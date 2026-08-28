import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const PROFILE_VERSION = "1.0.0";
export const RUN_MANIFEST_VERSION = "1.0.0";

export const RUNTIME_MODES = ["observe", "replay", "shadow", "assist", "execute"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];
export type LifecycleState =
  | "no_harness"
  | "evidence_ready"
  | "candidate_model"
  | "draft_review"
  | "observe"
  | "replay"
  | "shadow"
  | "assist"
  | "execute";
export type ClassificationMaskingState = "unmasked" | "masked" | "partially_masked" | "unknown";
export type SourceKind =
  | "csv"
  | "email"
  | "chat"
  | "file_update"
  | "api_audit"
  | "procedure"
  | "spreadsheet"
  | "other";

export interface OrganizationProfile {
  profile_id: string;
  version: string;
  organization_ref: string;
  tenant_ref: string;
  classification: { level: string; tags: readonly string[] };
  masking: { state: ClassificationMaskingState; method_ref?: string };
  input_sources: readonly {
    source_ref: string;
    path: string;
    media_type: string;
    adapter_ref: string;
    read_only: true;
  }[];
  adapters: readonly {
    adapter_ref: string;
    version: string;
    source_kind: SourceKind;
    authentication: "none" | "workload_identity" | "credential_reference";
    credential_ref?: string;
  }[];
  policy_ref: string;
  review: { reviewer_refs: readonly string[]; independent_for_high_risk: true };
  runtime: {
    default_mode: RuntimeMode;
    allowed_modes: readonly RuntimeMode[];
    network: "none" | "internal" | "external";
    approval_required: true;
    executor_ref: string;
    external_network_approval_ref?: string;
  };
  extensions?: Record<string, unknown>;
}

export interface ContractVersions {
  bootstrap_lifecycle: string;
  evidence_importer_port: string;
  observed_event: string;
  candidate_graph: string;
  harness_draft: string;
  bootstrap_policy: string;
  review_contract: string;
  runtime_promotion: string;
}

export interface BootstrapRunManifest {
  manifest_id: string;
  version: string;
  profile_ref: string;
  profile_digest: string;
  input_catalog_ref: string;
  input_catalog_digest: string;
  contract_versions: ContractVersions;
  policy_ref: string;
  policy_digest: string;
  policy_decision_ref: string;
  lifecycle_state: LifecycleState;
  mode: RuntimeMode;
  draft_ref: string;
  review_question_refs: readonly string[];
  run_ref: string;
  approval_refs: readonly string[];
  teardown_ref: string;
  started_at: string;
  ended_at: string;
  reproducible: true;
  network: "none" | "internal" | "external";
  external_network_approval_ref?: string;
  extensions?: Record<string, unknown>;
}

export interface ValidationError {
  code: string;
  path: string;
  message: string;
}

export type ProfileValidationResult =
  | { valid: true; profile: OrganizationProfile }
  | { valid: false; errors: readonly ValidationError[] };

export type RunManifestValidationResult =
  | { valid: true; manifest: BootstrapRunManifest }
  | { valid: false; errors: readonly ValidationError[] };

type RecordValue = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CONTRACT_VERSION = /^[a-z][a-z0-9-]+@\d+\.\d+\.\d+$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MASKING_STATES = new Set<ClassificationMaskingState>([
  "unmasked",
  "masked",
  "partially_masked",
  "unknown",
]);
const SOURCE_KINDS = new Set<SourceKind>([
  "csv",
  "email",
  "chat",
  "file_update",
  "api_audit",
  "procedure",
  "spreadsheet",
  "other",
]);
const AUTHENTICATIONS = new Set(["none", "workload_identity", "credential_reference"]);
const NETWORKS = new Set(["none", "internal", "external"]);
const FORBIDDEN_KEY =
  /(?:password|passphrase|private[_-]?key|api[_-]?key|access[_-]?token|client[_-]?secret)$/i;
const SECRET_VALUE =
  /-----BEGIN [A-Z ]+-----|(?:^|[\s:=])(ghp_|github_pat_|sk-[A-Za-z0-9]|Bearer\s+\S+)/;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushError(errors: ValidationError[], code: string, path: string, message: string): void {
  errors.push({ code, path, message });
}

