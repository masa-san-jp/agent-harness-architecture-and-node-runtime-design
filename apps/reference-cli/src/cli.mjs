import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { importDirectory } from "@agent-harness/evidence-importer";
import { runInference } from "@agent-harness/graph-inference";
import { assessReadiness, createHarnessDraft } from "@agent-harness/harness-draft";
import { runEphemeral } from "@agent-harness/ephemeral-runtime";
import { evaluatePolicy } from "@agent-harness/policy-evaluator";
import { generateReviewQuestions } from "@agent-harness/review-workflow";
import { openSqliteStorage } from "@agent-harness/storage";
import { createRunManifest, loadProfile } from "./profile.mjs";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/bootstrap/minimal-office-v1/", import.meta.url),
);
const defaultInput = `${fixtureRoot}raw`;
const defaultPolicy = `${fixtureRoot}expected/security/policy.json`;
const defaultProfile = `${fixtureRoot}expected/profile/minimal-office.json`;
const defaultCapturedAt = "2026-01-08T00:00:00Z";

const contractVersions = {
  bootstrap_lifecycle: "bootstrap-lifecycle@1.0.0",
  evidence_importer_port: "evidence-importer-port@1.0.0",
  observed_event: "observed-event@1.0.0",
  candidate_graph: "candidate-graph@1.0.0",
  harness_draft: "harness-draft@1.0.0",
  bootstrap_policy: "bootstrap-policy@1.0.0",
  review_contract: "review-contract@1.0.0",
  runtime_promotion: "runtime-promotion@1.0.0",
};

function claimValue(record, path) {
  return record.claims.find((claim) => claim.path === path)?.value;
}

function eventsFromCatalog(catalog) {
  return catalog.records
    .filter((record) => record.record_kind === "jsonl_record")
    .map((record) => {
      const actor = claimValue(record, "actor");
      const inputRef = claimValue(record, "input_ref");
      const outputRef = claimValue(record, "output_ref");
      return {
        event_id: claimValue(record, "event_id") ?? record.record_id,
        evidence_refs: [record.record_id],
        subject: actor ? { ref: actor, status: "known" } : { status: "unknown" },
        action: claimValue(record, "action") ?? "unknown_action",
        ...(inputRef ? { input_refs: [inputRef] } : {}),
        ...(outputRef ? { output_refs: [outputRef] } : {}),
        status: "fact",
        provenance: record.provenance,
      };
    });
}

async function readPolicy(policyPath) {
  return JSON.parse(await readFile(policyPath, "utf8"));
}

function validateProfileBindings(profile, catalog) {
  const declaredPaths = new Set(profile.input_sources.map((source) => source.path));
  const declaredAdapters = new Set(profile.adapters.map((adapter) => adapter.adapter_ref));
  for (const source of catalog.sources) {
    if (!declaredPaths.has(source.locator)) {
      throw new Error(`PROFILE_SOURCE_NOT_DECLARED: ${source.locator}`);
    }
  }
  for (const source of profile.input_sources) {
    if (!catalog.sources.some((candidate) => candidate.locator === source.path)) {
      throw new Error(`PROFILE_SOURCE_NOT_IMPORTED: ${source.path}`);
    }
  }
  for (const outcome of catalog.outcomes) {
    if (outcome.status === "parsed" && !declaredAdapters.has(outcome.adapter_id)) {
      throw new Error(`PROFILE_ADAPTER_NOT_DECLARED: ${outcome.adapter_id}`);
    }
  }
}

