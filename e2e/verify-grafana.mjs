#!/usr/bin/env node
/**
 * Verifies the dashboards through Grafana itself.
 *
 * Not "does Prometheus have data" — Grafana is asked to run each panel's query through its
 * own datasource proxy, so provisioning, the datasource definition and the panel JSON are
 * all exercised the same way the UI would exercise them.
 *
 * Environment: GRAFANA_URL, PROMETHEUS_URL, CUBE_API, CUBE_SECRET.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const GRAFANA = process.env.GRAFANA_URL || 'http://127.0.0.1:13000';
const PROMETHEUS = process.env.PROMETHEUS_URL || 'http://127.0.0.1:19090';
const CUBE_API = process.env.CUBE_API || 'http://127.0.0.1:14000/cubejs-api/v1';
const SECRET = process.env.CUBE_SECRET || 'e2e-secret-not-a-real-secret';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DASHBOARD_DIR = path.join(ROOT, 'charts/cube-observability/files/dashboards');

let pass = 0;
let fail = 0;
const ok = (message) => { pass += 1; console.log(`  ok   ${message}`); };
const bad = (message, detail) => {
  fail += 1;
  console.log(`  FAIL ${message}${detail ? `\n         ${String(detail).slice(0, 300)}` : ''}`);
};

/** Panels that must return a series once traffic has flowed. */
const REQUIRED = [
  ['overview', 'Requests / s'],
  ['overview', 'p95 load latency'],
  ['overview', 'Requests by API type'],
  ['overview', 'In-flight requests'],
  ['api-performance', 'p95 data source query time'],
  ['api-performance', 'Top events'],
  ['cache-preaggregation', 'Cache lookups by outcome'],
  ['refresh-worker', 'Resident memory by pod'],
];

/** Panels whose query must execute, even when the result is legitimately empty. */
const MUST_EXECUTE = [
  ['overview', 'Error ratio'],
  ['overview', 'Cache hit ratio'],
  ['api-performance', 'Continue wait ratio'],
  ['cache-preaggregation', 'Pre-aggregation coverage'],
  ['refresh-worker', 'Scheduler runs / s'],
];

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: 'grafana-verify', iat: now, exp: now + 3600 });
  const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Prometheus needs a discovery cycle and at least two scrapes before `rate()` has samples.
 * Polling the targets API is the only reliable signal: `up{}` is empty until the first
 * scrape, and a dashboard that "works" because of a sleep is a dashboard that flakes.
 */
async function waitForCubeTarget(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const body = await (await fetch(`${PROMETHEUS}/api/v1/targets`)).json();
      const targets = (body.data?.activeTargets || []).filter((target) => target.labels.job === 'cube');
      last = targets;
      if (targets.length && targets.every((target) => target.health === 'up')) return { ok: true, targets };
    } catch (e) {
      last = String(e.message);
    }
    await sleep(2000);
  }
  return { ok: false, targets: last };
}

async function waitFor(url, attempts = 60, intervalMs = 2000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (e) {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function load() {
  const token = jwt();
  const requestId = crypto.randomUUID();
  const query = { measures: ['orders.count'], dimensions: ['orders.status'] };

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await fetch(`${CUBE_API}/load`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (body && body.data) return { requestId, body };
    if (!/Continue wait/.test(JSON.stringify(body))) return { requestId, body };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('load never completed');
}

function readDashboards() {
  return readdirSync(DASHBOARD_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(DASHBOARD_DIR, file), 'utf8')));
}

function panelExpr(dashboard, title) {
  const panel = (dashboard.panels || []).find((entry) => entry.title === title);
  if (!panel) return null;
  return panel.targets?.[0]?.expr || null;
}

async function grafanaQuery(expr) {
  const resolved = expr.replace(/\$__rate_interval/g, '1m');
  const res = await fetch(`${GRAFANA}/api/ds/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'now-15m',
      to: 'now',
      queries: [{
        refId: 'A',
        datasource: { type: 'prometheus', uid: 'prometheus' },
        expr: resolved,
        instant: true,
        range: false,
        intervalMs: 5000,
        maxDataPoints: 100,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Grafana answered ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const result = body.results && body.results.A;
  if (!result) throw new Error('no result A');
  if (result.error) throw new Error(result.error);
  const frames = result.frames || [];
  const values = frames.flatMap((frame) => (frame.data && frame.data.values ? frame.data.values : []));
  const flat = values.flat().filter((value) => value !== null && value !== undefined);
  return { frames: frames.length, points: flat.length, sample: flat.slice(0, 3) };
}

async function main() {
  console.log('\nstack');
  if (!await waitFor(`${GRAFANA}/api/health`)) {
    bad('Grafana is healthy');
    process.exit(1);
  }
  ok('Grafana is healthy');

  const health = await (await fetch(`${GRAFANA}/api/health`)).json();
  ok(`Grafana ${health.version}`);

  if (!await waitFor(`${PROMETHEUS}/-/ready`)) {
    bad('Prometheus is ready');
    process.exit(1);
  }
  ok('Prometheus is ready');

  const scrape = await waitForCubeTarget();
  if (scrape.ok) {
    ok(`Prometheus scrapes ${scrape.targets.length} Cube target(s): up == 1`);
  } else {
    bad('Prometheus scrapes the Cube target', JSON.stringify(scrape.targets));
  }

  // Two scrapes with a 5s interval: enough for rate() to have samples on every panel.
  await sleep(12000);

  console.log('\ngrafana provisioning');
  const datasources = await (await fetch(`${GRAFANA}/api/datasources`)).json();
  const prom = datasources.find((ds) => ds.uid === 'prometheus');
  if (prom) ok(`datasource "${prom.name}" (${prom.type}) is provisioned`);
  else bad('prometheus datasource is provisioned');

  const search = await (await fetch(`${GRAFANA}/api/search?query=Cube`)).json();
  const dashboards = readDashboards();
  const found = new Map(search.map((hit) => [hit.uid, hit]));
  for (const dashboard of dashboards) {
    if (found.has(dashboard.uid)) ok(`dashboard "${dashboard.title}" is provisioned`);
    else bad(`dashboard "${dashboard.title}" is provisioned`, dashboard.uid);
  }

  console.log('\nquery path');
  const { requestId, body } = await load();
  if (body.data) ok(`load request returned data (trace id ${requestId})`);
  else bad('load request returned data', JSON.stringify(body));

  // A second identical request must produce cache activity for the cache dashboard.
  await load();
  await sleep(10000);

  console.log('\ndashboard panels through Grafana');
  const byFile = new Map(dashboards.map((dashboard) => [dashboard.uid.replace(/^cube-/, ''), dashboard]));

  for (const [file, title] of REQUIRED) {
    const dashboard = byFile.get(file);
    const expr = dashboard && panelExpr(dashboard, title);
    if (!expr) { bad(`panel "${file} / ${title}" exists`); continue; }
    try {
      const result = await grafanaQuery(expr);
      if (result.points > 0) ok(`"${title}" returns ${result.points} point(s) via Grafana`);
      else bad(`"${title}" returns data`, `frames=${result.frames} points=0`);
    } catch (error) {
      bad(`"${title}" returns data`, error.message);
    }
  }

  for (const [file, title] of MUST_EXECUTE) {
    const dashboard = byFile.get(file);
    const expr = dashboard && panelExpr(dashboard, title);
    if (!expr) { bad(`panel "${file} / ${title}" exists`); continue; }
    try {
      const result = await grafanaQuery(expr);
      ok(`"${title}" executes (${result.points} point(s))`);
    } catch (error) {
      bad(`"${title}" executes`, error.message);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
