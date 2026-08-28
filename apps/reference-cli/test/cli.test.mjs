import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { openSqliteStorage } from "@agent-harness/storage";
import { main, runBootstrap } from "../src/cli.mjs";

describe("reference bootstrap CLI", () => {
  it("reproduces the offline path from raw evidence to replay teardown", async () => {
    const result = await runBootstrap();
    expect(result.catalog).toMatchObject({
      source_count: 3,
      record_count: 9,
      diagnostics: [],
      read_only: true,
    });
    expect(result.graph.node_count).toBeGreaterThan(0);
    expect(result.graph.edge_count).toBeGreaterThan(0);
    expect(result.profile).toMatchObject({
      id: "profile:minimal-office",
      version: "1.0.0",
    });
    expect(result.draft).toMatchObject({ executable: false, target_mode: "observe" });
    expect(result.policy_decision).toMatchObject({ effect: "allow", audit_required: true });
    expect(result.replay).toEqual({
      status: "completed",
      completion_passed: true,
      credentials_revoked: true,
      workspace_deleted: true,
    });
    expect(result.run_manifest).toMatchObject({
      version: "1.0.0",
      profile_ref: "profile:minimal-office",
      policy_ref: "policy:minimal-office",
      lifecycle_state: "replay",
      mode: "replay",
      reproducible: true,
      network: "none",
      approval_refs: [],
    });
    const expected = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "../../../fixtures/bootstrap/minimal-office-v1/expected/profile/run-manifest.json",
        ),
        "utf8",
      ),
    );
    const expectedManifest = { ...expected };
    delete expectedManifest.contract_id;
    expect(result.run_manifest).toEqual(expectedManifest);
  });

  it("persists only derived catalog and run manifest references when --store is supplied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-reference-cli-"));
    try {
      const result = await runBootstrap(undefined, undefined, undefined, undefined, directory);
      expect(result.storage).toMatchObject({
        catalog: {
          kind: "catalog",
          ref: result.catalog.id,
          tenant_ref: "tenant:one",
          classification_level: "synthetic",
          masking_state: "unmasked",
        },
        run_manifest: {
          kind: "run_manifest",
          ref: result.run_manifest.manifest_id,
        },
      });
      expect(await readdir(directory)).toEqual(["bootstrap-storage.sqlite"]);

      const storage = await openSqliteStorage(directory);
      try {
        expect(await storage.getRunManifest(result.run_manifest.manifest_id)).toEqual(
          result.run_manifest,
        );
        const catalog = await storage.getCatalog(result.catalog.id);
        expect(catalog.catalog_id).toBe(result.catalog.id);
        expect(catalog.records).toHaveLength(result.catalog.record_count);
      } finally {
        storage.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("executes only the adapters declared by the profile from a trusted bundle", async () => {
    const fixtureRoot = join(import.meta.dirname, "../../../fixtures/bootstrap/adapter-bundle-v1");
    const result = await runBootstrap(
      join(fixtureRoot, "raw"),
      "2026-01-08T00:00:00Z",
      join(
        import.meta.dirname,
        "../../../fixtures/bootstrap/minimal-office-v1/expected/security/policy.json",
      ),
      join(fixtureRoot, "profile.json"),
      undefined,
      join(fixtureRoot, "bundle/manifest.json"),
    );

    expect(result.catalog).toMatchObject({
      source_count: 1,
      record_count: 1,
      adapter_ids: ["reference-org-ticket"],
      read_only: true,
    });
    expect(result.adapter_bundle).toMatchObject({
      id: "bundle:reference-org",
      version: "1.0.0",
      adapter_refs: ["reference-org-ticket"],
    });
    expect(result.adapter_bundle.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run_manifest.extensions).toEqual({
      "local.adapter_bundle_digest": result.adapter_bundle.digest,
    });
  });

  it("accepts the adapter bundle through the CLI option", async () => {
    const fixtureRoot = join(import.meta.dirname, "../../../fixtures/bootstrap/adapter-bundle-v1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await main([
        "--input",
        join(fixtureRoot, "raw"),
        "--policy",
        join(
          import.meta.dirname,
          "../../../fixtures/bootstrap/minimal-office-v1/expected/security/policy.json",
        ),
        "--profile",
        join(fixtureRoot, "profile.json"),
        "--adapter-bundle",
        join(fixtureRoot, "bundle/manifest.json"),
      ]);
      expect(result.catalog.adapter_ids).toEqual(["reference-org-ticket"]);
      expect(result.adapter_bundle.id).toBe("bundle:reference-org");
    } finally {
      log.mockRestore();
    }
  });
});
