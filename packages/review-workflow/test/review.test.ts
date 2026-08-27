import { describe, expect, it } from "vitest";

import {
  createApproval,
  createChangeSet,
  createReviewDecision,
  generateReviewQuestions,
  isApprovalActive,
} from "../src/index.ts";
import type { DraftForReview } from "../src/index.ts";

const draft: DraftForReview = {
  draft_id: "draft:001",
  node_ref: "node:001",
  field_proposals: [
    { field: "purpose", value: null, status: "unverified", evidence_refs: ["record:001"] },
    { field: "process", value: "request_created", status: "fact", evidence_refs: ["record:001"] },
  ],
  permissions: { read_scopes: ["record:001"], write_scopes: [], network: "none" },
  completion_check: { value: null, status: "unconfirmed", evidence_refs: ["record:001"] },
  failure_handling: { status: "unconfirmed" },
  risk: { level: "medium" },
  evidence_refs: ["record:001"],
};

describe("review workflow", () => {
  it("generates evidence-linked questions and supports explicit suppression", () => {
    const questions = generateReviewQuestions(draft, {
      createdAt: "2026-01-08T00:00:00Z",
      suppressedPaths: ["field.purpose"],
    });
    expect(questions.map((question) => question.path)).toContain("field.purpose");
    expect(questions.find((question) => question.path === "field.purpose")?.status).toBe(
      "suppressed",
    );
    expect(
      questions.find((question) => question.path === "completion_check")?.evidence_refs,
    ).toEqual(["record:001"]);
  });

  it("creates immutable decisions and proposed change sets", () => {
    const decision = createReviewDecision({
      targetRefs: ["draft:001"],
      responderRef: "person:reviewer",
      answerType: "fact",
      answer: "The requester creates the request.",
      evidenceRefs: ["record:001"],
      decidedAt: "2026-01-08T00:00:00Z",
    });
    const changeSet = createChangeSet({
      baseRef: "draft:001@1.0.0",
      changes: [
        {
          path: "field.purpose",
          operation: "replace",
          value: "Handle requests",
          decision_refs: [decision.decision_id],
        },
      ],
      createdBy: "person:reviewer",
      createdAt: "2026-01-08T00:00:00Z",
      resultingVersion: "1.0.1",
    });
    expect(decision.answer_type).toBe("fact");
    expect(changeSet.status).toBe("proposed");
    expect(changeSet.base_ref).toBe("draft:001@1.0.0");
  });

  it("rejects self-approval and expires approved decisions", () => {
    const selfApproval = createApproval({
      targetRef: "draft:001",
      requesterRef: "person:same",
      approverRef: "person:same",
      approverRole: "independent_reviewer",
      riskClass: "high",
      decision: "approve",
      decidedAt: "2026-01-08T00:00:00Z",
      expiresAt: "2026-01-09T00:00:00Z",
      evidenceRefs: ["record:001"],
    });
    expect(selfApproval.decision).toBe("reject");
    expect(selfApproval.reason_codes).toContain("SELF_APPROVAL_FORBIDDEN");

    const approval = createApproval({
      targetRef: "draft:001",
      requesterRef: "person:operator",
      approverRef: "person:reviewer",
      approverRole: "independent_reviewer",
      riskClass: "high",
      decision: "approve",
      decidedAt: "2026-01-08T00:00:00Z",
      expiresAt: "2026-01-09T00:00:00Z",
      evidenceRefs: ["record:001"],
    });
    expect(isApprovalActive(approval, "2026-01-08T12:00:00Z")).toBe(true);
    expect(isApprovalActive(approval, "2026-01-09T00:00:00Z")).toBe(false);
  });
});
