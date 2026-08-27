import { join } from "node:path";

export const id = "graph-inference";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/graph/graph.json"));
  const evidence = await readJson(join(fixtureRoot, "expected/evidence/normalized.json"));
  const graphSchema = await readJson(
    join(fixtureRoot, "../../../schemas/graph/candidate-graph.v1.schema.json"),
  );
  const nodeSchema = await readJson(
    join(fixtureRoot, "../../../schemas/graph/candidate-node.v1.schema.json"),
  );
  const edgeSchema = await readJson(
    join(fixtureRoot, "../../../schemas/graph/candidate-edge.v1.schema.json"),
  );
  const runSchema = await readJson(
    join(fixtureRoot, "../../../schemas/graph/inference-run.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/candidate-graph.v1.json"),
  );

  assert(expected.contract_id === registry.contract_id, "Graph contract id mismatch");
  assert(expected.version === registry.version, "Graph contract version mismatch");
  assert(
    graphSchema.$id === "urn:agent-harness-reference:candidate-graph:v1",
    "Graph schema id mismatch",
  );
  assert(
    nodeSchema.$id === "urn:agent-harness-reference:candidate-node:v1",
    "Node schema id mismatch",
  );
  assert(
    edgeSchema.$id === "urn:agent-harness-reference:candidate-edge:v1",
    "Edge schema id mismatch",
  );
  assert(
    runSchema.$id === "urn:agent-harness-reference:inference-run:v1",
    "Run schema id mismatch",
  );
  assert(
    evidence.events.length >= expected.minimum_deterministic_nodes,
    "Fixture has too few evidence events",
  );
  assert(expected.minimum_deterministic_edges >= 1, "Graph must preserve relation candidates");
  assert(expected.required_node_fields.length === 6, "Node six-field core changed");
  assert(
    expected.required_statuses.includes("insufficient"),
    "Missing evidence status is not preserved",
  );
  assert(expected.required_statuses.includes("ambiguous"), "Ambiguity status is not preserved");
  assert(
    expected.required_statuses.includes("contradictory"),
    "Contradiction status is not preserved",
  );
  assert(expected.model_provenance_kind === "inferred", "Model provenance is not separated");
  assert(expected.model_is_optional === true, "Model unexpectedly required");
}
