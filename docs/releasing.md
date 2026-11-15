# Releasing

Two repositories, two workflows, one rule: **the package version is the Cube release it
was verified against**. `cube-prometheus@1.8.25` means "tested against
`cubejs/cube:v1.8.25`".

```
cube-prometheus (package)                     cube-observability (chart, image, e2e)
─────────────────────────                     ─────────────────────────────────────
detect-cube-release.yml  (daily)
  └─ newer Cube tag?
       ├─ verify: unit + contract vs vX.Y.Z + pack        (must pass first)
       ├─ open/update PR "release: X.Y.Z"
       └─ auto-merge  (AUTO_RELEASE ≠ false)
            └─ dispatch publish  (AUTO_PUBLISH = true)
                 └─ publish.yml
                     ├─ tag == package.json (on tag events)
                     ├─ vX.Y.Z is a real cubejs/cube tag
                     ├─ contract vs vX.Y.Z
                     ├─ pack, not already published
                     ├─ npm publish with provenance
                     ├─ tag vX.Y.Z
                     └─ GitHub release

sync-package.yml (daily, umbrella)
  └─ newest published tag
       ├─ verify: unit + contract + chart render + e2e + Grafana,
       │          against the PUBLISHED tarball
       ├─ open PR "bump to vX.Y.Z"
       └─ auto-merge  (AUTO_RELEASE ≠ false)
```

Nothing merges before the checks for that change have run, and the checks run **before**
the pull request is opened — because a PR pushed with the default `GITHUB_TOKEN` does not
get a CI run of its own.

## Switches

| Repository variable | Default | Effect |
| --- | --- | --- |
| `AUTO_RELEASE` | unset (≈ true) | Set to `false` to leave release and sync PRs open for review instead of merging them |
| `AUTO_PUBLISH` | unset | Set to `true` to tag and publish automatically after a merge. Leave unset until npm authentication works |

| Secret | Default | Effect |
| --- | --- | --- |
| `RELEASE_TOKEN` | unset | A PAT with `repo` scope. When set, PRs are pushed with it, so they get ordinary CI in addition to the in-workflow verification |
| `NPM_TOKEN` | unset | Only needed if npm trusted publishing is unavailable |

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

## Current state

- `cube-prometheus@1.8.26` is published and is `latest` on npm.
- npm **trusted publishing** is configured for `benyaminsalimi/cube-prometheus` /
  `publish.yml`, so publishing uses OIDC with no token and no 2FA prompt.
- `AUTO_RELEASE` is unset (releases merge automatically after their gates pass) and
  `AUTO_PUBLISH=true` (publishing is dispatched automatically after the merge).
- The `0.0.0-stage` placeholder published while claiming the name is deprecated.

## One-time setup (already done here)

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

Automatic, with `AUTO_RELEASE` unset and `AUTO_PUBLISH=true`:

1. `detect-cube-release.yml` finds `cubejs/cube:vX.Y.Z` newer than `package.json`.
2. It runs unit tests, the contract against `vX.Y.Z`, and `npm pack`. If any of them fail,
   nothing is opened and the workflow fails — that is the alarm to run the
   `cube-upstream-contract` skill.
3. It opens or updates `release/X.Y.Z` and squash-merges it, provided the branch touches
   only `package.json`, `package-lock.json` and `CHANGELOG.md`.
4. It dispatches `publish.yml`, which re-runs every gate, publishes with provenance, tags
   the release and creates the GitHub release.
5. The umbrella's `sync-package.yml` bumps the submodule to the new tag, proves the pair
   with e2e and Grafana against the published tarball, and merges.

Read the run summary rather than assuming: the gates are in the logs.

### Manual, when a gate is red

If step 2 fails, the event vocabulary moved and the contract needs a human:

```bash
git checkout -b release/cube-X.Y.Z
# follow the cube-upstream-contract skill
make test-contract CUBE_REPO=../cube   # in the umbrella
```

Then push the branch and let the normal PR flow run.

### Manual publish (first release, or when AUTO_PUBLISH is off)

```bash
cd packages/cube-prometheus
npm publish --access public --otp=<code>
git tag vX.Y.Z && git push origin vX.Y.Z
```

Manual hotfix (same version, before any tag): run `publish.yml` with `workflow_dispatch`
and `dry_run: true` to execute every gate without publishing.

## After publishing

`sync-package.yml` in the umbrella repository opens a PR bumping `packages/cube-prometheus`
to the new tag. Its CI runs the full end-to-end and Grafana verification against the
**published** package (`EXPORTER_PACKAGE=cube-prometheus@X.Y.Z` set in the e2e
job). Merge only when green — that merge is what makes the deployed exporter the released
one.
