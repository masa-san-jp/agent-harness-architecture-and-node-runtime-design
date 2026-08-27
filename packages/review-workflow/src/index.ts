import { createHash } from "node:crypto";

export type ReviewPriority = "low" | "medium" | "high" | "critical";
export type ReviewAnswerType = "fact" | "opinion" | "approval" | "exception";

export interface DraftForReview {
  draft_id: string;
  node_ref: string;
  field_proposals: readonly {
    field: "purpose" | "input" | "process" | "output" | "completion_condition" | "executor";
    value: unknown;
    status: "fact" | "inferred" | "human_confirmed" | "contradictory" | "unverified";
    evidence_refs: readonly string[];
  }[];
  permissions: {
    read_scopes: readonly string[];
    write_scopes: readonly string[];
    network: "none" | "internal" | "external";
  };
  completion_check: {
    value: unknown;
    status: "unconfirmed" | "candidate" | "human_confirmed";
    evidence_refs: readonly string[];
  };
  failure_handling: {
    status: "unconfirmed" | "candidate" | "human_confirmed";
  };
  risk: { level: "low" | "medium" | "high" | "critical" };
  evidence_refs: readonly string[];
}

export interface ReviewQuestion {
  question_id: string;
  target_refs: readonly string[];
  evidence_refs: readonly string[];
  path: string;
  question: string;
  reason: string;
  priority: ReviewPriority;
  status: "open" | "answered" | "suppressed";
  created_at: string;
  suppression_reason?: string;
}

export interface QuestionOptions {
  createdAt: string;
  suppressedPaths?: readonly string[];
}

export interface ReviewDecision {
  decision_id: string;
  target_refs: readonly string[];
  responder_ref: string;
  answer_type: ReviewAnswerType;
  answer: unknown;
  evidence_refs: readonly string[];
  decided_at: string;
  expires_at?: string;
}

export interface Change {
  path: string;
  operation: "add" | "replace" | "remove";
  value: unknown;
  decision_refs: readonly string[];
}

export interface ChangeSet {
  change_set_id: string;
  base_ref: string;
  changes: readonly Change[];
  created_by: string;
  created_at: string;
  status: "proposed" | "approved" | "rejected" | "applied";
  resulting_version?: string;
}

export interface ApprovalRequest {
  targetRef: string;
  requesterRef: string;
  approverRef: string;
  approverRole: string;
  riskClass: "C1" | "C2" | "C3" | "low" | "medium" | "high" | "critical";
  decision: "approve" | "reject" | "revoke";
  decidedAt: string;
  expiresAt: string;
  evidenceRefs: readonly string[];
}