function rejectUnknownKeys(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  errors: ValidationError[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      pushError(
        errors,
        "UNKNOWN_PROPERTY",
        `${path}.${key}`,
        "Property is not part of the contract",
      );
    }
  }
}

function validateExtensions(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    pushError(errors, "EXTENSIONS_MUST_BE_OBJECT", path, "Extensions must be an object");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!/^(domain|local)\.[a-z][a-z0-9_.-]*$/.test(key)) {
      pushError(
        errors,
        "INVALID_EXTENSION_KEY",
        `${path}.${key}`,
        "Extensions must be domain/local namespaced",
      );
    }
  }
}

function scanForSecrets(value: unknown, path: string, errors: ValidationError[]): void {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) {
      pushError(
        errors,
        "INLINE_SECRET_FORBIDDEN",
        path,
        "Secret-like material must not be stored inline",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_KEY.test(key) && !key.endsWith("_ref")) {
      pushError(
        errors,
        "INLINE_SECRET_FORBIDDEN",
        nestedPath,
        "Credential material must be a reference only",
      );
    }
    scanForSecrets(nested, nestedPath, errors);
  }
}

function requiredRecord(
  root: RecordValue,
  key: string,
  errors: ValidationError[],
): RecordValue | undefined {
  const value = root[key];
  if (!isRecord(value)) {
    pushError(errors, "REQUIRED_OBJECT", `$.${key}`, `${key} must be an object`);
    return undefined;
  }
  return value;
}

function requiredArray(
  root: RecordValue,
  key: string,
  errors: ValidationError[],
): readonly unknown[] {
  const value = root[key];
  if (!Array.isArray(value)) {
    pushError(errors, "REQUIRED_ARRAY", `$.${key}`, `${key} must be an array`);
    return [];
  }
  return value;
}

function requiredString(
  root: RecordValue,
  key: string,
  errors: ValidationError[],
  pattern?: RegExp,
): string | undefined {
  const value = root[key];
  if (typeof value !== "string" || value.length === 0) {
    pushError(errors, "REQUIRED_STRING", `$.${key}`, `${key} must be a non-empty string`);
    return undefined;
  }
  if (pattern && !pattern.test(value)) {
    pushError(errors, "INVALID_FORMAT", `$.${key}`, `${key} has an invalid format`);
  }
  return value;
}

function validateIdentifier(
  root: RecordValue,
  key: string,
  errors: ValidationError[],
): string | undefined {
  return requiredString(root, key, errors, IDENTIFIER);
}

function validateDate(
  root: RecordValue,
  key: string,
  errors: ValidationError[],
): string | undefined {
  const value = requiredString(root, key, errors);
  if (value && Number.isNaN(Date.parse(value))) {
    pushError(errors, "INVALID_DATE", `$.${key}`, `${key} must be an RFC 3339 date-time`);
  }
  return value;
}

