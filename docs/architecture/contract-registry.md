# Contract registry

The registry is a directory of contract manifests. It intentionally has no manually maintained
shared index, so independent contributors can add contracts without editing the same file.

## Layout

```text
schemas/
├─ core/                         reusable primitives
├─ registry/
│  ├─ _meta.schema.json          manifest schema
│  └─ <contract-name>.v<major>.json
└─ <domain>/                     contract schemas owned by a work Issue
```

An accepted contract manifest is named:

```text
schemas/registry/<contract-name>.v<major>.json
```

The manifest's `schema_path`, `normative_spec`, and `conformance_suite` point to the complete
contract surface. The manifest itself is validated by
`schemas/registry/_meta.schema.json`.

## Manifest fields

```json
{
  "contract_id": "evidence-record",
  "version": "1.0.0",
  "status": "accepted",
  "owner_issue": "#3",
  "schema_path": "schemas/evidence/evidence-record.v1.schema.json",
  "normative_spec": "docs/architecture/evidence-contract.md",
  "conformance_suite": "evidence-contract",
  "compatibility": "initial"
}
```

The `$id` of a public schema is the stable, language-neutral identifier:

```text
urn:agent-harness-reference:<contract-name>:v<major>
```

The registry is discovered by scanning `schemas/registry/*.json` and ignoring files beginning with
an underscore. Consumers must resolve a contract by `contract_id` and `version`, not by an
implementation package path.

## Lifecycle

`draft` and `proposed` contracts may change on a branch. `accepted` contracts are immutable. A
breaking change creates a new major contract and manifest; a compatible revision creates a new
minor or patch version according to the compatibility policy. `deprecated` contracts remain
available for replay and historical audit until their retention policy expires.
