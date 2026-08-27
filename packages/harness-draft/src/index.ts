import { createHash } from "node:crypto";

export const HARNESS_TARGET_MODES = ["observe", "replay", "shadow", "assist", "execute"] as const;
export const HARNESS_NODE_FIELDS = [
  "purpose",
  "input",
  "process",
  "output",
  "completion_condition",
  "executor",
] as const;

export type HarnessTargetMode = (typeof HARNESS_TARGET_MODES)[number];
export type HarnessNodeField = (typeof HARNESS_NODE_FIELDS)[number];
export type AssertionStatus =
  | "fact"
  | "inferred"
  | "human_confirmed"
  | "contradictory"
  | "unverified";
export type CandidateSource = "deterministic" | "model" | "human";

export interface CandidateFieldInput {
  field: HarnessNodeField;
  value: unknown;
  status: AssertionStatus;
  confidence: number;
  evidence_refs: readonly string[];
  source: CandidateSource;
}

export interface CandidateNodeInput {
  node_id: string;
  status: "candidate" | "insufficient" | "ambiguous" | "contradictory";
  fields: readonly CandidateFieldInput[];
  evidence_refs: readonly string[];
  inference_run_ref: string;
}

export interface DraftFieldProposal extends CandidateFieldInput {}

export interface AdapterBinding {
  binding_ref: string;
  purpose: string;
}

export interface HarnessDraft {
  draft_id: string;
  node_ref: string;
  draft_version: string;
  target_mode: HarnessTargetMode;
  executable: false;
  inference_run_ref: string;
  field_proposals: readonly DraftFieldProposal[];
  capabilities: {
    model_requirements: readonly string[];
    skill_refs: readonly string[];
    tool_refs: readonly string[];
    adapter_bindings: readonly AdapterBinding[];
  };
  permissions: {
    read_scopes: readonly string[];
    write_scopes: readonly string[];
    network: "none" | "internal" | "external";
  };
  input_contract_ref?: string;
  output_contract_ref?: string;
  completion_check: {
    value: unknown;
    status: "unconfirmed" | "candidate" | "human_confirmed";
    verification_method: string;
    evidence_refs: readonly string[];
  };
  failure_handling: {
    status: "unconfirmed" | "candidate" | "human_confirmed";
    on_failure: "stop" | "return_to_review" | "retry";
    max_retries: number;
  };
  logging: {
    required_events: readonly string[];
  };
  teardown: {
    revoke_credentials: true;
    delete_workspace: true;
  };
  risk: {
    level: "low" | "medium" | "high" | "critical";
    reasons: readonly string[];
  };
  profile_refs?: readonly string[];
  policy_ref?: string;
  evidence_refs: readonly string[];
}

export interface ReadinessCheck {
  check_id: string;
  passed: boolean;
  reason: string;
}

export interface ReadinessAssessment {
  assessment_id: string;
  draft_ref: string;
  evaluated_at: string;
  status: "blocked" | "needs_review" | "ready_for_approval";
  checks: readonly ReadinessCheck[];
  blocking_reasons: readonly string[];
}

