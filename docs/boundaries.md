# Repository boundaries

Two repositories, one direction of dependency. This file is the contract; the last
section lists what fails a build when it is broken.

> **Unofficial.** Neither repository is affiliated with Cube Dev, Inc. or the upstream
> Cube project at <https://github.com/cube-js/cube>. Both consume Cube's public
> configuration surface and log events; neither is part of Cube.

## Ownership

| Concern | Owner | Never in the other repository |
| --- | --- | --- |
| Logger tap, metric catalog, event contract, log writer, listener | **cube-prometheus** | — |
| npm packaging, version, release workflow, contract gate | **cube-prometheus** | — |
| Helm chart, PodMonitors, alert rules, Grafana dashboards | **cube-observability** | — |
| Exporter image (`FROM cubejs/cube` + the published package) | **cube-observability** | — |
| End-to-end harness (Cube + Postgres) and Grafana verification | **cube-observability** | — |
| Metric reference generated from the catalog | **cube-observability** (`docs/metrics.md`) | — |
| The Cube version a release tracks | **cube-prometheus** (it *is* `package.json.version`) | any hardcoded Cube version |

## Dependency direction

```
cube-prometheus  ──(npm package + git submodule)──►  cube-observability
   library, tests, release                              chart, image, e2e, dashboards
```

- `cube-prometheus` never depends on `cube-observability`. It must run `npm test`,
  `npm run contract` and `npm publish` with nothing but itself.
- `cube-observability` consumes the package two ways: as a **submodule** (for the
  catalog, so dashboards and rules are generated from the real definitions) and as the
  **published tarball** (for the image and the release verification).
- The umbrella's `tools/contract-check.mjs` is a thin delegate to the submodule's
  implementation. There is exactly one implementation of the contract check.

## Version ownership

The package version *is* the upstream Cube release the exporter was verified against:
`cube-prometheus@1.8.26` ⇔ `cubejs/cube:v1.8.26`.

Everything else derives it:

| Place | How |
| --- | --- |
| `Makefile` | `CUBE_VERSION ?= $(shell node tools/cube-version.mjs)` |
| `e2e/run.sh`, `e2e/grafana.sh` | `node ../tools/cube-version.mjs` when not given |
| `e2e/docker-compose.yml` | requires `CUBE_VERSION`; has no default of its own |
| `charts/cube-observability/Chart.yaml` | `appVersion` must equal it (checked) |

Before this rule existed the version was hardcoded in four places and had already
drifted — the package said 1.8.26 while the chart and compose said 1.8.25.

## Where a change goes

| Change | Repository |
| --- | --- |
| New metric, new event mapping, label change | `cube-prometheus` → `make gen` in the umbrella picks it up |
| Cube renamed an event | `cube-prometheus` (`src/contract.js`), then the umbrella pointer bump |
| Alert threshold, panel, dashboard layout | `cube-observability` (`tools/dashboard-spec.mjs`, `tools/alert-defaults.mjs`) |
| Chart value, scrape object, image | `cube-observability` |
| New Cube release | automatic: detect → verify → merge in the package repository, then the sync workflow bumps the pointer here |

## What enforces it

| Guard | Where | Fails when |
| --- | --- | --- |
| `packages/cube-prometheus` is a gitlink (`160000`) | umbrella `tools/validate.mjs` | the package is vendored instead of referenced |
| Chart `appVersion` equals the package version | umbrella `tools/validate.mjs` | the Cube version drifts again |
| `CUBE_VERSION` derived, not hardcoded | umbrella `tools/validate.mjs` | someone reintroduces a literal |
| Compose has no Cube version default | umbrella `tools/validate.mjs` | a second source of truth appears |
| Only package concerns present | `cube-prometheus` `test/boundaries.test.js` | a chart, image or e2e harness is added to the package repo |
| No third-party scope, unofficial notice | `cube-prometheus` `test/boundaries.test.js` | the name or README starts implying ownership |
| Release pipeline self-contained | `cube-prometheus` `test/boundaries.test.js` | publishing starts depending on the umbrella |
