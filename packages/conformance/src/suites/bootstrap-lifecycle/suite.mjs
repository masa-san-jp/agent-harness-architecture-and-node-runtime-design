import { join } from "node:path";

export const id = "bootstrap-lifecycle";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/lifecycle/states.json"));
  const stateSchema = await readJson(
    join(fixtureRoot, "../../../schemas/bootstrap/lifecycle-state.v1.schema.json"),
  );
  const lifecycleManifest = await readJson(
    join(fixtureRoot, "../../../schemas/registry/bootstrap-lifecycle.v1.json"),
  );

  assert(expected.contract_id === lifecycleManifest.contract_id, "Lifecycle contract id mismatch");
  assert(expected.version === lifecycleManifest.version, "Lifecycle contract version mismatch");
  assert(stateSchema.$id.endsWith(":lifecycle-state:v1"), "Lifecycle state schema id mismatch");
  assert(stateSchema.enum.join("|") === expected.states.join("|"), "Lifecycle state list mismatch");
  assert(
    expected.allowed_transitions.length > expected.states.length,
    "Transition table is incomplete",
  );
  for (const [from, to] of expected.allowed_transitions) {
    assert(expected.states.includes(from), `Unknown transition source: ${from}`);
    assert(expected.states.includes(to), `Unknown transition target: ${to}`);
    assert(from !== to, `Self-transition is not allowed: ${from}`);
  }
}
