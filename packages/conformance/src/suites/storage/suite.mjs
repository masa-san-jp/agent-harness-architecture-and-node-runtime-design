import { join } from "node:path";

export const id = "storage";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/storage/references.json"));
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/bootstrap-storage.v1.json"),
  );
  assert(expected.contract_id === registry.contract_id, "Storage contract id mismatch");
  assert(expected.version === registry.version, "Storage contract version mismatch");
  assert(expected.catalog.kind === "catalog", "Catalog storage reference has wrong kind");
  assert(
    expected.run_manifest.kind === "run_manifest",
    "Manifest storage reference has wrong kind",
  );
  for (const reference of [expected.catalog, expected.run_manifest]) {
    assert(typeof reference.ref === "string" && reference.ref.includes(":"), "Missing stable ref");
    assert(/^[a-f0-9]{64}$/.test(reference.sha256), "Storage reference has invalid digest");
    assert(reference.tenant_ref === "tenant:one", "Storage reference lost tenant context");
    assert(reference.classification_level === "synthetic", "Storage reference lost classification");
    assert(reference.masking_state === "unmasked", "Storage reference lost masking state");
  }
  assert(expected.raw_files_persisted === false, "Raw evidence must not be persisted");
  assert(
    JSON.stringify(expected.persisted_files) === JSON.stringify(["bootstrap-storage.sqlite"]),
    "Reference storage must contain only its database file",
  );
}
