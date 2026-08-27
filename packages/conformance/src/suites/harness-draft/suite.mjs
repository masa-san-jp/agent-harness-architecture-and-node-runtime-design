import { join } from "node:path";

export const id = "harness-draft";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/harness-draft/draft.json"));
  const draftSchema = await readJson(
    join(fixtureRoot, "../../../schemas/harness/harness-draft.v1.schema.json"),
  );
  const readinessSchema = await readJson(
    join(fixtureRoot, "../../../schemas/harness/harness-readiness-assessment.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/harness-draft.v1.json"),
  );

  assert(expected.contract_id === registry.contract_id, "HarnessDraft contract id mismatch");
  assert(expected.version === registry.version, "HarnessDraft contract version mismatch");
  assert(
    draftSchema.$id === "urn:agent-harness-reference:harness-draft:v1",
    "HarnessDraft schema id mismatch",
  );
  assert(
    readinessSchema.$id === "urn:agent-harness-reference:harness-readiness-assessment:v1",
    "Readiness schema id mismatch",
  );
  assert(draftSchema.properties.executable.const === false, "HarnessDraft became executable");
  assert(expected.executable === false, "Fixture draft is executable");
  assert(expected.required_node_fields.length === 6, "HarnessDraft six-field core changed");
  for (const control of expected.required_controls) {
    assert(draftSchema.required.includes(control), `HarnessDraft omits control: ${control}`);
  }
  assert(
    expected.organization_values_are_references === true,
    "Organization values are not references",
  );
  for (const reason of expected.blocked_reasons) {
    assert(reason.length > 0, "Empty readiness blocker");
  }
}