function validateProfileObject(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  scanForSecrets(input, "$", errors);
  if (!isRecord(input)) {
    pushError(errors, "PROFILE_MUST_BE_OBJECT", "$", "Profile must be an object");
    return errors;
  }

  rejectUnknownKeys(
    input,
    [
      "profile_id",
      "version",
      "organization_ref",
      "tenant_ref",
      "classification",
      "masking",
      "input_sources",
      "adapters",
      "policy_ref",
      "review",
      "runtime",
      "extensions",
    ],
    "$",
    errors,
  );
  validateExtensions(input.extensions, "$.extensions", errors);

  validateIdentifier(input, "profile_id", errors);
  requiredString(input, "version", errors, SEMVER);
  validateIdentifier(input, "organization_ref", errors);
  validateIdentifier(input, "tenant_ref", errors);

  const classification = requiredRecord(input, "classification", errors);
  if (classification) {
    rejectUnknownKeys(classification, ["level", "tags"], "$.classification", errors);
    requiredString(classification, "level", errors);
    const tags = requiredArray(classification, "tags", errors);
    tags.forEach((tag, index) => {
      if (typeof tag !== "string" || tag.length === 0) {
        pushError(
          errors,
          "INVALID_TAG",
          `$.classification.tags[${index}]`,
          "Classification tags must be non-empty strings",
        );
      }
    });
  }

  const masking = requiredRecord(input, "masking", errors);
  if (masking) {
    rejectUnknownKeys(masking, ["state", "method_ref"], "$.masking", errors);
    const state = requiredString(masking, "state", errors);
    if (state && !MASKING_STATES.has(state as ClassificationMaskingState)) {
      pushError(errors, "INVALID_MASKING_STATE", "$.masking.state", "Unsupported masking state");
    }
    if (
      masking.method_ref !== undefined &&
      (!isRecord(masking) ||
        typeof masking.method_ref !== "string" ||
        !IDENTIFIER.test(masking.method_ref))
    ) {
      pushError(
        errors,
        "INVALID_REFERENCE",
        "$.masking.method_ref",
        "method_ref must be an identifier",
      );
    }
  }

  const adapters = requiredArray(input, "adapters", errors);
  const adapterRefs = new Set<string>();
  adapters.forEach((value, index) => {
    const path = `$.adapters[${index}]`;
    if (!isRecord(value)) {
      pushError(errors, "ADAPTER_MUST_BE_OBJECT", path, "Adapter declaration must be an object");
      return;
    }
    rejectUnknownKeys(
      value,
      ["adapter_ref", "version", "source_kind", "authentication", "credential_ref"],
      path,
      errors,
    );
    const adapterRef = validateIdentifier(value, "adapter_ref", errors);
    if (adapterRef) adapterRefs.add(adapterRef);
    requiredString(value, "version", errors, SEMVER);
    const sourceKind = requiredString(value, "source_kind", errors);
    if (sourceKind && !SOURCE_KINDS.has(sourceKind as SourceKind)) {
      pushError(errors, "INVALID_SOURCE_KIND", `${path}.source_kind`, "Unsupported source kind");
    }
    const authentication = requiredString(value, "authentication", errors);
    if (authentication && !AUTHENTICATIONS.has(authentication)) {
      pushError(
        errors,
        "INVALID_AUTHENTICATION",
        `${path}.authentication`,
        "Unsupported authentication mode",
      );
    }
    if (authentication === "credential_reference" && typeof value.credential_ref !== "string") {
      pushError(
        errors,
        "CREDENTIAL_REF_REQUIRED",
        `${path}.credential_ref`,
        "credential_reference requires credential_ref",
      );
    }
    if (authentication !== "credential_reference" && value.credential_ref !== undefined) {
      pushError(
        errors,
        "UNEXPECTED_CREDENTIAL_REF",
        `${path}.credential_ref`,
        "credential_ref is only valid for credential_reference",
      );
    }
    if (
      value.credential_ref !== undefined &&
      (typeof value.credential_ref !== "string" || !IDENTIFIER.test(value.credential_ref))
    ) {
      pushError(
        errors,
        "INVALID_REFERENCE",
        `${path}.credential_ref`,
        "credential_ref must be an identifier",
      );
    }
  });

  const sources = requiredArray(input, "input_sources", errors);
  if (sources.length === 0)
    pushError(
      errors,
      "INPUT_SOURCE_REQUIRED",
      "$.input_sources",
      "At least one input source is required",
    );
  sources.forEach((value, index) => {
    const path = `$.input_sources[${index}]`;
    if (!isRecord(value)) {
      pushError(
        errors,
        "INPUT_SOURCE_MUST_BE_OBJECT",
        path,
        "Input source declaration must be an object",
      );
      return;
    }
    rejectUnknownKeys(
      value,
      ["source_ref", "path", "media_type", "adapter_ref", "read_only"],
      path,
      errors,
    );
    validateIdentifier(value, "source_ref", errors);
    const sourcePath = requiredString(value, "path", errors);
    if (sourcePath && (sourcePath.startsWith("/") || sourcePath.includes(".."))) {
      pushError(
        errors,
        "INPUT_PATH_ESCAPES_ROOT",
        `${path}.path`,
        "Input path must be relative and stay inside its root",
      );
    }
    requiredString(value, "media_type", errors);
    const adapterRef = validateIdentifier(value, "adapter_ref", errors);
    if (adapterRef && !adapterRefs.has(adapterRef)) {
      pushError(
        errors,
        "ADAPTER_NOT_DECLARED",
        `${path}.adapter_ref`,
        "Input source references an undeclared adapter",
      );
    }
    if (value.read_only !== true) {
      pushError(
        errors,
        "INPUT_MUST_BE_READ_ONLY",
        `${path}.read_only`,
        "Bootstrap input sources must be read-only",
      );
    }
  });

  validateIdentifier(input, "policy_ref", errors);

  const review = requiredRecord(input, "review", errors);
  if (review) {
    rejectUnknownKeys(review, ["reviewer_refs", "independent_for_high_risk"], "$.review", errors);
    const reviewers = requiredArray(review, "reviewer_refs", errors);
    if (reviewers.length === 0)
      pushError(
        errors,
        "REVIEWER_REQUIRED",
        "$.review.reviewer_refs",
        "At least one reviewer is required",
      );
    reviewers.forEach((reviewer, index) => {
      if (typeof reviewer !== "string" || !IDENTIFIER.test(reviewer)) {
        pushError(
          errors,
          "INVALID_REFERENCE",
          `$.review.reviewer_refs[${index}]`,
          "reviewer_refs must contain identifiers",
        );
      }
    });
    if (review.independent_for_high_risk !== true) {
      pushError(
        errors,
        "INDEPENDENT_REVIEW_REQUIRED",
        "$.review.independent_for_high_risk",
        "High-risk review must be independent",
      );
    }
  }

  const runtime = requiredRecord(input, "runtime", errors);
  if (runtime) {
    rejectUnknownKeys(
      runtime,
      [
        "default_mode",
        "allowed_modes",
        "network",
        "approval_required",
        "executor_ref",
        "external_network_approval_ref",
      ],
      "$.runtime",
      errors,
    );
    const defaultMode = requiredString(runtime, "default_mode", errors);
    const allowedModes = requiredArray(runtime, "allowed_modes", errors);
    if (allowedModes.length === 0)
      pushError(
        errors,
        "RUNTIME_MODE_REQUIRED",
        "$.runtime.allowed_modes",
        "At least one runtime mode is required",
      );
    for (const [index, mode] of allowedModes.entries()) {
      if (typeof mode !== "string" || !RUNTIME_MODES.includes(mode as RuntimeMode)) {
        pushError(
          errors,
          "INVALID_RUNTIME_MODE",
          `$.runtime.allowed_modes[${index}]`,
          "Unsupported runtime mode",
        );
      }
    }
    if (defaultMode && !allowedModes.includes(defaultMode)) {
      pushError(
        errors,
        "DEFAULT_MODE_NOT_ALLOWED",
        "$.runtime.default_mode",
        "default_mode must be listed in allowed_modes",
      );
    }
    const network = requiredString(runtime, "network", errors);
    if (network && !NETWORKS.has(network)) {
      pushError(errors, "INVALID_NETWORK", "$.runtime.network", "Unsupported network boundary");
    }
    if (runtime.approval_required !== true) {
      pushError(
        errors,
        "APPROVAL_REQUIRED",
        "$.runtime.approval_required",
        "Profile runtime must require approval",
      );
    }
    validateIdentifier(runtime, "executor_ref", errors);
    if (allowedModes.includes("execute") && runtime.approval_required !== true) {
      pushError(
        errors,
        "EXECUTE_APPROVAL_REQUIRED",
        "$.runtime.allowed_modes",
        "Execute mode requires approval",
      );
    }
    if (network === "external" && typeof runtime.external_network_approval_ref !== "string") {
      pushError(
        errors,
        "EXTERNAL_NETWORK_APPROVAL_REQUIRED",
        "$.runtime.external_network_approval_ref",
        "External network requires an explicit approval reference",
      );
    }
    if (
      runtime.external_network_approval_ref !== undefined &&
      (typeof runtime.external_network_approval_ref !== "string" ||
        !IDENTIFIER.test(runtime.external_network_approval_ref))
    ) {
      pushError(
        errors,
        "INVALID_REFERENCE",
        "$.runtime.external_network_approval_ref",
        "external_network_approval_ref must be an identifier",
      );
    }
  }

  return errors;
}

