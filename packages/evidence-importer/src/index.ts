import { createHash } from "node:crypto";
import { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const DEFAULT_PARSER_VERSION = "reference-importer/0.1.0";

export type SourceKind =
  | "csv"
  | "email"
  | "chat"
  | "file_update"
  | "api_audit"
  | "procedure"
  | "spreadsheet"
  | "other";

export type AssertionStatus =
  | "fact"
  | "inferred"
  | "human_confirmed"
  | "contradictory"
  | "unverified";

export type ProvenanceKind =
  | "source"
  | "normalized"
  | "inferred"
  | "human_confirmed"
  | "system_generated";

export interface Classification {
  level: string;
  tags?: readonly string[];
}

export interface Masking {
  state: "unmasked" | "masked" | "partially_masked" | "unknown";
  method_ref?: string;
  detected_by?: "source_metadata" | "deterministic" | "human" | "unknown";
}

export interface Provenance {
  kind: ProvenanceKind;
  source_refs?: readonly string[];
  actor_ref?: string;
  method_ref?: string;
  observed_at?: string;
}

export interface TemporalObservation {
  kind: "instant" | "interval" | "bounded" | "unknown";
  at?: string;
  start?: string;
  end?: string;
  earliest?: string;
  latest?: string;
  precision: "exact" | "minute" | "hour" | "day" | "unknown";
  note?: string;
}

export interface EvidenceClaim {
  path: string;
  value: unknown;
  status: AssertionStatus;
  provenance: readonly Provenance[];
}

export interface ArtifactRef {
  artifact_id: string;
  locator: string;
  media_type: string;
  sha256: string;
  size_bytes: number;
  availability: "stored" | "reference_only" | "withheld" | "deleted";
  masking: Masking;
  classification: Classification;
  captured_at: string;
}

export interface EvidenceSource {
  source_id: string;
  source_kind: SourceKind;
  media_type: string;
  locator: string;
  captured_at: string;
  original_artifact_ref: string;
  record_count: number;
  classification: Classification;
  masking: Masking;
  provenance: readonly Provenance[];
}

export interface EvidenceRecord {
  record_id: string;
  source_ref: string;
  record_kind: string;
  captured_at: string;
  observed_time?: TemporalObservation;
  original_artifact_ref: string;
  source_locator: string;
  claims: readonly EvidenceClaim[];
  classification: Classification;
  masking: Masking;
  provenance: readonly Provenance[];
}

export interface AdapterInput {
  sourceId: string;
  relativePath: string;
  mediaType: string;
  bytes: Buffer;
  artifact: ArtifactRef;
  capturedAt: string;
  classification: Classification;
  masking: Masking;
}

export interface ParsedRecord {
  recordKind: string;
  sourceLocator: string;
  claims: readonly EvidenceClaim[];
  observedTime?: TemporalObservation;
}

export interface AdapterParseResult {
  records: readonly ParsedRecord[];
  diagnostics?: readonly ImportDiagnostic[];
}

export interface EvidenceAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly sourceKind: SourceKind;
  supports(input: Pick<AdapterInput, "relativePath" | "mediaType">): boolean;
  parse(input: AdapterInput): AdapterParseResult | Promise<AdapterParseResult>;
}

export interface ImportDiagnostic {
  diagnostic_id: string;
  code: string;
  severity: "info" | "warning" | "error";
  path: string;
  line?: number;
  message: string;
}

export interface ImportOutcome {
  source_ref: string;
  adapter_id: string;
  parser_version: string;
  status: "parsed" | "partial" | "unsupported" | "failed" | "duplicate";
  diagnostic_refs: readonly string[];
}

export interface ImportCatalog {
  catalog_id: string;
  captured_at: string;
  parser_version: string;
  read_only: true;
  dry_run: boolean;
  artifacts: readonly ArtifactRef[];
  sources: readonly EvidenceSource[];
  records: readonly EvidenceRecord[];
  outcomes: readonly ImportOutcome[];
  diagnostics: readonly ImportDiagnostic[];
}

export interface ImportOptions {
  capturedAt: string;
  classification: Classification;
  masking?: Masking;
  parserVersion?: string;
  dryRun?: boolean;
  adapters?: readonly EvidenceAdapter[];
}

export interface SecretFinding {
  code: "POTENTIAL_PRIVATE_KEY" | "POTENTIAL_TOKEN";
  line: number;
}

