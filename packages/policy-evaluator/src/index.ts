import { createHash } from "node:crypto";

export const POLICY_ACTIONS = [
  "evidence.read_metadata",
  "evidence.read_original",
  "storage.write_derived",
  "model.infer",
  "model.external_send",
  "tool.execute",
  "runtime.execute",
  "audit.append",
] as const;

export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export type PolicyEffect = "allow" | "deny";
export type NetworkProfile = "none" | "internal" | "external";
export type MaskingState = "unmasked" | "masked" | "partially_masked" | "unknown";

export interface PolicyConditions {
  classifications?: readonly string[];
  network?: NetworkProfile;
  tenant_scope?: "same_tenant" | "any" | "none";
  require_integrity?: boolean;
  require_human_approval?: boolean;
  require_masking?: boolean;
}

export interface PolicyRule {
  rule_id: string;
  action: string;
  effect: PolicyEffect;
  conditions: PolicyConditions;
}

export interface RetentionRule {
  classification: string;
  original_days: number;
  derived_days: number;
}

export interface BootstrapPolicy {
  policy_id: string;
  version: string;
  default_effect: "deny";
  actions: readonly PolicyAction[];
  rules: readonly PolicyRule[];
  classification_order: readonly string[];
  external_model_classifications: readonly string[];
  require_masking_for_external: boolean;
  retention: readonly RetentionRule[];
}

export interface PolicyRequest {
  request_id: string;
  subject_ref: string;
  subject_tenant_ref: string;
  action: PolicyAction | string;
  resource_refs: readonly string[];
  resource_tenant_ref?: string;
  classification: string;
  network: NetworkProfile;
  integrity_verified: boolean;
  human_approved: boolean;
  masking_state: MaskingState;
  prompt_injection_detected: boolean;
  evaluated_at: string;
}

export interface PolicyDecision {
  decision_id: string;
  request_id: string;
  policy_ref: string;
  action: string;
  effect: PolicyEffect;
  reason_codes: readonly string[];
  evaluated_at: string;
  subject_ref: string;
  resource_refs: readonly string[];
  matched_rule_refs: readonly string[];
  audit_required: true;
}

export interface DataHandlingRequest {
  request_id: string;
  data_ref: string;
  classification: string;
  original_access_requested: boolean;
  derived_access_requested: boolean;
  model_destination: "none" | "local" | "external";
  masking_state: MaskingState;
  human_approved: boolean;
  integrity_verified: boolean;
  tenant_isolation_verified: boolean;
  evaluated_at: string;
}

export interface DataHandlingDecision {
  decision_id: string;
  data_ref: string;
  classification: string;
  source_access: PolicyEffect;
  derived_access: PolicyEffect;
  model_destination: "none" | "local" | "external";
  masking_required: boolean;
  retention_days: {
    original: number;
    derived: number;
  };
  effect: PolicyEffect;
  reason_codes: readonly string[];
  evaluated_at: string;
}

export function isPolicyAction(value: string): value is PolicyAction {
  return (POLICY_ACTIONS as readonly string[]).includes(value);
}

