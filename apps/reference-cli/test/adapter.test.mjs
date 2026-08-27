import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { importDirectory } from "@agent-harness/evidence-importer";

describe("reference adapter test harness", () => {
  it("validates an organization adapter through the public importer port", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-harness-reference-adapter-"));
    try {
      await writeFile(join(directory, "ticket.org-export"), "ticket=42\n", "utf8");
      const adapter = {
        adapterId: "reference-org-export",
        version: "1.0.0",
        sourceKind: "other",
        supports: ({ relativePath, mediaType }) =>
          relativePath.endsWith(".org-export") && mediaType === "application/octet-stream",
        parse: (input) => {
          expect(input).not.toHaveProperty("credentials");
          return {
            records: [
              {
                recordKind: "organization_ticket",
                sourceLocator: "ticket:42",
                claims: [
                  {
                    path: "ticket.id",
                    value: "42",
                    status: "fact",
                    provenance: [{ kind: "source", source_refs: [input.sourceId] }],
                  },
                ],
              },
            ],
          };
        },
      };

      const catalog = await importDirectory(directory, {
        capturedAt: "2026-01-08T00:00:00Z",
        classification: { level: "synthetic", tags: ["adapter-test"] },
        masking: { state: "unmasked" },
        dryRun: true,
        adapters: [adapter],
      });

      expect(catalog.read_only).toBe(true);
      expect(catalog.sources[0]?.source_kind).toBe("other");
      expect(catalog.outcomes[0]).toMatchObject({
        adapter_id: "reference-org-export",
        status: "parsed",
      });
      expect(catalog.records[0]?.record_kind).toBe("organization_ticket");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
