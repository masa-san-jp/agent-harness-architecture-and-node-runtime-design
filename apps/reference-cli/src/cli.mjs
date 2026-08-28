import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { importDirectory } from "@agent-harness/evidence-importer";
import { runInference } from "@agent-harness/graph-inference";
import { assessReadiness, createHarnessDraft } from "@agent-harness/harness-draft";
import { runEphemeral } from "@agent-harness/ephemeral-runtime";
import { evaluatePolicy, POLICY_ACTIONS } from "@agent-harness/policy-evaluator";
import { generateReviewQuestions } from "@agent-harness/review-workflow";
import { createAdapterRegistry, loadAdapterBundle } from "@agent-harness/adapter-registry";
import { openSqliteStorage } from "@agent-harness/storage";
import { createScaffold } from "./scaffold.mjs";
import { createRunManifest, loadProfile, sha256 } from "./profile.mjs";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/bootstrap/minimal-office-v1/", import.meta.url),
);
const defaultInput = `${fixtureRoot}raw`;
const defaultPolicy = `${fixtureRoot}expected/security/policy.json`;
const defaultProfile = `${fixtureRoot}expected/profile/minimal-office.json`;
const defaultCapturedAt = "2026-01-08T00:00:00Z";
const cliPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cliVersion = cliPackage.version;

const HELP_TEXT = `@agent-harness/reference-cli ${cliVersion}

Usage:
  pnpm --filter @agent-harness/reference-cli run cli
  pnpm --filter @agent-harness/reference-cli run cli -- --validate
  pnpm --filter @agent-harness/reference-cli run cli -- --init ./organization-bootstrap

Options:
  --input <dir>             Read-only export directory (default: canonical fixture)
  --policy <file>           Bootstrap Policy JSON (default: canonical fixture)
  --profile <file>          Organization Profile JSON (default: canonical fixture)
  --captured-at <date>      Fixed RFC 3339 capture time
  --store <dir>             Persist derived Catalog and Run Manifest to SQLite
  --adapter-bundle <file>   Load a trusted local adapter bundle manifest
  --validate                Validate Profile, Policy, adapter bundle, and input binding
  --init <dir>               Create an organization bootstrap scaffold without overwriting files
  -h, --help                Show this help
  -v, --version             Show the CLI version

The default path is offline, read-only, and uses a fake replay executor. A generated HarnessDraft
is a review artifact and is not executable. Use --init to create a safe starting point for an
organization Profile, deny-by-default Policy, sample input, and custom adapter template.
`;

