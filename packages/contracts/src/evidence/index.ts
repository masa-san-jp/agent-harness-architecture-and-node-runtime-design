export const EVIDENCE_SOURCE_KINDS = [
  "csv",
  "email",
  "chat",
  "file_update",
  "api_audit",
  "procedure",
  "spreadsheet",
  "other",
] as const;

export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export const EVIDENCE_ASSERTION_STATUSES = [
  "fact",
  "inferred",
  "human_confirmed",
  "contradictory",
  "unverified",
] as const;

export type EvidenceAssertionStatus = (typeof EVIDENCE_ASSERTION_STATUSES)[number];

export const EVIDENCE_PROVENANCE_KINDS = [
  "source",
  "normalized",
  "inferred",
  "human_confirmed",
  "system_generated",
] as const;

export type EvidenceProvenanceKind = (typeof EVIDENCE_PROVENANCE_KINDS)[number];

export const EVIDENCE_EXTENSION_NAMESPACES = ["core", "domain", "local"] as const;

export type EvidenceExtensionNamespace = (typeof EVIDENCE_EXTENSION_NAMESPACES)[number];

export function isEvidenceSourceKind(value: string): value is EvidenceSourceKind {
  return (EVIDENCE_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isEvidenceAssertionStatus(value: string): value is EvidenceAssertionStatus {
  return (EVIDENCE_ASSERTION_STATUSES as readonly string[]).includes(value);
}

export function isEvidenceProvenanceKind(value: string): value is EvidenceProvenanceKind {
  return (EVIDENCE_PROVENANCE_KINDS as readonly string[]).includes(value);
}

export function isEvidenceExtensionKey(value: string): boolean {
  return /^(core|domain|local)\.[a-z][a-z0-9_.-]*$/.test(value);
}
