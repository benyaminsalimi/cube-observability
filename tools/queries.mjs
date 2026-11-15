import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { metricNames } = require('../packages/cube-prometheus/src/catalog.js');
const { EVENT_NAMES } = require('../packages/cube-prometheus/src/contract.js');

/**
 * Every PromQL expression used by dashboards and alerts is built here from metric and
 * event names. No panel or rule may spell a series name itself, so a rename fails
 * `make gen --check` instead of silently emptying a graph.
 */
export function buildQueries(prefix = 'cube') {
  const n = metricNames(prefix);
  const bucket = (metric) => `${metric}_bucket`;
  const event = (key) => EVENT_NAMES[key][0];

  const rate = (expr, window = '$__rate_interval') => `rate(${expr}[${window}])`;
  const ratio = (numerator, denominator) => `${numerator} / clamp_min(${denominator}, 1e-9)`;
  const quantile = (q, expr) => `histogram_quantile(${q}, sum by (le) (${rate(expr)}))`;

  return {
    requestRate: () => `sum(${rate(n.requestsTotal)})`,
    requestsByApiType: () => `sum by (api_type) (${rate(n.requestsTotal)})`,
    errorRate: () => `sum(${rate(`${n.requestsTotal}{status="error"}`)})`,
    errorRatio: () => ratio(
      `sum(${rate(`${n.requestsTotal}{status="error"}`)})`,
      `sum(${rate(n.requestsTotal)})`
    ),
    requestsInFlight: () => `sum by (api_type) (${n.requestsInFlight})`,

    latencyP50: () => quantile(0.5, bucket(n.requestDuration)),
    latencyP95: () => quantile(0.95, bucket(n.requestDuration)),
    latencyP95ByApiType: () => `histogram_quantile(0.95, sum by (le, api_type) (${rate(bucket(n.requestDuration))}))`,
    latencyP99: () => quantile(0.99, bucket(n.requestDuration)),

    dbLatencyP95: () => quantile(0.95, bucket(n.dbQueryDuration)),
    dbQueriesByStatus: () => `sum by (status) (${rate(n.dbQueriesTotal)})`,
    sqlGenerationP95: () => quantile(0.95, bucket(n.sqlGenerationDuration)),
    queueWaitP95: () => quantile(0.95, bucket(n.queueWait)),

    cacheHitRatio: () => ratio(
      `sum(${rate(`${n.cacheRequests}{outcome="hit"}`)})`,
      `sum(${rate(n.cacheRequests)})`
    ),
    cacheByOutcome: () => `sum by (outcome) (${rate(n.cacheRequests)})`,
    preaggregationRatio: () => ratio(
      `sum(${rate(n.preaggregationServed)})`,
      `sum(${rate(`${n.requestsTotal}{status="success"}`)})`
    ),
    buildOutcomes: () => `sum by (status) (${rate(n.preaggregationBuilds)})`,
    buildDurationP95: () => quantile(0.95, bucket(n.preaggregationBuildDuration)),
    buildFailures: () => `sum(increase(${n.preaggregationBuilds}{status="error"}[15m]))`,

    continueWaitRatio: () => ratio(
      `sum(${rate(`${n.eventsTotal}{event="${event('requestContinued')}"}`)})`,
      `sum(${rate(`${n.eventsTotal}{event="${event('requestStarted')}"}`)})`
    ),
    topEvents: () => `topk(10, sum by (event) (${rate(n.eventsTotal)}))`,

    schedulerRuns: () => `sum(${rate(`${n.eventsTotal}{event="${event('schedulerRun')}"}`)})`,
    schedulerErrors: () => `sum(${rate(`${n.eventsTotal}{event="${event('schedulerFailed')}"}`)})`,
    schedulerAbsent: () => `absent(${n.eventsTotal}{event="${event('schedulerRun')}"})`,

    memoryByPod: () => `${prefix}_process_resident_memory_bytes`,
    cpuByPod: () => `sum by (pod) (rate(${prefix}_process_cpu_seconds_total[$__rate_interval]))`,
    buildInfo: () => `${n.buildInfo}`,
    droppedEvents: () => `sum by (reason) (${rate(n.dropped)})`,
    unmappedEvents: () => `sum by (event) (${n.unmappedEvents})`,

    apiDown: () => `absent(${n.buildInfo})`,
    latencyBudget: (seconds) => `${quantile(0.95, bucket(n.requestDuration))} > ${seconds}`,
    queuePressure: (threshold) => `${ratio(
      `sum(${rate(`${n.eventsTotal}{event="${event('requestContinued')}"}`)})`,
      `sum(${rate(`${n.eventsTotal}{event="${event('requestStarted')}"}`)})`
    )} > ${threshold}`,
    buildFailureIncrease: () => `sum(increase(${n.preaggregationBuilds}{status="error"}[15m])) > 0`,
  };
}

export const QUERY_KEYS = Object.keys(buildQueries());
