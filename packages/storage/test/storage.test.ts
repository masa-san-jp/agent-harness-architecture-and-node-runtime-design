import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ImportCatalog } from "@agent-harness/evidence-importer";
import type { BootstrapRunManifest } from "@agent-harness/profile";
import {
  openSqliteStorage,
  StorageConflictError,
  StorageMetadataConflictError,
  StorageNotFoundError,
} from "../src/index.ts";

const context = {
  tenant_ref: "tenant:one",
  classification_level: "synthetic",
  masking_state: "unmasked" as const,
};

const catalog: ImportCatalog = {
  catalog_id: "catalog:storage-test",
  captured_at: "2026-01-08T00:00:00Z",
  parser_version: "reference-importer/0.1.0",
  read_only: true,
  dry_run: true,
  artifacts: [],
  sources: [],
  records: [],
  outcomes: [],
  diagnostics: [],
};

async function manifest(): Promise<BootstrapRunManifest> {
  const fixture = JSON.parse(
    await readFile(
      join(
        import.meta.dirname,
        "../../../fixtures/bootstrap/minimal-office-v1/expected/profile/run-manifest.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  delete fixture.contract_id;
  return fixture as unknown as BootstrapRunManifest;
}

describe("SQLite storage port", () => {
  it("reopens and retrieves immutable catalogs and run manifests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-storage-"));
    let storage = await openSqliteStorage(directory);
    try {
      const catalogReference = await storage.putCatalog(catalog, context);
      expect(catalogReference).toMatchObject({
        kind: "catalog",
        ref: catalog.catalog_id,
        contract_id: "evidence-importer-port",
        version: "1.0.0",
        tenant_ref: "tenant:one",
        classification_level: "synthetic",
        masking_state: "unmasked",
      });
      expect(await storage.putCatalog(catalog, context)).toEqual(catalogReference);

      const runManifest = await manifest();
      const manifestReference = await storage.putRunManifest(runManifest, context);
      expect(manifestReference).toMatchObject({
        kind: "run_manifest",
        ref: runManifest.manifest_id,
        contract_id: "bootstrap-run-manifest",
      });
      expect(await storage.getCatalog(catalog.catalog_id)).toEqual(catalog);
      expect(await storage.getRunManifest(runManifest.manifest_id)).toEqual(runManifest);
      storage.close();

      storage = await openSqliteStorage(directory);
      expect(await storage.getCatalog(catalog.catalog_id)).toEqual(catalog);
      expect(await storage.getRunManifest(runManifest.manifest_id)).toEqual(runManifest);
    } finally {
      storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects replacement, metadata drift, invalid refs, and missing records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-storage-"));
    const storage = await openSqliteStorage(directory);
    try {
      await storage.putCatalog(catalog, context);
      await expect(
        storage.putCatalog({ ...catalog, parser_version: "changed" }, context),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(
        storage.putCatalog(catalog, { ...context, tenant_ref: "tenant:two" }),
      ).rejects.toBeInstanceOf(StorageMetadataConflictError);
      await expect(storage.getCatalog("../../raw/secret.txt")).rejects.toThrow(
        "INVALID_STORAGE_IDENTIFIER",
      );
      await expect(storage.getCatalog("catalog:missing")).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    } finally {
      storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
