# Organization Profile and Bootstrap Run Manifest

`OrganizationProfile` is the explicit boundary between the organization-specific environment and
the Core bootstrap contracts. It declares tenant and classification context, input sources,
adapter references, policy, reviewers, runtime modes, and provider references. It never contains a
password, token, private key, or credential value.

## Profile boundary

```text
organization export / identity system
              ↓ approved local handoff
OrganizationProfile ──→ read-only importer ──→ ImportCatalog
       │                       │
       ├── policy_ref           └── adapter_ref/version
       ├── reviewer_refs
       └── runtime boundaries
```

The `path` of an `input_source` is relative to the directory passed to the importer. An adapter
reference is a stable identifier; its implementation and source authentication are outside this
contract. A `credential_ref` may point to an approved secret manager handle, but the secret value
must remain in that external system.

The initial profile must be safe for bootstrap: input sources are read-only, runtime approval is
required, external network requires an explicit approval reference, and a profile that allows
`execute` must still pass the control-kernel evaluation and active human approval at runtime.

## Adapter author procedure

1. Create a non-sensitive fixture representing the vendor or organizational export.
2. Register a stable adapter ID, semantic version, source kind, and authentication boundary in the
   profile.
3. Keep retrieval and authentication outside `EvidenceAdapter`; hand the approved local bytes to
   the importer.
4. Run the adapter smoke test and verify the catalog's source hash, adapter ID/version,
   provenance, diagnostics, and `read_only: true` value.
5. Run profile conformance, the reference CLI, and the full `pnpm verify` before promotion.

## Run Manifest

`BootstrapRunManifest` is a compact, reproducible index for one run. It stores references and
SHA-256 digests rather than raw evidence or policy contents. It records the exact versions of the
lifecycle, evidence, event, graph, draft, policy, review, and runtime contracts. A consumer can
resolve the profile, input catalog, policy, draft, questions, approval, runtime run, and teardown
from the manifest without relying on process-local state.

The manifest is reproducible only when the profile, input catalog, policy, contract versions,
timestamps, mode, and referenced outcomes are fixed. A new profile or contract version produces a
new manifest identity; accepted contracts are not edited in place.

## Compatibility matrix

| Profile dimension        | Stable Core surface                             | Organization-specific value                             |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------- |
| Input format             | `evidence-importer-port@1.0.0`                  | adapter ID, version, source kind, auth reference        |
| Tenant and data handling | `bootstrap-policy@1.0.0`                        | tenant, classification, masking, retention policy       |
| Derived business graph   | `observed-event@1.0.0`, `candidate-graph@1.0.0` | field mapping and optional inference model              |
| Review and approval      | `review-contract@1.0.0`                         | reviewer identity and approval route                    |
| Runtime                  | `runtime-promotion@1.0.0`                       | executor, workspace, credential provider, allowed modes |

Changing an organization value does not require a Core contract change. Changing the meaning,
required fields, or safety semantics of a contract requires a new version according to
`docs/architecture/compatibility-policy.md`.
