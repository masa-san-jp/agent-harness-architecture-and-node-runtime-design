# Reference bootstrap quickstart

This walkthrough runs from the repository root against the synthetic offline fixture. It starts
with raw records, creates a Catalog, derives a Candidate Graph, creates a non-executable
HarnessDraft, asks review questions, and performs a replay with a fake executor.

The reference path is runnable, but it is not a production harness: it does not retrieve data from
external systems, call an LLM, execute real tools, or provide an approval service. Use it to verify
the contracts and to establish the organization-specific boundaries before connecting those
systems.

## Prerequisites

Use Node.js `24.20.0` and pnpm `10.34.5`, as pinned by `.node-version`, `package.json`, and CI.
Run the commands below from the repository root.

## First run

```sh
pnpm install --frozen-lockfile
pnpm --filter @agent-harness/reference-cli run cli \
  --input fixtures/bootstrap/minimal-office-v1/raw \
  --policy fixtures/bootstrap/minimal-office-v1/expected/security/policy.json \
  --profile fixtures/bootstrap/minimal-office-v1/expected/profile/minimal-office.json \
  --captured-at 2026-01-08T00:00:00Z
pnpm --filter @agent-harness/reference-cli test
pnpm conformance
```

The CLI output is JSON. A successful reference run includes a read-only Catalog, a non-executable
HarnessDraft, a completed replay, revoked credentials, deleted temporary workspace state, and a
Run Manifest containing the fixed input/profile/policy references. The CLI does not modify, upload,
or delete the fixture's `raw/` files.

The first `run cli` invocation builds the workspace packages required by the CLI automatically.
The package test also builds them, so either command is safe on a clean checkout.

## Generate an organization scaffold

When starting with no existing Profile, Policy, or adapter, generate a non-overwriting scaffold:

```sh
pnpm --filter @agent-harness/reference-cli run cli -- --init ./organization-bootstrap
```

The command creates a deny-by-default `policy.json`, a Profile bound to a synthetic JSONL sample,
an optional custom adapter bundle template, and a `.gitignore` for future files under `input/` and
`adapter-input/`.
It fails if the target directory is not empty. Replace the `replace-me` identifiers, add only
approved Policy rules, and never put credentials or production exports into the generated directory.

Validate the generated configuration and input binding before using an organization export:

```sh
pnpm --filter @agent-harness/reference-cli run cli -- \
  --validate \
  --input ./organization-bootstrap/input \
  --policy ./organization-bootstrap/policy.json \
  --profile ./organization-bootstrap/profile.json
```

The scaffold README contains the equivalent custom-adapter command. `--help` lists all options and
`--version` reports the reference CLI version.

## Optional local persistence

To persist only the derived Catalog and Run Manifest in the local reference SQLite adapter, add
`--store`:

```sh
pnpm --filter @agent-harness/reference-cli run cli \
  --profile fixtures/bootstrap/minimal-office-v1/expected/profile/minimal-office.json \
  --store ./.tmp/bootstrap-storage
```

The command creates `.tmp/bootstrap-storage/bootstrap-storage.sqlite`. Reopen it through the
Storage Port to retrieve the Catalog or Run Manifest by the references printed in the CLI JSON.
The input `raw/` directory is not copied or modified.

To run an organization adapter from a trusted local bundle, add `--adapter-bundle`:

```sh
pnpm --filter @agent-harness/reference-cli run cli \
  --input fixtures/bootstrap/adapter-bundle-v1/raw \
  --policy fixtures/bootstrap/minimal-office-v1/expected/security/policy.json \
  --profile fixtures/bootstrap/adapter-bundle-v1/profile.json \
  --adapter-bundle fixtures/bootstrap/adapter-bundle-v1/bundle/manifest.json
```

The CLI uses only adapters declared by the Profile. It prints the selected adapter IDs and records
the bundle digest in the Run Manifest under `local.adapter_bundle_digest`. The bundle loader is a
trusted local-code boundary; production deployments need their own code review, signing,
distribution, and sandboxing controls.

The CLI prints JSON containing the contract versions, source and record counts, candidate graph
counts, readiness status, policy decision, replay status, teardown result, and run manifest. No raw fixture file
is modified, uploaded, or deleted. Replace the `--input` directory with an approved local export;
keep the capture time fixed when comparing or replaying a run.

The reference CLI uses a fake replay executor and, on the default path, does not connect to an
external model, business system, or network service. A real adapter or executor must be introduced
behind the contracts and policy gates owned by the corresponding package. Treat the generated
HarnessDraft as a review artifact, not as permission to execute a business process.

## Organization adapter authoring

An organization adapter is supplied to `importDirectory` through the public `EvidenceAdapter` port.
The adapter receives bytes and bounded metadata; it does not receive credentials or a network client.
Keep source authentication and export retrieval outside the importer, then pass the approved local
export to the same read-only import path.

Validate a new adapter in this order:

1. Add a fixture containing representative, non-sensitive bytes.
2. Assert `supports` matches only the intended media type or file rule.
3. Assert `parse` emits Core claims, source locators, and explicit diagnostics for partial input.
4. Assert the catalog records the adapter ID/version, hashes, provenance, and read-only boundary.
5. Run `pnpm --filter @agent-harness/reference-cli test` and `pnpm conformance`.

The reference compatibility matrix is:

| Surface                | Reference version              | Checked by                               | Organization-specific change                          |
| ---------------------- | ------------------------------ | ---------------------------------------- | ----------------------------------------------------- |
| Evidence importer port | `evidence-importer-port@1.0.0` | adapter smoke test, importer conformance | adapter and source authentication outside Core        |
| Candidate graph        | `candidate-graph@1.0.0`        | graph conformance                        | mapping or inference model                            |
| HarnessDraft           | `harness-draft@1.0.0`          | draft conformance                        | profile, skill, tool, and adapter bindings            |
| Bootstrap policy       | `bootstrap-policy@1.0.0`       | security conformance                     | tenant, classification, masking, and retention rules  |
| Review workflow        | `review-contract@1.0.0`        | review conformance                       | reviewer identity and approval routing                |
| Runtime promotion      | `runtime-promotion@1.0.0`      | runtime conformance and replay test      | executor, workspace, and credential providers         |
| Bootstrap storage      | `bootstrap-storage@1.0.0`      | storage conformance and reopen test      | database, object store, retention, and access adapter |

An organization may replace an adapter, model, policy profile, or executor while keeping these
Core contracts stable. A contract change must follow the version and compatibility rules in
`docs/architecture/compatibility-policy.md`.