export async function runBootstrap(
  inputDirectory = defaultInput,
  capturedAt = defaultCapturedAt,
  policyPath = defaultPolicy,
  profilePath = defaultProfile,
  storeDirectory,
) {
  const profile = await loadProfile(profilePath);
  const catalog = await importDirectory(inputDirectory, {
    capturedAt,
    classification: profile.classification,
    masking: profile.masking,
    dryRun: true,
  });
  validateProfileBindings(profile, catalog);
  const events = eventsFromCatalog(catalog);
  if (events.length === 0) throw new Error("No audit-like events were imported");

  const inference = await runInference({ events }, { executedAt: capturedAt });
  const node = inference.graph.nodes[0];
  if (!node) throw new Error("Inference produced no candidate node");
  const draft = createHarnessDraft(node, {
    targetMode: profile.runtime.default_mode,
    evaluatedAt: capturedAt,
    profileRefs: [profile.profile_id],
    policyRef: profile.policy_ref,
  });
  const readiness = assessReadiness(draft, capturedAt);
  const questions = generateReviewQuestions(draft, { createdAt: capturedAt });
  const policy = await readPolicy(policyPath);
  const policyDecision = evaluatePolicy(
    {
      request_id: "request:reference-cli-metadata",
      subject_ref: "person:reference-cli",
      subject_tenant_ref: profile.tenant_ref,
      action: "evidence.read_metadata",
      resource_refs: catalog.records.slice(0, 1).map((record) => record.record_id),
      resource_tenant_ref: profile.tenant_ref,
      classification: profile.classification.level,
      network: profile.runtime.network,
      integrity_verified: true,
      human_approved: false,
      masking_state: "unmasked",
      prompt_injection_detected: false,
      evaluated_at: capturedAt,
    },
    policy,
  );
  const replay = await runEphemeral(
    {
      request_id: "request:reference-cli-replay",
      draft_ref: draft.draft_id,
      policy_ref: profile.policy_ref,
      mode: "replay",
      input_snapshot_ref: catalog.catalog_id,
      tool_requested: false,
      write_requested: false,
      network: profile.runtime.network,
      evaluation_passed: false,
      approval_active: false,
      prompt_injection_detected: false,
    },
    {
      execute: async ({ inputSnapshotRef }) => ({
        output: { inputSnapshotRef, nodeCount: inference.graph.nodes.length },
        completed: true,
      }),
      teardown: async () => ({ credentialsRevoked: true, workspaceDeleted: true }),
    },
  );
  const manifest = createRunManifest({
    profile,
    inputCatalogRef: catalog.catalog_id,
    inputCatalog: catalog,
    contractVersions,
    policyRef: profile.policy_ref,
    policy,
    policyDecisionRef: policyDecision.decision_id,
    lifecycleState: "replay",
    mode: "replay",
    draftRef: draft.draft_id,
    reviewQuestionRefs: questions.map((question) => question.question_id),
    runRef: replay.run.run_id,
    approvalRefs: [],
    teardownRef: `teardown:${replay.run.run_id}`,
    startedAt: capturedAt,
    endedAt: capturedAt,
    network: profile.runtime.network,
  });

  let storageResult;
  if (storeDirectory) {
    const storageAdapter = await openSqliteStorage(storeDirectory);
    try {
      const context = {
        tenant_ref: profile.tenant_ref,
        classification_level: profile.classification.level,
        masking_state: profile.masking.state,
      };
      const catalogReference = await storageAdapter.putCatalog(catalog, context);
      const manifestReference = await storageAdapter.putRunManifest(manifest, context);
      storageResult = {
        database_path: storageAdapter.databasePath,
        catalog: catalogReference,
        run_manifest: manifestReference,
      };
    } finally {
      storageAdapter.close();
    }
  }

  return {
    contract_versions: manifest.contract_versions,
    profile: {
      id: profile.profile_id,
      version: profile.version,
      digest: manifest.profile_digest,
    },
    catalog: {
      id: catalog.catalog_id,
      source_count: catalog.sources.length,
      record_count: catalog.records.length,
      diagnostics: catalog.diagnostics,
      read_only: catalog.read_only,
    },
    graph: {
      node_count: inference.graph.nodes.length,
      edge_count: inference.graph.edges.length,
      inference_run_ref: inference.run.run_id,
    },
    draft: {
      id: draft.draft_id,
      executable: draft.executable,
      target_mode: draft.target_mode,
      readiness: readiness.status,
      question_count: questions.length,
    },
    policy_decision: {
      effect: policyDecision.effect,
      reason_codes: policyDecision.reason_codes,
      audit_required: policyDecision.audit_required,
    },
    replay: {
      status: replay.run.status,
      completion_passed: replay.completion.passed,
      credentials_revoked: replay.teardown.credentials_revoked,
      workspace_deleted: replay.teardown.workspace_deleted,
    },
    run_manifest: manifest,
    ...(storageResult ? { storage: storageResult } : {}),
  };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export async function main(args = process.argv.slice(2)) {
  const inputOption = option(args, "--input", defaultInput);
  const policyOption = option(args, "--policy", defaultPolicy);
  const profileOption = option(args, "--profile", defaultProfile);
  const storeOption = option(args, "--store", undefined);
  const input = resolve(process.env.INIT_CWD ?? process.cwd(), inputOption);
  const policyPath = resolve(process.env.INIT_CWD ?? process.cwd(), policyOption);
  const profilePath = resolve(process.env.INIT_CWD ?? process.cwd(), profileOption);
  const storeDirectory = storeOption
    ? resolve(process.env.INIT_CWD ?? process.cwd(), storeOption)
    : undefined;
  const capturedAt = option(args, "--captured-at", defaultCapturedAt);
  const result = await runBootstrap(input, capturedAt, policyPath, profilePath, storeDirectory);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
