import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertValidProfile,
  createRunManifest,
  loadProfile,
  sha256,
  validateProfile,
  validateRunManifest,
  type ContractVersions,
  type OrganizationProfile,
} from "../src/index.ts";

const fixturePath = join(
  import.meta.dirname,
  "../../../fixtures/bootstrap/minimal-office-v1/expected/profile/minimal-office.json",
);
const date = "2026-01-08T00:00:00Z";
const contractVersions: ContractVersions = {
  bootstrap_lifecycle: "bootstrap-lifecycle@1.0.0",
  evidence_importer_port: "evidence-importer-port@1.0.0",
  observed_event: "observed-event@1.0.0",
  candidate_graph: "candidate-graph@1.0.0",
  harness_draft: "harness-draft@1.0.0",
  bootstrap_policy: "bootstrap-policy@1.0.0",
  review_contract: "review-contract@1.0.0",
  runtime_promotion: "runtime-promotion@1.0.0",
};

async function profile(): Promise<OrganizationProfile> {
  return loadProfile(fixturePath);
}

describe("organization profile", () => {
  it("loads a valid profile and produces a stable digest", async () => {
    const value = await profile();
    expect(validateProfile(value)).toMatchObject({ valid: true });
    expect(sha256(value)).toHaveLength(64);
    expect(value.runtime.network).toBe("none");
    expect(value.input_sources.every((source) => source.read_only)).toBe(true);
  });

  it("rejects inline secrets, undeclared adapters, and unsafe network profiles", async () => {
    const value = await profile();
    const withUnknownProperty = validateProfile({ ...value, unsupported: true });
    expect(withUnknownProperty.valid).toBe(false);
    if (!withUnknownProperty.valid) {
      expect(withUnknownProperty.errors.map((error) => error.code)).toContain("UNKNOWN_PROPERTY");
    }

    const withSecret = {
      ...value,
      extensions: { "local.api_key": "ghp_not-a-real-token-but-for-test" },
    };
    const secretResult = validateProfile(withSecret);
    expect(secretResult.valid).toBe(false);
    if (!secretResult.valid)
      expect(secretResult.errors.map((error) => error.code)).toContain("INLINE_SECRET_FORBIDDEN");

    const withUnknownAdapter = {
      ...value,
      input_sources: [{ ...value.input_sources[0], adapter_ref: "adapter:missing" }],
    };
    const adapterResult = validateProfile(withUnknownAdapter);
    expect(adapterResult.valid).toBe(false);
    if (!adapterResult.valid)
      expect(adapterResult.errors.map((error) => error.code)).toContain("ADAPTER_NOT_DECLARED");

    const withExternalNetwork = {
      ...value,
      runtime: { ...value.runtime, network: "external" },
    };
    const networkResult = validateProfile(withExternalNetwork);
    expect(networkResult.valid).toBe(false);
    if (!networkResult.valid) {
      expect(networkResult.errors.map((error) => error.code)).toContain(
        "EXTERNAL_NETWORK_APPROVAL_REQUIRED",
      );
    }
  });

  it("rejects the checked-in invalid profile fixture", async () => {
    const invalidPath = join(
      import.meta.dirname,
      "../../../fixtures/bootstrap/minimal-office-v1/expected/profile/invalid-inline-secret.json",
    );
    const invalid = JSON.parse(await readFile(invalidPath, "utf8"));
    const result = validateProfile(invalid.profile);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(invalid.expected_failure_codes),
      );
    }
  });
});

describe("bootstrap run manifest", () => {
  it("records reproducible references and validates the result", async () => {
    const value = await profile();
    const policy = { policy_id: "policy:minimal-office", version: "1.0.0" };
    const manifest = createRunManifest({
      profile: value,
      inputCatalogRef: "catalog:001",
      inputCatalog: { catalog_id: "catalog:001", records: 9 },
      contractVersions,
      policyRef: value.policy_ref,
      policy,
      policyDecisionRef: "decision:001",
      lifecycleState: "replay",
      mode: "replay",
      draftRef: "draft:001",
      reviewQuestionRefs: ["question:001"],
      runRef: "run:001",
      approvalRefs: [],
      teardownRef: "teardown:001",
      startedAt: date,
      endedAt: date,
      network: "none",
    });

    expect(manifest.manifest_id).toMatch(/^run-manifest:/);
    expect(manifest.reproducible).toBe(true);
    expect(manifest.profile_digest).toBe(sha256(value));
    expect(validateRunManifest(manifest)).toMatchObject({ valid: true });
    expect(
      createRunManifest({
        profile: value,
        inputCatalogRef: "catalog:001",
        inputCatalog: { catalog_id: "catalog:001", records: 9 },
        contractVersions,
        policyRef: value.policy_ref,
        policy,
        policyDecisionRef: "decision:001",
        lifecycleState: "replay",
        mode: "replay",
        draftRef: "draft:001",
        reviewQuestionRefs: ["question:001"],
        runRef: "run:001",
        approvalRefs: [],
        teardownRef: "teardown:001",
        startedAt: date,
        endedAt: date,
        network: "none",
      }).manifest_id,
    ).toBe(manifest.manifest_id);
    expect(() =>
      createRunManifest({
        profile: value,
        inputCatalogRef: "catalog:001",
        inputCatalog: { catalog_id: "catalog:001", records: 9 },
        contractVersions,
        policyRef: value.policy_ref,
        policy: { policy_id: "policy:wrong", version: "1.0.0" },
        lifecycleState: "replay",
        mode: "replay",
        draftRef: "draft:001",
        reviewQuestionRefs: [],
        runRef: "run:001",
        approvalRefs: [],
        teardownRef: "teardown:001",
        startedAt: date,
        endedAt: date,
        network: "none",
      }),
    ).toThrow("POLICY_ID_MISMATCH");
  });

  it("rejects a manifest that contains a secret-like value", async () => {
    const raw = JSON.parse(await readFile(fixturePath, "utf8"));
    const result = validateRunManifest({
      manifest_id: "run-manifest:001",
      version: "1.0.0",
      profile_ref: raw.profile_id,
      profile_digest: "a".repeat(64),
      input_catalog_ref: "catalog:001",
      input_catalog_digest: "b".repeat(64),
      contract_versions: contractVersions,
      policy_ref: raw.policy_ref,
      policy_digest: "c".repeat(64),
      lifecycle_state: "replay",
      mode: "replay",
      draft_ref: "draft:001",
      review_question_refs: [],
      run_ref: "run:001",
      approval_refs: [],
      teardown_ref: "teardown:001",
      started_at: date,
      ended_at: date,
      reproducible: true,
      network: "none",
      extensions: { "local.bearer": "Bearer hidden-value" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((error) => error.code)).toContain("INLINE_SECRET_FORBIDDEN");
    expect(() => assertValidProfile({ ...raw, password: "hidden" })).toThrow(
      "INLINE_SECRET_FORBIDDEN",
    );
  });
});
