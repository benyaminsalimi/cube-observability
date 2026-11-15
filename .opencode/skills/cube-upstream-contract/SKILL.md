---
name: cube-upstream-contract
description: Verify the cube_observability exporter against a new Cube release. Use when bumping the Cube version, when the CubeTelemetryUnmappedEvents alert fires, when a dashboard panel goes empty after an upgrade, or before release. Checks every hardcoded assumption (event names, the logger option, config loading, request id format, image paths, env vars) against a Cube checkout and updates the metric contract.
allowed-tools: Bash(make:*), Bash(node:*), Bash(git:*), Bash(docker:*)
license: Apache-2.0
metadata:
  author: cube_observability
  version: "1.0"
---

# Cube upstream contract check

This project hardcodes exactly one kind of thing: **Cube's own vocabulary** — event names,
the `logger` config option, how `cube.js` is loaded, the request id format, and two image
paths. All of it lives in `packages/cube-prometheus/src/contract.js`, and all of it is
mechanically verified against a Cube checkout.

Use this skill when the Cube version changes, in either direction.

## Inputs

- A Cube checkout. Default `../cube`; override with `CUBE_REPO=/path/to/cube` or `--cube`.
- Network only if `.tools/helm`/`.tools/promtool` are missing (`make tools`).

## Procedure

1. **Point at the new checkout and run the contract check.**

   ```bash
   make test-contract CUBE_REPO=/path/to/cube
   ```

   Every line is `ok <id> (<file>:<line>)`. Any `FAIL` names the exact missing literal and
   the file it was expected in. Do not proceed while a `FAIL` remains.

2. **Re-run the drift detector against a running deployment** (if one is available).

   ```promql
   sum by (event) (increase(cube_telemetry_unmapped_events_total[1h])) > 0
   ```

   Any result is an event name the contract does not know. Decide for each one:

   - it replaces a known event → update `EVENT_NAMES` in `contract.js`
     **and** the `EVENT_ANCHORS` entry, then run `make gen`;
   - it is new but carries no semantics we use → add it to `BENIGN_EVENTS`;
   - it is a rename of a semantic event → update `EVENT_NAMES`, `EVENT_ANCHORS`,
     and the effect table in `tools/gen.mjs` if the mapping changed.

3. **Fix anchors, never guesses.** If `FAIL` says `'Load Request Success' not found in
   gateway.ts`, find the new name in the file and update the contract — do not loosen the
   check. The check is the only thing standing between a Cube rename and an empty panel.

4. **Regenerate and validate.**

   ```bash
   make gen        # dashboards, rules, docs/metrics.md from the catalog
   make test       # unit + gen --check + contract + static + chart render
   ```

5. **Bump the version markers together.** These four must agree:

   - `images/exporter/Dockerfile` → `ARG CUBE_VERSION`
   - `e2e/docker-compose.yml` → `CUBE_VERSION` default
   - `Makefile` → `CUBE_VERSION`
   - `charts/cube-observability/Chart.yaml` → `appVersion` (without the `v` prefix)

6. **Prove it end to end.**

   ```bash
   make e2e
   ```

   This builds the exporter on top of the new image, runs real Cube against real Postgres,
   and asserts metrics, NDJSON logs and the warehouse SQL comment all carry one trace id.
   A broken event name fails here rather than in production.

7. **Record the result** in `docs/upgrade-cube.md` (date, from → to, contract changes,
   e2e result).

## Guardrails

- Never make the check pass by removing an assertion. If an event genuinely disappeared,
  delete its mapping and add a `## Removed` note to the upgrade log so dashboards can be
  updated deliberately.
- Never add a Cube event name anywhere outside `contract.js`. A grep for a quoted event
  name in `src/` outside that file should return nothing.
- If `CreateOptions.logger` disappears or stops being honoured, stop: the whole delivery
  model depends on it. Escalate before working around it.
