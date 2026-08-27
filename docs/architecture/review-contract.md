# Review and approval contract

The review workflow turns uncertainty in a candidate graph or HarnessDraft into bounded human
work. It asks about missing or conflicting facts instead of asking a team to rewrite the entire
business process from a blank page.

## Objects

| Object           | Purpose                                                        | Mutability                                 |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `ReviewQuestion` | A prioritized question tied to a draft/node and evidence       | Open, answered, or explicitly suppressed   |
| `ReviewDecision` | One answer classified as fact, opinion, approval, or exception | Immutable event                            |
| `ChangeSet`      | Proposed versioned edits derived from decisions                | Proposed, approved, rejected, or applied   |
| `Approval`       | A time-bounded decision by an authorized reviewer              | Immutable; expiry is evaluated, not edited |

Questions are generated from `unverified`, `contradictory`, high-risk, missing completion, missing
failure, and unsafe permission fields. Each question includes the reason and source references.
Suppression is explicit and scoped; it is not silent deletion.

## Review flow

```text
draft / candidate
      ↓
question generation ──→ human answer
      ↓                    ↓
  open questions       ReviewDecision
                             ↓
                         ChangeSet
                             ↓
                independent approval / exception
```

An approved version is never edited in place. Applying a change set creates a new version and keeps
the base reference. A rejected or revoked approval cannot be used as an execution grant.

## Answer and approval semantics

- `fact`: a statement about the observed operation, preferably with evidence;
- `opinion`: a preference or design suggestion, not proof of current behavior;
- `approval`: authorization for the named target and version;
- `exception`: a bounded deviation with owner, reason, and expiration.

Self-approval is forbidden when the requester and approver are the same identity. High and critical
risk targets require an independent reviewer role. An approval is active only between its approval
time and expiration time; an expired exception becomes a new review question.

Organization profiles may map C1/C2/C3 or their own risk classes to stricter roles, waiting periods,
and approval counts. The reference library provides the minimum separation-of-duties check and does
not assume a particular identity provider.
