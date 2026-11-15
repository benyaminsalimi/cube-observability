#!/usr/bin/env bash
#
# Grafana verification: brings up Cube + Postgres + Prometheus + Grafana, drives traffic,
# then asks Grafana to run every dashboard panel's query through its own datasource.
#
# Usage: e2e/grafana.sh [--keep] [--no-build]
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

PROJECT=${COMPOSE_PROJECT_NAME:-cube-observability-e2e}
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.yml --profile observability)
CUBE_VERSION=${CUBE_VERSION:-$(node ../tools/cube-version.mjs)}
export CUBE_VERSION
export GRAFANA_URL=${GRAFANA_URL:-http://127.0.0.1:13000}
export PROMETHEUS_URL=${PROMETHEUS_URL:-http://127.0.0.1:19090}
export CUBE_API=${CUBE_API:-http://127.0.0.1:14000/cubejs-api/v1}

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  else
    printf '\nkept: grafana %s (admin/admin), prometheus %s\n' "$GRAFANA_URL" "$PROMETHEUS_URL"
  fi
}
trap cleanup EXIT

if [ "$BUILD" -eq 1 ]; then
  "${COMPOSE[@]}" build cube >/tmp/cube-grafana-build.log 2>&1 \
    && echo "  ok   exporter image builds" \
    || { echo "  FAIL exporter image builds (see /tmp/cube-grafana-build.log)"; exit 1; }
fi

"${COMPOSE[@]}" up -d >/tmp/cube-grafana-up.log 2>&1 \
  || { echo "  FAIL compose up (see /tmp/cube-grafana-up.log)"; tail -20 /tmp/cube-grafana-up.log; exit 1; }

node verify-grafana.mjs
exit $?