const OPTION_DEFINITIONS = {
  "--input": { name: "input", value: true },
  "--policy": { name: "policy", value: true },
  "--profile": { name: "profile", value: true },
  "--captured-at": { name: "capturedAt", value: true },
  "--store": { name: "store", value: true },
  "--adapter-bundle": { name: "adapterBundle", value: true },
  "--validate": { name: "validate", value: false },
  "--init": { name: "init", value: true },
  "--help": { name: "help", value: false },
  "-h": { name: "help", value: false },
  "--version": { name: "version", value: false },
  "-v": { name: "version", value: false },
};

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
  let policy;
  try {
    policy = JSON.parse(await readFile(policyPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`POLICY_INVALID: malformed JSON (${policyPath})`);
    }
    throw error;
  }
  return assertValidPolicy(policy);
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidPolicy(input) {
  const errors = [];
  if (!isRecord(input)) throw new Error("POLICY_INVALID: expected an object");

  if (typeof input.policy_id !== "string" || !IDENTIFIER.test(input.policy_id)) {
    errors.push("policy_id");
  }
  if (typeof input.version !== "string" || !SEMVER.test(input.version)) errors.push("version");
  if (input.default_effect !== "deny") errors.push("default_effect must be deny");

  const actions = input.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push("actions");
  } else {
    const actionSet = new Set();
    for (const [index, action] of actions.entries()) {
      if (typeof action !== "string" || !POLICY_ACTIONS.includes(action)) {
        errors.push(`actions[${index}]`);
      } else if (actionSet.has(action)) {
        errors.push(`actions[${index}] duplicate`);
      }
      actionSet.add(action);
    }
  }

  if (!Array.isArray(input.rules)) {
    errors.push("rules");
  } else {
    const ruleIds = new Set();
    for (const [index, rule] of input.rules.entries()) {
      if (!isRecord(rule)) {
        errors.push(`rules[${index}]`);
        continue;
      }
      if (typeof rule.rule_id !== "string" || !IDENTIFIER.test(rule.rule_id)) {
        errors.push(`rules[${index}].rule_id`);
      } else if (ruleIds.has(rule.rule_id)) {
        errors.push(`rules[${index}].rule_id duplicate`);
      }
      ruleIds.add(rule.rule_id);
      if (typeof rule.action !== "string" || !POLICY_ACTIONS.includes(rule.action)) {
        errors.push(`rules[${index}].action`);
      }
      if (rule.effect !== "allow" && rule.effect !== "deny") {
        errors.push(`rules[${index}].effect`);
      }
      if (!isRecord(rule.conditions)) errors.push(`rules[${index}].conditions`);
    }
  }

  if (
    !Array.isArray(input.classification_order) ||
    input.classification_order.some((classification) => typeof classification !== "string")
  ) {
    errors.push("classification_order");
  }
  if (
    !Array.isArray(input.external_model_classifications) ||
    input.external_model_classifications.some(
      (classification) => typeof classification !== "string",
    )
  ) {
    errors.push("external_model_classifications");
  }
  if (typeof input.require_masking_for_external !== "boolean") {
    errors.push("require_masking_for_external");
  }
  if (!Array.isArray(input.retention)) {
    errors.push("retention");
  } else {
    input.retention.forEach((rule, index) => {
      if (
        !isRecord(rule) ||
        typeof rule.classification !== "string" ||
        !Number.isInteger(rule.original_days) ||
        rule.original_days < 0 ||
        !Number.isInteger(rule.derived_days) ||
        rule.derived_days < 0
      ) {
        errors.push(`retention[${index}]`);
      }
    });
  }

  if (errors.length > 0) throw new Error(`POLICY_INVALID: ${errors.join(", ")}`);
  return input;
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

async function validateConfiguration({
  inputDirectory,
  capturedAt,
  policyPath,
  profilePath,
  adapterBundlePath,
}) {
  const profile = await loadProfile(profilePath);
  const policy = await readPolicy(policyPath);
  if (profile.policy_ref !== policy.policy_id) {
    throw new Error(`POLICY_PROFILE_MISMATCH: ${profile.policy_ref} != ${policy.policy_id}`);
  }

  const adapterBundle = adapterBundlePath ? await loadAdapterBundle(adapterBundlePath) : undefined;
  const adapterRegistry = createAdapterRegistry(adapterBundle?.adapters ?? []);
  const selectedAdapters = adapterRegistry.adaptersFor(profile);
  const catalog = await importDirectory(inputDirectory, {
    capturedAt,
    classification: profile.classification,
    masking: profile.masking,
    dryRun: true,
    adapters: selectedAdapters,
  });
  validateProfileBindings(profile, catalog);

  return {
    valid: true,
    profile: {
      id: profile.profile_id,
      version: profile.version,
      digest: sha256(profile),
    },
    policy: {
      id: policy.policy_id,
      version: policy.version,
      digest: sha256(policy),
    },
    input: {
      source_count: catalog.sources.length,
      record_count: catalog.records.length,
      diagnostics: catalog.diagnostics,
      read_only: catalog.read_only,
      adapter_ids: [...new Set(catalog.outcomes.map((outcome) => outcome.adapter_id))],
    },
    ...(adapterBundle
      ? {
          adapter_bundle: {
            id: adapterBundle.manifest.bundle_id,
            version: adapterBundle.manifest.version,
            digest: adapterBundle.digest,
            adapter_refs: adapterBundle.adapters.map((adapter) => adapter.adapterId),
          },
        }
      : {}),
  };
}

