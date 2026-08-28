import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProfile } from "../src/profile.mjs";

describe("reference profile boundary", () => {
  it("loads the canonical profile through the application boundary", async () => {
    const path = join(
      import.meta.dirname,
      "../../../fixtures/bootstrap/minimal-office-v1/expected/profile/minimal-office.json",
    );
    const profile = await loadProfile(path);
    const sourceText = await readFile(path, "utf8");

    expect(profile.profile_id).toBe("profile:minimal-office");
    expect(profile.runtime.approval_required).toBe(true);
    expect(profile.input_sources.every((source) => source.read_only)).toBe(true);
    expect(sourceText).not.toMatch(/password|api[_-]?key|private[_-]?key/i);
  });
});
