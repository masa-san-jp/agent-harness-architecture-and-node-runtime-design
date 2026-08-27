import { join } from "node:path";

export const id = "evidence-contract";

const contractIds = ["artifact-ref", "evidence-record", "evidence-source", "observed-event"];
const sourceKinds = [
  "csv",
  "email",
  "chat",
  "file_update",
  "api_audit",
  "procedure",
  "spreadsheet",
  "other",
];
const statuses = ["fact", "inferred", "human_confirmed", "contradictory", "unverified"];
const namespaces = /^(core|domain|local)\.[a-z][a-z0-9_.-]*$/;

function assertSchema(assert, schema, expectedId, label) {
  assert(
    schema.$id === `urn:agent-harness-reference:${expectedId}:v1`,
    `${label} schema id mismatch`,
  );
  assert(schema.type === "object", `${label} schema must be an object`);
  assert(
    schema.additionalProperties === false,
    `${label} schema must close unknown top-level fields`,
  );
}

function assertProvenance(assert, provenance, label) {
  assert(Array.isArray(provenance) && provenance.length > 0, `${label} has no provenance`);
  for (const entry of provenance) {
    assert(
      ["source", "normalized", "inferred", "human_confirmed", "system_generated"].includes(
        entry.kind,
      ),
      `${label} has unknown provenance kind`,
    );
    assert(
      Array.isArray(entry.source_refs) && entry.source_refs.length > 0,
      `${label} has no source refs`,
    );
  }
}

function assertExtensions(assert, value, label) {
  if (!value) return;
  for (const key of Object.keys(value)) {
    assert(namespaces.test(key), `${label} has unnamespaced extension: ${key}`);
  }
}

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/evidence/normalized.json"));
  const sourceExamples = await readJson(
    join(fixtureRoot, "expected/evidence/source-examples.json"),
  );
  const schemas = await Promise.all(
    [
      ["artifact-ref", "artifact-ref.v1.schema.json"],
      ["evidence-source", "evidence-source.v1.schema.json"],
      ["evidence-record", "evidence-record.v1.schema.json"],
      ["observed-event", "observed-event.v1.schema.json"],
    ].map(async ([id, file]) => [
      id,
      await readJson(join(fixtureRoot, `../../../schemas/evidence/${file}`)),
    ]),
  );

  assert(
    expected.contract_ids.join("|") === contractIds.join("|"),
    "Evidence contract list mismatch",
  );
  for (const [schemaId, schema] of schemas) {
    assertSchema(assert, schema, schemaId, schemaId);
    assert(
      schema.properties.extensions?.$ref?.includes("evidence-shared:v1"),
      `${schemaId} loses extension definition`,
    );
  }

  const sourceIds = new Set();
  for (const source of expected.sources) {
    assert(!sourceIds.has(source.source_id), `Duplicate source: ${source.source_id}`);
    sourceIds.add(source.source_id);
    assert(sourceKinds.includes(source.source_kind), `Unknown source kind: ${source.source_kind}`);
    assert(
      source.original_artifact_ref.startsWith("artifact:"),
      `Source has no artifact ref: ${source.source_id}`,
    );
    assertProvenance(assert, source.provenance, `Source ${source.source_id}`);
    assertExtensions(assert, source.extensions, `Source ${source.source_id}`);
  }

  const artifactIds = new Set(expected.artifacts.map((artifact) => artifact.artifact_id));
  for (const artifact of expected.artifacts) {
    assert(
      /^[a-f0-9]{64}$/.test(artifact.sha256),
      `Invalid artifact hash: ${artifact.artifact_id}`,
    );
    assert(
      ["stored", "reference_only", "withheld", "deleted"].includes(artifact.availability),
      `Invalid artifact availability: ${artifact.artifact_id}`,
    );
    assert(
      ["unmasked", "masked", "partially_masked", "unknown"].includes(artifact.masking.state),
      `Invalid masking state: ${artifact.artifact_id}`,
    );
  }

  const recordIds = new Set();
  for (const record of expected.records) {
    assert(!recordIds.has(record.record_id), `Duplicate record: ${record.record_id}`);
    recordIds.add(record.record_id);
    assert(sourceIds.has(record.source_ref), `Record source is unknown: ${record.record_id}`);
    assert(
      artifactIds.has(record.original_artifact_ref),
      `Record artifact is unknown: ${record.record_id}`,
    );
    assert(
      !Object.hasOwn(record, "raw") && !Object.hasOwn(record, "raw_payload"),
      `Record copies raw content: ${record.record_id}`,
    );
    assert(record.claims.length > 0, `Record has no claims: ${record.record_id}`);
    assertProvenance(assert, record.provenance, `Record ${record.record_id}`);
    for (const claim of record.claims) {
      assert(statuses.includes(claim.status), `Unknown claim status: ${claim.path}`);
      assertProvenance(assert, claim.provenance, `Claim ${claim.path}`);
    }
  }

  for (const event of expected.events) {
    assert(
      event.evidence_refs.every((ref) => recordIds.has(ref)),
      `Event has unknown evidence: ${event.event_id}`,
    );
    assert(statuses.includes(event.status), `Unknown event status: ${event.event_id}`);
    assert(
      ["known", "unknown", "ambiguous", "withheld"].includes(event.subject.status),
      `Unknown subject status: ${event.event_id}`,
    );
    assertProvenance(assert, event.provenance, `Event ${event.event_id}`);
    assertExtensions(assert, event.extensions, `Event ${event.event_id}`);
    for (const claim of event.assertions ?? []) {
      assert(statuses.includes(claim.status), `Unknown event assertion status: ${claim.path}`);
      assertProvenance(assert, claim.provenance, `Event assertion ${claim.path}`);
    }
  }

  const exampleKinds = new Set(sourceExamples.examples.map((example) => example.source_kind));
  for (const kind of ["csv", "email", "file_update", "api_audit"]) {
    assert(exampleKinds.has(kind), `Missing source example: ${kind}`);
  }
}
