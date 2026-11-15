# Upgrading Cube

The exporter depends on Cube's **event vocabulary**, not on its internals. An upgrade is
safe when the contract still holds; `make test-contract` answers that in seconds.

## Procedure

1. Pick the target release and confirm the image tag exists (Cube tags carry a `v`):

   ```bash
   docker pull cubejs/cube:v1.9.0
   ```

2. Fetch and check out that Cube tag in your Cube checkout, then verify the contract:

   ```bash
   make test-contract CUBE_REPO=../cube
   ```

3. Bump the four version markers so they agree:

   | File | Field |
   | --- | --- |
   | `images/exporter/Dockerfile` | `ARG CUBE_VERSION` |
   | `e2e/docker-compose.yml` | `CUBE_VERSION` default |
   | `Makefile` | `CUBE_VERSION` |
   | `charts/cube-observability/Chart.yaml` | `appVersion` (no `v`) |

4. Regenerate and run the fast suite:

   ```bash
   make gen && make test
   ```

5. Prove it against the real binary:

   ```bash
   make e2e
   ```

   This asserts the three-way trace correlation and that a real request moves
   `cube_requests_total`, `cube_request_duration_seconds` and `cube_db_queries_total`.

6. Record the upgrade below.

## When the contract check fails

`make test-contract` prints `FAIL <event> ('Name' not found in file.ts)`. That is the alarm
working: Cube renamed or removed an event the metric contract depends on.

1. Find the new literal in the named file.
2. Update `packages/cube-prometheus/src/contract.js` (`EVENT_NAMES` + `EVENT_ANCHORS`).
3. Update the `effect` table in `tools/gen.mjs` if the semantics changed.
4. `make gen && make test`.

For the full decision tree (rename vs new event vs benign event), run the
`cube-upstream-contract` skill.

## Upgrade log

| Date | Cube | Contract changes | `make test` | `make e2e` |
| --- | --- | --- | --- | --- |
| 2026-11-15 | v1.8.25 | initial contract | pass | pass (16/16) |
