# Evidence Adapter Registry

The Adapter Registry is the binding boundary between an organization profile and executable
`EvidenceAdapter` implementations. A profile declares the adapter reference, version, source kind,
and authentication boundary; the registry resolves that declaration to a read-only adapter before
the importer sees any bytes.

```text
OrganizationProfile.adapters
          ↓ exact ref/version/source_kind match
AdapterRegistry ──→ declared EvidenceAdapter[]
          ↓
read-only importDirectory(adapter list)
          ↓
ImportCatalog + adapter outcomes
```

## Resolution rules

`createAdapterRegistry()` starts with the built-in adapters. A caller may register adapters loaded
from a trusted local bundle. `adaptersFor(profile)` then:

- resolves every profile `adapter_ref`, failing closed if one is missing;
- rejects duplicate profile declarations and duplicate registry IDs;
- requires the implementation version and source kind to match the profile exactly; and
- returns only adapters declared by the profile, so an undeclared built-in cannot parse an input.

The registry does not retrieve exports, call a vendor API, or resolve credentials. Retrieval and
authentication happen before the approved local handoff to the importer.

## Trusted local bundle

`loadAdapterBundle(path)` reads an `evidence-adapter-bundle@1.0.0` manifest and imports the listed
ES modules. The bundle manifest contains only a bundle identity and adapter metadata:

```json
{
  "bundle_id": "bundle:reference-org",
  "version": "1.0.0",
  "adapters": [
    {
      "adapter_ref": "reference-org-ticket",
      "version": "1.0.0",
      "source_kind": "other",
      "module_path": "org-ticket.mjs",
      "read_only": true
    }
  ]
}
```

The loader rejects absolute paths, traversal segments, symlink escapes from the bundle directory,
duplicate references, non-`*.mjs` modules, malformed exports, and metadata mismatches. An adapter
module must export an `EvidenceAdapter` as its default export (or `adapter` named export). The
adapter receives the existing importer input boundary: bounded bytes and metadata, never a
credential or network client.

The bundle digest covers the normalized manifest and every module's bytes. When a bundle is used,
the reference CLI stores that digest in the Run Manifest under the namespaced
`local.adapter_bundle_digest` extension. This makes a changed adapter implementation produce a
different reproducibility identity without changing the existing Core manifest fields.

The bundle path is a trusted code-loading boundary. Organizations must review and pin the module
source, run it in the approved runtime environment, and add tests for tenant isolation, secret
handling, dependency policy, and supply-chain provenance before production use.

## Authoring flow

1. Add a representative non-sensitive export fixture.
2. Implement a pure adapter module that parses bytes into Core claims and explicit diagnostics.
3. Add the adapter declaration to the organization Profile and bundle manifest with identical
   reference, version, and source kind.
4. Run the reference CLI with `--adapter-bundle`, then inspect adapter outcomes and the bundle
   digest in the output Run Manifest.
5. Run `pnpm conformance -- --suite adapter-registry` and the full verification suite.

The local bundle loader is a reference implementation for trusted code. It is not a replacement for
an organization's code review, artifact signing, deployment isolation, or secret manager.