const mediaTypes: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".text": "text/plain",
  ".txt": "text/plain",
};

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashText(value: string): string {
  return hashBytes(Buffer.from(value));
}

function mediaTypeFor(path: string): string {
  return mediaTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function sourceKindFor(path: string): SourceKind {
  switch (extname(path).toLowerCase()) {
    case ".csv":
      return "csv";
    case ".jsonl":
      return "api_audit";
    case ".md":
    case ".markdown":
      return "procedure";
    default:
      return "other";
  }
}

function claim(
  path: string,
  value: unknown,
  sourceId: string,
  kind: ProvenanceKind = "normalized",
): EvidenceClaim {
  return {
    path,
    value,
    status: "fact",
    provenance: [{ kind, source_refs: [sourceId] }],
  };
}

function normalizedPath(value: string, fallback: string): string {
  const path = value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return path || fallback;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function csvAdapter(): EvidenceAdapter {
  return {
    adapterId: "builtin-csv",
    version: "1.0.0",
    sourceKind: "csv",
    supports: ({ mediaType }) => mediaType === "text/csv",
    parse: (input) => {
      const rows = parseCsv(input.bytes.toString("utf8").replace(/^\uFEFF/, ""));
      if (rows.length === 0) return { records: [] };
      const headerRow = rows[0] ?? [];
      const dataRows = rows.slice(1);
      const headers = headerRow.map((header, index) =>
        normalizedPath(header, `column_${index + 1}`),
      );
      const records = dataRows.map((values, rowIndex) => ({
        recordKind: "csv_row",
        sourceLocator: `row:${rowIndex + 2}`,
        claims: values.map((value, index) =>
          claim(headers[index] ?? `column_${index + 1}`, value, input.sourceId),
        ),
      }));
      return { records };
    },
  };
}

function jsonClaims(value: Record<string, unknown>, sourceId: string): EvidenceClaim[] {
  const entries = Object.entries(value);
  if (entries.length === 0) return [claim("json.object", value, sourceId)];
  return entries.map(([key, entry]) => claim(normalizedPath(key, "json.value"), entry, sourceId));
}

function jsonAdapter(): EvidenceAdapter {
  return {
    adapterId: "builtin-json",
    version: "1.0.0",
    sourceKind: "other",
    supports: ({ mediaType }) => mediaType === "application/json",
    parse: (input) => {
      const value: unknown = JSON.parse(input.bytes.toString("utf8"));
      const values = Array.isArray(value) ? value : [value];
      if (
        values.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))
      ) {
        throw new Error("JSON root must be an object or an array of objects");
      }
      return {
        records: values.map((entry, index) => ({
          recordKind: "json_object",
          sourceLocator: Array.isArray(value) ? `item:${index}` : "document",
          claims: jsonClaims(entry as Record<string, unknown>, input.sourceId),
        })),
      };
    },
  };
}

function jsonlAdapter(): EvidenceAdapter {
  return {
    adapterId: "builtin-jsonl",
    version: "1.0.0",
    sourceKind: "api_audit",
    supports: ({ mediaType }) => mediaType === "application/jsonl",
    parse: (input) => {
      const records: ParsedRecord[] = [];
      const diagnostics: ImportDiagnostic[] = [];
      const lines = input.bytes.toString("utf8").split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        try {
          const value: unknown = JSON.parse(line);
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("JSONL line must be an object");
          }
          records.push({
            recordKind: "jsonl_record",
            sourceLocator: `line:${index + 1}`,
            claims: jsonClaims(value as Record<string, unknown>, input.sourceId),
          });
        } catch (error) {
          diagnostics.push({
            diagnostic_id: "pending",
            code: "PARSE_FAILED",
            severity: "error",
            path: input.relativePath,
            line: index + 1,
            message: error instanceof Error ? error.message : "JSONL line could not be parsed",
          });
        }
      }
      return { records, diagnostics };
    },
  };
}

