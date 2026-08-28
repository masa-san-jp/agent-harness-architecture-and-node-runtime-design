# minimal-office-v1

This fixture is synthetic and intentionally small. It is the canonical starting point for the
reference path from raw records to a first HarnessDraft and can be used without any external
service or personal data.

The raw records contain requests, handoffs, approvals, a pending item, and a short observed
procedure. They do not contain enough information to infer legal authority, complete exception
handling, or write permissions. Implementations must expose those gaps instead of inventing them.

Use it to confirm the complete local path:

```text
raw/ → Evidence Importer → Catalog → Candidate Graph → HarnessDraft → review questions → replay
```

The expected outputs are organized by stage under `expected/`:

- `evidence/`, `importer/`: normalized evidence and Catalog expectations
- `graph/`: candidate nodes and edges
- `harness-draft/`, `review/`: draft readiness and review questions
- `security/`, `lifecycle/`, `runtime/`: policy, promotion, replay, and teardown expectations
- `profile/`: the organization Profile and reproducible Run Manifest expectations
- `storage/`: references for the local SQLite adapter

`manifest.json` is the fixture envelope. Every raw source is content-addressed by SHA-256 and must
remain under `raw/`. Stage-specific expected outputs belong under `expected/<stage>/` and are owned
by the Issue that produces that stage.

The fixture is offline-only, contains no real personal data or secrets, and may be replayed by every
conformance suite. The reference CLI reads `raw/` but does not modify, upload, or delete it. Do not
replace this canonical fixture with real organizational data; create a separate approved export and
organization-owned fixture instead.
