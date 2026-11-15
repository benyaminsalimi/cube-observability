/**
 * Dashboard definitions, expressed as query keys rather than PromQL strings.
 *
 * `tools/gen.mjs` resolves each key through tools/queries.mjs, so metric names never
 * appear in this file.
 */

export const DASHBOARDS = [
  {
    file: 'overview',
    title: 'Cube — Overview',
    description: 'Request volume, errors, latency, cache effectiveness and in-flight load.',
    panels: [
      { title: 'Requests / s', type: 'stat', query: 'requestRate', unit: 'reqps' },
      { title: 'Error ratio', type: 'stat', query: 'errorRatio', unit: 'percentunit' },
      { title: 'p95 load latency', type: 'stat', query: 'latencyP95', unit: 's' },
      { title: 'Cache hit ratio', type: 'stat', query: 'cacheHitRatio', unit: 'percentunit' },
      { title: 'Requests by API type', type: 'timeseries', query: 'requestsByApiType', unit: 'reqps' },
      { title: 'Errors / s', type: 'timeseries', query: 'errorRate', unit: 'reqps' },
      { title: 'p95 latency by API type', type: 'timeseries', query: 'latencyP95ByApiType', unit: 's' },
      { title: 'In-flight requests', type: 'timeseries', query: 'requestsInFlight', unit: 'short' },
    ],
  },
  {
    file: 'api-performance',
    title: 'Cube — API & query performance',
    description: 'Latency percentiles, database time, SQL generation and orchestrator pressure.',
    panels: [
      { title: 'p50 load latency', type: 'timeseries', query: 'latencyP50', unit: 's' },
      { title: 'p95 load latency', type: 'timeseries', query: 'latencyP95', unit: 's' },
      { title: 'p99 load latency', type: 'timeseries', query: 'latencyP99', unit: 's' },
      { title: 'p95 data source query time', type: 'timeseries', query: 'dbLatencyP95', unit: 's' },
      { title: 'p95 SQL generation time', type: 'timeseries', query: 'sqlGenerationP95', unit: 's' },
      { title: 'p95 queue wait', type: 'timeseries', query: 'queueWaitP95', unit: 's' },
      { title: 'Continue wait ratio', type: 'timeseries', query: 'continueWaitRatio', unit: 'percentunit' },
      { title: 'Data source queries by status', type: 'timeseries', query: 'dbQueriesByStatus', unit: 'reqps' },
      { title: 'Top events', type: 'timeseries', query: 'topEvents', unit: 'ops' },
      { title: 'Dropped telemetry', type: 'timeseries', query: 'droppedEvents', unit: 'ops' },
    ],
  },
  {
    file: 'cache-preaggregation',
    title: 'Cube — Cache & pre-aggregations',
    description: 'Cache outcomes, pre-aggregation coverage, build health and build duration.',
    panels: [
      { title: 'Cache hit ratio', type: 'stat', query: 'cacheHitRatio', unit: 'percentunit' },
      { title: 'Pre-aggregation coverage', type: 'stat', query: 'preaggregationRatio', unit: 'percentunit' },
      { title: 'Cache lookups by outcome', type: 'timeseries', query: 'cacheByOutcome', unit: 'ops' },
      { title: 'Pre-aggregation build outcomes', type: 'timeseries', query: 'buildOutcomes', unit: 'ops' },
      { title: 'p95 build duration', type: 'timeseries', query: 'buildDurationP95', unit: 's' },
      { title: 'Failed builds (15m)', type: 'stat', query: 'buildFailures', unit: 'short' },
    ],
  },
  {
    file: 'refresh-worker',
    title: 'Cube — Refresh worker',
    description: 'Scheduler heartbeat, scheduler errors and worker resource use.',
    panels: [
      { title: 'Scheduler runs / s', type: 'timeseries', query: 'schedulerRuns', unit: 'ops' },
      { title: 'Scheduler errors / s', type: 'timeseries', query: 'schedulerErrors', unit: 'ops' },
      { title: 'Scheduler missing', type: 'stat', query: 'schedulerAbsent', unit: 'short' },
      { title: 'Resident memory by pod', type: 'timeseries', query: 'memoryByPod', unit: 'bytes' },
      { title: 'CPU cores by pod', type: 'timeseries', query: 'cpuByPod', unit: 'short' },
      { title: 'Unmapped events (drift)', type: 'table', query: 'unmappedEvents', unit: 'short' },
    ],
  },
];
