# Conformance authoring

Conformance suites are discovered automatically from
`packages/conformance/src/suites/<suite-id>/suite.mjs`. There is no shared suite index.

## Suite interface

Each suite exports an id matching its directory and a function with this shape:

```js
export const id = "evidence-contract";

export async function run({ fixtureRoot, assert, readJson, sha256 }) {
  // read fixture inputs and throw through assert when the contract is violated
}
```

Suites must be deterministic, offline, and safe to run on a clean checkout. They may only write
under a temporary test directory created by the suite and must not mutate the canonical fixture.

## Commands

```sh
pnpm conformance -- --list
pnpm conformance -- --suite fixture-integrity
pnpm conformance
```

The root workspace runner forwards arguments after `--` to the conformance package. A suite is
complete only when it is discovered by `--list`, passes by explicit selection, and passes as part
of the complete run.

## Fixture ownership

- #13 owns `raw/**`, `manifest.json`, and the runner/shared helpers.
- A stage owner may add `expected/<stage>/**` and its suite directory.
- No stage owner may edit raw inputs or another stage's expected outputs.
- The manifest hash is updated only when the raw fixture intentionally changes.

## Failure output

Failures must name the suite, contract or fixture path, and the violated invariant. Avoid opaque
assertions that require reproducing the entire run locally.
