import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const registryDirectory = join(import.meta.dirname, "../../../../schemas/registry");

describe("contract registry manifests", () => {
  it("discovers one manifest per contract version without a shared index", async () => {
    const files = (await readdir(registryDirectory))
      .filter((file) => file.endsWith(".json"))
      .filter((file) => !file.startsWith("_"))
      .sort();

    expect(files).toContain("contract-manifest.v1.json");
    expect(files).toContain("core-primitives.v1.json");
    expect(files.every((file) => /^[a-z][a-z0-9-]*\.v[0-9]+\.json$/.test(file))).toBe(true);
    expect(files.some((file) => file === "index.json")).toBe(false);
  });

  it("requires every manifest to name its owner and public surfaces", async () => {
    const files = (await readdir(registryDirectory))
      .filter((file) => file.endsWith(".json"))
      .filter((file) => !file.startsWith("_"));

    for (const file of files) {
      const manifest = JSON.parse(await readFile(join(registryDirectory, file), "utf8"));
      expect(manifest).toMatchObject({
        contract_id: expect.any(String),
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        owner_issue: expect.stringMatching(/^#[1-9]\d*$/),
        schema_path: expect.stringMatching(/^schemas\/.+(\.json|\/$)/),
        normative_spec: expect.stringMatching(/^docs\/.+\.md$/),
        conformance_suite: expect.any(String),
      });
    }
  });
});
