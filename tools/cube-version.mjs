#!/usr/bin/env node
/**
 * The one place the Cube version comes from.
 *
 * The package version IS the Cube release the exporter is verified against, so this
 * repository does not get its own answer: it reads the submodule's package.json and
 * prints "v<version>" for the image tag and the end-to-end runs.
 *
 * Usage: node tools/cube-version.mjs        -> v1.8.26
 *        node tools/cube-version.mjs --bare -> 1.8.26
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const manifest = path.resolve(here, '..', 'packages', 'cube-prometheus', 'package.json');

if (!existsSync(manifest)) {
  console.error(`Missing ${manifest}`);
  console.error('Run: git submodule update --init --recursive');
  process.exit(2);
}

const { version } = require(manifest);
const bare = process.argv.includes('--bare');
process.stdout.write(bare ? version : `v${version}`);
