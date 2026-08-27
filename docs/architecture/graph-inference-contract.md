# Graph inference contract

This contract turns normalized evidence into reviewable candidate nodes and candidate edges. It is
an inference boundary, not an approval or execution boundary. A candidate graph may be incomplete,
contradictory, or wrong and must remain visibly so.

## Pipeline

```text
EvidenceRecord / ObservedEvent
             │
             ├─ deterministic extraction ──┐
             │                             ├─ CandidateNode / CandidateEdge
             └─ optional model proposal ───┘
                                           │
                                  InferenceRun + evidence links
```

Deterministic extraction and model proposal are separate sources in the output. The reference
implementation first creates one insufficient-but-traceable candidate node per observed event,
then appends model proposals when a model port is supplied. It never replaces a deterministic
candidate with a model candidate and never merges competing proposals.

## Candidate node

Every node has the stable six business fields:

1. `purpose`
2. `input`
3. `process`
4. `output`
5. `completion_condition`
6. `executor`

Each field carries a value, assertion status, confidence, provenance, and evidence references.
Missing values are represented as `null` with `unverified` status. A node with missing purpose or
completion condition is `insufficient`; a node or field that conflicts with evidence is
`contradictory`. These states are review work, not permission to invent a value.

## Candidate edge

An edge connects two candidates and keeps the evidence supporting the relation. A relation inferred
from adjacency or matching inputs/outputs has `inferred` status even if the adjacency algorithm is
deterministic. An explicitly observed handoff can be `fact`. No edge grants authority or changes a
lifecycle state.

## Reproducibility and model separation

Every output references an `InferenceRun` containing the input event IDs, configuration or rule-set
reference, input digest, execution time, and optional model reference/version. The same input,
configuration, and model identity can therefore be identified and compared across runs. The model
port receives evidence as data and returns proposals; it cannot write the graph, policy, lifecycle,
or runtime.

The model name, prompt, vendor, and credentials are not Core node fields. They belong in the run's
method/configuration references or a Local/Domain binding.

## Ambiguity, contradiction, and missing evidence

The pipeline preserves:

- multiple candidate nodes for different interpretations;
- contradictory fields and relations;
- unverified actor, time, purpose, and completion conditions;
- evidence references for every value that is not explicitly marked unverified.

Downstream review may merge, split, correct, or reject candidates. That operation belongs to the
review contract and produces a versioned change set; inference does not silently perform it.
