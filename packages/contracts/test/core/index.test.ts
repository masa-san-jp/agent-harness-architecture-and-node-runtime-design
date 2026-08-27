import { describe, expect, it } from "vitest";

import { CORE_CONTRACT_IDS, coreContractId } from "../../src/core/index.js";

describe("core contract identifiers", () => {
  it("produces the stable URN form", () => {
    expect(coreContractId("evidence-record", 1)).toBe(
      "urn:agent-harness-reference:evidence-record:v1",
    );
  });

  it("rejects invalid names and versions", () => {
    expect(() => coreContractId("EvidenceRecord", 1)).toThrow("Invalid contract name");
    expect(() => coreContractId("evidence-record", 0)).toThrow("Invalid major version");
  });

  it("keeps core identifiers unique", () => {
    expect(new Set(CORE_CONTRACT_IDS).size).toBe(CORE_CONTRACT_IDS.length);
  });
});
