# HarnessDraft contract

`HarnessDraft` is the bridge between a candidate business node and a future approved execution
definition. It is intentionally non-executable. It records what would be needed, what is still
unknown, and what must be confirmed by a person or policy before a runtime can be considered.

## Draft versus executable definition

| Object              | Meaning                                                     | Can execute?                                |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `CandidateNode`     | Evidence-derived hypothesis about a business operation      | No                                          |
| `HarnessDraft`      | Proposed execution shape, permissions, checks, and teardown | Never in v1; `executable` is always `false` |
| `HarnessDefinition` | Later approved, versioned execution contract                | Owned by a later lifecycle/runtime contract |

Creating a draft never grants a tool, network, write, or credential permission. A draft may list a
requested binding or permission as a proposal, but it remains pending until the review, policy, and
lifecycle contracts approve it.

## Draft contents

The draft carries the six candidate node fields with their evidence, provenance, assertion status,
and confidence. It also carries:

- input/output contract references or explicit unknowns;
- model capability requirements rather than a vendor or model name;
- skill, tool, and adapter binding references;
- read scopes, write scopes, and network profile;
- completion verification and failure handling;
- mandatory logging events and teardown obligations;
- risk level, profile references, and policy reference.

Environment-specific values are references under `profiles` or `adapter_bindings`. Core fields do
not contain credentials, endpoint secrets, or product-specific configuration.

## Readiness

The readiness assessment uses three meanings:

- `blocked`: a required fact or control is missing, contradictory, or unsafe;
- `needs_review`: the draft is internally complete enough to present to a reviewer but has not been
  approved;
- `ready_for_approval`: required completion, permission, failure, integrity, and teardown details
  are known and the draft can enter the review workflow.

`ready_for_approval` does not mean executable. In particular, any write scope, external network,
high-risk classification, or execute target still requires explicit policy and human approval.

## Generation rules

1. Copy candidate field values with their evidence links; do not upgrade `inferred` or `unverified`
   values to facts.
2. Default to observe mode, read-only scopes, no network, no tools, and zero retries.
3. Treat missing completion conditions, permissions, failure handling, or teardown as blockers.
4. Keep separate drafts for observe, replay, shadow, assist, and execute targets.
5. Preserve alternative or contradictory candidate nodes as separate drafts.
6. Reference a profile or adapter binding for organization-specific values.
