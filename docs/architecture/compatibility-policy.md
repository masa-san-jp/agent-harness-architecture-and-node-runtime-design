# Contract compatibility policy

The reference implementation uses explicit contract versions so that an old run can be replayed
with the exact contract it used.

## Version rules

- Contract IDs are stable names such as `evidence-record`.
- The major version is part of the schema `$id` and registry filename.
- An accepted schema or manifest is never edited in place.
- A patch version may clarify documentation or metadata without changing validation or behavior.
- A minor version may add optional fields or non-breaking metadata while preserving the v1
  consumer contract.
- A major version is required when a required field is removed or renamed, a type changes, an
  accepted value becomes invalid, or behavior/safety semantics change.

## Producer and consumer review

Compatibility must be checked from both directions. A change that is additive for a producer can
still break a strict consumer if it changes an enum or an unknown-field rule. Every version change
must state:

- producer compatibility
- consumer compatibility
- replay compatibility
- migration or dual-read / dual-write requirement
- whether the change affects safety or authorization

If the answer is uncertain, classify the change as breaking and create a new major version.

## Registry requirements

Every manifest must point to the schema, normative behavior, and conformance suite for the exact
version. A deprecated version must remain resolvable by ID and version even after a newer version
is accepted.