export async function runBootstrap(
  inputDirectory = defaultInput,
  capturedAt = defaultCapturedAt,
  policyPath = defaultPolicy,
  profilePath = defaultProfile,
  storeDirectory,
  adapterBundlePath,
) {
  const profile = await loadProfile(profilePath);
  const adapterBundle = adapterBundlePath ? await loadAdapterBundle(adapterBundlePath) : undefined;
  const adapterRegistry = createAdapterRegistry(adapterBundle?.adapters ?? []);
  const adapters = adapterRegistry.adaptersFor(profile);
  const catalog = await importDirectory(inputDirectory, {
    capturedAt,
    classification: profile.classification,
    masking: profile.masking,
    dryRun: true,
    adapters,
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
    ...(adapterBundle
      ? { extensions: { "local.adapter_bundle_digest": adapterBundle.digest } }
      : {}),
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
      adapter_ids: [...new Set(catalog.outcomes.map((outcome) => outcome.adapter_id))],
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
    ...(adapterBundle
      ? {
          adapter_bundle: {
            id: adapterBundle.manifest.bundle_id,
            version: adapterBundle.manifest.version,
            digest: adapterBundle.digest,
            adapter_refs: adapterBundle.adapters.map((adapter) => adapter.adapterId),
          },
        }
      : {}),
    ...(storageResult ? { storage: storageResult } : {}),
  };
}

function parseArguments(rawArgs) {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const definition = OPTION_DEFINITIONS[argument];
    if (!definition) {
      if (argument.startsWith("-")) throw new Error(`UNKNOWN_OPTION: ${argument}`);
      throw new Error(`UNEXPECTED_ARGUMENT: ${argument}`);
    }
    if (Object.hasOwn(values, definition.name)) {
      throw new Error(`DUPLICATE_OPTION: ${argument}`);
    }
    if (definition.value) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      values[definition.name] = value;
      index += 1;
    } else {
      values[definition.name] = true;
    }
  }
  return values;
}

function assertStandalone(values, name) {
  const otherOptions = Object.keys(values).filter((key) => key !== name);
  if (otherOptions.length > 0) {
    const labels = { capturedAt: "--captured-at", adapterBundle: "--adapter-bundle" };
    throw new Error(
      `${name === "init" ? "--init" : `--${name}`} cannot be combined with ${otherOptions.map((key) => labels[key] ?? `--${key}`).join(", ")}`,
    );
  }
}

export async function main(args = process.argv.slice(2)) {
  const values = parseArguments(args);
  if (values.help) {
    assertStandalone(values, "help");
    console.log(HELP_TEXT);
    return { help: true };
  }
  if (values.version) {
    assertStandalone(values, "version");
    console.log(`@agent-harness/reference-cli ${cliVersion}`);
    return { version: cliVersion };
  }

  const invocationRoot = process.env.INIT_CWD ?? process.cwd();
  if (values.init) {
    assertStandalone(values, "init");
    const scaffold = await createScaffold(values.init, invocationRoot);
    console.log(`Created organization bootstrap scaffold in ${scaffold.directory}`);
    console.log(
      "Edit profile.json and policy.json, then run --validate before using real exports.",
    );
    return { initialized: true, ...scaffold };
  }

  const input = resolve(invocationRoot, values.input ?? defaultInput);
  const policyPath = resolve(invocationRoot, values.policy ?? defaultPolicy);
  const profilePath = resolve(invocationRoot, values.profile ?? defaultProfile);
  const storeDirectory = values.store ? resolve(invocationRoot, values.store) : undefined;
  const adapterBundlePath = values.adapterBundle
    ? resolve(invocationRoot, values.adapterBundle)
    : undefined;
  const capturedAt = values.capturedAt ?? defaultCapturedAt;

  if (values.validate) {
    if (storeDirectory) throw new Error("--validate cannot be combined with --store");
    const result = await validateConfiguration({
      inputDirectory: input,
      capturedAt,
      policyPath,
      profilePath,
      adapterBundlePath,
    });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const result = await runBootstrap(
    input,
    capturedAt,
    policyPath,
    profilePath,
    storeDirectory,
    adapterBundlePath,
  );
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