export interface DraftOptions {
  evaluatedAt: string;
  targetMode: HarnessTargetMode;
  draftVersion?: string;
  profileRefs?: readonly string[];
  policyRef?: string;
  inputContractRef?: string;
  outputContractRef?: string;
  skillRefs?: readonly string[];
  toolRefs?: readonly string[];
  adapterBindings?: readonly AdapterBinding[];
  requestedWriteScopes?: readonly string[];
  network?: "none" | "internal" | "external";
  completionStatus?: "unconfirmed" | "candidate" | "human_confirmed";
  completionVerificationMethod?: string;
  failureStatus?: "unconfirmed" | "candidate" | "human_confirmed";
  failureOn?: "stop" | "return_to_review" | "retry";
  maxRetries?: number;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function fallbackField(
  name: HarnessNodeField,
  evidenceRefs: readonly string[],
): DraftFieldProposal {
  return {
    field: name,
    value: null,
    status: "unverified",
    confidence: 0.2,
    evidence_refs: evidenceRefs,
    source: "deterministic",
  };
}

function riskFor(node: CandidateNodeInput, options: DraftOptions): HarnessDraft["risk"] {
  const reasons: string[] = [];
  let level: HarnessDraft["risk"]["level"] = "low";
  if (node.status === "insufficient") {
    level = "medium";
    reasons.push("NODE_FIELDS_INCOMPLETE");
  }
  if (node.status === "ambiguous") {
    level = "high";
    reasons.push("NODE_INTERPRETATION_AMBIGUOUS");
  }
  if (node.status === "contradictory") {
    level = "critical";
    reasons.push("NODE_EVIDENCE_CONTRADICTORY");
  }
  if ((options.requestedWriteScopes ?? []).length > 0) {
    level = level === "critical" ? level : "high";
    reasons.push("WRITE_SCOPE_REQUESTED");
  }
  if (options.network && options.network !== "none") {
    level = level === "critical" ? level : "high";
    reasons.push("NETWORK_SCOPE_REQUESTED");
  }
  return { level, reasons };
}

export function createHarnessDraft(node: CandidateNodeInput, options: DraftOptions): HarnessDraft {
  const evidenceRefs = unique(node.evidence_refs);
  const fieldsByName = new Map(node.fields.map((candidate) => [candidate.field, candidate]));
  const fieldProposals = HARNESS_NODE_FIELDS.map(
    (name) => fieldsByName.get(name) ?? fallbackField(name, evidenceRefs),
  );
  const completionField =
    fieldsByName.get("completion_condition") ?? fallbackField("completion_condition", evidenceRefs);
  const draftVersion = options.draftVersion ?? "1.0.0";
  const draftId = `draft:${digest({
    node: node.node_id,
    draftVersion,
    targetMode: options.targetMode,
    profileRefs: options.profileRefs ?? [],
    policyRef: options.policyRef ?? null,
  })}`;
  return {
    draft_id: draftId,
    node_ref: node.node_id,
    draft_version: draftVersion,
    target_mode: options.targetMode,
    executable: false,
    inference_run_ref: node.inference_run_ref,
    field_proposals: fieldProposals,
    capabilities: {
      model_requirements: ["structured_output", "provenance_trace"],
      skill_refs: options.skillRefs ?? [],
      tool_refs: options.toolRefs ?? [],
      adapter_bindings: options.adapterBindings ?? [],
    },
    permissions: {
      read_scopes: evidenceRefs,
      write_scopes: options.requestedWriteScopes ?? [],
      network: options.network ?? "none",
    },
    ...(options.inputContractRef ? { input_contract_ref: options.inputContractRef } : {}),
    ...(options.outputContractRef ? { output_contract_ref: options.outputContractRef } : {}),
    completion_check: {
      value: completionField.value,
      status:
        options.completionStatus ??
        (completionField.status === "human_confirmed" ? "human_confirmed" : "unconfirmed"),
      verification_method: options.completionVerificationMethod ?? "human_review_required",
      evidence_refs: completionField.evidence_refs,
    },
    failure_handling: {
      status: options.failureStatus ?? "unconfirmed",
      on_failure: options.failureOn ?? "stop",
      max_retries: options.maxRetries ?? 0,
    },
    logging: {
      required_events: [
        "draft_created",
        "policy_decision",
        "input_bound",
        "output_checked",
        "teardown",
      ],
    },
    teardown: {
      revoke_credentials: true,
      delete_workspace: true,
    },
    risk: riskFor(node, options),
    ...(options.profileRefs?.length ? { profile_refs: options.profileRefs } : {}),
    ...(options.policyRef ? { policy_ref: options.policyRef } : {}),
    evidence_refs: evidenceRefs,
  };
}

function check(
  checkId: string,
  passed: boolean,
  reason: string,
  blockers: string[],
): ReadinessCheck {
  if (!passed) blockers.push(reason);
  return { check_id: checkId, passed, reason };
}

export function assessReadiness(draft: HarnessDraft, evaluatedAt: string): ReadinessAssessment {
  const blockers: string[] = [];
  const checks: ReadinessCheck[] = [];
  const fieldNames = new Set(draft.field_proposals.map((candidate) => candidate.field));
  const hasUnconfirmedFields = draft.field_proposals.some(
    (candidate) => candidate.status === "unverified" || candidate.status === "contradictory",
  );
  checks.push(
    check(
      "check:non-executable",
      draft.executable === false,
      "DRAFT_MUST_BE_NON_EXECUTABLE",
      blockers,
    ),
  );
  checks.push(
    check(
      "check:six-fields",
      HARNESS_NODE_FIELDS.every((name) => fieldNames.has(name)) && !hasUnconfirmedFields,
      hasUnconfirmedFields ? "NODE_FIELD_REQUIRES_CONFIRMATION" : "NODE_FIELDS_COMPLETE",
      blockers,
    ),
  );
  checks.push(
    check(
      "check:completion",
      draft.completion_check.status === "human_confirmed" && draft.completion_check.value !== null,
      "COMPLETION_CONDITION_REQUIRES_HUMAN_CONFIRMATION",
      blockers,
    ),
  );
  checks.push(
    check(
      "check:failure",
      draft.failure_handling.status === "human_confirmed",
      "FAILURE_HANDLING_REQUIRES_HUMAN_CONFIRMATION",
      blockers,
    ),
  );
  checks.push(
    check(
      "check:permissions",
      draft.permissions.write_scopes.length === 0 && draft.permissions.network === "none",
      "WRITE_OR_NETWORK_SCOPE_REQUIRES_POLICY_AND_HUMAN_APPROVAL",
      blockers,
    ),
  );
  checks.push(
    check(
      "check:teardown",
      draft.teardown.revoke_credentials && draft.teardown.delete_workspace,
      "TEARDOWN_MUST_REVOKE_AND_DELETE",
      blockers,
    ),
  );
  const uniqueBlockers = unique(blockers);
  return {
    assessment_id: `assessment:${digest({ draft: draft.draft_id, evaluatedAt, blockers: uniqueBlockers })}`,
    draft_ref: draft.draft_id,
    evaluated_at: evaluatedAt,
    status: uniqueBlockers.length > 0 ? "blocked" : "ready_for_approval",
    checks,
    blocking_reasons: uniqueBlockers,
  };
}