function textAdapter(
  adapterId: string,
  sourceKind: SourceKind,
  mediaType: "text/markdown" | "text/plain",
): EvidenceAdapter {
  return {
    adapterId,
    version: "1.0.0",
    sourceKind,
    supports: (input) => input.mediaType === mediaType,
    parse: (input) => {
      const text = input.bytes.toString("utf8");
      const lines = text.split(/\r?\n/);
      return {
        records: [
          {
            recordKind: "text_document",
            sourceLocator: "document",
            claims: [
              claim("document.line_count", lines.length, input.sourceId),
              claim(
                "document.non_empty_line_count",
                lines.filter((line) => line.trim().length > 0).length,
                input.sourceId,
              ),
              claim(
                "document.heading_count",
                lines.filter((line) => /^\s*#{1,6}\s+/.test(line)).length,
                input.sourceId,
              ),
            ],
          },
        ],
      };
    },
  };
}

export const builtInAdapters: readonly EvidenceAdapter[] = [
  csvAdapter(),
  jsonAdapter(),
  jsonlAdapter(),
  textAdapter("builtin-markdown", "procedure", "text/markdown"),
  textAdapter("builtin-text", "other", "text/plain"),
];

export function scanForPotentialSecrets(input: Uint8Array | string): readonly SecretFinding[] {
  const text = typeof input === "string" ? input : Buffer.from(input).toString("utf8");
  const findings: SecretFinding[] = [];
  const patterns: readonly [SecretFinding["code"], RegExp][] = [
    ["POTENTIAL_PRIVATE_KEY", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    [
      "POTENTIAL_TOKEN",
      /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/,
    ],
  ];
  for (const [code, pattern] of patterns) {
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (pattern.test(line)) findings.push({ code, line: index + 1 });
    }
  }
  return findings;
}

interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
}

interface DiscoveryDiagnostic {
  code: string;
  severity: "warning" | "error";
  path: string;
  message: string;
}

async function discoverFiles(root: string): Promise<{
  files: readonly DiscoveredFile[];
  diagnostics: readonly DiscoveryDiagnostic[];
}> {
  const files: DiscoveredFile[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  async function visit(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        code: "READ_FAILED",
        severity: "error",
        path: relative(root, directory).split(sep).join("/") || ".",
        message: error instanceof Error ? error.message : "Directory could not be read",
      });
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        diagnostics.push({
          code: "SYMLINK_SKIPPED",
          severity: "warning",
          path: relativePath,
          message: "Symbolic links are not followed by the read-only importer",
        });
      } else if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath });
      } else {
        diagnostics.push({
          code: "NON_REGULAR_FILE",
          severity: "warning",
          path: relativePath,
          message: "Only regular files are imported",
        });
      }
    }
  }

  await visit(root);
  return { files, diagnostics };
}

function addDiagnostic(
  diagnostics: ImportDiagnostic[],
  diagnostic: Omit<ImportDiagnostic, "diagnostic_id">,
): string {
  const diagnosticId = `diagnostic:${String(diagnostics.length + 1).padStart(4, "0")}`;
  diagnostics.push({ diagnostic_id: diagnosticId, ...diagnostic });
  return diagnosticId;
}

function recordId(sourceId: string, locator: string): string {
  return `record:${hashText(`${sourceId}:${locator}`).slice(0, 24)}`;
}

function makeRecord(parsed: ParsedRecord, input: AdapterInput): EvidenceRecord {
  return {
    record_id: recordId(input.sourceId, parsed.sourceLocator),
    source_ref: input.sourceId,
    record_kind: parsed.recordKind,
    captured_at: input.capturedAt,
    ...(parsed.observedTime ? { observed_time: parsed.observedTime } : {}),
    original_artifact_ref: input.artifact.artifact_id,
    source_locator: parsed.sourceLocator,
    claims: parsed.claims,
    classification: input.classification,
    masking: input.masking,
    provenance: [{ kind: "normalized", source_refs: [input.sourceId] }],
  };
}

