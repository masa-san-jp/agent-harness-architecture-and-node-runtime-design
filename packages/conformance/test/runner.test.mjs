import { describe, expect, it } from "vitest";

import { discoverSuites, parseArguments } from "../src/runner/cli.mjs";

describe("conformance runner", () => {
  it("discovers suites without a shared index", async () => {
    const suites = await discoverSuites();
    expect(suites.map((suite) => suite.id)).toContain("fixture-integrity");
    expect(suites.length).toBeGreaterThanOrEqual(1);
  });

  it("parses list and suite selection", () => {
    expect(parseArguments(["--list"])).toEqual({ list: true, suite: undefined });
    expect(parseArguments(["--suite", "fixture-integrity"])).toEqual({
      list: false,
      suite: "fixture-integrity",
    });
  });
});