export function validateProfile(input: unknown): ProfileValidationResult {
  const errors = validateProfileObject(input);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, profile: input as OrganizationProfile };
}

export function assertValidProfile(input: unknown): OrganizationProfile {
  const result = validateProfile(input);
  if (!result.valid) {
    throw new Error(result.errors.map((error) => `${error.code} at ${error.path}`).join("; "));
  }
  return result.profile;
}

function validateManifestObject(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  scanForSecrets(input, "$", errors);
  if (!isRecord(input)) {
    pushError(errors, "MANIFEST_MUST_BE_OBJECT", "$", "Run manifest must be an object");
    return errors;
  }
  rejectUnknownKeys(
    input,
    [
      "manifest_id",
      "version",
      "profile_ref",
      "profile_digest",
      "input_catalog_ref",
      "input_catalog_digest",
      "contract_versions",
      "policy_ref",
      "policy_digest",
      "policy_decision_ref",
      "lifecycle_state",
      "mode",
      "draft_ref",
      "review_question_refs",
      "run_ref",
      "approval_refs",
      "teardown_ref",
      "started_at",
      "ended_at",
      "reproducible",
      "network",
      "external_network_approval_ref",
      "extensions",
    ],
    "$",
    errors,
  );
  validateExtensions(input.extensions, "$.extensions", errors);
  validateIdentifier(input, "manifest_id", errors);
  requiredString(input, "version", errors, SEMVER);
  validateIdentifier(input, "profile_ref", errors);
  requiredString(input, "profile_digest", errors, DIGEST);
  validateIdentifier(input, "input_catalog_ref", errors);
  requiredString(input, "input_catalog_digest", errors, DIGEST);
  validateIdentifier(input, "policy_ref", errors);
  requiredString(input, "policy_digest", errors, DIGEST);
  validateIdentifier(input, "policy_decision_ref", errors);
  requiredString(input, "lifecycle_state", errors);
  requiredString(input, "mode", errors);
  validateIdentifier(input, "draft_ref", errors);
  validateIdentifier(input, "run_ref", errors);
  validateIdentifier(input, "teardown_ref", errors);
  validateDate(input, "started_at", errors);
  validateDate(input, "ended_at", errors);
  if (input.reproducible !== true)
    pushError(
      errors,
      "REPRODUCIBILITY_REQUIRED",
      "$.reproducible",
      "Run manifest must be reproducible",
    );
  const network = requiredString(input, "network", errors);
  if (network && !NETWORKS.has(network))
    pushError(errors, "INVALID_NETWORK", "$.network", "Unsupported network boundary");
  for (const key of ["review_question_refs", "approval_refs"]) {
    const refs = requiredArray(input, key, errors);
    refs.forEach((ref, index) => {
      if (typeof ref !== "string" || !IDENTIFIER.test(ref)) {
        pushError(
          errors,
          "INVALID_REFERENCE",
          `$.${key}[${index}]`,
          `${key} must contain identifiers`,
        );
      }
    });
  }
  const versions = requiredRecord(input, "contract_versions", errors);
  const requiredVersions: (keyof ContractVersions)[] = [
    "bootstrap_lifecycle",
    "evidence_importer_port",
    "observed_event",
    "candidate_graph",
    "harness_draft",
    "bootstrap_policy",
    "review_contract",
    "runtime_promotion",
  ];
  if (versions) {
    rejectUnknownKeys(versions, requiredVersions, "$.contract_versions", errors);
    for (const key of requiredVersions) requiredString(versions, key, errors, CONTRACT_VERSION);
  }
  if (
    input.external_network_approval_ref !== undefined &&
    (typeof input.external_network_approval_ref !== "string" ||
      !IDENTIFIER.test(input.external_network_approval_ref))
  ) {
    pushError(
      errors,
      "INVALID_REFERENCE",
      "$.external_network_approval_ref",
      "external_network_approval_ref must be an identifier",
    );
  }
  if (network === "external" && typeof input.external_network_approval_ref !== "string") {
    pushError(
      errors,
      "EXTERNAL_NETWORK_APPROVAL_REQUIRED",
      "$.external_network_approval_ref",
      "External network requires an explicit approval reference",
    );
  }
  return errors;
}

