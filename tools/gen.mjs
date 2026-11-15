#!/usr/bin/env node
/**
 * Generates dashboards and alert rules from the metric catalog.
 *
 *   node tools/gen.mjs           write files
 *   node tools/gen.mjs --check   fail if the committed files are stale
 *
 * Metric names and Cube event names come from the package (catalog.js, contract.js);
 * this tool only decides layout and thresholds.
 */

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { buildQueries } from './queries.mjs';
import { DASHBOARDS } from './dashboard-spec.mjs';
import { ALERT_DEFAULTS } from './alert-defaults.mjs';

const require = createRequire(import.meta.url);
const catalog = require('../packages/cube-prometheus/src/catalog.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHART = path.join(ROOT, 'charts', 'cube-observability', 'files');
const DASHBOARD_DIR = path.join(CHART, 'dashboards');
const RULES_FILE = path.join(CHART, 'rules.yml');

const check = process.argv.includes('--check');
const queries = buildQueries('cube');

const DATASOURCE = { type: 'prometheus', uid: '${datasource}' };

function panelId(index) {
  return index + 1;
}

function buildPanel(panel, index, cursor) {
  const width = panel.type === 'stat' ? 6 : 12;
  const height = panel.type === 'stat' ? 4 : 8;
  const gridPos = { ...cursor };
  if (panel.type === 'stat') {
    gridPos.w = width;
    gridPos.h = height;
  } else {
    gridPos.w = width;
    gridPos.h = height;
  }
  cursor.x += width;
  if (cursor.x >= 24) {
    cursor.x = 0;
    cursor.y += height;
  }

  const base = {
    id: panelId(index),
    title: panel.title,
    type: panel.type,
    datasource: DATASOURCE,
    gridPos,
    targets: [{ refId: 'A', expr: queries[panel.query](), legendFormat: panel.legendFormat || undefined }],
  };

  if (panel.type === 'stat') {
    return {
      ...base,
      options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'value', graphMode: 'area' },
      fieldConfig: { defaults: { unit: panel.unit, decimals: 2 }, overrides: [] },
    };
  }

  if (panel.type === 'table') {
    return {
      ...base,
      options: { showHeader: true },
      fieldConfig: { defaults: { unit: panel.unit }, overrides: [] },
    };
  }

  return {
    ...base,
    options: { legend: { displayMode: 'table', placement: 'bottom', calcs: ['mean', 'max'] }, tooltip: { mode: 'multi' } },
    fieldConfig: { defaults: { unit: panel.unit, custom: { fillOpacity: 10, lineWidth: 2, showPoints: 'never' } }, overrides: [] },
  };
}

function buildDashboard(spec) {
  const cursor = { x: 0, y: 0, w: 0, h: 0 };
  const panels = spec.panels.map((panel, index) => buildPanel(panel, index, cursor));
  return {
    uid: `cube-${spec.file}`,
    title: spec.title,
    description: spec.description,
    tags: ['cube', 'observability'],
    schemaVersion: 39,
    version: 1,
    editable: true,
    graphTooltip: 1,
    time: { from: 'now-6h', to: 'now' },
    refresh: '30s',
    templating: {
      list: [
        {
          name: 'datasource',
          label: 'Data source',
          type: 'datasource',
          query: 'prometheus',
          current: {},
          hide: 0,
        },
      ],
    },
    panels,
  };
}

function alertRule(name, expr, forDuration, severity, summary) {
  return [
    `      - alert: ${name}`,
    `        expr: '${expr}'`,
    `        for: ${forDuration}`,
    '        labels:',
    `          severity: ${severity}`,
    '        annotations:',
    `          summary: ${JSON.stringify(summary)}`,
    '          runbook: docs/operations.md',
  ].join('\n');
}

