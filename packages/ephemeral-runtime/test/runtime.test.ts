import { describe, expect, it } from "vitest";

import { runEphemeral } from "../src/index.ts";

const base = {
  request_id: "request:run-001",
  draft_ref: "draft:001",
  policy_ref: "policy:001@1.0.0",
  mode: "replay",
  input_snapshot_ref: "snapshot:001",
  tool_requested: false,
  write_requested: false,
  network: "none" as const,
  evaluation_passed: false,
  approval_active: false,
  prompt_injection_detected: false,
};

describe("ephemeral runtime", () => {
  it("runs replay with a fixed snapshot and tears down", async () => {
    let tornDown = false;
    const result = await runEphemeral(base, {
      execute: async ({ mode, inputSnapshotRef }) => {
        expect(mode).toBe("replay");
        expect(inputSnapshotRef).toBe("snapshot:001");
        return { output: { ok: true }, completed: true };
      },
      teardown: async () => {
        tornDown = true;
        return { credentialsRevoked: true, workspaceDeleted: true };
      },
    });
    expect(result.run.status).toBe("completed");
    expect(result.teardown).toEqual({ credentials_revoked: true, workspace_deleted: true });
    expect(tornDown).toBe(true);
  });

  it("does not invoke an executor after a denied execute request", async () => {
    let invoked = false;
    const result = await runEphemeral(
      { ...base, mode: "execute", write_requested: true },
      {
        execute: async () => {
          invoked = true;
          return { output: null, completed: true };
        },
        teardown: async () => ({ credentialsRevoked: true, workspaceDeleted: true }),
      },
    );
    expect(result.run.status).toBe("denied");
    expect(invoked).toBe(false);
    expect(result.authorization.reason_codes).toContain("EXECUTE_REQUIRES_EVALUATION_AND_APPROVAL");
  });

  it("records failed completion and still tears down", async () => {
    const result = await runEphemeral(base, {
      execute: async () => ({ output: null, completed: false }),
      teardown: async () => ({ credentialsRevoked: true, workspaceDeleted: true }),
    });
    expect(result.run.status).toBe("failed");
    expect(result.completion.passed).toBe(false);
    expect(result.events.map((event) => event.kind)).toEqual([
      "authorized",
      "input_bound",
      "output_checked",
      "teardown",
    ]);
  });
});
