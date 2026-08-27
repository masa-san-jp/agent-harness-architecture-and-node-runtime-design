import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { importDirectory } from "@agent-harness/evidence-importer";
import { runInference } from "@agent-harness/graph-inference";
import { assessReadiness, createHarnessDraft } from "@agent-harness/harness-draft";
import { runEphemeral } from "@agent-harness/ephemeral-runtime";
import { evaluatePolicy } from "@agent-harness/policy-evaluator";
import { generateReviewQuestions } from "@agent-harness/review-workflow";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/bootstrap/minimal-office-v1/", import.meta.url),
);
const defaultInput = `${fixtureRoot}raw`;
const defaultPolicy = `${fixtureRoot}expected/security/policy.json`;
const defaultCapturedAt = "2026-01-08T00:00:00Z";

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

export async function runBootstrap(
  inputDirectory = defaultInput,
  capturedAt = defaultCapturedAt,
  policyPath = defaultPolicy,
) {
  const catalog = await importDirectory(inputDirectory, {
    capturedAt,
    classification: { level: "synthetic", tags: ["offline-fixture"] },
    masking: { state: "unmasked" },
    dryRun: true,
  });
  const events = eventsFromCatalog(catalog);
  if (events.length === 0) throw new Error("No audit-like events were imported");

  const inference = await runInference({ events }, { executedAt: capturedAt });
  const node = inference.graph.nodes[0];
  if (!node) throw new Error("Inference produced no candidate node");
  const draft = createHarnessDraft(node, {
    targetMode: "observe",
    evaluatedAt: capturedAt,
    policyRef: "policy:minimal-office@1.0.0",
  });
  const readiness = assessReadiness(draft, capturedAt);
  const questions = generateReviewQuestions(draft, { createdAt: capturedAt });
  const policy = await readPolicy(policyPath);
  const policyDecision = evaluatePolicy(
    {
      request_id: "request:reference-cli-metadata",
      subject_ref: "person:reference-cli",
      subject_tenant_ref: "tenant:one",
      action: "evidence.read_metadata",
      resource_refs: catalog.records.slice(0, 1).map((record) => record.record_id),
      resource_tenant_ref: "tenant:one",
      classification: "synthetic",
      network: "none",
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
      policy_ref: "policy:minimal-office@1.0.0",
      mode: "replay",
      input_snapshot_ref: catalog.catalog_id,
      tool_requested: false,
      write_requested: false,
      network: "none",
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

  return {
    contract_versions: {
      importer: "evidence-importer-port@1.0.0",
      graph: "candidate-graph@1.0.0",
      draft: "harness-draft@1.0.0",
      policy: "bootstrap-policy@1.0.0",
      review: "review-contract@1.0.0",
      runtime: "runtime-promotion@1.0.0",
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
  };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

export async function main(args = process.argv.slice(2)) {
  const inputOption = option(args, "--input", defaultInput);
  const policyOption = option(args, "--policy", defaultPolicy);
  const input = resolve(process.env.INIT_CWD ?? process.cwd(), inputOption);
  const policyPath = resolve(process.env.INIT_CWD ?? process.cwd(), policyOption);
  const capturedAt = option(args, "--captured-at", defaultCapturedAt);
  const result = await runBootstrap(input, capturedAt, policyPath);
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