export function createDenyByDefaultPolicy(policyId = "policy:deny-by-default"): BootstrapPolicy {
  return {
    policy_id: policyId,
    version: "1.0.0",
    default_effect: "deny",
    actions: POLICY_ACTIONS,
    rules: [],
    classification_order: ["public", "synthetic", "internal", "confidential", "restricted"],
    external_model_classifications: [],
    require_masking_for_external: true,
    retention: [{ classification: "default", original_days: 0, derived_days: 0 }],
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function decisionId(prefix: string, value: unknown): string {
  return `${prefix}:${digest(value)}`;
}

function uniqueReasons(reasons: readonly string[]): readonly string[] {
  return [...new Set(reasons)];
}

function conditionsMatch(rule: PolicyRule, request: PolicyRequest): boolean {
  const conditions = rule.conditions;
  if (conditions.classifications && !conditions.classifications.includes(request.classification)) {
    return false;
  }
  if (conditions.network && conditions.network !== request.network) return false;
  if (conditions.tenant_scope === "same_tenant" && !request.resource_tenant_ref) return false;
  if (conditions.tenant_scope === "none" && request.resource_tenant_ref) return false;
  if (conditions.require_integrity === true && !request.integrity_verified) return false;
  if (conditions.require_human_approval === true && !request.human_approved) return false;
  if (
    conditions.require_masking === true &&
    request.masking_state !== "masked" &&
    request.masking_state !== "partially_masked"
  ) {
    return false;
  }
  return true;
}

function makeDecision(
  request: PolicyRequest,
  policy: BootstrapPolicy,
  effect: PolicyEffect,
  reasonCodes: readonly string[],
  matchedRuleRefs: readonly string[],
): PolicyDecision {
  return {
    decision_id: decisionId("decision", {
      request_id: request.request_id,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      action: request.action,
      effect,
      reasonCodes,
    }),
    request_id: request.request_id,
    policy_ref: `${policy.policy_id}@${policy.version}`,
    action: request.action,
    effect,
    reason_codes: uniqueReasons(reasonCodes),
    evaluated_at: request.evaluated_at,
    subject_ref: request.subject_ref,
    resource_refs: request.resource_refs,
    matched_rule_refs: matchedRuleRefs,
    audit_required: true,
  };
}

export function evaluatePolicy(request: PolicyRequest, policy: BootstrapPolicy): PolicyDecision {
  if (!isPolicyAction(request.action)) {
    return makeDecision(request, policy, "deny", ["UNKNOWN_ACTION"], []);
  }

  if (request.resource_tenant_ref && request.resource_tenant_ref !== request.subject_tenant_ref) {
    return makeDecision(request, policy, "deny", ["CROSS_TENANT_REFERENCE"], []);
  }

  if (
    request.prompt_injection_detected &&
    ["model.external_send", "tool.execute", "runtime.execute"].includes(request.action)
  ) {
    return makeDecision(request, policy, "deny", ["PROMPT_INJECTION_UNTRUSTED"], []);
  }

  if (
    request.action === "model.external_send" &&
    !policy.external_model_classifications.includes(request.classification)
  ) {
    return makeDecision(request, policy, "deny", ["CLASSIFICATION_NOT_ALLOWED"], []);
  }

  if (
    request.action === "model.external_send" &&
    policy.require_masking_for_external &&
    request.masking_state !== "masked" &&
    request.masking_state !== "partially_masked"
  ) {
    return makeDecision(request, policy, "deny", ["MASKING_REQUIRED"], []);
  }

  const matchingRules = policy.rules.filter(
    (rule) => rule.action === request.action && conditionsMatch(rule, request),
  );
  const denyRules = matchingRules.filter((rule) => rule.effect === "deny");
  if (denyRules.length > 0) {
    return makeDecision(
      request,
      policy,
      "deny",
      ["RULE_DENY"],
      denyRules.map((rule) => rule.rule_id),
    );
  }

  const allowRules = matchingRules.filter((rule) => rule.effect === "allow");
  if (allowRules.length > 0) {
    return makeDecision(
      request,
      policy,
      "allow",
      ["RULE_ALLOW"],
      allowRules.map((rule) => rule.rule_id),
    );
  }

  return makeDecision(request, policy, policy.default_effect, ["DEFAULT_DENY"], []);
}

function retentionFor(policy: BootstrapPolicy, classification: string): RetentionRule | undefined {
  return policy.retention.find((rule) => rule.classification === classification);
}

export function evaluateDataHandling(
  request: DataHandlingRequest,
  policy: BootstrapPolicy,
): DataHandlingDecision {
  const retention = retentionFor(policy, request.classification);
  const reasons: string[] = [];
  const originalRequested = request.original_access_requested;
  const derivedRequested = request.derived_access_requested;
  const externalRequested = request.model_destination === "external";
  const maskingRequired = externalRequested && policy.require_masking_for_external;
  let sourceAccess: PolicyEffect = "deny";
  let derivedAccess: PolicyEffect = "deny";
  let modelDestination: DataHandlingDecision["model_destination"] = "none";

  if (originalRequested) {
    if (request.human_approved && request.tenant_isolation_verified) {
      sourceAccess = "allow";
    } else {
      reasons.push(
        request.human_approved ? "TENANT_ISOLATION_REQUIRED" : "HUMAN_APPROVAL_REQUIRED",
      );
    }
  }

  if (derivedRequested) {
    if (request.integrity_verified && request.tenant_isolation_verified) {
      derivedAccess = "allow";
    } else {
      reasons.push(request.integrity_verified ? "TENANT_ISOLATION_REQUIRED" : "INTEGRITY_REQUIRED");
    }
  }

  if (request.model_destination === "local") {
    if (request.integrity_verified && request.tenant_isolation_verified) {
      modelDestination = "local";
    } else {
      reasons.push("LOCAL_MODEL_GUARDS_REQUIRED");
    }
  }

  if (externalRequested) {
    const classificationAllowed = policy.external_model_classifications.includes(
      request.classification,
    );
    const maskingSatisfied =
      request.masking_state === "masked" || request.masking_state === "partially_masked";
    if (!classificationAllowed) reasons.push("CLASSIFICATION_NOT_ALLOWED");
    if (maskingRequired && !maskingSatisfied) reasons.push("MASKING_REQUIRED");
    if (classificationAllowed && (!maskingRequired || maskingSatisfied)) {
      modelDestination = "external";
    }
  }

  if (!retention) reasons.push("RETENTION_UNSPECIFIED");
  if (
    !originalRequested &&
    !derivedRequested &&
    !externalRequested &&
    modelDestination === "none"
  ) {
    reasons.push("NO_DATA_ACTION_REQUESTED");
  }

  const effect: PolicyEffect =
    reasons.length === 0 &&
    (!originalRequested || sourceAccess === "allow") &&
    (!derivedRequested || derivedAccess === "allow") &&
    (!externalRequested || modelDestination === "external")
      ? "allow"
      : "deny";
  if (effect === "allow") reasons.push("DATA_HANDLING_ALLOWED");

  return {
    decision_id: decisionId("data-decision", {
      request_id: request.request_id,
      policy_id: policy.policy_id,
      policy_version: policy.version,
      data_ref: request.data_ref,
    }),
    data_ref: request.data_ref,
    classification: request.classification,
    source_access: sourceAccess,
    derived_access: derivedAccess,
    model_destination: modelDestination,
    masking_required: maskingRequired,
    retention_days: retention
      ? { original: retention.original_days, derived: retention.derived_days }
      : { original: 0, derived: 0 },
    effect,
    reason_codes: uniqueReasons(reasons),
    evaluated_at: request.evaluated_at,
  };
}
