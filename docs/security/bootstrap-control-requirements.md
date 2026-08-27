# Bootstrap control requirements

This document is normative for the reference policy evaluator. An organization may add stricter
rules through a profile, but may not turn the evaluator into an implicit allowlist or give evidence
text control authority.

## Action vocabulary

| Action                   | Meaning                                                    | Default                                                                 |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `evidence.read_metadata` | Read IDs, hashes, classifications, and normalized metadata | deny until scoped                                                       |
| `evidence.read_original` | Read original bytes through an approved reference          | deny until separately granted                                           |
| `storage.write_derived`  | Persist normalized or inferred data                        | deny until retention and tenant scope are known                         |
| `model.infer`            | Send approved input to a local or controlled model         | deny until classification and integrity checks pass                     |
| `model.external_send`    | Send data outside the controlled model boundary            | deny unless explicitly allowlisted                                      |
| `tool.execute`           | Invoke a tool or business-system adapter                   | deny unless explicitly approved                                         |
| `runtime.execute`        | Run a harness with external side effects                   | deny until later lifecycle and approval gates                           |
| `audit.append`           | Append an audit record                                     | deny for callers; evaluator/runtime may emit it as a control obligation |

An implementation must reject unknown action names. Aliases must not silently map to a more
privileged action.

## Evaluation order

The evaluator applies these checks in order:

1. validate policy and request shape;
2. reject a cross-tenant resource reference;
3. reject prompt-injection-tainted requests for model external send, tool execution, or runtime
   execution;
4. apply action-specific global restrictions, including classification and masking;
5. evaluate explicit deny rules;
6. evaluate matching allow rules and their conditions;
7. fall back to the policy default, which is always deny in the reference policy;
8. return a decision with reason codes and `audit_required: true`.

The evaluator is deterministic. It does not call a model, inspect natural-language intent, fetch a
policy from the network, or execute a tool.

## Data handling separation

`evidence.read_original` and `evidence.read_metadata` are never interchangeable. A reviewer may be
allowed to see a hash and normalized claim while the original remains withheld. Similarly,
`model.infer` and `model.external_send` are separate actions even if an adapter uses the same model
API for both.

External model transmission requires both:

- the classification is listed in `external_model_classifications`; and
- if `require_masking_for_external` is true, the data is `masked` or `partially_masked`.

The data-handling decision also records original access, derived access, destination, masking
requirement, and retention days. A downstream storage or model gateway must enforce the decision,
not reinterpret it.

## Tenant isolation

Every request has a subject tenant. If a resource has a tenant reference, it must match the subject
tenant unless a future, separately reviewed federation policy is in force. The v1 evaluator has no
federation escape hatch. Missing tenant information is not treated as “any tenant” for privileged
actions.

## Organization-configurable controls

An organization profile may:

- add actions and stricter deny rules in a Domain namespace;
- lower classification ceilings or shorten retention;
- require additional reviewers, integrity attestations, or network restrictions;
- choose a local model and adapter implementation.

It may not:

- make the default effect allow;
- let evidence content change a decision;
- collapse original and derived access;
- allow a cross-tenant reference by omission;
- make an unapproved tool or runtime action executable.
