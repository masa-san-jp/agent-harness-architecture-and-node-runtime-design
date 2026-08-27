import { describe, expect, it } from "vitest";

import {
  ALLOWED_BOOTSTRAP_TRANSITIONS,
  BOOTSTRAP_STATES,
  canTransition,
  isBootstrapState,
} from "../../src/bootstrap/index.js";

describe("bootstrap lifecycle", () => {
  it("starts without a harness and exposes the normative states", () => {
    expect(BOOTSTRAP_STATES[0]).toBe("no_harness");
    expect(BOOTSTRAP_STATES).toHaveLength(9);
    expect(isBootstrapState("execute")).toBe(true);
    expect(isBootstrapState("write_everything")).toBe(false);
  });

  it("allows only the bounded promotion path", () => {
    expect(canTransition("no_harness", "evidence_ready")).toBe(true);
    expect(canTransition("evidence_ready", "candidate_model")).toBe(true);
    expect(canTransition("candidate_model", "execute")).toBe(false);
    expect(canTransition("shadow", "execute")).toBe(false);
    expect(canTransition("assist", "execute")).toBe(true);
    expect(canTransition("execute", "draft_review")).toBe(true);
  });

  it("defines a transition target for every state", () => {
    expect(Object.keys(ALLOWED_BOOTSTRAP_TRANSITIONS).sort()).toEqual([...BOOTSTRAP_STATES].sort());
  });
});
