#!/usr/bin/env bash
#
# End-to-end test: real Cube, real Postgres, real scrape.
#
# Proves the three claims that matter:
#   1. the exporter serves metrics on a real Cube process;
#   2. a real load request moves the right series;
#   3. one request id appears in the log line AND in the SQL the warehouse received.
#
# Usage: e2e/run.sh [--keep] [--no-build]
set -uo pipefail

cd "$(dirname "$0")"

KEEP=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --no-build) BUILD=0 ;;
  esac
done

CUBE_PORT=${CUBE_PORT:-14000}
METRICS_PORT=${METRICS_PORT:-19464}
PROJECT=${COMPOSE_PROJECT_NAME:-cube-observability-e2e}
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.yml)
API="http://127.0.0.1:${CUBE_PORT}/cubejs-api/v1"
METRICS="http://127.0.0.1:${METRICS_PORT}/metrics"
SECRET="e2e-secret-not-a-real-secret"
REQUEST_ID="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n         %s\n' "$1" "${2:-}"; }

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  else
    printf '\nkept: docker compose -p %s -f docker-compose.yml logs\n' "$PROJECT"
  fi
}
trap cleanup EXIT

wait_for() {
  local url="$1" attempts="${2:-60}" i=0
  until curl -fsS -m 2 "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$attempts" ]; then return 1; fi
    sleep 2
  done
  return 0
}

token() {
  node -e '
const crypto = require("crypto");
const secret = process.argv[1];
const now = Math.floor(Date.now() / 1000);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({ sub: "e2e", iat: now, exp: now + 3600 });
const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${signature}`);
' "$SECRET"
}

load_query() {
  local token="$1"
  curl -sS -m 30 -X POST "${API}/load" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -H "x-request-id: ${REQUEST_ID}" \
    -d '{"query":{"measures":["orders.count"],"dimensions":["orders.status"]}}'
}

printf 'build\n'
if [ "$BUILD" -eq 1 ]; then
  if "${COMPOSE[@]}" build --progress plain cube >/tmp/cube-e2e-build.log 2>&1; then
    ok "exporter image builds on top of cubejs/cube"
  else
    bad "exporter image builds" "see /tmp/cube-e2e-build.log"
    # Surface the underlying npm/docker error, not just the failing Dockerfile line.
    grep -iE "npm (err|error)|EACCES|ENOENT|not found|404|403|failed to|did not complete" \
      /tmp/cube-e2e-build.log | tail -20 || tail -40 /tmp/cube-e2e-build.log
    exit 1
  fi
fi

printf '\nstart\n'
"${COMPOSE[@]}" up -d >/tmp/cube-e2e-up.log 2>&1 || { bad "compose up" "see /tmp/cube-e2e-up.log"; exit 1; }

if wait_for "http://127.0.0.1:${CUBE_PORT}/livez" 90; then
  ok "Cube answers /livez"
else
  bad "Cube answers /livez" "$("${COMPOSE[@]}" logs --tail 30 cube 2>&1 | tail -20)"
  exit 1
fi

if wait_for "$METRICS" 30; then
  ok "metrics endpoint is reachable"
else
  bad "metrics endpoint is reachable"
  exit 1
fi

printf '\nmetrics endpoint\n'
EXPOSITION="$(curl -sS "$METRICS")"
if printf '%s' "$EXPOSITION" | grep -q "^cube_build_info"; then
  ok "exposes cube_build_info before any traffic"
else
  bad "exposes cube_build_info before any traffic"
fi

if printf '%s' "$EXPOSITION" | grep -q 'deployment="e2e"'; then
  ok "static labels from CUBE_METRICS_LABELS are applied"
else
  bad "static labels from CUBE_METRICS_LABELS are applied"
fi

printf '\nrequest path\n'
TOKEN="$(token)"
SUCCESS=0
for attempt in $(seq 1 20); do
  BODY="$(load_query "$TOKEN")"
  if printf '%s' "$BODY" | grep -q 'Continue wait'; then
    sleep 1
    continue
  fi
  if printf '%s' "$BODY" | grep -q '"data"'; then
    SUCCESS=1
    break
  fi
  bad "load request returns data" "$BODY"
  break
done

if [ "$SUCCESS" -eq 1 ]; then
  ok "load request returns data"
else
  bad "load request returns data"
fi

sleep 3
EXPOSITION="$(curl -sS "$METRICS")"
for series in cube_events_total cube_requests_total cube_db_queries_total; do
  if printf '%s' "$EXPOSITION" | grep -q "^${series}"; then
    ok "exposes ${series} after traffic"
  else
    bad "exposes ${series} after traffic"
  fi
done
if printf '%s' "$EXPOSITION" | grep -qE '^cube_requests_total\{[^}]*status="success"[^}]*\} [1-9]'; then
  ok "success counter increased"
else
  bad "success counter increased" "$(printf '%s' "$EXPOSITION" | grep '^cube_requests_total' | head -3)"
fi

if printf '%s' "$EXPOSITION" | grep -qE '^cube_request_duration_seconds_count\{[^}]*\} [1-9]'; then
  ok "request histogram recorded observations"
else
  bad "request histogram recorded observations"
fi

if printf '%s' "$EXPOSITION" | grep -qE '^cube_db_queries_total\{[^}]*status="success"[^}]*\} [1-9]'; then
  ok "data source query counter increased"
else
  bad "data source query counter increased"
fi

printf '\ntrace correlation\n'
# Captured once: piping a long `docker compose logs` into `grep -q` lets grep exit on the
# first match and SIGPIPE the producer, which `pipefail` then reports as a failure.
CUBE_LOGS="$("${COMPOSE[@]}" logs cube 2>&1)"
PG_LOGS="$("${COMPOSE[@]}" logs postgres 2>&1)"

count() { printf '%s' "$1" | grep -c -- "$2" || true; }

if [ "$(count "$CUBE_LOGS" "\"trace_id\":\"${REQUEST_ID}\"")" -gt 0 ]; then
  ok "log record carries the caller's trace_id"
else
  bad "log record carries the caller's trace_id" "$(printf '%s' "$CUBE_LOGS" | grep -m1 'Load Request Success' | cut -c1-200)"
fi

if [ "$(count "$CUBE_LOGS" '"msg":"Load Request Success"')" -gt 0 ]; then
  ok "log records are NDJSON with a pino msg field"
else
  bad "log records are NDJSON with a pino msg field"
fi

if [ "$(count "$PG_LOGS" "trace_id: ${REQUEST_ID}")" -gt 0 ]; then
  ok "warehouse SQL carries the same trace_id"
else
  bad "warehouse SQL carries the same trace_id" "$(printf '%s' "$PG_LOGS" | grep -m1 'select' | cut -c1-160)"
fi

if [ "$(count "$CUBE_LOGS" "\"trace_id\":\"${REQUEST_ID}\"")" -gt 0 ] \
   && [ "$(count "$PG_LOGS" "trace_id: ${REQUEST_ID}")" -gt 0 ] \
   && [ "$(count "$EXPOSITION" '^cube_requests_total{.*status="success"')" -gt 0 ]; then
  ok "three-way correlation: metric request -> log line -> warehouse query"
else
  bad "three-way correlation: metric request -> log line -> warehouse query"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
