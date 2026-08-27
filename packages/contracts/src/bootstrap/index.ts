export const BOOTSTRAP_STATES = [
  "no_harness",
  "evidence_ready",
  "candidate_model",
  "draft_review",
  "observe",
  "replay",
  "shadow",
  "assist",
  "execute",
] as const;

export type BootstrapState = (typeof BOOTSTRAP_STATES)[number];

export const ALLOWED_BOOTSTRAP_TRANSITIONS: Readonly<
  Record<BootstrapState, readonly BootstrapState[]>
> = {
  no_harness: ["evidence_ready"],
  evidence_ready: ["candidate_model"],
  candidate_model: ["draft_review"],
  draft_review: ["observe"],
  observe: ["replay", "draft_review"],
  replay: ["shadow", "draft_review"],
  shadow: ["assist", "draft_review"],
  assist: ["execute", "draft_review"],
  execute: ["draft_review"],
};

export function isBootstrapState(value: string): value is BootstrapState {
  return (BOOTSTRAP_STATES as readonly string[]).includes(value);
}

export function canTransition(from: BootstrapState, to: BootstrapState): boolean {
  return ALLOWED_BOOTSTRAP_TRANSITIONS[from].includes(to);
}
