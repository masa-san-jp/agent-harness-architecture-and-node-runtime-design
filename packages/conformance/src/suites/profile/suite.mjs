import { join } from "node:path";

export const id = "profile";

function walk(value, path, assert) {
  if (typeof value === "string") {
    assert(!/-----BEGIN [A-Z ]+-----/.test(value), `Secret-like value found at ${path}`);
    assert(!/(?:ghp_|github_pat_|sk-|Bearer\s+)/.test(value), `Token-like value found at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, assert));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert(
      !/(?:password|passphrase|private[_-]?key|api[_-]?key|access[_-]?token|client[_-]?secret)$/i.test(
        key,
      ) || key.endsWith("_ref"),
      `Inline credential key found at ${path}.${key}`,
    );
    walk(nested, `${path}.${key}`, assert);
  }
}

export async function run({ fixtureRoot, assert, readJson }) {
  const profile = await readJson(join(fixtureRoot, "expected/profile/minimal-office.json"));
  const expectedManifest = await readJson(join(fixtureRoot, "expected/profile/run-manifest.json"));
  const invalidProfile = await readJson(
    join(fixtureRoot, "expected/profile/invalid-inline-secret.json"),
  );
  const profileSchema = await readJson(
    join(fixtureRoot, "../../../schemas/profile/bootstrap-profile.v1.schema.json"),
  );
  const manifestSchema = await readJson(
    join(fixtureRoot, "../../../schemas/profile/bootstrap-run-manifest.v1.schema.json"),
  );
  const profileRegistry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/bootstrap-profile.v1.json"),
  );
  const manifestRegistry = await readJson(
    join(fixtureRoot, "../../../schemas/registry/bootstrap-run-manifest.v1.json"),
  );

  assert(profileRegistry.contract_id === "bootstrap-profile", "Profile registry ID mismatch");
  assert(profileRegistry.version === "1.0.0", "Profile registry version mismatch");
  assert(
    manifestRegistry.contract_id === "bootstrap-run-manifest",
    "Manifest registry ID mismatch",
  );
  assert(manifestRegistry.version === "1.0.0", "Manifest registry version mismatch");
  assert(
    profileSchema.$id === "urn:agent-harness-reference:bootstrap-profile:v1",
    "Profile schema ID mismatch",
  );
  assert(
    manifestSchema.$id === "urn:agent-harness-reference:bootstrap-run-manifest:v1",
    "Manifest schema ID mismatch",
  );
  assert(profile.profile_id === "profile:minimal-office", "Unexpected profile ID");
  assert(profile.tenant_ref === "tenant:one", "Profile tenant is not explicit");
  assert(profile.input_sources.length === 3, "Profile source count changed");
  assert(
    profile.input_sources.every((source) => source.read_only === true),
    "Profile input is not read-only",
  );
  assert(profile.runtime.default_mode === "observe", "Profile default mode is not observe");
  assert(profile.runtime.network === "none", "Profile enables network by default");
  assert(profile.runtime.approval_required === true, "Profile does not require approval");
  assert(
    expectedManifest.contract_id === "bootstrap-run-manifest",
    "Expected manifest ID mismatch",
  );
  assert(expectedManifest.profile_ref === profile.profile_id, "Manifest profile ref mismatch");
  assert(expectedManifest.reproducible === true, "Manifest is not reproducible");
  assert(expectedManifest.mode === "replay", "Manifest mode is not replay");
  assert(expectedManifest.network === "none", "Manifest network is not disabled");
  assert(expectedManifest.approval_refs.length === 0, "Replay unexpectedly has approval refs");
  assert(expectedManifest.profile_digest.length === 64, "Manifest has no profile digest");
  assert(expectedManifest.input_catalog_digest.length === 64, "Manifest has no catalog digest");
  assert(expectedManifest.policy_digest.length === 64, "Manifest has no policy digest");
  assert(
    invalidProfile.case_id === "inline-secret",
    "Invalid profile fixture is missing its case ID",
  );
  assert(
    invalidProfile.expected_failure_codes.includes("INLINE_SECRET_FORBIDDEN"),
    "Invalid profile fixture does not exercise secret rejection",
  );
  assert(
    typeof invalidProfile.profile.password === "string",
    "Invalid profile fixture has no secret input",
  );
  walk(profile, "$.profile", assert);
  walk(expectedManifest, "$.manifest", assert);
}
