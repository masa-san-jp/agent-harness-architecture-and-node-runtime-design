import { join } from "node:path";

export const id = "runtime-promotion";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/runtime/runtime.json"));
  const schema = await readJson(
    join(fixtureRoot, "../../../schemas/runtime/runtime-promotion.v1.schema.json"),
  );
  const runSchema = await readJson(
    join(fixtureRoot, "../../../schemas/runtime/harness-run.v1.schema.json"),
  );
  const teardownSchema = await readJson(
    join(fixtureRoot, "../../../schemas/runtime/teardown-result.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/runtime-promotion.v1.json"),
  );

  assert(expected.contract_id === registry.contract_id, "Runtime contract id mismatch");
  assert(expected.version === registry.version, "Runtime contract version mismatch");
  assert(
    schema.$id === "urn:agent-harness-reference:runtime-promotion:v1",
    "Runtime schema id mismatch",
  );
  assert(runSchema.$id === "urn:agent-harness-reference:harness-run:v1", "Run schema id mismatch");
  assert(
    teardownSchema.properties.credentials_revoked.const === true,
    "Credential teardown is optional",
  );
  assert(
    teardownSchema.properties.workspace_deleted.const === true,
    "Workspace teardown is optional",
  );
  assert(expected.replay_requires_snapshot === true, "Replay snapshot guard removed");
  assert(expected.external_network_default === "deny", "External network default changed");
  for (const mode of expected.modes) assert(mode.length > 0, "Empty runtime mode");
  for (const requirement of expected.execute_requires)
    assert(requirement.length > 0, "Empty execute gate");
}