export interface Approval {
  approval_id: string;
  target_ref: string;
  requester_ref: string;
  approver_ref: string;
  approver_role: string;
  risk_class: ApprovalRequest["riskClass"];
  decision: ApprovalRequest["decision"];
  decided_at: string;
  expires_at: string;
  evidence_refs: readonly string[];
  reason_codes: readonly string[];
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function priorityFor(status: string, risk: DraftForReview["risk"]["level"]): ReviewPriority {
  if (status === "contradictory" || risk === "critical") return "critical";
  if (risk === "high" || status === "unverified") return "high";
  if (status === "inferred") return "medium";
  return "low";
}

function question(
  draft: DraftForReview,
  path: string,
  evidenceRefs: readonly string[],
  reason: string,
  priority: ReviewPriority,
  options: QuestionOptions,
): ReviewQuestion {
  const suppressed = options.suppressedPaths?.includes(path) ?? false;
  const base = {
    question_id: `question:${digest({ draft: draft.draft_id, path })}`,
    target_refs: [draft.draft_id, draft.node_ref],
    evidence_refs: unique(evidenceRefs),
    path,
    question: `Confirm ${path} for ${draft.node_ref}.`,
    reason,
    priority,
    status: suppressed ? ("suppressed" as const) : ("open" as const),
    created_at: options.createdAt,
  };
  return suppressed
    ? { ...base, suppression_reason: "Suppressed by explicit review configuration" }
    : base;
}

export function generateReviewQuestions(
  draft: DraftForReview,
  options: QuestionOptions,
): readonly ReviewQuestion[] {
  const questions: ReviewQuestion[] = [];
  for (const proposal of draft.field_proposals) {
    if (proposal.status === "unverified" || proposal.status === "contradictory") {
      questions.push(
        question(
          draft,
          `field.${proposal.field}`,
          proposal.evidence_refs,
          proposal.status === "contradictory" ? "FIELD_CONTRADICTORY" : "FIELD_UNVERIFIED",
          priorityFor(proposal.status, draft.risk.level),
          options,
        ),
      );
    }
  }
  if (draft.completion_check.status !== "human_confirmed") {
    questions.push(
      question(
        draft,
        "completion_check",
        draft.completion_check.evidence_refs,
        "COMPLETION_CONDITION_UNCONFIRMED",
        "high",
        options,
      ),
    );
  }
  if (draft.failure_handling.status !== "human_confirmed") {
    questions.push(
      question(
        draft,
        "failure_handling",
        draft.evidence_refs,
        "FAILURE_HANDLING_UNCONFIRMED",
        "high",
        options,
      ),
    );
  }
  if (draft.permissions.write_scopes.length > 0) {
    questions.push(
      question(
        draft,
        "permissions.write_scopes",
        draft.evidence_refs,
        "WRITE_SCOPE_REQUIRES_APPROVAL",
        "critical",
        options,
      ),
    );
  }
  if (draft.permissions.network !== "none") {
    questions.push(
      question(
        draft,
        "permissions.network",
        draft.evidence_refs,
        "NETWORK_SCOPE_REQUIRES_APPROVAL",
        "high",
        options,
      ),
    );
  }
  if (draft.risk.level === "high" || draft.risk.level === "critical") {
    questions.push(
      question(
        draft,
        "risk.level",
        draft.evidence_refs,
        "HIGH_RISK_REQUIRES_INDEPENDENT_REVIEW",
        draft.risk.level === "critical" ? "critical" : "high",
        options,
      ),
    );
  }
  return questions;
}

export function createReviewDecision(input: {
  targetRefs: readonly string[];
  responderRef: string;
  answerType: ReviewAnswerType;
  answer: unknown;
  evidenceRefs?: readonly string[];
  decidedAt: string;
  expiresAt?: string;
}): ReviewDecision {
  return {
    decision_id: `review-decision:${digest(input)}`,
    target_refs: input.targetRefs,
    responder_ref: input.responderRef,
    answer_type: input.answerType,
    answer: input.answer,
    evidence_refs: input.evidenceRefs ?? [],
    decided_at: input.decidedAt,
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
  };
}

export function createChangeSet(input: {
  baseRef: string;
  changes: readonly Change[];
  createdBy: string;
  createdAt: string;
  resultingVersion?: string;
}): ChangeSet {
  return {
    change_set_id: `change-set:${digest(input)}`,
    base_ref: input.baseRef,
    changes: input.changes,
    created_by: input.createdBy,
    created_at: input.createdAt,
    status: "proposed",
    ...(input.resultingVersion ? { resulting_version: input.resultingVersion } : {}),
  };
}

const highRisk = new Set(["C3", "high", "critical"]);

export function createApproval(request: ApprovalRequest): Approval {
  const reasons: string[] = [];
  let decision = request.decision;
  if (request.approverRef === request.requesterRef) {
    decision = "reject";
    reasons.push("SELF_APPROVAL_FORBIDDEN");
  }
  if (
    highRisk.has(request.riskClass) &&
    !["independent_reviewer", "security_reviewer"].includes(request.approverRole)
  ) {
    decision = "reject";
    reasons.push("INDEPENDENT_REVIEWER_REQUIRED");
  }
  if (request.expiresAt <= request.decidedAt && request.decision === "approve") {
    decision = "reject";
    reasons.push("EXPIRY_MUST_FOLLOW_DECISION");
  }
  if (reasons.length === 0)
    reasons.push(
      request.decision === "approve"
        ? "APPROVED_BY_SEPARATE_REVIEWER"
        : `DECISION_${request.decision.toUpperCase()}`,
    );
  return {
    approval_id: `approval:${digest({ ...request, decision, reasons })}`,
    target_ref: request.targetRef,
    requester_ref: request.requesterRef,
    approver_ref: request.approverRef,
    approver_role: request.approverRole,
    risk_class: request.riskClass,
    decision,
    decided_at: request.decidedAt,
    expires_at: request.expiresAt,
    evidence_refs: request.evidenceRefs,
    reason_codes: unique(reasons),
  };
}

export function isApprovalActive(approval: Approval, at: string): boolean {
  return approval.decision === "approve" && approval.decided_at <= at && at < approval.expires_at;
}
