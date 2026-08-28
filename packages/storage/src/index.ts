import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { ImportCatalog } from "@agent-harness/evidence-importer";
import {
  assertValidRunManifest,
  type BootstrapRunManifest,
  type ClassificationMaskingState,
} from "@agent-harness/profile";

export const STORAGE_CONTRACT_ID = "bootstrap-storage" as const;
export const STORAGE_CONTRACT_VERSION = "1.0.0" as const;
export const CATALOG_CONTRACT_ID = "evidence-importer-port" as const;
export const CATALOG_CONTRACT_VERSION = "1.0.0" as const;

export type StorageRecordKind = "catalog" | "run_manifest";

export interface StorageContext {
  tenant_ref: string;
  classification_level: string;
  masking_state: ClassificationMaskingState;
}

export interface StoredReference {
  kind: StorageRecordKind;
  ref: string;
  contract_id: string;
  version: string;
  sha256: string;
  tenant_ref: string;
  classification_level: string;
  masking_state: ClassificationMaskingState;
}

export interface StoragePort {
  putCatalog(catalog: ImportCatalog, context: StorageContext): Promise<StoredReference>;
  getCatalog(catalogRef: string): Promise<ImportCatalog>;
  putRunManifest(manifest: BootstrapRunManifest, context: StorageContext): Promise<StoredReference>;
  getRunManifest(manifestRef: string): Promise<BootstrapRunManifest>;
  close(): void;
}

export class StorageConflictError extends Error {
  readonly code = "IMMUTABLE_RECORD_CONFLICT" as const;

  constructor(
    readonly kind: StorageRecordKind,
    readonly ref: string,
  ) {
    super(`Cannot replace immutable ${kind}: ${ref}`);
    this.name = "StorageConflictError";
  }
}

export class StorageMetadataConflictError extends Error {
  readonly code = "STORAGE_METADATA_CONFLICT" as const;

  constructor(
    readonly kind: StorageRecordKind,
    readonly ref: string,
  ) {
    super(`Storage metadata differs for immutable ${kind}: ${ref}`);
    this.name = "StorageMetadataConflictError";
  }
}

export class StorageNotFoundError extends Error {
  readonly code = "STORAGE_NOT_FOUND" as const;

  constructor(
    readonly kind: StorageRecordKind,
    readonly ref: string,
  ) {
    super(`Stored ${kind} was not found: ${ref}`);
    this.name = "StorageNotFoundError";
  }
}

export class StorageIntegrityError extends Error {
  readonly code = "STORAGE_INTEGRITY_ERROR" as const;

  constructor(
    readonly kind: StorageRecordKind,
    readonly ref: string,
  ) {
    super(`Stored ${kind} failed its digest check: ${ref}`);
    this.name = "StorageIntegrityError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const MASKING_STATES = new Set<ClassificationMaskingState>([
  "unmasked",
  "masked",
  "partially_masked",
  "unknown",
]);

interface StorageRow {
  kind: StorageRecordKind;
  record_ref: string;
  contract_id: string;
  version: string;
  payload_json: string;
  sha256: string;
  tenant_ref: string;
  classification_level: string;
  masking_state: ClassificationMaskingState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`INVALID_STORAGE_IDENTIFIER: ${field}`);
  }
}

function assertContext(context: StorageContext): void {
  assertIdentifier(context.tenant_ref, "tenant_ref");
  if (
    typeof context.classification_level !== "string" ||
    context.classification_level.length === 0 ||
    context.classification_level.length > 128
  ) {
    throw new Error("INVALID_STORAGE_CONTEXT: classification_level");
  }
  if (!MASKING_STATES.has(context.masking_state)) {
    throw new Error("INVALID_STORAGE_CONTEXT: masking_state");
  }
}

function assertCatalog(value: ImportCatalog): ImportCatalog {
  if (!isRecord(value)) throw new Error("INVALID_CATALOG: expected an object");
  assertIdentifier(value.catalog_id, "catalog_id");
  if (typeof value.captured_at !== "string" || value.captured_at.length === 0) {
    throw new Error("INVALID_CATALOG: captured_at");
  }
  if (typeof value.parser_version !== "string" || value.parser_version.length === 0) {
    throw new Error("INVALID_CATALOG: parser_version");
  }
  if (value.read_only !== true) throw new Error("CATALOG_MUST_BE_READ_ONLY");
  if (typeof value.dry_run !== "boolean") throw new Error("INVALID_CATALOG: dry_run");
  for (const field of ["artifacts", "sources", "records", "outcomes", "diagnostics"]) {
    if (!Array.isArray(value[field])) throw new Error(`INVALID_CATALOG: ${field}`);
  }
  return value;
}

function serializePayload(payload: object): { json: string; sha256: string } {
  const json = JSON.stringify(payload);
  if (!json) throw new Error("UNSERIALIZABLE_STORAGE_PAYLOAD");
  return {
    json,
    sha256: createHash("sha256").update(json).digest("hex"),
  };
}

function validateStoredRow(row: StorageRow, kind: StorageRecordKind, ref: string): void {
  if (
    typeof row.kind !== "string" ||
    row.kind !== kind ||
    typeof row.record_ref !== "string" ||
    row.record_ref !== ref ||
    !IDENTIFIER.test(row.record_ref) ||
    typeof row.contract_id !== "string" ||
    row.contract_id !== (kind === "catalog" ? CATALOG_CONTRACT_ID : "bootstrap-run-manifest") ||
    typeof row.version !== "string" ||
    !SEMVER.test(row.version) ||
    typeof row.payload_json !== "string" ||
    !DIGEST.test(row.sha256) ||
    typeof row.sha256 !== "string" ||
    typeof row.tenant_ref !== "string" ||
    !IDENTIFIER.test(row.tenant_ref) ||
    typeof row.classification_level !== "string" ||
    row.classification_level.length === 0 ||
    typeof row.masking_state !== "string" ||
    !MASKING_STATES.has(row.masking_state)
  ) {
    throw new StorageIntegrityError(kind, ref);
  }
}

