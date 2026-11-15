# cube_observability

Prometheus metrics, alert rules and Grafana dashboards for a **self-hosted Cube (OSS)**
deployment. No fork of Cube, no fork of your Helm chart, and no vendor account.

- npm package: [`@cube_oss/cube-prometheus`](https://www.npmjs.com/package/@cube_oss/cube-prometheus)
- chart + image + e2e (this repository): [benyaminsalimi/cube-observability](https://github.com/benyaminsalimi/cube-observability)
- package source: [benyaminsalimi/cube-prometheus](https://github.com/benyaminsalimi/cube-prometheus)

`packages/cube-prometheus` here is a **git submodule** pointing at the package repository's
`main` branch. The package is not duplicated: edit it in
`cube-prometheus`, then bump the pointer here.

The package is released **only** from its own repository, and its version mirrors the Cube
release: Cube `v1.8.25` → `@cube_oss/cube-prometheus@1.8.25`. The exporter image installs
that exact version from the registry, so an upgrade moves the Cube tag and the package
version together.

```bash
git clone --recurse-submodules https://github.com/benyaminsalimi/cube-observability.git
# or, in an existing clone
git submodule update --init --recursive
```

To ship a package change into the image, commit it in the package repository, then:

```bash
cd packages/cube-prometheus && git pull origin main && cd ../..
git add packages/cube-prometheus && git commit -m "chore: bump cube-prometheus"
```

### Boundaries

| Repository | Owns | Must not contain |
| --- | --- | --- |
| [cube-prometheus](https://github.com/benyaminsalimi/cube-prometheus) | all JavaScript: `src/`, `test/`, the npm release and its GitHub Actions workflow | chart, image, dashboards, Cube checkouts |
| cube-observability (this repo) | chart, image, e2e, generated dashboards/rules, contract check, docs | a second copy of the package code |

The submodule is a pointer, not a copy: there is exactly one source for the JS, and exactly
one place that publishes it. This repository re-checks the package's assumptions against a
real Cube checkout (`make test-contract`) but never publishes on its behalf.

### Release flow

1. In **cube-prometheus**: bump `version` in `package.json` — it must equal the Cube release
   the package targets, without the `v` (`v1.8.25` → `1.8.25`).
2. Push a `v<version>` tag. The repository's `publish` workflow runs the unit tests, asserts
   the tag matches `package.json`, and publishes with provenance.
3. In **this repository**: bump the Cube version markers (see
   [`docs/upgrade-cube.md`](docs/upgrade-cube.md)) — the image derives the package version
   from `CUBE_VERSION`, so the two never drift.
4. `make image && make e2e`.

Step 2 is the only way a version reaches npm. Nothing is back-filled: each Cube upgrade gets
exactly one new package version.

Cube OSS exposes only `/livez` and `/readyz`. It does, however, emit a structured logger
event for every request, database query, cache decision and refresh cycle. This project
turns that existing signal into a scrape surface, a log stream and a correlation id —
using only Cube's public `logger` config option.

```
┌──────────── Cube API pod ────────────────┐
│ cube.js → logger tap → prom-client       │──► :9464 /metrics ◄── PodMonitor (targetPort)
│         └─► NDJSON stdout                │──► collector ──► Loki
└──────────────────────────────────────────┘
┌──────── Cube Store router/workers ───────┐
│ native StatsD → statsd_exporter :9102    │──► cs_*            ◄── PodMonitor/ServiceMonitor
└──────────────────────────────────────────┘
      Prometheus ──► Grafana (4 dashboards) ──► Alertmanager (7 rules)
```

## Layout

| Path | What it is | Publishable as |
| --- | --- | --- |
| `packages/cube-prometheus` | the npm package (submodule → `cube-prometheus`) | `npm publish` from that repo |
| `images/exporter` | `FROM cubejs/cube` + the published package, with a default `cube.js` | container image |
| `charts/cube-observability` | PodMonitors, PrometheusRule, dashboard ConfigMaps | Helm chart |
| `tools` | contract check, generator, validators | — |
| `e2e` | real Cube + real Postgres + real scrape | — |
| `docs` | metric reference (generated), runbook, upgrade guide | — |

## Prerequisites

- Node 20+ and `npm`
- Docker (for the end-to-end test)
- Optional: `make tools` fetches `helm` and `promtool` into `.tools/` for chart and rule checks

## Quick start

If you only want the exporter in your own Cube image:

```bash
npm install @cube_oss/cube-prometheus@1.8.25   # same number as your cubejs/cube tag
# cube.js
module.exports = require('@cube_oss/cube-prometheus').withMetrics({ ...yourConfig });
```

Working on this repository:

```bash
make tools      # helm + promtool into .tools/ (optional but recommended)
make gen        # regenerate dashboards, rules and docs/metrics.md
make test       # unit, generation check, contract check, static checks, chart render
make e2e        # real Cube + Postgres + scrape, ~2 minutes
```

## Use it

**1. Build and push the exporter image for your Cube version.**

```bash
make image CUBE_VERSION=v1.8.25 IMAGE=registry.example.com/cube-exporter:v1.8.25
docker push registry.example.com/cube-exporter:v1.8.25
```

**2. Deploy Cube with that image.** Any chart works; set the image and one env var:

```yaml
image:
  repository: registry.example.com/cube-exporter
  tag: v1.8.25
config:
  extraEnvVars:
    - name: CUBE_METRICS_PORT
      value: "9464"
```

The image already ships `/cube/conf/cube.js`, which enables the exporter. If you mount your
own `cube.js`, add one line to it instead:

```js
module.exports = require('@cube_oss/cube-prometheus').withMetrics({ ...yourConfig });
```

**3. Install the chart next to it.**

```bash
helm install cube-observability ./charts/cube-observability \
  --namespace cube \
  --set cube.selectorLabels.app\.kubernetes\.io/name=cube
```

That installs two PodMonitors (API and worker), the alert rules and the dashboards. The
PodMonitors scrape the pod IP directly with `targetPort`, so they need no Service port and
no container port declaration — which is why nothing in your Cube chart has to change.

**4. Point Grafana at Prometheus.** The dashboard ConfigMaps are labelled
`grafana_dashboard=1`, so a kube-prometheus-stack sidecar imports them automatically.

## Configuration

All options are env vars read once at startup; nothing else in the codebase reads
`process.env`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUBE_METRICS_ENABLED` | `true` | `false` disables the tap entirely |
| `CUBE_METRICS_PORT` | `9464` | listener port; `0` disables the listener |
| `CUBE_METRICS_HOST` | `0.0.0.0` | listener address |
| `CUBE_METRICS_PATH` | `/metrics` | endpoint path |
| `CUBE_METRICS_PREFIX` | `cube` | metric prefix (matches Cube Cloud's naming) |
| `CUBE_METRICS_TOKEN` | — | optional bearer token for scrapes |
| `CUBE_METRICS_LABELS` | `{}` | JSON object of static labels |
| `CUBE_METRICS_LOGS` | `json` | `json` (NDJSON only), `passthrough` (NDJSON + Cube's logger), `none` |

## Metrics

See [docs/metrics.md](docs/metrics.md) — generated from the catalog, so it cannot drift.

Two properties worth knowing before you build on them:

- Durations are **seconds**; Cube reports milliseconds and the exporter converts.
- **No content in labels**: no query text, SQL, request id or tenant. Query-level detail is
  in the log stream, joined by `trace_id`.

## The trace id

Cube threads one id from the HTTP entry point through to the SQL it sends to the warehouse.
The exporter strips the `-span-N` suffix and publishes it as `trace_id` on every log line.

Enable the SQL comment so the join reaches your database too:

```yaml
config:
  extraEnvVars:
    - name: CUBEJS_SQL_INCLUDE_TRACE_ID
      value: "true"
```

Now one id links: the metric observation → the NDJSON log line → the warehouse query.

## What this does not do

- **No query history UI.** That needs a store and a different product; this is monitoring.
- **No traces.** Cube OSS emits no spans; faking them would be worse than not having them.
- **No queue-depth gauge.** Cube logs queue size only at enqueue time, which over-reports
  after a burst drains. `Continue wait` ratio and `queue_wait_seconds` are the honest
  signals available today. A core PR is tracked in `docs/operations.md`.
- **No Cube Store metrics.** Its chart already ships `statsd_exporter`; use it as-is.

## Testing

| Command | Proves |
| --- | --- |
| `make test-unit` | mapping, log records, config, server, package API (59 tests, no cluster) |
| `make test-gen` | committed dashboards/rules/docs match the catalog |
| `make test-contract` | every Cube assumption still holds against a checkout |
| `make test-static` | dashboards reference only real series and events; rules parse (`promtool`) |
| `make test-render` | chart renders 2 PodMonitors, 4 dashboards, rules; everything can be disabled |
| `make e2e` | real Cube answers a load; one request id appears in the metric path, the log line and the warehouse SQL |
| `make grafana` | the same stack plus Prometheus and Grafana; every dashboard panel is queried **through Grafana's own datasource proxy** |

## Upgrading Cube

There is an agent skill for this: **`.opencode/skills/cube-upstream-contract`**. It walks
through the contract check, what each failure means, and how to update the metric contract
without loosening the check.

`make test-contract` after every Cube bump. If Cube renames an event, that check fails
before a dashboard goes empty. The full procedure — including the decision tree for
renames vs new vs benign events — is the `cube-upstream-contract` skill and
[docs/upgrade-cube.md](docs/upgrade-cube.md).

---

## Example: from zero to a dashboard in one session

This is the exact flow the end-to-end test automates.

```bash
# 1. Build the exporter for your Cube release
make image CUBE_VERSION=v1.8.25 IMAGE=cube-exporter:v1.8.25

# 2. Deploy Cube with it (any chart) and turn on trace correlation
helm upgrade --install cube gadsme/cube --namespace cube --reuse-values \
  --set image.repository=cube-exporter \
  --set image.tag=v1.8.25 \
  --set 'config.extraEnvVars[0].name=CUBE_METRICS_PORT' \
  --set 'config.extraEnvVars[0].value=9464' \
  --set 'config.extraEnvVars[1].name=CUBEJS_SQL_INCLUDE_TRACE_ID' \
  --set 'config.extraEnvVars[1].value=true'

# 3. Attach monitoring
helm install cube-observability ./charts/cube-observability --namespace cube

# 4. Send a request with your own id
TOKEN=$(node -e '/* HS256 JWT signed with CUBEJS_API_SECRET, see e2e/run.sh */')
curl -s -X POST http://localhost:4000/cubejs-api/v1/load \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "x-request-id: my-trace-1" \
  -d '{"query":{"measures":["orders.count"],"dimensions":["orders.status"]}}'

# 5. Watch the same request from three angles
curl -s http://localhost:9464/metrics | grep '^cube_requests_total'
kubectl -n cube logs deploy/cube | grep '"trace_id":"my-trace-1"'
psql "$DSN" -c "select query from pg_stat_activity where query like '%my-trace-1%'" 2>/dev/null \
  || kubectl -n db logs deploy/postgres | grep 'trace_id: my-trace-1'
```

The end-to-end test asserts all three carry `my-trace-1`. Run it against your own setup:

```bash
make e2e                                # builds, asserts, then removes everything
./e2e/run.sh --keep                     # keep the containers to poke at
./e2e/run.sh --no-build --keep          # reuse the image from a previous run
```

Expected output:

```
  ok   exporter image builds on top of cubejs/cube
  ok   Cube answers /livez
  ok   metrics endpoint is reachable
  ok   load request returns data
  ok   exposes cube_events_total after traffic
  ok   exposes cube_requests_total after traffic
  ok   exposes cube_db_queries_total after traffic
  ok   success counter increased
  ok   request histogram recorded observations
  ok   data source query counter increased
  ok   log record carries the caller's trace_id
  ok   log records are NDJSON with a pino msg field
  ok   warehouse SQL carries the same trace_id
  ok   three-way correlation: metric request -> log line -> warehouse query
16 passed, 0 failed
```
