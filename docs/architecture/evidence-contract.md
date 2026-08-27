# Evidence and observed-event contract

This contract defines the portable boundary between records an organization already has and the
candidate business model built from those records. It is deliberately about evidence, not about a
specific importer, storage product, or AI model.

## Responsibility boundaries

| Contract             | Responsibility                                                                                        | Must not claim                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `evidence-source/v1` | Where a collection of records came from, how it was acquired, and what access or masking limits apply | That every record is complete or that a business event actually occurred |
| `evidence-record/v1` | One addressable source record plus normalized claims extracted from it                                | That normalized claims are the original content                          |
| `observed-event/v1`  | A time-ordered or time-uncertain event hypothesis linked back to evidence records                     | That an inferred event is an approved business rule                      |
| `artifact-ref/v1`    | A content-addressed reference to original or derived material                                         | That the referenced material is always available to the consumer         |

The canonical flow is:

```text
source catalog
    ↓
evidence record ───────→ artifact reference (original or derived material)
    ↓
observed event
    ↓
candidate node / graph (owned by a later contract)
```

An importer may produce these objects from CSV, mail, chat, file history, a procedure document, or
an API audit log. The importer is not part of this contract and may be replaced without changing
the normalized representation.

## Preserve the record without copying the original

An `EvidenceRecord` has an `original_artifact_ref`, source locator, and integrity information
through the referenced `ArtifactRef`. It does not have a free-form `raw` or `raw_payload` field.
Normalized claims may contain values needed for analysis, but the original bytes remain at the
declared locator or are explicitly marked as unavailable, withheld, deleted, or redacted.

Consumers must be able to answer both questions mechanically:

1. Can the original be retrieved (`artifact_ref.availability`)?
2. Was it masked (`artifact_ref.masking.state`)?

`reference_only`, `withheld`, and `deleted` are valid states. They are not importer failures and
must not cause the record to be discarded.

## Facts, hypotheses, and review

Every normalized claim and observed event has an assertion status:

- `fact`: directly present in the source or deterministically extracted from it;
- `inferred`: a model or heuristic hypothesis;
- `human_confirmed`: explicitly confirmed by a human reviewer;
- `contradictory`: conflicts with another claim or source;
- `unverified`: retained but not sufficiently supported.

Status and provenance are separate. A human may confirm an inferred claim, and a deterministic
normalizer may produce a claim whose source is still incomplete. Provenance uses the Core
`provenance/v1` kinds `source`, `normalized`, `inferred`, `human_confirmed`, and
`system_generated`; source references remain attached to the claim or event.

The following mapping is normative for the reference path:

| Operation                                    | Provenance kind    | Typical assertion status |
| -------------------------------------------- | ------------------ | ------------------------ |
| Keep the original source                     | `source`           | `fact`                   |
| Parse a CSV row or JSON field                | `normalized`       | `fact`                   |
| Extract a value with a deterministic rule    | `normalized`       | `fact` or `unverified`   |
| Propose a missing relation or event          | `inferred`         | `inferred`               |
| Record a reviewer decision                   | `human_confirmed`  | `human_confirmed`        |
| Create an import envelope or checksum record | `system_generated` | `fact`                   |

An observed event can be useful while its actor, target, or time is unknown. Unknown and ambiguous
values are represented explicitly rather than replaced with a guessed identity or timestamp.
`TemporalObservation` supports exact instants, intervals, bounded uncertainty, and an entirely
unknown time.

## Namespace and compatibility rules

The top-level fields in these contracts are Core fields. Organization-specific data belongs in the
`extensions` object and must use one of these namespaced keys:

```text
core.<name>      reserved for a published Core contract
domain.<name>    shared by a domain profile or business capability
local.<name>     private to one organization or deployment
```

Unknown `domain.*` and `local.*` values must be preserved during read/transform/write round trips.
Consumers that do not understand an extension may ignore it for Core processing, but may not delete
it from a persisted evidence object. A `core.*` extension may be emitted only when its owning Core
contract is published in the registry.

Adding an optional extension or an optional field is compatible. Removing a field, changing its
meaning or type, adding a new required field, or changing an enum in a way that rejects existing
data requires a new major contract. A Domain or Local extension must not redefine a Core field or
silently change the meaning of an existing namespace key.

## Source examples

The same boundary applies to different input formats:

| Input         | `source_kind` | Addressable record                      | Normalized result                                           |
| ------------- | ------------- | --------------------------------------- | ----------------------------------------------------------- |
| CSV export    | `csv`         | row number or stable row key            | column claims with `normalized` provenance                  |
| Email         | `email`       | message ID and attachment ID            | sender, recipients, subject, body-derived claims            |
| File history  | `file_update` | repository/object version and timestamp | create, modify, rename, or delete event                     |
| API audit log | `api_audit`   | audit event ID or request ID            | actor, operation, target, result, and request/response refs |

The canonical fixture includes CSV, JSONL audit-like records, and a procedure document. The
conformance fixture also includes the four source-kind mappings above so a new importer can start
from observed records without inventing an organization-specific schema.

## Security and retention

Classification and masking metadata travel with every public object. A downstream component must
not infer that a reference is safe to expose merely because its content is unavailable. Access
control, retention, and deletion are organization policies; this contract records their effective
state so later graph, harness, and runtime contracts can enforce them.
