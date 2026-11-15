/**
 * Alert thresholds, in one place.
 *
 * The rule file is generated from these values. If you change a number here, run
 * `make gen` so the shipped rules follow.
 */
export const ALERT_DEFAULTS = {
  namespace: 'cube',
  apiDown: { for: '2m' },
  errorRatio: { threshold: 0.05, for: '10m' },
  latency: { p95Seconds: 10, for: '10m' },
  queuePressure: { ratio: 0.2, for: '10m' },
  refreshStale: { for: '10m' },
  buildFailure: { for: '1m' },
};
