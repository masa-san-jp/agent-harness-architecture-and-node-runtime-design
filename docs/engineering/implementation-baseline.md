# Implementation baseline

This document is the engineering baseline for the reference implementation described by
[Issue #11](https://github.com/masa-san-jp/agent-harness-architecture-and-node-runtime-design/issues/11).

## Boundary

The normative contracts remain language- and vendor-neutral. The choices below apply only to
the local reference implementation and may not be copied into Core, Domain, or Local business
contracts.

## Fixed reference stack

| Concern                     | Baseline                                                    |
| --------------------------- | ----------------------------------------------------------- |
| Runtime                     | Node.js 24.20.0                                             |
| Package manager             | pnpm 10.34.5                                                |
| Language                    | TypeScript with strict compiler options                     |
| Module system               | ESM / NodeNext                                              |
| Contract format             | JSON Schema Draft 2020-12                                   |
| Test runner                 | Vitest 3.2.4                                                |
| Formatting                  | Prettier 3.6.2                                              |
| Linting                     | ESLint 9.29.0                                               |
| Local persistence           | SQLite behind a storage port when persistence is introduced |
| External services in tests  | Fake adapters; network disabled by default                  |
| User-facing surface in v0.1 | CLI-first; no web UI requirement                            |

Exact tool versions are pinned in `package.json`, `.node-version`, and `pnpm-lock.yaml`.

## Repository layout

```text
docs/architecture/     normative architecture and behavior
docs/adr/              recorded design decisions
docs/engineering/      implementation and contribution conventions
schemas/               machine-readable public contracts
packages/              reusable reference implementation packages
apps/                  executable reference applications
fixtures/              synthetic, versioned canonical inputs and outputs
scripts/               repository-level orchestration only
```

## Workspace conventions

- Workspace packages use the private `@agent-harness/*` namespace.
- Each package owns its own `package.json`, `tsconfig.json`, source, and tests.
- Root scripts discover package scripts; adding a package does not require editing the root
  script list.
- A package must not import another package's private source path. Use its declared exports and
  a published contract version.
- Generated TypeScript bindings are derived from JSON Schema and are never hand-edited.
- Tests use fake model, storage, identity, tool, and external-system adapters by default.
- No implementation may add an external network dependency to the default verification path.

## Required commands

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm conformance
pnpm verify
```

The root commands are intentionally valid when no implementation package exists yet. As packages
are added, their matching scripts are discovered automatically by `scripts/run-workspaces.mjs`.

## Change protocol

1. Read the owning Issue and its Owned paths before editing.
2. Add or update a machine-readable contract and its conformance fixture in the same change when
   the public boundary changes.
3. Do not edit another Issue's Owned paths to make a local implementation convenient.
4. Record the verification commands and any contract decision in the owning Issue.
5. Keep the default verification path deterministic and offline.
