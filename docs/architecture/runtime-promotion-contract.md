# Runtime promotion contract

The runtime executes one approved processing unit under a fixed mode. The mode is selected by the
control kernel, not by a model or by text inside an evidence record.

| Mode      | Input                           | Write/tool/network side effects               | Gate                         |
| --------- | ------------------------------- | --------------------------------------------- | ---------------------------- |
| `observe` | live metadata or evidence scope | read-only, no tool write, no external network | policy                       |
| `replay`  | fixed historical snapshot       | fixture-only, no external side effect         | snapshot integrity           |
| `shadow`  | bounded live input              | no production write; comparison only          | policy + evaluation          |
| `assist`  | approved input                  | proposal only; no unapproved external write   | human approval per output    |
| `execute` | approved input                  | only explicitly allowed scope                 | evaluation + active approval |

The control kernel rejects mode escalation, unknown modes, missing replay snapshots, cross-boundary
network requests, and execute requests without both a passing evaluation and an active approval.
The executor receives an immutable plan and cannot change its mode or permissions during a run.

Each run records the input snapshot, mode, policy and draft references, execution events, completion
check, and teardown result. A failed completion check returns a failure result and never upgrades the
run. Teardown must revoke temporary credentials and delete the temporary workspace, including on
executor failure.
