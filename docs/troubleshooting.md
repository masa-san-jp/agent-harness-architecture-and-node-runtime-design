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

## The profile is rejected

Check that every input path is relative to `--input`, every source points to a declared adapter,
and the profile's policy and runtime references are identifiers rather than inline configuration.
Credential values belong in the organization's secret manager; only a `credential_ref` may appear
in the profile. External network and execute mode require explicit approval boundaries.

## The run is not reproducible

Keep the profile, policy, input bytes, contract versions, mode, and capture timestamp fixed. The
CLI writes references and SHA-256 digests to the run manifest, never raw evidence or policy
contents. A changed input or profile should produce a new manifest identity.

## The stored record cannot be written

Use a writable directory with `--store`. The reference adapter creates
`bootstrap-storage.sqlite` and does not copy raw input files. Reusing the same kind and reference
with different payload content is rejected as `IMMUTABLE_RECORD_CONFLICT`; reusing it with changed
tenant, classification, or masking metadata is rejected as `STORAGE_METADATA_CONFLICT`. Inspect the
stored reference digest before retrying.
