# Source of truth and change protocol

This document defines how the reference implementation resolves competing descriptions of a
contract. GitHub Issues remain the source of truth for work scope and progress; they do not replace
versioned contracts in the repository.

## Authority order

Use the following authority for the corresponding kind of statement:

1. Structure, required fields, and validation: the accepted JSON Schema under `schemas/`.
2. Behavior, safety invariants, and state transitions: the normative specification under
   `docs/architecture/`.
3. Decision rationale and alternatives: the applicable ADR under `docs/adr/`.
4. Accepted examples and expected outcomes: the conformance suite and canonical fixtures.
5. Implementation details: `packages/` and `apps/`, provided they conform to the above.
6. Work scope, progress, and completion evidence: the owning GitHub Issue and pull request.
7. Discussion comments and local notes are advisory only.

If a lower-authority artifact conflicts with a higher-authority artifact, stop implementation and
open a contract change proposal. Do not silently adapt the implementation or add a private variant.

## Contract ownership

Every public contract has one owning Issue and one registry manifest. The owner is responsible for
the schema, normative behavior document, compatibility classification, and conformance suite.
Consumers may depend on a published contract version but must not edit its files.

## Generated artifacts

Generated TypeScript bindings, registry listings, and reports are derived artifacts. They may be
committed only when the owning contract explicitly requires it, and must include the source
contract ID and version. They are never edited as the source of truth.

## Work item protocol

Each implementation Issue must state:

- Owned paths
- Consumed contract IDs and versions
- Produced contract IDs and versions
- Paths and behaviors it must not change
- Verification commands
- Completion evidence

An implementation is complete only when its PR is merged, its contract manifest is accepted, and
the owning Issue records the verification evidence.
