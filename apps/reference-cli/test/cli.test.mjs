import { describe, expect, it } from "vitest";

import { runBootstrap } from "../src/cli.mjs";

describe("reference bootstrap CLI", () => {
  it("reproduces the offline path from raw evidence to replay teardown", async () => {
    const result = await runBootstrap();
    expect(result.catalog).toMatchObject({
      source_count: 3,
      record_count: 9,
      diagnostics: [],
      read_only: true,
    });
    expect(result.graph.node_count).toBeGreaterThan(0);
    expect(result.graph.edge_count).toBeGreaterThan(0);
    expect(result.draft).toMatchObject({ executable: false, target_mode: "observe" });
    expect(result.policy_decision).toMatchObject({ effect: "allow", audit_required: true });
    expect(result.replay).toEqual({
      status: "completed",
      completion_passed: true,
      credentials_revoked: true,
      workspace_deleted: true,
    });
  });
});
