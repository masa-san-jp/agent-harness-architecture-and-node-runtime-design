import { describe, expect, it } from "vitest";

import { authorizeRun } from "../src/index.ts";

const base = {
  request_id: "request:run-001",
  draft_ref: "draft:001",
  policy_ref: "policy:001@1.0.0",
  mode: "observe",
  tool_requested: false,
  write_requested: false,
  network: "none" as const,
  evaluation_passed: false,
  approval_active: false,
  prompt_injection_detected: false,
};

describe("control kernel", () => {
  it("authorizes read-only modes only within their boundaries", () => {
    expect(authorizeRun(base).effect).toBe("allow");
    expect(authorizeRun({ ...base, mode: "replay" }).reason_codes).toContain(
      "REPLAY_SNAPSHOT_REQUIRED",
    );
    expect(
      authorizeRun({ ...base, mode: "replay", input_snapshot_ref: "snapshot:001" }).effect,
    ).toBe("allow");
    expect(authorizeRun({ ...base, mode: "shadow", tool_requested: true }).effect).toBe("deny");
    expect(authorizeRun({ ...base, mode: "observe", write_requested: true }).effect).toBe("deny");
  });

  it("requires evaluation and approval for execute and rejects tainted promotion", () => {
    expect(authorizeRun({ ...base, mode: "execute", write_requested: true }).effect).toBe("deny");
    expect(
      authorizeRun({
        ...base,
        mode: "execute",
        write_requested: true,
        network: "internal",
        evaluation_passed: true,
        approval_active: true,
      }).effect,
    ).toBe("allow");
    expect(
      authorizeRun({
        ...base,
        mode: "execute",
        evaluation_passed: true,
        approval_active: true,
        prompt_injection_detected: true,
      }).reason_codes,
    ).toContain("PROMPT_INJECTION_UNTRUSTED");
  });
});
