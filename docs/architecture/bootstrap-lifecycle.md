# Bootstrap lifecycle

This lifecycle describes how an organization moves from having no harness to a bounded,
human-approved execution harness. It is a safety gate, not a promise that every organization must
use the same tools, model, or deployment topology.

## States

| State             | Meaning                                                           | Side effects permitted                   |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `no_harness`      | No harness or executable definition exists for the scope          | None                                     |
| `evidence_ready`  | Evidence has been imported, cataloged, and integrity-checked      | Read-only evidence access                |
| `candidate_model` | Candidate nodes and edges have been generated from evidence       | No business-system write                 |
| `draft_review`    | Human review is required or a draft is being revised              | No business-system write                 |
| `observe`         | A read-only observer may collect or classify inputs               | Read-only, bounded to the evidence scope |
| `replay`          | A draft is run against fixed historical inputs                    | Fixture or snapshot only                 |
| `shadow`          | The candidate runs beside a human or existing process             | No production side effect                |
| `assist`          | The harness proposes or prepares output for human approval        | No unapproved external write             |
| `execute`         | The approved harness may perform its explicitly allowed operation | Only approved node and policy scope      |

The initial state is always `no_harness`. A state transition never grants more permission than the
target state explicitly defines. In particular, evidence ingestion and model inference cannot
grant business-system write permission.

## Allowed transitions

```text
no_harness     -> evidence_ready
evidence_ready -> candidate_model
candidate_model -> draft_review
draft_review   -> observe
observe        -> replay | draft_review
replay         -> shadow | draft_review
shadow         -> assist | draft_review
assist         -> execute | draft_review
execute        -> draft_review
```

The return to `draft_review` is used for failed checks, expired approvals, policy changes, or
explicit revocation. It is safer than silently retaining the previous execution permission.

## Promotion decision

Every transition after `candidate_model` is represented by a versioned promotion decision. The
decision records the lifecycle, source and target state, requester, approver, evidence, policy
version, checks, and reason. A rejected or returned transition does not create a new executable
state.

The state machine is deterministic. An AI may propose a transition or summarize evidence, but it
cannot create an allowed transition, alter the target state, or bypass an approval gate.

## Organization profiles

The Core states and forbidden transitions are fixed. An organization or Domain profile may add
reviewers, checks, waiting periods, data-handling restrictions, or extra intermediate gates. It may
not remove the `draft_review` gate before `execute`, allow a write from `observe`, `replay`, or
`shadow`, or make a rejected transition executable.

## Reproducibility

A lifecycle record references the evidence set, node and harness draft versions, policy version, and
promotion decisions that produced its current state. Historical records remain resolvable after a
newer contract is accepted.
