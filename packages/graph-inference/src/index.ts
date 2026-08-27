import { createHash } from "node:crypto";

export const CANDIDATE_NODE_FIELDS = [
  "purpose",
  "input",
  "process",
  "output",
  "completion_condition",
  "executor",
] as const;

export type CandidateNodeField = (typeof CANDIDATE_NODE_FIELDS)[number];
export type AssertionStatus =
  | "fact"
  | "inferred"
  | "human_confirmed"
  | "contradictory"
  | "unverified";
export type CandidateNodeStatus = "candidate" | "insufficient" | "ambiguous" | "contradictory";
export type CandidateSource = "deterministic" | "model" | "human";

export interface Provenance {
  kind: "source" | "normalized" | "inferred" | "human_confirmed" | "system_generated";
  source_refs?: readonly string[];
  method_ref?: string;
}

export interface ObservedEventInput {
  event_id: string;
  evidence_refs: readonly string[];
  occurred_time?: {
    kind: "instant" | "interval" | "bounded" | "unknown";
    at?: string;
    start?: string;
  };
  subject: {
    ref?: string;
    status: "known" | "unknown" | "ambiguous" | "withheld";
  };
  action: string;
  target_refs?: readonly string[];
  input_refs?: readonly string[];
  output_refs?: readonly string[];
  status: AssertionStatus;
  provenance: readonly Provenance[];
}

export interface CandidateField {
  field: CandidateNodeField;
  value: unknown;
  status: AssertionStatus;
  confidence: number;
  evidence_refs: readonly string[];
  provenance: readonly Provenance[];
  source: CandidateSource;
}

export interface CandidateNode {
  node_id: string;
  status: CandidateNodeStatus;
  confidence: number;
  fields: readonly CandidateField[];
  evidence_refs: readonly string[];
  inference_run_ref: string;
}

export interface CandidateEdge {
  edge_id: string;
  from_node_ref: string;
  to_node_ref: string;
  status: AssertionStatus;
  confidence: number;
  evidence_refs: readonly string[];
  provenance: readonly Provenance[];
  inference_run_ref: string;
  source: CandidateSource;
}

export interface InferenceRun {
  run_id: string;
  input_refs: readonly string[];
  method: "deterministic" | "model" | "hybrid";
  configuration_ref: string;
  input_digest: string;
  model_ref?: string;
  model_version?: string;
  policy_ref?: string;
  executed_at: string;
  reproducible: boolean;
  produced_node_refs: readonly string[];
  produced_edge_refs: readonly string[];
}

export interface CandidateGraph {
  graph_id: string;
  inference_run_ref: string;
  nodes: readonly CandidateNode[];
  edges: readonly CandidateEdge[];
}

export interface ModelNodeProposal {
  node_id?: string;
  status: CandidateNodeStatus;
  confidence: number;
  fields: readonly CandidateField[];
  evidence_refs: readonly string[];
}

export interface InferenceModel {
  readonly model_ref: string;
  readonly model_version: string;
  propose(input: {
    events: readonly ObservedEventInput[];
    deterministic_nodes: readonly CandidateNode[];
  }): readonly ModelNodeProposal[] | Promise<readonly ModelNodeProposal[]>;
}

export interface InferenceOptions {
  executedAt: string;
  configurationRef?: string;
  policyRef?: string;
  model?: InferenceModel;
}

export interface InferenceInput {
  events: readonly ObservedEventInput[];
}

