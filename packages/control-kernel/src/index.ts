import { createHash } from "node:crypto";

export const RUNTIME_MODES = ["observe", "replay", "shadow", "assist", "execute"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type RuntimeEffect = "allow" | "deny";

export interface RunAuthorizationRequest {
  request_id: string;
  draft_ref: string;
  policy_ref: string;
  mode: RuntimeMode | string;
  input_snapshot_ref?: string;
  tool_requested: boolean;
  write_requested: boolean;
  network: "none" | "internal" | "external";
  evaluation_passed: boolean;
  approval_active: boolean;
  prompt_injection_detected: boolean;
}

export interface RunAuthorization {
  authorization_id: string;
  request_id: string;
  mode: string;
  effect: RuntimeEffect;
  reason_codes: readonly string[];
  policy_ref: string;
  audit_required: true;
}

function id(value: unknown): string {
  return `runtime-auth:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

export function isRuntimeMode(value: string): value is RuntimeMode {
  return (RUNTIME_MODES as readonly string[]).includes(value);
}

export function authorizeRun(request: RunAuthorizationRequest): RunAuthorization {
  const reasons: string[] = [];
  if (!isRuntimeMode(request.mode)) reasons.push("UNKNOWN_MODE");
  if (request.mode === "replay" && !request.input_snapshot_ref)
    reasons.push("REPLAY_SNAPSHOT_REQUIRED");
  if (["observe", "replay", "shadow", "assist"].includes(request.mode) && request.write_requested) {
    reasons.push("WRITE_FORBIDDEN_IN_MODE");
  }
  if (["observe", "replay", "shadow"].includes(request.mode) && request.tool_requested) {
    reasons.push("TOOL_FORBIDDEN_IN_MODE");
  }
  if (request.mode !== "execute" && request.network !== "none")
    reasons.push("NETWORK_FORBIDDEN_IN_MODE");
  if (request.mode === "execute" && (!request.evaluation_passed || !request.approval_active)) {
    reasons.push("EXECUTE_REQUIRES_EVALUATION_AND_APPROVAL");
  }
  if (request.prompt_injection_detected && ["assist", "execute"].includes(request.mode))
    reasons.push("PROMPT_INJECTION_UNTRUSTED");
  const uniqueReasons = [...new Set(reasons)];
  return {
    authorization_id: id({ request, uniqueReasons }),
    request_id: request.request_id,
    mode: request.mode,
    effect: uniqueReasons.length === 0 ? "allow" : "deny",
    reason_codes: uniqueReasons.length === 0 ? ["MODE_AUTHORIZED"] : uniqueReasons,
    policy_ref: request.policy_ref,
    audit_required: true,
  };
}