export function validateRunManifest(input: unknown): RunManifestValidationResult {
  const errors = validateManifestObject(input);
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, manifest: input as BootstrapRunManifest };
}

export function assertValidRunManifest(input: unknown): BootstrapRunManifest {
  const result = validateRunManifest(input);
  if (!result.valid) {
    throw new Error(result.errors.map((error) => `${error.code} at ${error.path}`).join("; "));
  }
  return result.manifest;
}

export function sha256(value: unknown): string {
  const bytes = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function assertIdentifier(value: string, name: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`${name} must be an identifier`);
}

export interface RunManifestInput {
  profile: OrganizationProfile;
  inputCatalogRef: string;
  inputCatalog: unknown;
  contractVersions: ContractVersions;
  policyRef: string;
  policy: unknown;
  policyDecisionRef: string;
  lifecycleState: LifecycleState;
  mode: RuntimeMode;
  draftRef: string;
  reviewQuestionRefs: readonly string[];
  runRef: string;
  approvalRefs: readonly string[];
  teardownRef: string;
  startedAt: string;
  endedAt: string;
  network: "none" | "internal" | "external";
  externalNetworkApprovalRef?: string;
  extensions?: Record<string, unknown>;
}

export function createRunManifest(input: RunManifestInput): BootstrapRunManifest {
  const profile = assertValidProfile(input.profile);
  assertIdentifier(input.inputCatalogRef, "inputCatalogRef");
  assertIdentifier(input.policyRef, "policyRef");
  assertIdentifier(input.draftRef, "draftRef");
  assertIdentifier(input.runRef, "runRef");
  assertIdentifier(input.teardownRef, "teardownRef");
  if (profile.policy_ref !== input.policyRef) throw new Error("PROFILE_POLICY_MISMATCH");
  if (isRecord(input.policy) && input.policy.policy_id !== input.policyRef) {
    throw new Error("POLICY_ID_MISMATCH");
  }
  if (!profile.runtime.allowed_modes.includes(input.mode))
    throw new Error("PROFILE_MODE_NOT_ALLOWED");
  const profileNetworkRank = { none: 0, internal: 1, external: 2 } as const;
  if (profileNetworkRank[input.network] > profileNetworkRank[profile.runtime.network]) {
    throw new Error("PROFILE_NETWORK_BOUNDARY_EXCEEDED");
  }
  const manifestWithoutId = {
    version: RUN_MANIFEST_VERSION,
    profile_ref: profile.profile_id,
    profile_digest: sha256(profile),
    input_catalog_ref: input.inputCatalogRef,
    input_catalog_digest: sha256(input.inputCatalog),
    contract_versions: input.contractVersions,
    policy_ref: input.policyRef,
    policy_digest: sha256(input.policy),
    policy_decision_ref: input.policyDecisionRef,
    lifecycle_state: input.lifecycleState,
    mode: input.mode,
    draft_ref: input.draftRef,
    review_question_refs: [...input.reviewQuestionRefs],
    run_ref: input.runRef,
    approval_refs: [...input.approvalRefs],
    teardown_ref: input.teardownRef,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    reproducible: true as const,
    network: input.network,
    ...(input.externalNetworkApprovalRef
      ? { external_network_approval_ref: input.externalNetworkApprovalRef }
      : {}),
    ...(input.extensions ? { extensions: input.extensions } : {}),
  };
  const manifest = {
    manifest_id: `run-manifest:${sha256(manifestWithoutId).slice(0, 24)}`,
    ...manifestWithoutId,
  } satisfies BootstrapRunManifest;
  return assertValidRunManifest(manifest);
}

export async function loadProfile(path: string): Promise<OrganizationProfile> {
  const input = JSON.parse(await readFile(path, "utf8")) as unknown;
  return assertValidProfile(input);
}
