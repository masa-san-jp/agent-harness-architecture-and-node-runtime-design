import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { importDirectory, scanForPotentialSecrets, type EvidenceAdapter } from "../src/index.ts";

const fixtureRoot = join(import.meta.dirname, "../../../fixtures/bootstrap/minimal-office-v1/raw");
const options = {
  capturedAt: "2026-01-08T00:00:00Z",
  classification: { level: "synthetic", tags: ["no-personal-data"] },
  masking: { state: "unmasked" as const },
  dryRun: true,
};

async function sha256(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

describe("evidence importer", () => {
  it("imports the canonical fixture read-only and idempotently", async () => {
    const before = await Promise.all(
      ["requests.csv", "handoffs.jsonl", "procedure.md"].map((file) =>
        sha256(join(fixtureRoot, file)),
      ),
    );
    const first = await importDirectory(fixtureRoot, options);
    const second = await importDirectory(fixtureRoot, options);

    expect(second).toEqual(first);
    expect(first.read_only).toBe(true);
    expect(first.dry_run).toBe(true);
    expect(first.sources.map((source) => source.source_kind)).toEqual([
      "api_audit",
      "procedure",
      "csv",
    ]);
    expect(first.records).toHaveLength(9);
    expect(first.outcomes.every((outcome) => outcome.status === "parsed")).toBe(true);

    const after = await Promise.all(
      ["requests.csv", "handoffs.jsonl", "procedure.md"].map((file) =>
        sha256(join(fixtureRoot, file)),
      ),
    );
    expect(after).toEqual(before);
  });

  it("reports unsupported, malformed, and potentially sensitive input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-importer-"));
    try {
      await writeFile(join(directory, "broken.json"), '{"incomplete":', "utf8");
      await writeFile(join(directory, "unknown.bin"), Buffer.from([0, 1, 2]));
      await writeFile(
        join(directory, "secret.txt"),
        "-----BEGIN PRIVATE KEY-----\nnot-retained\n-----END PRIVATE KEY-----\n",
        "utf8",
      );

      const catalog = await importDirectory(directory, options);
      expect(catalog.outcomes.map((outcome) => outcome.status)).toEqual([
        "failed",
        "parsed",
        "unsupported",
      ]);
      expect(catalog.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "PARSE_FAILED",
        "POTENTIAL_PRIVATE_KEY",
        "UNSUPPORTED_FORMAT",
      ]);
      expect(
        catalog.diagnostics.every((diagnostic) => !diagnostic.message.includes("not-retained")),
      ).toBe(true);
      expect(scanForPotentialSecrets("token=ghp_123456789012345678901234")).toEqual([
        { code: "POTENTIAL_TOKEN", line: 1 },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts an organization adapter without adding credentials to the port", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-importer-"));
    try {
      await writeFile(join(directory, "request.eml"), "Subject: Example\n\nBody\n", "utf8");
      const adapter: EvidenceAdapter = {
        adapterId: "example-email",
        version: "1.0.0",
        sourceKind: "email",
        supports: ({ relativePath }) => relativePath.endsWith(".eml"),
        parse: (input) => ({
          records: [
            {
              recordKind: "email_message",
              sourceLocator: "message-id:example@example.invalid",
              claims: [
                {
                  path: "email.subject",
                  value: "Example",
                  status: "fact",
                  provenance: [{ kind: "source", source_refs: [input.sourceId] }],
                },
              ],
            },
          ],
        }),
      };

      const catalog = await importDirectory(directory, { ...options, adapters: [adapter] });
      expect(catalog.sources[0]?.source_kind).toBe("email");
      expect(catalog.outcomes[0]?.adapter_id).toBe("example-email");
      expect(catalog.records[0]?.claims[0]?.path).toBe("email.subject");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
