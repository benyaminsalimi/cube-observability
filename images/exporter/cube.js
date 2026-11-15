/**
 * Default Cube configuration for the exporter image.
 *
 * Every setting comes from the environment, so this file stays a one-liner and users
 * who need their own configuration mount over it.
 *
 *   CUBE_METRICS_ENABLED   false disables the exporter entirely
 *   CUBE_METRICS_PORT      listener port (default 9464)
 *   CUBE_METRICS_PATH      endpoint path (default /metrics)
 *   CUBE_METRICS_PREFIX    metric prefix (default cube)
 *   CUBE_METRICS_LOGS      json | passthrough | none
 *   CUBE_METRICS_TOKEN     optional bearer token
 *   CUBE_METRICS_LABELS    JSON object of static labels
 */
module.exports = require('@cube_oss/cube-prometheus').withMetrics({});
