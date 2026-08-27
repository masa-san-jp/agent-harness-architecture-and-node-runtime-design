import { join } from "node:path";

export const id = "bootstrap-e2e";

export async function run({ fixtureRoot, assert, readJson }) {
  const expected = await readJson(join(fixtureRoot, "expected/e2e/bootstrap.json"));
  const manifest = await readJson(join(fixtureRoot, "manifest.json"));
  assert(expected.contract_id === "bootstrap-e2e", "E2E contract id mismatch");
  assert(expected.version === "1.0.0", "E2E contract version mismatch");
  assert(expected.input === "raw/", "E2E does not start from raw fixture");
  assert(
    expected.source_count === manifest.sources.length,
    "E2E source count diverges from fixture",
  );
  assert(expected.record_count > expected.source_count, "E2E fixture has no parsed records");
  assert(expected.draft_executable === false, "E2E draft is executable");
  assert(expected.replay_status === "completed", "E2E replay is not successful");
  assert(expected.teardown.credentials_revoked === true, "E2E credentials are not revoked");
  assert(expected.teardown.workspace_deleted === true, "E2E workspace is not deleted");
  assert(expected.network_access === false, "E2E network access is enabled");
  for (const step of expected.expected_path) assert(step.length > 0, "E2E path has an empty step");
}
