import { createHash } from "node:crypto";

import {
  authorizeRun,
  type RunAuthorization,
  type RunAuthorizationRequest,
} from "@agent-harness/control-kernel";

export interface RuntimeExecutor {
  execute(input: {
    mode: string;
    inputSnapshotRef: string;
  }): Promise<{ output: unknown; completed: boolean }>;
  teardown(): Promise<{ credentialsRevoked: boolean; workspaceDeleted: boolean }>;
}

export interface RuntimeResult {
  run: {
    run_id: string;
    draft_ref: string;
    mode: string;
    input_snapshot_ref: string;
    policy_ref: string;
    status: "completed" | "failed" | "denied";
  };
  authorization: RunAuthorization;
  events: readonly { kind: string; detail: string }[];
  completion: { passed: boolean; reason: string };
  teardown: { credentials_revoked: boolean; workspace_deleted: boolean };
}

function runId(request: RunAuthorizationRequest): string {
  return `run:${createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 24)}`;
}

export async function runEphemeral(
  request: RunAuthorizationRequest,
  executor: RuntimeExecutor,
): Promise<RuntimeResult> {
  const authorization = authorizeRun(request);
  const id = runId(request);
  const events: { kind: string; detail: string }[] = [
    { kind: "authorized", detail: authorization.effect },
  ];
  const snapshot = request.input_snapshot_ref ?? "snapshot:live-bounded";
  if (authorization.effect === "deny") {
    return {
      run: {
        run_id: id,
        draft_ref: request.draft_ref,
        mode: request.mode,
        input_snapshot_ref: snapshot,
        policy_ref: request.policy_ref,
        status: "denied",
      },
      authorization,
      events,
      completion: { passed: false, reason: authorization.reason_codes.join(",") },
      teardown: { credentials_revoked: true, workspace_deleted: true },
    };
  }

  events.push({ kind: "input_bound", detail: snapshot });
  try {
    const result = await executor.execute({ mode: request.mode, inputSnapshotRef: snapshot });
    events.push({ kind: "output_checked", detail: result.completed ? "passed" : "failed" });
    const teardown = await executor.teardown();
    events.push({ kind: "teardown", detail: "completed" });
    const teardownPassed = teardown.credentialsRevoked && teardown.workspaceDeleted;
    return {
      run: {
        run_id: id,
        draft_ref: request.draft_ref,
        mode: request.mode,
        input_snapshot_ref: snapshot,
        policy_ref: request.policy_ref,
        status: result.completed && teardownPassed ? "completed" : "failed",
      },
      authorization,
      events,
      completion: {
        passed: result.completed,
        reason: result.completed ? "COMPLETION_CHECK_PASSED" : "COMPLETION_CHECK_FAILED",
      },
      teardown: {
        credentials_revoked: teardown.credentialsRevoked,
        workspace_deleted: teardown.workspaceDeleted,
      },
    };
  } catch (error) {
    events.push({
      kind: "failed",
      detail: error instanceof Error ? error.message : "executor_failed",
    });
    const teardown = await executor.teardown();
    events.push({ kind: "teardown", detail: "completed" });
    return {
      run: {
        run_id: id,
        draft_ref: request.draft_ref,
        mode: request.mode,
        input_snapshot_ref: snapshot,
        policy_ref: request.policy_ref,
        status: "failed",
      },
      authorization,
      events,
      completion: { passed: false, reason: "EXECUTOR_FAILED" },
      teardown: {
        credentials_revoked: teardown.credentialsRevoked,
        workspace_deleted: teardown.workspaceDeleted,
      },
    };
  }
}
