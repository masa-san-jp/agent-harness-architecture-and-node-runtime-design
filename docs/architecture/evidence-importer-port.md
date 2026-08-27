# Evidence importer port

The evidence importer is the read-only entry point for an organization that has no harness yet.
It turns ordinary local exports into the evidence contracts without requiring an external service,
an account, or a business-system connector.

## Boundary

The reference package exposes a library API and an adapter port. It does not provide a root CLI,
storage service, model call, or organization-specific authentication. A later application may add
those integrations around this port.

```text
filesystem / export
        ↓ read-only bytes
EvidenceAdapter
        ↓
ArtifactRef + EvidenceSource + EvidenceRecord
        ↓
ImportCatalog + diagnostics
```

The importer never modifies, moves, deletes, or uploads an input path. `dry_run` is therefore
explicit in the catalog even though the reference implementation has no persistence side effect.

## Supported built-in formats

| Format     | Detection           | Records                                                      |
| ---------- | ------------------- | ------------------------------------------------------------ |
| CSV        | `.csv`              | one record per data row, with normalized column claims       |
| JSON       | `.json`             | one record for an object, one record per object for an array |
| JSONL      | `.jsonl`            | one record per non-empty line                                |
| Markdown   | `.md` / `.markdown` | one document metadata record                                 |
| Plain text | `.txt` / `.text`    | one document metadata record                                 |

The implementation records the relative source locator, byte length, SHA-256, media type, parser
version, capture time, classification, and masking state. Original bytes are not copied into a
record; they are represented by the content-addressed artifact reference.

## Adapter port

An adapter receives bytes and metadata, not credentials or a network client:

```ts
interface EvidenceAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly sourceKind: EvidenceSourceKind;
  supports(input: AdapterInput): boolean;
  parse(input: AdapterInput): Promise<AdapterParseResult> | AdapterParseResult;
}
```

An organization can add an email, chat, spreadsheet, or vendor-export adapter without changing
the Core evidence schemas. The adapter must emit a Core `source_kind` or use `other` with a
namespaced Domain extension; it must not put credentials or vendor authentication fields into the
Core contract.

### Adapter authoring checklist

1. Choose a stable `adapterId` and semantic adapter version.
2. Match only the media types or file naming rules the adapter can parse.
3. Parse bytes into addressable records and emit a source locator for every record.
4. Put organization-specific values in namespaced claims or extensions.
5. Return diagnostics for partial input; never turn a rejected record into an empty success.
6. Test the adapter with a fake input and verify that it does not need a credential or network
   client.

The importer supplies the artifact reference, classification, masking state, capture time, and
source ID to every adapter. An adapter therefore focuses on format interpretation and cannot
silently replace the integrity or read-only boundary.

## Idempotency and content identity

The caller supplies `capturedAt` and the parser version. Given the same relative paths, bytes,
parser version, and options, the catalog ID and all source, artifact, and record IDs are stable.
The importer uses content SHA-256 for artifact identity. If two paths in one import contain the
same bytes, the later path is retained in the catalog and receives a `DUPLICATE_ARTIFACT`
diagnostic instead of being silently discarded.

## Failure and sensitive-data behavior

Unsupported extensions, unreadable files, malformed JSON/CSV, symlinks, non-regular files, and
partial JSONL input produce explicit diagnostics. A failed file is never represented as a
successful empty source.

The deterministic secret scan reports only a code, path, and line number; it never includes the
matched value. It detects common private-key and token shapes as a warning, not as proof that a
secret exists. Organizations should add a stronger scanner and policy gate before sending any
material to an external model.

## Catalog use

`ImportCatalog` is an in-memory, serializable handoff. A caller may persist it using an approved
storage policy, but persistence is outside this port. Each catalog outcome identifies the adapter,
parser version, status, and diagnostics. Downstream graph inference must consume the catalog's
evidence objects and must not re-read the original path as an implicit side channel.
