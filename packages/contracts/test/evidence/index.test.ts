import { describe, expect, it } from "vitest";

import {
  EVIDENCE_ASSERTION_STATUSES,
  EVIDENCE_PROVENANCE_KINDS,
  EVIDENCE_SOURCE_KINDS,
  isEvidenceAssertionStatus,
  isEvidenceExtensionKey,
  isEvidenceProvenanceKind,
  isEvidenceSourceKind,
} from "../../src/evidence/index.ts";

describe("evidence contract primitives", () => {
  it("keeps source kinds broad enough for common organizational records", () => {
    expect(EVIDENCE_SOURCE_KINDS).toEqual([
      "csv",
      "email",
      "chat",
      "file_update",
      "api_audit",
      "procedure",
      "spreadsheet",
      "other",
    ]);
    expect(isEvidenceSourceKind("email")).toBe(true);
    expect(isEvidenceSourceKind("vendor_export")).toBe(false);
  });

  it("distinguishes assertion status from provenance kind", () => {
    expect(isEvidenceAssertionStatus("inferred")).toBe(true);
    expect(isEvidenceAssertionStatus("source")).toBe(false);
    expect(isEvidenceProvenanceKind("human_confirmed")).toBe(true);
    expect(isEvidenceProvenanceKind("contradictory")).toBe(false);
    expect(EVIDENCE_ASSERTION_STATUSES).toContain("contradictory");
    expect(EVIDENCE_PROVENANCE_KINDS).toContain("normalized");
  });

  it("accepts only namespaced extension keys", () => {
    expect(isEvidenceExtensionKey("domain.approval.sla_hours")).toBe(true);
    expect(isEvidenceExtensionKey("local.team_code")).toBe(true);
    expect(isEvidenceExtensionKey("core.request_id")).toBe(true);
    expect(isEvidenceExtensionKey("approval.sla_hours")).toBe(false);
    expect(isEvidenceExtensionKey("domain.Approval")).toBe(false);
  });
});
