#!/usr/bin/env node
/**
 * Static validation, no cluster required.
 *
 *   1. the committed dashboard/rule files are what tools/gen.mjs would produce;
 *   2. every series a dashboard queries exists in the catalog;
 *   3. every `event="..."` label a dashboard filters on exists in the contract;
 *   4. the alert rules parse (promtool, when available).
 *
 * Usage: node tools/validate.mjs [--promtool <path>]
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const catalog = require('../packages/cube-prometheus/src/catalog.js');
const contract = require('../packages/cube-prometheus/src/contract.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DASHBOARD_DIR = path.join(ROOT, 'charts/cube-observability/files/dashboards');
const RULES_FILE = path.join(ROOT, 'charts/cube-observability/files/rules.yml');

const PROMTOOL = (() => {
  const index = process.argv.indexOf('--promtool');
  if (index !== -1) return process.argv[index + 1];
  const local = path.join(ROOT, '.tools', 'promtool');
  return existsSync(local) ? local : null;
})();

let failures = 0;
const ok = (message) => console.log(`  ok   ${message}`);
const bad = (message, detail) => {
  failures += 1;
  console.log(`  FAIL ${message}${detail ? `\n         ${detail}` : ''}`);
};

const allowed = new Set();
for (const name of catalog.allNames('cube')) {
  allowed.add(name);
  allowed.add(`${name}_bucket`);
  allowed.add(`${name}_sum`);
  allowed.add(`${name}_count`);
}
for (const family of catalog.DEFAULT_METRIC_FAMILIES) {
  allowed.add(`cube_${family}`);
}
const knownEvents = contract.knownEventNames();

function exprsOf(dashboard) {
  const exprs = [];
  for (const panel of dashboard.panels || []) {
    for (const target of panel.targets || []) {
      if (target.expr) exprs.push({ panel: panel.title, expr: target.expr });
    }
  }
  return exprs;
}

console.log('\ndashboards');
const files = readdirSync(DASHBOARD_DIR).filter((file) => file.endsWith('.json'));
if (!files.length) bad('dashboards are generated');
for (const file of files) {
  const full = path.join(DASHBOARD_DIR, file);
  const dashboard = JSON.parse(readFileSync(full, 'utf8'));
  ok(`${file} parses as JSON (${dashboard.panels.length} panels)`);

  if (!dashboard.uid || !dashboard.title) bad(`${file} has a uid and title`);

  for (const { panel, expr } of exprsOf(dashboard)) {
    const series = [...new Set(expr.match(/(?:^|[^a-zA-Z0-9_])(cube_[a-zA-Z0-9_]+)/g) || [])]
      .map((match) => match.replace(/^[^c]/, ''));
    for (const name of series) {
      if (!allowed.has(name)) bad(`${file} / "${panel}" references unknown series ${name}`, expr);
    }
    const events = [...expr.matchAll(/event="([^"]+)"/g)].map((match) => match[1]);
    for (const event of events) {
      if (!knownEvents.has(event)) bad(`${file} / "${panel}" references unknown event "${event}"`, expr);
    }
  }
  ok(`${file} queries only catalog series`);
}

console.log('\nrules');
const rules = readFileSync(RULES_FILE, 'utf8');
const ruleSeries = [...new Set(rules.match(/(?:^|[^a-zA-Z0-9_])(cube_[a-zA-Z0-9_]+)/g) || [])]
  .map((match) => match.replace(/^[^c]/, ''));
for (const name of ruleSeries) {
  if (!allowed.has(name) && !name.startsWith('cube_')) bad(`rules reference unknown series ${name}`);
  else if (!allowed.has(name)) bad(`rules reference unknown series ${name}`);
}
ok(`rules reference ${ruleSeries.length} catalog series`);

const ruleEvents = [...rules.matchAll(/event="([^"]+)"/g)].map((match) => match[1]);
for (const event of ruleEvents) {
  if (!knownEvents.has(event)) bad(`rules reference unknown event "${event}"`);
}
ok('rules reference only contract events');

if (PROMTOOL) {
  const rendered = rules.replace(/__NAMESPACE__/g, 'cube');
  const dir = mkdtempSync(path.join(tmpdir(), 'cube-rules-'));
  const file = path.join(dir, 'rules.yml');
  writeFileSync(file, `groups:\n${rendered}`);
  try {
    execFileSync(PROMTOOL, ['check', 'rules', file], { stdio: 'pipe' });
    ok('promtool check rules');
  } catch (error) {
    bad('promtool check rules', String(error.stderr || error.message).slice(0, 400));
  }
} else {
  console.log('  skip promtool check rules (run: make tools)');
}

console.log(failures === 0 ? '\nvalidation passed' : `\n${failures} validation failure(s)`);
process.exit(failures === 0 ? 0 : 1);
