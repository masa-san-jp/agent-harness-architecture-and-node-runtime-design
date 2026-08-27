import { join } from "node:path";

export const id = "bootstrap-security";

const actions = [
  "evidence.read_metadata",
  "evidence.read_original",
  "storage.write_derived",
  "model.infer",
  "model.external_send",
  "tool.execute",
  "runtime.execute",
  "audit.append",
];

export async function run({ fixtureRoot, assert, readJson }) {
  const policy = await readJson(join(fixtureRoot, "expected/security/policy.json"));
  const cases = await readJson(join(fixtureRoot, "expected/security/threat-cases.json"));
  const policySchema = await readJson(
    join(fixtureRoot, "../../../schemas/policy/bootstrap-policy.v1.schema.json"),
  );
  const decisionSchema = await readJson(
    join(fixtureRoot, "../../../schemas/policy/policy-decision.v1.schema.json"),
  );
  const dataSchema = await readJson(
    join(fixtureRoot, "../../../schemas/policy/data-handling-decision.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/bootstrap-policy.v1.json"),
  );

  assert(policy.contract_id === registry.contract_id, "Policy contract id mismatch");
  assert(policy.version === registry.version, "Policy contract version mismatch");
  assert(
    policySchema.$id === "urn:agent-harness-reference:bootstrap-policy:v1",
    "Policy schema id mismatch",
  );
  assert(
    decisionSchema.$id === "urn:agent-harness-reference:policy-decision:v1",
    "Decision schema id mismatch",
  );
  assert(
    dataSchema.$id === "urn:agent-harness-reference:data-handling-decision:v1",
    "Data schema id mismatch",
  );
  assert(policy.default_effect === "deny", "Policy is not deny-by-default");
  for (const action of actions)
    assert(policy.actions.includes(action), `Policy omits action: ${action}`);

  for (const threatCase of cases.cases) {
    assert(
      ["allow", "deny"].includes(threatCase.expected_effect),
      `Invalid expected effect: ${threatCase.case_id}`,
    );
    assert(threatCase.expected_reason.length > 0, `Missing reason code: ${threatCase.case_id}`);
    assert(threatCase.subject_tenant.length > 0, `Missing subject tenant: ${threatCase.case_id}`);
    assert(threatCase.resource_tenant.length > 0, `Missing resource tenant: ${threatCase.case_id}`);
  }
  assert(cases.data_handling.derived_retention_days > 0, "Derived retention is not defined");
  assert(
    cases.data_handling.original_access === "deny_without_approval",
    "Original access guard changed",
  );
  assert(
    cases.data_handling.external_destination === "allow_when_masked",
    "External destination guard changed",
  );
}
