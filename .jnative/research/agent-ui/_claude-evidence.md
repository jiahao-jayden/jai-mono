# Claude Code：subagents、进度与 transcript 的官方证据

核验日期：2026-09-10。本文仅核验 `code.claude.com`、`docs.anthropic.com` 与 Anthropic 官方 GitHub 仓库；官方文档为持续更新页面，以下 URL 以该日期访问结果为准。

## 结论

1. Claude Code 的 subagent、进度、可见输出与恢复能力受到不同产品表面和版本演进的限制；逐项官方证据见下文。[官方证据](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)

## 逐项证据

### 1. 后台 subagent 的主会话可见结果是“完成通知”，不能据此假定父会话会逐步接收或交织子 agent 的叙述与工具调用。

官方 URL：[https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background](https://code.claude.com/docs/en/sub-agents#run-subagents-in-foreground-or-background)

> Subagents can run in the foreground or the background:
>
> - Foreground subagents block the main conversation until complete. Permission prompts are passed through to you as they come up.
> - Background subagents run concurrently while you continue working.
>
> As of v2.1.198, subagents run in the background by default. Claude runs a subagent in the foreground when it needs the result before continuing.
>
> A background subagent's results reach Claude as a completion notification in a later turn. Claude waits for that notification before reporting the subagent's results, and if you ask about progress first, it reports that the subagent is still running.

### 2. 把 Claude 的任务清单当成所有 subagent 的统一进度模型不成立：它与后台任务视图分离，并且在部分较新模型上默认为空。

官方 URL：[https://docs.anthropic.com/en/docs/claude-code/interactive-mode#task-list](https://docs.anthropic.com/en/docs/claude-code/interactive-mode#task-list)

> The task list is Claude's to-do checklist: items Claude created to plan multi-step work, with indicators showing what's pending, in progress, or complete. It's separate from the background-task view. To see running shells and subagents, use `/tasks` instead.
>
> On Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and later versions of those families, Claude keeps track of multi-step work without a written checklist, and Claude Code doesn't provide the tools that fill this list, so it stays empty.
>
> If you'd like the task list on those models anyway, opt in with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` or one of the other ways under Task tool availability.
>
> - Press `Ctrl+T` to toggle the task list view. The display shows up to five tasks at a time.

### 3. “官方没有公开进度事件 schema”的笼统结论不成立；Agent SDK 公开了周期性 `task_progress` 消息，但摘要字段默认关闭。

官方 URL：[https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdktaskprogressmessage](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript#sdktaskprogressmessage)

> ### `SDKTaskProgressMessage`
>
> Emitted periodically while a subagent or background task is running. The `summary` field is populated only when `agentProgressSummaries` is enabled.
>
> ```typescript
> type SDKTaskProgressMessage = {
>   type: "system";
>   subtype: "task_progress";
>   task_id: string;
>   tool_use_id?: string;
>   description: string;
>   subagent_type?: string;
>   usage: {
>     total_tokens: number;
>     tool_uses: number;
>     duration_ms: number;
>   };

### 4. “无法在机器可读输出中获得 subagent 文本或 thinking”的结论已不成立；官方 changelog 记录了显式 opt-in 的 `stream-json` 转发开关，且嵌套 subagent 需要该开关才能出现。

官方 URL：[https://code.claude.com/docs/en/changelog](https://code.claude.com/docs/en/changelog)

> - Changed session transcripts to record the reasoning effort level on each assistant message
> - Changed headless/SDK sessions to apply a `set_model` control request mid-turn; the next model round-trip uses the new model instead of waiting for the next turn
> - Changed agent view / `claude agents --json`: sessions waiting on a sandbox, MCP-input, or managed-settings prompt now show as "Needs input" instead of "Working"
> - Updated the auth status panel title from "Cloud authentication" to "Authentication"
> - Corrected an earlier release note (2.1.200): tmux through the 3.6 series lacks synchronized output; newer tmux with support is detected automatically
> - Added `--forward-subagent-text` flag and `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` environment variable to include subagent text and thinking in stream-json output
> - Fixed permission previews relayed to chat channels not neutralizing bidirectional-override, zero-width, and look-alike quote characters, so tool inputs cannot visually alter the approval message

### 5. 交互 transcript 提供的是详细查看模式而非“永远逐条展开”的叙述：工具使用、执行、时间和模型可见，但某些调用会先折叠为汇总行。

官方 URL：[https://docs.anthropic.com/en/docs/claude-code/interactive-mode#keyboard-shortcuts](https://docs.anthropic.com/en/docs/claude-code/interactive-mode#keyboard-shortcuts)

> | `Ctrl+O` | Toggle transcript viewer | Shows detailed tool usage and execution, with a timestamp and the model used on each assistant message. Also expands lines that collapse by default, such as MCP calls, shown as a single `Called slack 3 times` line, and messages from your other sessions, shown as a one-line `Message from @` preview |
> | `Ctrl+T` | Toggle Claude's task checklist | Show or hide Claude's to-do checklist in the status area. This is not the background-task view; use `/tasks` to see running shells and subagents |
>
> In fullscreen rendering, press `?` in the transcript viewer to see available shortcuts there.
>
> Keyboard shortcuts may vary by platform and terminal.

### 6. Claude Code 支持恢复会话并恢复完整对话历史（含工具调用和结果），但恢复不是对原始启动环境的完全重放：若依赖若干 CLI 配置，必须再次传入。

官方 URL：[https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores](https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores)

> A resumed session restores the conversation along with the state saved in it:
>
> - Conversation history: the full history, including tool calls and results.
> - Model: the session continues on the model it was using.
> - Agent: a session started with `--agent` or the `agent` setting continues as that agent, keeping its system prompt, tool restrictions, and model.
> - Permission mode: if you resume from a terminal with `claude --continue`, `claude --resume`, or `claude --resume <session>`, without `-p`, Claude Code restores the permission mode the session was in.
> - Active goal: a goal that was still active when the session ended carries over; its turn count, timer, and token-spend baseline reset.
> - Scheduled tasks: tasks that haven't expired are restored. Background Bash and monitor tasks aren't.
>
> Not every configuration flag from the original launch is restored. If the session depended on `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, or directories added with `--add-dir`, pass them again when you resume.

### 7. subagent transcript 与主会话独立持久化，主会话压缩不会删掉它；但默认清理期为 30 天，因此它不是无限期的产品存档承诺。

官方 URL：[https://code.claude.com/docs/en/sub-agents#resume-subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents)

> You can also ask Claude for the agent ID if you want to reference it explicitly, or find IDs in the transcript files at `~/.claude/projects/{project}/{sessionId}/subagents/`. Each transcript is stored as `agent-{agentId}.jsonl`.
>
> Subagent transcripts persist independently of the main conversation:
>
> - Main conversation compaction: when the main conversation compacts, subagent transcripts are unaffected. They're stored in separate files.
> - Session persistence: subagent transcripts persist within their session. You can resume a subagent after restarting Claude Code by resuming the same session.
> - Automatic cleanup: Claude Code deletes subagent transcripts after the `cleanupPeriodDays` retention period, 30 days by default, following the retention sweep rules.

### 8. 不应把磁盘 transcript 当作当前 UI/事件状态的强一致来源：官方 hooks 文档明确它是异步写入，hook 触发时可能缺少当前 turn 的最新消息。

官方 URL：[https://docs.anthropic.com/en/docs/claude-code/hooks#common-input-fields](https://docs.anthropic.com/en/docs/claude-code/hooks#common-input-fields)

> ### Common input fields
>
> Hook events receive these fields as JSON, in addition to event-specific fields documented in each hook event section. For command hooks, this JSON arrives via stdin. For HTTP hooks, it arrives as the POST request body.
>
> | Field | Description |
> | --- | --- |
> | `session_id` | Current session identifier |
> | `prompt_id` | UUID identifying the user prompt currently being processed. Matches the `prompt.id` attribute on OpenTelemetry events, so you can correlate hook output with telemetry for a single prompt. Absent until the first user input. Requires Claude Code v2.1.196 or later |
> | `transcript_path` | Path to conversation JSON. The transcript file is written asynchronously and may lag the in-memory conversation, so it may not yet include the current turn's most recent messages when a hook fires. Hooks that need the final assistant text of the current turn should use `last_assistant_message` on Stop and SubagentStop instead of reading the transcript |

### 9. Anthropic 仓库维护者确认：在 hook 中，`transcript_path` 的设计始终指向主会话；子 agent 的独立路径目前仅在 `SubagentStop` 提供。故不能从 `agent_id` 的存在推断每个工具事件都有对应子 agent transcript 路径。

官方 URL：[https://github.com/anthropics/claude-code/issues/76333#issuecomment-4198013913](https://github.com/anthropics/claude-code/issues/76333#issuecomment-4198013913)

> Thanks for the detailed repro. I reproduced this on 2.1.233 on Linux: a `PreToolUse` hook fired from inside a Task subagent receives `agent_id` for the subagent, but `transcript_path` points at the parent session's transcript.
>
> This is currently intended behavior rather than a bug: `transcript_path` always refers to the main session's transcript, for every hook event. The subagent's own transcript is exposed through a separate field, `agent_transcript_path` — but today that field is only included on `SubagentStop` ([hooks reference](https://code.claude.com/docs/en/hooks#subagentstop)).
>
> That said, we agree it's confusing that tool events inside a subagent identify the agent without pointing at its transcript, and the docs don't call this out. We're considering adding `agent_transcript_path` to tool events that fire inside subagents, and clarifying the hooks reference in the meantime.
>
> Workaround that works today: the subagent transcript lives next to the session transcript — take `transcript_path`, drop the `.jsonl` extension, and append `/subagents/agent-<agent_id>.jsonl`.

### 10. 历史演变表明后台行为和可见状态仍在快速变化：不能把旧版“subagent 默认前台”或“完成状态不更新”当作稳定的产品约束。

官方 URL：[https://code.claude.com/docs/en/changelog](https://code.claude.com/docs/en/changelog)

> - Fixed resetting a corrupted config file from the startup recovery dialog destroying it unrecoverably — it now backs up the file first
> - Fixed Claude in Chrome repeatedly opening the reconnect page when sessions run from different builds or config directories
> - Fixed plan mode not prompting for state-changing browser tool calls; read-only `browser_batch` calls are now correctly auto-allowed
> - Transient server rate-limit errors (429s unrelated to your usage limit) are now retried automatically with backoff for subscribers instead of failing the turn
> - `CLAUDE_CODE_RETRY_WATCHDOG` now raises the default retry count for non-capacity transient errors to 300 and lifts the cap of 15 on `CLAUDE_CODE_MAX_RETRIES`
> - `claude agents` session rows now show pull-request links as bare `#N` without the redundant "PR" label
> - Subagents now run in the background by default, so Claude keeps working while they run and is notified when they finish (previously a gradual rollout)
> - Added background agent notifications in `claude agents` — sessions that need input or finish now fire the `Notification` hook (`agent_needs_input` / `agent_completed`)

## 来源覆盖

| 来源类别 | 核验记录 |
|---|---|
| 官方文档 / 源码 | 已核验 Claude Code 的 Subagents、Interactive mode、Sessions、Hooks、Agent SDK TypeScript reference 与 Status line 文档（访问日期 2026-09-10）。 |
| 作者或维护者本人的说法 | 已找到 Anthropic 官方仓库维护者 `bcherny` 在 #76333 的复现与“intended behavior”说明（发现 9）。 |
| 同类方案 | 不适用：本笔记按要求仅研究 Claude Code 官方资料，未比较其他产品。 |
| issue / PR / 社区实践 | 已查看官方仓库 #76333（有维护者回复）和 #76602（开放问题；页面可见 Timeline 未见 Anthropic 维护者文字回复）。后者不能用作官方行为结论。 |
| 历史演变 | 已查看官方 changelog；发现 4 和 10 记录 stream 转发与后台默认行为的演进。 |

## 对本项目的影响

此笔记只补充第三方官方来源面，不对本仓库实现作分析或提出改动。使用它时，应区分 SDK 的公开 `task_progress` schema、CLI 的 `stream-json` 文本转发、以及 hooks 的异步 transcript 文件；三者不能互相替代，也不能据此假定有公开的 Desktop UI 交织控制协议。