function buildRules() {
  const namespace = '__NAMESPACE__';
  const matches = (label) => `${label}{namespace="${namespace}"}`;
  const buildInfo = catalog.fullName('cube', 'buildInfo');
  const eventsTotal = catalog.fullName('cube', 'eventsTotal');
  const buildsTotal = catalog.fullName('cube', 'preaggregationBuilds');
  const unmapped = catalog.fullName('cube', 'unmappedEvents');

  const rules = [
    alertRule(
      'CubeApiMetricsMissing',
      `absent(${matches(buildInfo)})`,
      ALERT_DEFAULTS.apiDown.for,
      'critical',
      'No Cube API pod is reporting metrics: either the deployment is down or the exporter stopped.'
    ),
    alertRule(
      'CubeApiErrorRatioHigh',
      `${queries.errorRatio().replace(/\$__rate_interval/g, '5m')} > ${ALERT_DEFAULTS.errorRatio.threshold}`,
      ALERT_DEFAULTS.errorRatio.for,
      'warning',
      'More than the configured share of Cube API requests are failing.'
    ),
    alertRule(
      'CubeApiLatencyHigh',
      queries
        .latencyBudget(ALERT_DEFAULTS.latency.p95Seconds)
        .replace(/\$__rate_interval/g, '5m'),
      ALERT_DEFAULTS.latency.for,
      'warning',
      'p95 Cube API latency is above the configured budget.'
    ),
    alertRule(
      'CubeQueuePressureHigh',
      queries
        .queuePressure(ALERT_DEFAULTS.queuePressure.ratio)
        .replace(/\$__rate_interval/g, '5m'),
      ALERT_DEFAULTS.queuePressure.for,
      'warning',
      'A large share of load requests are answering "Continue wait": the deployment is under-provisioned or the data source is slow.'
    ),
    alertRule(
      'CubeRefreshSchedulerStale',
      `absent(${eventsTotal}{event="${require('../packages/cube-prometheus/src/contract.js').EVENT_NAMES.schedulerRun[0]}", namespace="${namespace}"})`,
      ALERT_DEFAULTS.refreshStale.for,
      'critical',
      'The refresh worker has not reported a scheduler run: pre-aggregations are not being refreshed.'
    ),
    alertRule(
      'CubePreaggregationBuildFailures',
      `increase(${buildsTotal}{status="error"}[15m]) > 0`,
      ALERT_DEFAULTS.buildFailure.for,
      'warning',
      'A pre-aggregation build failed in the last 15 minutes.'
    ),
    alertRule(
      'CubeTelemetryUnmappedEvents',
      `increase(${unmapped}[1h]) > 0`,
      '5m',
      'info',
      'Cube emitted event names the exporter does not know: the metric contract needs updating for this Cube version.'
    ),
  ];

  return [
    '# Generated by tools/gen.mjs. Do not edit by hand.',
    '  - name: cube-observability',
    '    rules:',
    rules.join('\n'),
    '',
  ].join('\n');
}

