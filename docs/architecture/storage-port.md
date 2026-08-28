# Bootstrap Storage Port

`bootstrap-storage@1.0.0` defines the persistence boundary for the evidence-to-harness bootstrap
path. It keeps organization-specific databases, object stores, retention systems, and audit
systems outside the Core packages while giving every implementation the same reference semantics.

```text
ImportCatalog ──putCatalog──→ StoragePort ──→ immutable record
BootstrapRunManifest ─putRunManifest─→ StoragePort ─→ immutable record
                                      ↑
                         get by kind + stable ref
```

## Port

The public TypeScript port is implemented by `@agent-harness/storage`:

```text
putCatalog(catalog, context) -> StoredReference
getCatalog(catalogRef) -> ImportCatalog
putRunManifest(manifest, context) -> StoredReference
getRunManifest(manifestRef) -> BootstrapRunManifest
close() -> void
```

`StorageContext` carries only governance metadata needed by the storage boundary:

```json
{
  "tenant_ref": "tenant:one",
  "classification_level": "synthetic",
  "masking_state": "unmasked"
}
```

The context has no credential or raw-content field. A `StoredReference` contains the record kind,
stable record reference, source contract identity, SHA-256 payload digest, and the governance
context. The payload is not augmented with adapter-specific database fields.

## Reference implementation

`openSqliteStorage(directory)` creates `bootstrap-storage.sqlite` under the supplied directory and
uses Node 24's built-in `node:sqlite` module. It has no network or third-party runtime dependency.
The database table is deliberately small: one immutable JSON payload and its reference metadata.

The implementation enforces these rules:

- A Catalog must remain `read_only: true`; both Catalog and Run Manifest are validated before write.
- A new `(kind, ref)` is inserted in one transaction.
- Re-registering the same payload and metadata is idempotent.
- Re-registering the same ref with another payload digest is rejected with
  `IMMUTABLE_RECORD_CONFLICT`.
- Re-registering the same payload with changed governance metadata is rejected with
  `STORAGE_METADATA_CONFLICT`.
- Retrieved JSON is rehashed and validated, so a damaged row fails closed with
  `STORAGE_INTEGRITY_ERROR`.
- References are validated as opaque identifiers; SQL parameters are always bound rather than
  interpolated.

The adapter stores derived Catalog and Run Manifest JSON only. It does not copy the input directory,
raw evidence bytes, credentials, or network responses. The reference CLI therefore has no storage
side effect unless `--store <directory>` is supplied.

## Organization-specific adapters

An organization may implement the same `StoragePort` over an approved database, object store, or
audit repository. The adapter must preserve the contract version, stable `(kind, ref)` key,
payload digest, governance metadata, read-after-reopen behavior, and immutable conflict behavior.
Retention, encryption at rest, access control, backup, and multi-writer coordination remain
deployment responsibilities and must be documented by the organization profile or adapter.

An adapter should be introduced in this order:

1. Choose the storage system and document its failure, retention, and access model.
2. Map one physical record to one `StoredReference` and immutable payload.
3. Run the storage package tests and `pnpm conformance -- --suite storage` against the adapter.
4. Add organization-owned tests for tenant isolation, authorization, backup/restore, and retention.
5. Keep raw evidence retrieval behind the importer boundary; do not make the Storage Port a raw
   collection client.

The SQLite adapter is a local reference implementation, not a production deployment recipe.
