import { join } from "node:path";

export const id = "adapter-registry";

export async function run({ fixtureRoot, assert, readJson }) {
  const bundleRoot = join(fixtureRoot, "../adapter-bundle-v1");
  const bundle = await readJson(join(bundleRoot, "bundle/manifest.json"));
  const profile = await readJson(join(bundleRoot, "profile.json"));
  const registry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/evidence-adapter-bundle.v1.json"),
  );
  assert(registry.contract_id === "evidence-adapter-bundle", "Adapter bundle contract id mismatch");
  assert(registry.version === "1.0.0", "Adapter bundle contract version mismatch");
  assert(bundle.bundle_id === "bundle:reference-org", "Unexpected adapter bundle fixture");
  assert(bundle.adapters.length === 1, "Fixture must contain one adapter");
  const [declaration] = bundle.adapters;
  assert(declaration.adapter_ref === "reference-org-ticket", "Unexpected adapter reference");
  assert(declaration.version === "1.0.0", "Adapter version is not pinned");
  assert(declaration.source_kind === "other", "Unexpected adapter source kind");
  assert(declaration.read_only === true, "Adapter bundle must be read-only");
  assert(!declaration.module_path.startsWith("/"), "Adapter module path must be relative");
  assert(!declaration.module_path.split("/").includes(".."), "Adapter path traversal is allowed");
  assert(profile.adapters.length === 1, "Fixture profile must contain one adapter");
  assert(
    profile.adapters[0].adapter_ref === declaration.adapter_ref,
    "Profile and bundle adapter references differ",
  );
  assert(
    profile.input_sources[0].adapter_ref === declaration.adapter_ref,
    "Input source is not bound to the declared adapter",
  );
}