function buildMetricsDoc() {
  const contract = require('../packages/cube-prometheus/src/contract.js');

  const effect = {
    requestStarted: 'requests_in_flight +1, events_total',
    requestSucceeded: 'requests_total{status="success"}, request_duration_seconds, preaggregation_served_total',
    requestFailed: 'requests_total{status="error"}, requests_in_flight -1',
    requestContinued: 'events_total only (a load spans several HTTP attempts)',
    dbSucceeded: 'db_queries_total{status="success"}, db_query_duration_seconds',
    dbFailed: 'db_queries_total{status="error"}',
    queueCompleted: 'queue_wait_seconds, and preaggregation_builds_total + build_duration_seconds when preAggregationId is set',
    queueFailed: 'preaggregation_builds_total{status="error"} when preAggregationId is set',
    sqlGenerated: 'sql_generation_duration_seconds',
    schedulerRun: 'events_total, used by the refresh heartbeat alert',
    schedulerFailed: 'events_total, used by the refresh alerts',
    preaggregationBuildStarted: 'events_total',
    preaggregationBuildFailed: 'events_total',
  };

  const metricRows = Object.keys(catalog.METRICS).map((key) => {
    const spec = catalog.METRICS[key];
    const labels = spec.labelNames.length ? spec.labelNames.map((label) => `\`${label}\``).join(', ') : '—';
    return `| \`${catalog.fullName('cube', key)}\` | ${spec.type} | ${labels} | ${spec.help} |`;
  });

  const eventRows = Object.entries(contract.EVENT_NAMES).map(([group, names]) => (
    `| ${group} | ${names.map((name) => `\`${name}\``).join(', ')} | ${effect[group] || 'events_total'} |`
  ));

  const cacheRows = Object.entries(contract.CACHE_OUTCOMES).map(([name, outcome]) => (
    `| \`${name}\` | \`${outcome}\` |`
  ));

  return [
    '<!-- Generated by tools/gen.mjs from packages/cube-prometheus/src/{catalog,contract}.js. Do not edit by hand. -->',
    '',
    '# Metric reference',
    '',
    'Every series below is published with the `cube_` prefix by default (`CUBE_METRICS_PREFIX`).',
    'Durations are in **seconds**; Cube reports milliseconds and the exporter converts.',
    '',
    '## Series',
    '',
    '| Metric | Type | Labels | Meaning |',
    '| --- | --- | --- | --- |',
    ...metricRows,
    '',
    'Runtime families from `collectDefaultMetrics` are published under the same prefix:',
    ...catalog.DEFAULT_METRIC_FAMILIES.map((family) => `- \`cube_${family}\``),
    '',
    'Cube Store publishes its own `cs_*` families through `statsd_exporter`; they are not',
    'part of this catalog and are documented by the Cube Store chart.',
    '',
    '## Event mapping',
    '',
    'Cube event names are the ABI. `make test-contract` verifies each one against a Cube',
    'checkout, and `tools/gen.mjs` builds the dashboards from the same table.',
    '',
    '| Family | Events | Effect |',
    '| --- | --- | --- |',
    ...eventRows,
    '',
    '## Cache outcomes',
    '',
    'Only the terminal event of a lookup is counted, so the hit ratio is not inflated by',
    'precursor events such as `Found cache entry`.',
    '',
    '| Event | `outcome` label |',
    '| --- | --- |',
    ...cacheRows,
    '',
    '## Deliberate omissions',
    '',
    '- No query text, SQL, request id, tenant or cache key in any label.',
    '- No `status` label on HTTP requests: Cube logs the request before the handler runs,',
    '  so a reliable status code needs a core change (tracked upstream).',
    '- No queue depth gauge: Cube logs queue size only at enqueue time, which over-reports',
    '  after a burst drains. `Continue wait` ratio and `queue_wait_seconds` are the honest',
    '  saturation signals available today.',
    '',
    '## Drift detection',
    '',
    '`cube_telemetry_unmapped_events_total{event}` increments when Cube emits an event the',
    'contract does not know. The `CubeTelemetryUnmappedEvents` alert fires on it, which is',
    'the signal to run the `cube-upstream-contract` skill after a Cube upgrade.',
    '',
  ].join('\n');
}

function emit(target, content) {
  if (check) {
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing !== content) {
      console.error(`stale: ${path.relative(ROOT, target)} (run: make gen)`);
      return false;
    }
    return true;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote ${path.relative(ROOT, target)}`);
  return true;
}

let ok = true;
for (const spec of DASHBOARDS) {
  ok = emit(path.join(DASHBOARD_DIR, `${spec.file}.json`), `${JSON.stringify(buildDashboard(spec), null, 2)}\n`) && ok;
}
ok = emit(RULES_FILE, buildRules()) && ok;
ok = emit(path.join(ROOT, 'docs', 'metrics.md'), buildMetricsDoc()) && ok;

if (check && ok) console.log('generated files are up to date');
process.exit(ok ? 0 : 1);
