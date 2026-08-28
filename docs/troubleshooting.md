# Troubleshooting

## `pnpm install --frozen-lockfile` fails

Use the pinned Node version from `.node-version` and pnpm `10.34.5`. A clean checkout must install
with the lockfile before any package build. Do not update the lockfile just to bypass an engine
warning; update it only when a workspace package or dependency changes.

## The CLI cannot resolve a workspace package

Run the CLI through its package script from the repository root:

```sh
pnpm --filter @agent-harness/reference-cli run cli
```

The reference CLI's package script builds its workspace dependencies before bootstrap or validation
on a clean checkout. Help, version, and scaffold commands do not need a package build. If you invoke
`node apps/reference-cli/src/cli.mjs` directly, build the dependencies first with
`pnpm --filter @agent-harness/reference-cli run build-dependencies`.

## Configuration validation fails

Run `--validate` and fix the reported Profile, Policy, adapter bundle, or input binding before
running bootstrap. The validator intentionally rejects policy configurations that are not
deny-by-default, Profile references to undeclared adapters, source paths outside the input root,
and adapter bundle bindings that do not match. It does not contact an external service.

## Scaffold creation fails

`--init <dir>` never overwrites an existing file. Choose a new directory or an existing empty
directory. If a previous initialization was interrupted and left files behind, inspect the target
before deciding whether to move those files and retry; do not point `--init` at a directory that
contains an approved export.

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

The default CLI path is deliberately a `replay` with a fake executor. A completed replay does not
mean that a real business action was executed; a `HarnessDraft` remains non-executable until an
organization supplies and separately approves a real runtime integration.

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

## The adapter bundle is rejected

Check that the bundle module path is a relative `*.mjs` path within the bundle directory, its
default (or named `adapter`) export implements `supports` and `parse`, and its adapter ID, version,
and source kind exactly match both the Profile and bundle manifest. The loader rejects symlink
escapes and does not provide credentials or a network client to adapter code.
