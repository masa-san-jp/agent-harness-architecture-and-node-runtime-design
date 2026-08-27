import { describe, expect, it } from "vitest";

import {
  HARNESS_NODE_FIELDS,
  assessReadiness,
  createHarnessDraft,
  type CandidateNodeInput,
} from "../src/index.ts";

const date = "2026-01-08T00:00:00Z";

const node: CandidateNodeInput = {
  node_id: "node:request-created",
  status: "insufficient",
  inference_run_ref: "inference-run:001",
  evidence_refs: ["record:request-001"],
  fields: [
    {
      field: "process",
      value: "request_created",
      status: "fact",
      confidence: 1,
      evidence_refs: ["record:request-001"],
      source: "deterministic",
    },
  ],
};

function completeNode(): CandidateNodeInput {
  return {
    ...node,
    status: "candidate",
    fields: HARNESS_NODE_FIELDS.map((field) => ({
      field,
      value: field === "completion_condition" ? "request status is completed" : field,
      status: "human_confirmed" as const,
      confidence: 1,
      evidence_refs: ["record:request-001"],
      source: "human" as const,
    })),
  };
}

describe("HarnessDraft", () => {
  it("creates a non-executable observe draft and blocks missing controls", () => {
    const draft = createHarnessDraft(node, { targetMode: "observe", evaluatedAt: date });
    const assessment = assessReadiness(draft, date);

    expect(draft.executable).toBe(false);
    expect(draft.target_mode).toBe("observe");
    expect(draft.permissions.write_scopes).toEqual([]);
    expect(draft.permissions.network).toBe("none");
    expect(draft.capabilities.tool_refs).toEqual([]);
    expect(assessment.status).toBe("blocked");
    expect(assessment.blocking_reasons).toContain("NODE_FIELD_REQUIRES_CONFIRMATION");
    expect(assessment.blocking_reasons).toContain(
      "COMPLETION_CONDITION_REQUIRES_HUMAN_CONFIRMATION",
    );
    expect(assessment.blocking_reasons).toContain("FAILURE_HANDLING_REQUIRES_HUMAN_CONFIRMATION");
  });

  it("keeps complete drafts non-executable while making them ready for approval", () => {
    const draft = createHarnessDraft(completeNode(), {
      targetMode: "execute",
      evaluatedAt: date,
      completionStatus: "human_confirmed",
      failureStatus: "human_confirmed",
      policyRef: "policy:minimal-office@1.0.0",
      profileRefs: ["profile:local-office"],
    });
    const assessment = assessReadiness(draft, date);

    expect(draft.executable).toBe(false);
    expect(assessment.status).toBe("ready_for_approval");
    expect(assessment.blocking_reasons).toEqual([]);
    expect(draft.policy_ref).toBe("policy:minimal-office@1.0.0");
  });

  it("creates separate non-executable drafts for each target mode", () => {
    const drafts = ["observe", "replay", "shadow", "assist", "execute"].map((targetMode) =>
      createHarnessDraft(completeNode(), {
        targetMode: targetMode as "observe" | "replay" | "shadow" | "assist" | "execute",
        evaluatedAt: date,
        completionStatus: "human_confirmed",
        failureStatus: "human_confirmed",
      }),
    );
    expect(new Set(drafts.map((draft) => draft.draft_id)).size).toBe(5);
    expect(drafts.every((draft) => draft.executable === false)).toBe(true);
  });
});