export interface InferenceResult {
  run: InferenceRun;
  graph: CandidateGraph;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function shortId(prefix: string, value: unknown): string {
  return `${prefix}:${digest(value).slice(0, 24)}`;
}

function confidenceFor(status: AssertionStatus): number {
  switch (status) {
    case "fact":
    case "human_confirmed":
      return 1;
    case "inferred":
      return 0.6;
    case "contradictory":
      return 0.25;
    case "unverified":
      return 0.2;
  }
}

function field(
  name: CandidateNodeField,
  value: unknown,
  status: AssertionStatus,
  evidenceRefs: readonly string[],
  provenance: readonly Provenance[],
  source: CandidateSource,
): CandidateField {
  return {
    field: name,
    value,
    status,
    confidence: confidenceFor(status),
    evidence_refs: evidenceRefs,
    provenance,
    source,
  };
}

function deterministicNode(event: ObservedEventInput, index: number): CandidateNode {
  const evidenceRefs = [...new Set(event.evidence_refs)];
  const provenance = event.provenance.length
    ? event.provenance
    : [{ kind: "normalized" as const, source_refs: evidenceRefs }];
  const valueStatus = event.status === "contradictory" ? "contradictory" : "fact";
  const inputValue = event.input_refs?.length ? event.input_refs : (event.target_refs ?? []);
  const outputValue = event.output_refs ?? [];
  const executorValue = event.subject.status === "known" ? (event.subject.ref ?? null) : null;
  const fields = [
    field("purpose", null, "unverified", evidenceRefs, provenance, "deterministic"),
    field("input", inputValue, valueStatus, evidenceRefs, provenance, "deterministic"),
    field("process", event.action, valueStatus, evidenceRefs, provenance, "deterministic"),
    field("output", outputValue, valueStatus, evidenceRefs, provenance, "deterministic"),
    field("completion_condition", null, "unverified", evidenceRefs, provenance, "deterministic"),
    field(
      "executor",
      executorValue,
      executorValue === null ? "unverified" : valueStatus,
      evidenceRefs,
      provenance,
      "deterministic",
    ),
  ];
  const status: CandidateNodeStatus =
    event.status === "contradictory"
      ? "contradictory"
      : fields.some((candidate) => candidate.status === "contradictory")
        ? "contradictory"
        : fields.some((candidate) => candidate.status === "unverified")
          ? "insufficient"
          : "candidate";
  return {
    node_id: shortId("node", { event: event.event_id, index }),
    status,
    confidence: Math.min(...fields.map((candidate) => candidate.confidence)),
    fields,
    evidence_refs: evidenceRefs,
    inference_run_ref: "pending",
  };
}

function eventSortKey(event: ObservedEventInput): string {
  return event.occurred_time?.at ?? event.occurred_time?.start ?? event.event_id;
}

function deterministicEdges(
  events: readonly ObservedEventInput[],
  nodes: readonly CandidateNode[],
): CandidateEdge[] {
  const orderedEvents = [...events].sort((left, right) =>
    eventSortKey(left).localeCompare(eventSortKey(right)),
  );
  return orderedEvents.slice(1).flatMap((event, index) => {
    const previousEvent = orderedEvents[index];
    if (!previousEvent) return [];
    const from = nodes.find(
      (node) =>
        node.node_id ===
        shortId("node", { event: previousEvent.event_id, index: events.indexOf(previousEvent) }),
    );
    const to = nodes.find(
      (node) =>
        node.node_id === shortId("node", { event: event.event_id, index: events.indexOf(event) }),
    );
    if (!from || !to) return [];
    const evidenceRefs = [...new Set([...from.evidence_refs, ...to.evidence_refs])];
    return [
      {
        edge_id: shortId("edge", { from: from.node_id, to: to.node_id }),
        from_node_ref: from.node_id,
        to_node_ref: to.node_id,
        status: "inferred" as const,
        confidence: 0.4,
        evidence_refs: evidenceRefs,
        provenance: [{ kind: "inferred" as const, source_refs: evidenceRefs }],
        inference_run_ref: "pending",
        source: "deterministic" as const,
      },
    ];
  });
}

function normalizeModelNode(
  proposal: ModelNodeProposal,
  model: InferenceModel,
  index: number,
): CandidateNode {
  const fieldsByName = new Map(proposal.fields.map((candidate) => [candidate.field, candidate]));
  const fields = CANDIDATE_NODE_FIELDS.map(
    (name) =>
      fieldsByName.get(name) ??
      field(
        name,
        null,
        "unverified",
        proposal.evidence_refs,
        [{ kind: "inferred", source_refs: proposal.evidence_refs, method_ref: model.model_ref }],
        "model",
      ),
  );
  return {
    node_id: proposal.node_id ?? shortId("model-node", { model: model.model_ref, index }),
    status: proposal.status,
    confidence: proposal.confidence,
    fields,
    evidence_refs: [...new Set(proposal.evidence_refs)],
    inference_run_ref: "pending",
  };
}

export async function runInference(
  input: InferenceInput,
  options: InferenceOptions,
): Promise<InferenceResult> {
  const deterministicNodes = input.events.map((event, index) => deterministicNode(event, index));
  const deterministicEdges = deterministicEdgesFor(input.events, deterministicNodes);
  const modelNodes = options.model
    ? (
        await options.model.propose({
          events: input.events,
          deterministic_nodes: deterministicNodes,
        })
      ).map((proposal, index) =>
        normalizeModelNode(proposal, options.model as InferenceModel, index),
      )
    : [];
  const method = options.model ? "hybrid" : "deterministic";
  const inputRefs = [...new Set(input.events.flatMap((event) => event.evidence_refs))];
  const inputDigest = digest(input.events);
  const configurationRef = options.configurationRef ?? "rules:graph-inference-v1";
  const runId = shortId("inference-run", {
    inputDigest,
    configurationRef,
    modelRef: options.model?.model_ref ?? null,
    modelVersion: options.model?.model_version ?? null,
  });
  const nodes = [...deterministicNodes, ...modelNodes].map((node) => ({
    ...node,
    inference_run_ref: runId,
  }));
  const edges = deterministicEdges.map((edge) => ({ ...edge, inference_run_ref: runId }));
  const run: InferenceRun = {
    run_id: runId,
    input_refs: inputRefs.length ? inputRefs : input.events.map((event) => event.event_id),
    method,
    configuration_ref: configurationRef,
    input_digest: inputDigest,
    ...(options.model
      ? { model_ref: options.model.model_ref, model_version: options.model.model_version }
      : {}),
    ...(options.policyRef ? { policy_ref: options.policyRef } : {}),
    executed_at: options.executedAt,
    reproducible: true,
    produced_node_refs: nodes.map((node) => node.node_id),
    produced_edge_refs: edges.map((edge) => edge.edge_id),
  };
  return {
    run,
    graph: {
      graph_id: shortId("graph", { runId }),
      inference_run_ref: runId,
      nodes,
      edges,
    },
  };
}

function deterministicEdgesFor(
  events: readonly ObservedEventInput[],
  nodes: readonly CandidateNode[],
): CandidateEdge[] {
  return deterministicEdges(events, nodes);
}