export async function importDirectory(
  directory: string,
  options: ImportOptions,
): Promise<ImportCatalog> {
  const root = resolve(directory);
  const parserVersion = options.parserVersion ?? DEFAULT_PARSER_VERSION;
  const masking = options.masking ?? { state: "unknown", detected_by: "unknown" as const };
  const { files, diagnostics: discoveryDiagnostics } = await discoverFiles(root);
  const diagnostics: ImportDiagnostic[] = [];

  for (const diagnostic of discoveryDiagnostics) addDiagnostic(diagnostics, diagnostic);

  const artifacts: ArtifactRef[] = [];
  const sources: EvidenceSource[] = [];
  const records: EvidenceRecord[] = [];
  const outcomes: ImportOutcome[] = [];
  const seenHashes = new Set<string>();

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(file.absolutePath);
    } catch (error) {
      const diagnosticId = addDiagnostic(diagnostics, {
        code: "READ_FAILED",
        severity: "error",
        path: file.relativePath,
        message: error instanceof Error ? error.message : "File could not be read",
      });
      outcomes.push({
        source_ref: `source:${hashText(file.relativePath).slice(0, 24)}`,
        adapter_id: "none",
        parser_version: parserVersion,
        status: "failed",
        diagnostic_refs: [diagnosticId],
      });
      continue;
    }

    const sha256 = hashBytes(bytes);
    const sourceId = `source:${hashText(`${file.relativePath}:${sha256}`).slice(0, 24)}`;
    const mediaType = mediaTypeFor(file.relativePath);
    const artifactId = `artifact:${sha256}`;
    const artifact: ArtifactRef = {
      artifact_id: artifactId,
      locator: file.relativePath,
      media_type: mediaType,
      sha256,
      size_bytes: bytes.byteLength,
      availability: "stored",
      masking,
      classification: options.classification,
      captured_at: options.capturedAt,
    };
    artifacts.push(artifact);

    const fileDiagnosticRefs: string[] = [];
    for (const finding of scanForPotentialSecrets(bytes)) {
      fileDiagnosticRefs.push(
        addDiagnostic(diagnostics, {
          code: finding.code,
          severity: "warning",
          path: file.relativePath,
          line: finding.line,
          message: "Potential sensitive material detected; matched content is not retained",
        }),
      );
    }

    const input: AdapterInput = {
      sourceId,
      relativePath: file.relativePath,
      mediaType,
      bytes,
      artifact,
      capturedAt: options.capturedAt,
      classification: options.classification,
      masking,
    };
    const adapter = [...(options.adapters ?? []), ...builtInAdapters].find((candidate) =>
      candidate.supports(input),
    );
    let status: ImportOutcome["status"] = "parsed";
    let parsedRecords: EvidenceRecord[] = [];
    let adapterId = adapter?.adapterId ?? "none";
    let adapterVersion = adapter?.version ?? parserVersion;

    if (seenHashes.has(sha256)) {
      status = "duplicate";
      fileDiagnosticRefs.push(
        addDiagnostic(diagnostics, {
          code: "DUPLICATE_ARTIFACT",
          severity: "warning",
          path: file.relativePath,
          message: "The same content hash was already cataloged in this import",
        }),
      );
    } else if (!adapter) {
      status = "unsupported";
      fileDiagnosticRefs.push(
        addDiagnostic(diagnostics, {
          code: "UNSUPPORTED_FORMAT",
          severity: "error",
          path: file.relativePath,
          message: `No adapter supports media type ${mediaType}`,
        }),
      );
    } else {
      try {
        const result = await adapter.parse(input);
        for (const diagnostic of result.diagnostics ?? []) {
          const { diagnostic_id: _ignored, ...withoutId } = diagnostic;
          const diagnosticId = addDiagnostic(diagnostics, withoutId);
          fileDiagnosticRefs.push(diagnosticId);
        }
        parsedRecords = result.records.map((parsed) => makeRecord(parsed, input));
        records.push(...parsedRecords);
        if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.severity === "error")) {
          status = "partial";
        }
      } catch (error) {
        status = "failed";
        fileDiagnosticRefs.push(
          addDiagnostic(diagnostics, {
            code: "PARSE_FAILED",
            severity: "error",
            path: file.relativePath,
            message: error instanceof Error ? error.message : "File could not be parsed",
          }),
        );
      }
    }

    const source: EvidenceSource = {
      source_id: sourceId,
      source_kind: adapter?.sourceKind ?? sourceKindFor(file.relativePath),
      media_type: mediaType,
      locator: file.relativePath,
      captured_at: options.capturedAt,
      original_artifact_ref: artifactId,
      record_count: parsedRecords.length,
      classification: options.classification,
      masking,
      provenance: [{ kind: "source", source_refs: [sourceId] }],
    };
    sources.push(source);
    outcomes.push({
      source_ref: sourceId,
      adapter_id: adapterId,
      parser_version: adapterVersion,
      status,
      diagnostic_refs: fileDiagnosticRefs,
    });
    seenHashes.add(sha256);
  }

  const fingerprint = hashText(
    JSON.stringify({
      parserVersion,
      files: artifacts.map(({ locator, sha256 }) => ({ locator, sha256 })),
    }),
  ).slice(0, 32);
  return {
    catalog_id: `catalog:${fingerprint}`,
    captured_at: options.capturedAt,
    parser_version: parserVersion,
    read_only: true,
    dry_run: options.dryRun ?? true,
    artifacts,
    sources,
    records,
    outcomes,
    diagnostics,
  };
}
