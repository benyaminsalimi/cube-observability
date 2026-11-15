# Releasing

Two repositories, two workflows, one rule: **the package version is the Cube release it
was verified against**. `@cube_oss/cube-prometheus@1.8.25` means "tested against
`cubejs/cube:v1.8.25`".

```
cube-prometheus (package)                    cube-observability (chart, image, e2e)
─────────────────────────                    ─────────────────────────────────────
detect-cube-release.yml  (daily)
  └─ newer Cube tag? → PR "release: X.Y.Z"
        └─ CI: unit + contract vs vX.Y.Z + pack
              └─ merge
                    │
                    ├─ tag vX.Y.Z ──► publish.yml
                    │                   ├─ tag == package.json
                    │                   ├─ vX.Y.Z is a real cubejs/cube tag
                    │                   ├─ contract vs vX.Y.Z
                    │                   ├─ pack + not already published
                    │                   ├─ npm publish (trusted publishing, provenance)
                    │                   └─ GitHub release
                    │
                    └─ sync-package.yml (daily) → PR "bump to vX.Y.Z"
                          └─ CI: unit, contract, chart render, e2e, Grafana
                                └─ merge → deployed version is now provably the released one
```

## Gates, and why each exists

| Gate | Workflow | Catches |
| --- | --- | --- |
| Unit tests | both | mapping, log records, config, listener, package API |
| Tag == `package.json` | publish | a tag that would publish a different version than it names |
| Version is a real Cube tag | publish | inventing a version with no release behind it |
| Contract vs **that** Cube tag | publish | Cube renamed an event and the metric contract rotted |
| Not already published | publish | accidental overwrite attempt |
| `npm pack` | publish | a broken `files`/`exports` map shipping an unusable tarball |
| Chart render + `promtool` | umbrella CI | dashboards/rules referencing series that no longer exist |
| End-to-end (Cube + Postgres) | umbrella CI | the exporter breaking against a real server |
| Grafana panel queries | umbrella CI | provisioned dashboards that render empty |

## One-time setup

1. **First publish is manual.** npm trusted publishing can only be configured for a package
   that already exists, so the very first `npm publish` needs either a one-time password or
   a granular token with "Bypass 2FA":

   ```bash
   cd packages/cube-prometheus
   npm publish --access public --otp=<code>
   git tag v1.8.25 && git push origin main --tags   # then CI takes over for this version
   ```

   If the version is already published by hand, skip the tag; the next release uses CI only.

2. **Configure trusted publishing** (npm → package → Settings → Trusted Publisher):
   organization/user `benyaminsalimi`, repository `cube-prometheus`, workflow `publish.yml`.
   After this, no token and no 2FA prompt is involved in publishing.

3. **Allow Actions to open pull requests** (repository → Settings → Actions → General →
   Workflow permissions → *Allow GitHub Actions to create and approve pull requests*).
   Both release workflows open PRs; without this they fail with a permissions error.

4. Optional: an `NPM_TOKEN` secret with "Bypass 2FA" acts as a fallback if trusted
   publishing is unavailable.

## Cutting a release

Automatic:

1. `detect-cube-release.yml` finds `cubejs/cube:vX.Y.Z` newer than `package.json` and opens
   `release/X.Y.Z` with the version and a CHANGELOG stub.
2. Review it. The contract check in CI tells you immediately whether Cube's event vocabulary
   moved; if it did, fix the contract in the same PR (see the `cube-upstream-contract` skill).
3. Merge, then tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

4. `publish.yml` runs the gates and publishes. Watch the run; the last step confirms the
   registry serves the version before creating the GitHub release.

Manual hotfix (same version, before any tag): run `publish.yml` with `workflow_dispatch`
and `dry_run: true` to execute every gate without publishing.

## After publishing

`sync-package.yml` in the umbrella repository opens a PR bumping `packages/cube-prometheus`
to the new tag. Its CI runs the full end-to-end and Grafana verification against the
**published** package (`EXPORTER_PACKAGE=@cube_oss/cube-prometheus@X.Y.Z` set in the e2e
job). Merge only when green — that merge is what makes the deployed exporter the released
one.
