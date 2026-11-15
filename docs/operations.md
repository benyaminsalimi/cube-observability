# Operations

## What this stack is responsible for

| Signal | Owner | Where it comes from |
| --- | --- | --- |
| `cube_*` | this project | the exporter's logger tap |
| `cs_*` | Cube Store chart | native StatsD through `statsd_exporter` |
| `process_*`, `kube_*` | kube-prometheus-stack | cAdvisor and kube-state-metrics |
| logs | this project + collector | NDJSON on stdout |

## Alerts

| Alert | Meaning | First checks |
| --- | --- | --- |
| `CubeApiMetricsMissing` | no API pod reports metrics for 2m | is the pod running? is the exporter image the one deployed? `curl :9464/metrics` in the pod |
| `CubeApiErrorRatioHigh` | >5% of requests failing for 10m | `cube_events_total` by event; recent deploy; data source reachability |
| `CubeApiLatencyHigh` | p95 load latency >10s for 10m | `cube_db_query_duration_seconds` (warehouse) vs `cube_sql_generation_duration_seconds` (Cube); if the DB dominates, scaling Cube will not help |
| `CubeQueuePressureHigh` | >20% of loads answer `Continue wait` for 10m | `cube_queue_wait_seconds`; concurrency and replica count; a shared Cube Store queue means scaling out does not reduce queue wait |
| `CubeRefreshSchedulerStale` | no scheduler run for 10m | is the refresh worker running with `CUBEJS_REFRESH_WORKER=true`? is the PodMonitor selecting it? |
| `CubePreaggregationBuildFailures` | a build failed in 15m | `cube_preaggregation_builds_total{status="error"}`; build logs (`Pre-aggregations build job error`) |
| `CubeTelemetryUnmappedEvents` | Cube emitted an event the exporter does not know | run the `cube-upstream-contract` skill; the metric contract needs updating for that Cube version |

Every dashboard panel and alert rule is generated from `packages/cube-prometheus/src/catalog.js`
and `contract.js`. If you need a new panel, add it to `tools/dashboard-spec.mjs` and run
`make gen`; do not hand-edit the JSON.

## Autoscaling

- **CPU is the default and the only signal to trust today.** Set `resources.requests.cpu`;
  HPA `Utilization` is a percentage of the request.
- **`cube_requests_in_flight` is a safe custom metric**: it is per pod, so HPA averages it
  correctly across replicas.
- **Do not autoscale on queue depth with the `cubestore` driver.** The queue is shared, so
  every pod reports the same global number and the HPA chases its own tail.
- **Floor the replicas.** Caches are per process and a new pod must compile the data model
  before serving; `minReplicas: 2` is not waste, it is latency.
- **Never autoscale the refresh worker.** One replica, no HPA.

## Security

- The metrics endpoint publishes aggregate numbers only: no query text, no SQL, no tenant,
  no request id. It is still cluster-internal by design.
- Do not expose `:9464` through an ingress. If you must, set `CUBE_METRICS_TOKEN` and scrape
  with a bearer token.
- Log records whitelist fields and never include `query` or `params`; `CUBEJS_LOG_REDACTION`
  still applies to everything else.
- Suggested NetworkPolicy: allow ingress to the metrics port only from the Prometheus
  namespace.

## Retention

- Prometheus: 15d is a reasonable default; recording rules for the dashboard queries keep
  long ranges cheap.
- Loki: keep query-history-style log volume bounded by `CUBEJS_LOG_LEVEL=info`; `trace` is a
  firehose and is not required for any metric in this project.
