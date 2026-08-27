import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const id = "fixture-integrity";

export async function run({ fixtureRoot, assert, readJson, sha256 }) {
  const manifestPath = join(fixtureRoot, "manifest.json");
  const manifest = await readJson(manifestPath);
  assert(manifest.fixture_id === "minimal-office", "Unexpected canonical fixture id");
  assert(manifest.version === "1.0.0", "Unexpected canonical fixture version");
  assert(Array.isArray(manifest.sources) && manifest.sources.length > 0, "Fixture has no sources");

  const sourcePaths = new Set();
  for (const source of manifest.sources) {
    assert(typeof source.path === "string", "Fixture source path is missing");
    assert(!source.path.includes(".."), `Fixture source escapes root: ${source.path}`);
    assert(!sourcePaths.has(source.path), `Duplicate fixture source: ${source.path}`);
    sourcePaths.add(source.path);

    const path = join(fixtureRoot, source.path);
    const actualHash = await sha256(path);
    assert(actualHash === source.sha256, `Fixture hash mismatch: ${source.path}`);
  }

  const rawRoot = join(fixtureRoot, "raw");
  const rawFiles = await readdir(rawRoot, { recursive: true });
  const normalizedRawFiles = rawFiles
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.split(sep).join("/"));
  for (const source of manifest.sources) {
    assert(
      normalizedRawFiles.includes(
        relative(rawRoot, join(fixtureRoot, source.path)).split(sep).join("/"),
      ),
      `Manifest source is not under raw/: ${source.path}`,
    );
  }

  assert(manifest.classification?.level === "synthetic", "Fixture must be synthetic");
  assert(manifest.network_access === false, "Fixture network policy must be offline");
}
