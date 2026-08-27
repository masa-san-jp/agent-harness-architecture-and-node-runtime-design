import { describe, expect, it } from "vitest";

import {
  POLICY_ACTIONS,
  createDenyByDefaultPolicy,
  evaluateDataHandling,
  evaluatePolicy,
} from "../src/index.ts";
import type { BootstrapPolicy, PolicyRequest } from "../src/index.ts";

const policy: BootstrapPolicy = {
  policy_id: "policy:minimal-office",
  version: "1.0.0",
  default_effect: "deny",
  actions: POLICY_ACTIONS,
  rules: [
    {
      rule_id: "rule:metadata-same-tenant",
      action: "evidence.read_metadata",
      effect: "allow",
      conditions: { tenant_scope: "same_tenant", require_integrity: true },
    },
    {
      rule_id: "rule:original-reviewed",
      action: "evidence.read_original",
      effect: "allow",
      conditions: { tenant_scope: "same_tenant", require_human_approval: true },
    },
    {
      rule_id: "rule:tool-reviewed",
      action: "tool.execute",
      effect: "allow",
      conditions: { tenant_scope: "same_tenant", require_human_approval: true },
    },
  ],
  classification_order: ["synthetic", "internal", "confidential"],
  external_model_classifications: ["synthetic"],
  require_masking_for_external: true,
  retention: [{ classification: "synthetic", original_days: 30, derived_days: 90 }],
};

const request = (overrides: Partial<PolicyRequest> = {}): PolicyRequest => ({
  request_id: "request:001",
  subject_ref: "person:a",
  subject_tenant_ref: "tenant:one",
  action: "evidence.read_metadata",
  resource_refs: ["record:001"],
  resource_tenant_ref: "tenant:one",
  classification: "synthetic",
  network: "none",
  integrity_verified: true,
  human_approved: false,
  masking_state: "unmasked",
  prompt_injection_detected: false,
  evaluated_at: "2026-01-08T00:00:00Z",
  ...overrides,
});

describe("policy evaluator", () => {
  it("denies unknown actions and policies without an allow rule", () => {
    expect(evaluatePolicy(request({ action: "future.privileged_action" }), policy)).toMatchObject({
      effect: "deny",
      reason_codes: ["UNKNOWN_ACTION"],
      audit_required: true,
    });
    expect(evaluatePolicy(request({ action: "storage.write_derived" }), policy)).toMatchObject({
      effect: "deny",
      reason_codes: ["DEFAULT_DENY"],
    });
    expect(evaluatePolicy(request({ action: "evidence.read_metadata" }), policy).effect).toBe(
      "allow",
    );
  });

  it("denies cross-tenant access before any allow rule", () => {
    const decision = evaluatePolicy(request({ resource_tenant_ref: "tenant:other" }), policy);
    expect(decision.effect).toBe("deny");
    expect(decision.reason_codes).toContain("CROSS_TENANT_REFERENCE");
  });

  it("does not let prompt injection grant tool authority", () => {
    const decision = evaluatePolicy(
      request({
        action: "tool.execute",
        human_approved: true,
        prompt_injection_detected: true,
      }),
      policy,
    );
    expect(decision.effect).toBe("deny");
    expect(decision.reason_codes).toEqual(["PROMPT_INJECTION_UNTRUSTED"]);
  });

  it("separates external model classification and masking checks", () => {
    expect(
      evaluatePolicy(request({ action: "model.external_send", masking_state: "masked" }), policy)
        .effect,
    ).toBe("deny");
    expect(
      evaluatePolicy(
        request({
          action: "model.external_send",
          masking_state: "masked",
          classification: "synthetic",
        }),
        {
          ...policy,
          rules: [
            {
              rule_id: "rule:external",
              action: "model.external_send",
              effect: "allow",
              conditions: {},
            },
          ],
        },
      ).effect,
    ).toBe("allow");
  });

  it("returns data handling and retention decisions separately", () => {
    const decision = evaluateDataHandling(
      {
        request_id: "request:002",
        data_ref: "artifact:001",
        classification: "synthetic",
        original_access_requested: true,
        derived_access_requested: true,
        model_destination: "external",
        masking_state: "masked",
        human_approved: true,
        integrity_verified: true,
        tenant_isolation_verified: true,
        evaluated_at: "2026-01-08T00:00:00Z",
      },
      { ...policy, external_model_classifications: ["synthetic"] },
    );
    expect(decision).toMatchObject({
      effect: "allow",
      source_access: "allow",
      derived_access: "allow",
      model_destination: "external",
      retention_days: { original: 30, derived: 90 },
    });
  });

  it("provides a safe empty policy for a new organization", () => {
    const empty = createDenyByDefaultPolicy();
    const decision = evaluatePolicy(request({ action: "evidence.read_metadata" }), empty);
    expect(empty.default_effect).toBe("deny");
    expect(decision.effect).toBe("deny");
  });
});
