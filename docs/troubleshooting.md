# Troubleshooting

## `pnpm install --frozen-lockfile` fails

Use the pinned Node version from `.node-version` and pnpm `10.34.5`. A clean checkout must install
with the lockfile before any package build. Do not update the lockfile just to bypass an engine
warning; update it only when a workspace package or dependency changes.

## The CLI cannot resolve a workspace package

Run the CLI through the package test or run the package build first. The reference CLI's `pretest`
script builds its workspace dependencies so a clean checkout can use their declared exports.

## A file is not imported

Inspect the CLI JSON `diagnostics` and the importer outcome for that relative path. Unsupported
formats, malformed data, symlinks, duplicate content, and read failures are explicit outcomes. Do
not treat an empty record list as a successful import without checking the outcome status.

## Readiness is `blocked`

Open the review questions. The usual causes are missing or inferred completion conditions, failure
handling, contradictory node fields, write or network scopes, or an incomplete teardown plan. A
blocked HarnessDraft is intentionally non-executable and must be corrected through a versioned
review change set.

## Replay is denied

Replay requires a fixed input snapshot reference and no tool/write/network request. Execute requires
both a passing evaluation and an active approval. These checks are enforced by the control kernel,
not by the CLI's natural-language output.