function rowToReference(row: StorageRow): StoredReference {
  return {
    kind: row.kind,
    ref: row.record_ref,
    contract_id: row.contract_id,
    version: row.version,
    sha256: row.sha256,
    tenant_ref: row.tenant_ref,
    classification_level: row.classification_level,
    masking_state: row.masking_state,
  };
}

export class SqliteStorage implements StoragePort {
  readonly databasePath: string;
  #database: DatabaseSync;
  #closed = false;

  constructor(database: DatabaseSync, databasePath: string) {
    this.#database = database;
    this.databasePath = databasePath;
  }

  async putCatalog(catalog: ImportCatalog, context: StorageContext): Promise<StoredReference> {
    const validCatalog = assertCatalog(catalog);
    return this.#put(
      "catalog",
      validCatalog.catalog_id,
      CATALOG_CONTRACT_ID,
      CATALOG_CONTRACT_VERSION,
      validCatalog,
      context,
    );
  }

  async getCatalog(catalogRef: string): Promise<ImportCatalog> {
    const row = this.#getRow("catalog", catalogRef);
    const payload = JSON.parse(row.payload_json) as ImportCatalog;
    if (serializePayload(payload).sha256 !== row.sha256) {
      throw new StorageIntegrityError("catalog", catalogRef);
    }
    if (row.version !== CATALOG_CONTRACT_VERSION) {
      throw new StorageIntegrityError("catalog", catalogRef);
    }
    return assertCatalog(payload);
  }

  async putRunManifest(
    manifest: BootstrapRunManifest,
    context: StorageContext,
  ): Promise<StoredReference> {
    const validManifest = assertValidRunManifest(manifest);
    return this.#put(
      "run_manifest",
      validManifest.manifest_id,
      "bootstrap-run-manifest",
      validManifest.version,
      validManifest,
      context,
    );
  }

  async getRunManifest(manifestRef: string): Promise<BootstrapRunManifest> {
    const row = this.#getRow("run_manifest", manifestRef);
    const payload = JSON.parse(row.payload_json) as BootstrapRunManifest;
    if (serializePayload(payload).sha256 !== row.sha256) {
      throw new StorageIntegrityError("run_manifest", manifestRef);
    }
    const validManifest = assertValidRunManifest(payload);
    if (row.version !== validManifest.version) {
      throw new StorageIntegrityError("run_manifest", manifestRef);
    }
    return validManifest;
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #put(
    kind: StorageRecordKind,
    ref: string,
    contractId: string,
    version: string,
    payload: object,
    context: StorageContext,
  ): StoredReference {
    this.#ensureOpen();
    assertIdentifier(ref, "ref");
    assertContext(context);
    const serialized = serializePayload(payload);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.#selectRow(kind, ref);
      if (existing) {
        validateStoredRow(existing, kind, ref);
        if (existing.sha256 !== serialized.sha256) {
          throw new StorageConflictError(kind, ref);
        }
        if (
          existing.contract_id !== contractId ||
          existing.version !== version ||
          existing.tenant_ref !== context.tenant_ref ||
          existing.classification_level !== context.classification_level ||
          existing.masking_state !== context.masking_state
        ) {
          throw new StorageMetadataConflictError(kind, ref);
        }
        this.#database.exec("COMMIT");
        return rowToReference(existing);
      }

      this.#database
        .prepare(
          `INSERT INTO stored_records (
             kind, record_ref, contract_id, version, payload_json, sha256,
             tenant_ref, classification_level, masking_state
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          kind,
          ref,
          contractId,
          version,
          serialized.json,
          serialized.sha256,
          context.tenant_ref,
          context.classification_level,
          context.masking_state,
        );
      this.#database.exec("COMMIT");
      return {
        kind,
        ref,
        contract_id: contractId,
        version,
        sha256: serialized.sha256,
        ...context,
      };
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original error if the transaction was already closed.
      }
      throw error;
    }
  }

  #getRow(kind: StorageRecordKind, ref: string): StorageRow {
    this.#ensureOpen();
    assertIdentifier(ref, "ref");
    const row = this.#selectRow(kind, ref);
    if (!row) throw new StorageNotFoundError(kind, ref);
    validateStoredRow(row, kind, ref);
    return row;
  }

  #selectRow(kind: StorageRecordKind, ref: string): StorageRow | undefined {
    return this.#database
      .prepare(
        `SELECT kind, record_ref, contract_id, version, payload_json, sha256,
                tenant_ref, classification_level, masking_state
           FROM stored_records
          WHERE kind = ? AND record_ref = ?`,
      )
      .get(kind, ref) as StorageRow | undefined;
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("STORAGE_CLOSED");
  }
}

export async function openSqliteStorage(directory: string): Promise<SqliteStorage> {
  const resolvedDirectory = resolve(directory);
  await mkdir(resolvedDirectory, { recursive: true });
  const databasePath = resolve(resolvedDirectory, "bootstrap-storage.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS stored_records (
      kind TEXT NOT NULL CHECK (kind IN ('catalog', 'run_manifest')),
      record_ref TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      tenant_ref TEXT NOT NULL,
      classification_level TEXT NOT NULL,
      masking_state TEXT NOT NULL,
      PRIMARY KEY (kind, record_ref)
    ) STRICT;
  `);
  return new SqliteStorage(database, databasePath);
}
