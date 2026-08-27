import { join } from "node:path";

export const id = "evidence-importer";

export async function run({ fixtureRoot, assert, readJson }) {
  const catalog = await readJson(join(fixtureRoot, "expected/importer/catalog.json"));
  const manifest = await readJson(join(fixtureRoot, "manifest.json"));
  const schema = await readJson(
    join(fixtureRoot, "../../../schemas/adapter/evidence-importer-port.v1.schema.json"),
  );
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/evidence-importer-port.v1.json"),
  );

  assert(catalog.contract_id === registry.contract_id, "Importer contract id mismatch");
  assert(catalog.version === registry.version, "Importer contract version mismatch");
  assert(
    schema.$id === "urn:agent-harness-reference:evidence-importer-port:v1",
    "Importer schema id mismatch",
  );
  assert(schema.properties.read_only.const === true, "Importer must be read-only");
  assert(catalog.read_only === true, "Fixture catalog is not read-only");
  assert(catalog.dry_run === true, "Fixture catalog is not marked dry-run");
  assert(catalog.parser_version.length > 0, "Fixture catalog has no parser version");

  const manifestHashes = new Map(
    manifest.sources.map((source) => [`${source.path}`, source.sha256]),
  );
  for (const path of catalog.source_paths) {
    assert(manifestHashes.has(path), `Catalog source is not in fixture manifest: ${path}`);
    assert(
      catalog.sha256_by_path[path] === manifestHashes.get(path),
      `Catalog hash mismatch: ${path}`,
    );
    assert(catalog.record_counts[path] > 0, `Catalog has no records: ${path}`);
    assert(catalog.outcome_statuses[path] === "parsed", `Fixture import did not parse: ${path}`);
  }
  assert(catalog.diagnostic_codes.length === 0, "Canonical fixture has unexpected diagnostics");
}
