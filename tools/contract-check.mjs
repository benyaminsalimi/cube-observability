#!/usr/bin/env node
/**
 * Delegates to the package repository's contract checker.
 *
 * `packages/cube-prometheus` is a git submodule, and the verification of Cube assumptions
 * belongs with the code that makes them. Keeping one implementation means the umbrella
 * repository and the published package can never disagree about what "the contract" is.
 *
 * Usage: node tools/contract-check.mjs [--cube <path>]
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const here = path.dirname(new URL(import.meta.url).pathname);
const script = path.resolve(here, '..', 'packages', 'cube-prometheus', 'tools', 'contract-check.mjs');

if (!existsSync(script)) {
  console.error(`Missing ${script}`);
  console.error('Run: git submodule update --init --recursive');
  process.exit(2);
}

const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
