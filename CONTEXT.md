# PandaWork Desktop Agent Context

The vocabulary for PandaWork Desktop's Agent-facing product concepts. These terms keep delegated execution, session progress, and future coordination records distinct.

## Agent workflow

**Subagent delegation**:
An isolated child Agent run started by a parent Session for a bounded delegated task.
_Avoid_: Task (when referring to the delegation itself), background job

**Session Todo**:
A structured, session-scoped checklist that represents the parent Agent's current execution plan and progress.
_Avoid_: Task, work item

**Execution round**:
A single parent Agent run triggered by one user message, from execution start until the Agent becomes idle. A queued message starts a new round.
_Avoid_: Todo, work item

**Work item**:
A persistent, assignable coordination record with an independent lifecycle, such as ownership or dependencies, across Sessions or Agents. It is not part of the current PandaWork scope.
_Avoid_: Todo, subagent run

**Plan**:
A user-reviewable proposal for how work should be carried out before execution begins.
_Avoid_: Todo, work item
