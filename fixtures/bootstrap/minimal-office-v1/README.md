# minimal-office-v1

This fixture is synthetic and intentionally small. It is the shared starting point for the
reference path from raw records to a first HarnessDraft.

The raw records contain requests, handoffs, approvals, a pending item, and a short observed
procedure. They do not contain enough information to infer legal authority, complete exception
handling, or write permissions. Implementations must expose those gaps instead of inventing them.

`manifest.json` is the fixture envelope. Every raw source is content-addressed by SHA-256 and must
remain under `raw/`. Stage-specific expected outputs belong under `expected/<stage>/` and are owned
by the Issue that produces that stage.

The fixture is offline-only, contains no real personal data or secrets, and may be replayed by every
conformance suite.
