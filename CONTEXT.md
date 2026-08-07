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

**Session App State**:
JSON business state that is restored and persisted with a Session. Agent owns its current authoritative value, while Coding Agent defines its business meaning.
_Avoid_: Extension state, UI state, transcript

**Agent Runtime State**:
Execution-only state such as running status, streaming messages, and pending tool calls. It is distinct from Session App State and is not persisted as business state.
_Avoid_: app state, session data

## Permission System

**Permission rule**:
A tool-specific pattern that determines whether a tool call is allowed, denied, or requires approval.
_Avoid_: permission flag, command toggle

**Project authorization**:
A persisted allow rule scoped to the currently opened project and reused by later sessions in that project.
_Avoid_: global authorization, session permission

**Dangerous command**:
A Bash invocation with an irreversible or high-impact external side effect that must remain confirmation-gated.
_Avoid_: unsafe command, bad command

**OpenCode-compatible permission configuration**:
The canonical Jai permission document and evaluation semantics, matching OpenCode's permission keys, patterns, actions, and last-match precedence.
_Avoid_: legacy Jai permission rules, compatibility mode

**Work item**:
A persistent, assignable coordination record with an independent lifecycle, such as ownership or dependencies, across Sessions or Agents. It is not part of the current PandaWork scope.
_Avoid_: Todo, subagent run

## External product terminology

**Claude Code Artifact**:
Claude Code 中从 session 产出 HTML/Markdown 单页并发布到 `claude.ai` 的可交互、可版本化页面。它不是普通项目文件，也不是所有 tool output 的统称。
_Avoid_: file output, session transcript

**Plan**:
A user-reviewable proposal for how work should be carried out before execution begins.
_Avoid_: Todo, work item
