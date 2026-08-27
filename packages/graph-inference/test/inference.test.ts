import { describe, expect, it } from "vitest";

import { CANDIDATE_NODE_FIELDS, runInference, type InferenceModel } from "../src/index.ts";

const events = [
  {
    event_id: "event:request-created",
    evidence_refs: ["record:request-001"],
    occurred_time: { kind: "instant" as const, at: "2026-01-05T09:00:00Z" },
    subject: { ref: "person:a", status: "known" as const },
    action: "request_created",
    target_refs: ["request:REQ-001"],
    output_refs: ["request:REQ-001"],
    status: "fact" as const,
    provenance: [{ kind: "source" as const, source_refs: ["record:request-001"] }],
  },
  {
    event_id: "event:request-approved",
    evidence_refs: ["record:approval-001"],
    occurred_time: { kind: "instant" as const, at: "2026-01-05T11:30:00Z" },
    subject: { status: "unknown" as const },
    action: "request_approved",
    input_refs: ["request:REQ-001"],
    status: "fact" as const,
    provenance: [{ kind: "source" as const, source_refs: ["record:approval-001"] }],
  },
];

const options = { executedAt: "2026-01-08T00:00:00Z" };

describe("graph inference", () => {
  it("creates traceable deterministic nodes with all six fields", async () => {
    const first = await runInference({ events }, options);
    const second = await runInference({ events }, options);

    expect(second).toEqual(first);
    expect(first.run.method).toBe("deterministic");
    expect(first.run.reproducible).toBe(true);
    expect(first.graph.nodes).toHaveLength(2);
    expect(first.graph.edges).toHaveLength(1);
    expect(first.graph.nodes[0]?.fields.map((field) => field.field)).toEqual(CANDIDATE_NODE_FIELDS);
    expect(first.graph.nodes.every((node) => node.status === "insufficient")).toBe(true);
    expect(
      first.graph.nodes.every((node) =>
        node.fields.every((field) => field.evidence_refs.length > 0),
      ),
    ).toBe(true);
  });

  it("keeps multiple model interpretations alongside deterministic output", async () => {
    const model: InferenceModel = {
      model_ref: "model:fake",
      model_version: "1.0.0",
      propose: ({ events: inputEvents }) => [
        {
          node_id: "model-node:monthly-report",
          status: "candidate",
          confidence: 0.7,
          evidence_refs: [inputEvents[0]?.evidence_refs[0] ?? "record:missing"],
          fields: CANDIDATE_NODE_FIELDS.map((field) => ({
            field,
            value: field === "purpose" ? "Prepare a monthly report" : null,
            status: field === "purpose" ? ("inferred" as const) : ("unverified" as const),
            confidence: field === "purpose" ? 0.7 : 0.2,
            evidence_refs: [inputEvents[0]?.evidence_refs[0] ?? "record:missing"],
            provenance: [
              {
                kind: "inferred" as const,
                source_refs: [inputEvents[0]?.event_id ?? "event:missing"],
              },
            ],
            source: "model" as const,
          })),
        },
        {
          node_id: "model-node:monthly-report-alternative",
          status: "ambiguous",
          confidence: 0.45,
          evidence_refs: [inputEvents[0]?.evidence_refs[0] ?? "record:missing"],
          fields: CANDIDATE_NODE_FIELDS.map((field) => ({
            field,
            value: field === "purpose" ? "Validate a monthly report" : null,
            status: field === "purpose" ? ("contradictory" as const) : ("unverified" as const),
            confidence: field === "purpose" ? 0.3 : 0.2,
            evidence_refs: [inputEvents[0]?.evidence_refs[0] ?? "record:missing"],
            provenance: [
              {
                kind: "inferred" as const,
                source_refs: [inputEvents[0]?.event_id ?? "event:missing"],
              },
            ],
            source: "model" as const,
          })),
        },
      ],
    };

    const result = await runInference({ events }, { ...options, model });
    expect(result.run.method).toBe("hybrid");
    expect(result.run.model_ref).toBe("model:fake");
    expect(result.graph.nodes.map((node) => node.node_id)).toEqual([
      expect.stringMatching(/^node:/),
      expect.stringMatching(/^node:/),
      "model-node:monthly-report",
      "model-node:monthly-report-alternative",
    ]);
    expect(
      result.graph.nodes.filter((node) => node.node_id.startsWith("model-node:")),
    ).toHaveLength(2);
    expect(result.graph.nodes.at(-1)?.status).toBe("ambiguous");
  });
});
