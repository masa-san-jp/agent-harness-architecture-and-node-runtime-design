import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProfile } from "@agent-harness/profile";
import { createAdapterRegistry, loadAdapterBundle, validateAdapterBundle } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "../../../fixtures/bootstrap/adapter-bundle-v1");
const bundlePath = join(fixtureRoot, "bundle/manifest.json");
const profilePath = join(fixtureRoot, "profile.json");

describe("adapter registry", () => {
  it("loads a local bundle and resolves exactly the adapters declared by a profile", async () => {
    const bundle = await loadAdapterBundle(bundlePath);
    const profile = await loadProfile(profilePath);
    const registry = createAdapterRegistry(bundle.adapters);
    const adapters = registry.adaptersFor(profile);

    expect(bundle.manifest.bundle_id).toBe("bundle:reference-org");
    expect(bundle.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toMatchObject({
      adapterId: "reference-org-ticket",
      version: "1.0.0",
      sourceKind: "other",
    });
    expect(
      adapters[0]?.supports({
        relativePath: "ticket.org-export",
        mediaType: "application/octet-stream",
      }),
    ).toBe(true);
  });

  it("rejects unsafe bundle paths, duplicate declarations, and invalid module exports", async () => {
    expect(() =>
      validateAdapterBundle({
        bundle_id: "bundle:unsafe",
        version: "1.0.0",
        adapters: [
          {
            adapter_ref: "adapter:unsafe",
            version: "1.0.0",
            source_kind: "other",
            module_path: "../escape.mjs",
            read_only: true,
          },
        ],
      }),
    ).toThrow("ADAPTER_BUNDLE_INVALID");

    const duplicate = {
      bundle_id: "bundle:duplicate",
      version: "1.0.0",
      adapters: [
        {
          adapter_ref: "adapter:duplicate",
          version: "1.0.0",
          source_kind: "other",
          module_path: "one.mjs",
          read_only: true,
        },
        {
          adapter_ref: "adapter:duplicate",
          version: "1.0.0",
          source_kind: "other",
          module_path: "two.mjs",
          read_only: true,
        },
      ],
    };
    expect(() => validateAdapterBundle(duplicate)).toThrow("duplicate adapter_ref");

    const directory = await mkdtemp(join(tmpdir(), "agent-harness-adapter-registry-"));
    try {
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({
          bundle_id: "bundle:invalid",
          version: "1.0.0",
          adapters: [
            {
              adapter_ref: "adapter:invalid",
              version: "1.0.0",
              source_kind: "other",
              module_path: "invalid.mjs",
              read_only: true,
            },
          ],
        }),
        "utf8",
      );
      await writeFile(join(directory, "invalid.mjs"), "export default {};\n", "utf8");
      await expect(loadAdapterBundle(join(directory, "manifest.json"))).rejects.toThrow(
        "ADAPTER_INVALID",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when a profile references an unregistered adapter", async () => {
    const profile = await loadProfile(profilePath);
    expect(() => createAdapterRegistry().adaptersFor(profile)).toThrow(
      "PROFILE_ADAPTER_NOT_RESOLVED",
    );
  });
});
