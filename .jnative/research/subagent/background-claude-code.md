# Claude Code 后台 subagent 机制调研笔记

核验日期：2026-09-28。文档钉在 code.claude.com 2026-09-28 快照（含 v2.1.198 / v2.1.211 / v2.1.217 / v2.1.224 / v2.1.232 / v2.1.280 / v2.1.281 版本标记）；CHANGELOG 钉死 commit `2923bc87`；issue 引用为原文快照。钉住的原因：文档随版本改写频繁，不钉版本结论几周后无法复核。

- 方法约束：只用公开网络资源（官方文档 + `anthropics/claude-code` 公开 issue + CHANGELOG），未读任何本地仓库代码。Claude Code 本体闭源，无官方公开源码可引；凡引用第三方复刻/实测均已单独标注，不得作为结论支撑。
- 范围：只记录 Claude Code（CLI 内 `Agent`/`TaskOutput`/`TaskStop` + Bash `run_in_background`）机制；不涉及 Codex/Gemini，不评价优劣，不涉及价格模型。

---

## 结论

1. 后台是默认：`Agent` 调用省略 `run_in_background` 即进后台（v2.1.198 起），`false` 才进前台；fork mode 开时该参数直接从 schema 移除。见[官方 SDK 文档](https://code.claude.com/docs/en/agent-sdk/subagents)。
2. 取结果工具 `TaskOutput` 已在 v2.1.83 废弃，替代是对后台任务输出文件路径用 `Read`；且 agent 类任务只取 `Agent` 返回摘要，勿 `Read` 全量 `.output`（实测 21 倍上下文差距）。见[官方 CHANGELOG](https://github.com/anthropics/claude-code/blob/2923bc87/CHANGELOG.md)。
3. 完成后靠 harness 下发的 completion notification 在后续 turn 注入对话（自动化事件，非用户消息），官方明示勿用 `sleep` 轮询。见[官方 sub-agents 文档](https://code.claude.com/docs/en/sub-agents)。
4. 并发上限可量化：单会话同时运行默认 20（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`，超限 `Concurrent subagent limit reached` 且不重试），会话总量不限（200 总量帽已在 v2.1.224 删除）。见[官方 sub-agents 文档](https://code.claude.com/docs/en/sub-agents)。
5. 进程结束后台不存活：resume 后只留“没跑完”注记，不继续不重跑；subagent transcript 独立存 `agent-{agentId}.jsonl`（默认保留 30 天），resume 同 session 可续跑。见[官方 sessions 文档](https://code.claude.com/docs/en/sessions)。

---

## 1. 后台启动：参数名、类型、默认值

### 1.1 `Agent` 工具的 `run_in_background`（boolean，默认后台）

主张：CLI 中 `Agent` 工具用 `run_in_background: boolean` 控制前/后台；**v2.1.198 起省略该字段即进后台**（后台是默认），显式 `run_in_background: false` 才进前台；fork mode 开启时该参数直接从 schema 移除。

引证 A（官方文档 `sub-agents`）：https://code.claude.com/docs/en/sub-agents （含 `As of v2.1.198` 版本标记）

> Where fork mode is off, Claude runs the subagent in the background by default and in the foreground when it needs the result before continuing.

> Where fork mode is on, as it is by default in an interactive session, Claude Code runs the subagent in the background, forks and non-fork subagents alike, and Claude can't ask for the foreground.

引证 B（官方文档 `agent-sdk/subagents`，同一行为的 SDK 侧表述）：[agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents)

> Subagents run in the background by default. An Agent tool call that omits the `run_in_background` input launches a background subagent, and Claude sets `run_in_background: false` when it needs the result before continuing. Before v2.1.198, omitting `run_in_background` ran the subagent synchronously.

引证 C（fork mode 移除参数，官方文档 `sub-agents`）：

> When `CLAUDE_CODE_FORK_SUBAGENT` is set to `1`, every subagent runs in the background and the frontmatter `background` field has no effect, because fork mode removes the `run_in_background` parameter from the `Agent` tool.

引证 D（第三方实测 `claude-code-from-source` Ch.8，记述 schema 裁剪逻辑，仅作线索，不支撑结论）：https://claude-code-from-source.com/ch08-sub-agents/

```js
// 1: (() => {
// 2:   let schema = /* Agent tool input schema */;
// 3:   if (/* KAIROS flag off */) schema = schema.omit({ cwd: true });
// 4:   if (/* background disabled */ || forkMode) schema = schema.omit({ run_in_background: true });
// 5:   return schema;
// 6: })()
// 7: // 解读：forkMode 或 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS 下模型根本看不到该字段
```

### 1.2 定义侧强制后台：`background: true`（boolean frontmatter / AgentDefinition）

主张：subagent 定义（文件 frontmatter 或 SDK `AgentDefinition`）中的 `background: boolean` 可把该类型钉死在后台，即使 Claude 要求前台也一样（fork mode 下本来就全后台，此字段无效果）。

引证（官方文档 `sub-agents`，frontmatter 表）：https://code.claude.com/docs/en/sub-agents

> `background` | No | Set to `true` to keep this subagent in the background even when Claude asks to run it in the foreground. Where fork mode is on, Claude Code already runs the subagents Claude spawns in the background

引证（SDK 侧字段表）：https://code.claude.com/docs/en/agent-sdk/subagents

> | `background` | `boolean` | No | Run this agent as a non-blocking background task when invoked |

### 1.3 `Agent` 调用的其它已知输入字段（字段名级）

主张：除 `run_in_background` 外，公开资料中出现的 `Agent` 调用字段还有 `description`（3–5 词）、`prompt`、`subagent_type`、`model`（per-invocation override）、`name`（命名/可寻址）、`resume`（按 agent ID 续跑）。其中 `description/prompt/subagent_type/model/name` 有官方文档支撑，`resume` 仅见第三方 schema 整理。

引证（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> Claude can give a subagent a name by passing a `name` parameter on the Agent tool call, and may do so on its own, without asking you first. The name makes the subagent addressable: Claude can message or resume it by name after it finishes.

> When Claude invokes a subagent, it can also pass a `model` parameter for that specific invocation.

> An Agent tool call that omits `subagent_type` fails with `subagent_type is required` when the session has no `general-purpose` subagent to fall back on.

引证（官方 `errors` 错误参考，`subagent_type` 省略语义）：https://code.claude.com/docs/en/errors

```text
1: subagent_type is required: the general-purpose agent is not available in this session
```

### 1.4 总开关与 fork 开关（环境变量）

主张：`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` 关闭全部后台能力（含 `Agent`/`Bash` 的 `run_in_background`、auto-backgrounding、Ctrl+B），且优先级高于 fork mode；`CLAUDE_CODE_FORK_SUBAGENT=1/0` 强制开/关 fork mode（交互式默认开）。

引证（官方 `env-vars`）：https://code.claude.com/docs/en/env-vars

> `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Set to `1` to disable all background task functionality, including the `run_in_background` parameter on Bash and subagent tools, auto-backgrounding, and the Ctrl+B shortcut

> `CLAUDE_CODE_FORK_SUBAGENT` | Controls fork mode, which lets Claude spawn forked subagents itself and is on by default in interactive sessions only. Set to `1` to turn it on in `claude -p` and the Agent SDK as well, or `0` to turn it off in every kind of session.

引证（fork mode 默认开的版本标记，官方 `whats-new/2026-w33`）：https://code.claude.com/docs/en/whats-new/2026-w33

> fork mode turns on by default

---

## 2. 启动后立即返回什么（id 字段名）

### 2.1 完成时返回 `agentId` 文本块（官方确认）

主张：subagent 完成时，`Agent` 工具结果中带一段含 `agentId: ` 的文本块，Claude 靠它后续 resume / `SendMessage` 定址；`Explore`/`Plan` 内置 agent 是一次性的，不返回 agent ID。

引证 A（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> When a subagent completes, Claude receives its agent ID.

> The built-in Explore and Plan agents are one-shot and return no agent ID, so Claude can't resume them. Use `general-purpose` or a custom subagent when you need to continue the work.

引证 B（官方 `agent-sdk/subagents`，含提取 `agentId` 的示例代码）：https://code.claude.com/docs/en/agent-sdk/subagents

> When a subagent completes, the Agent tool result includes a text block containing `agentId: `.

```python
1: def extract_agent_id(block: ToolResultBlock) -> str | None:
2:     """Extract agentId from an Agent tool result's text content."""
3:     parts = block.content if isinstance(block.content, list) else [{"text": block.content}]
4:     for part in parts:
5:         if match := re.search(r"agentId:\s*([\w-]+)", part.get("text") or ""):
6:             return match.group(1)
7:     return None
```

### 2.2 后台任务输出文件路径（用户 issue 实测 + 官方废弃指引旁证）

主张：后台任务（bash 与 agent）在返回/通知里携带输出文件路径，形如 `/tmp/claude-<uid>/.../tasks/<task_id>.output`；`TaskStop` 也接受 agent ID 或 name 定址，旁证后台启动产物就是可定址的 ID。

引证（`anthropics/claude-code` issue #44703，2026-04-07，v2.1.92，用户复现步骤与错误日志；issue 本体是公开原始出处，但步骤细节是用户观察，见「待验证」说明）：https://github.com/anthropics/claude-code/issues/44703

> 2. Launch a sub-agent using the Agent tool with run_in_background: true.
> 3. When task_notification fires, observe the main agent immediately calling Read on the path /tmp/claude-1000/.../tasks/<task_id>.output.

```shell
1: tool_call Read | input: {'file_path': '/tmp/claude-1000/.../tasks/aa8bd3ced112e5ae5.output'}
2: tool_result Read | ok | output: {"parentUuid":null,"isSidechain":true,"promptId":"747dfb10...",
3:  "type":"user","message":{"role":"user","content":"In the repo at ... <- 87,286 chars
```

引证（官方 `tools-reference`，`TaskStop` 定址方式）：https://code.claude.com/docs/en/tools-reference

> `TaskStop` | Stops a running background task by ID. It also accepts an agent-team teammate or a named background agent by agent ID or name.

---

## 3. 取结果用什么工具（TaskOutput 参数、废弃与替代）

### 3.1 `TaskOutput` 已在 v2.1.83 废弃，替代是 `Read` 输出文件路径

主张：`TaskOutput`（取后台任务输出）在 **v2.1.83** 被官方废弃，替代方案是对任务输出文件路径直接用 `Read`；`TaskOutput` 找不到 ID 时的错误会列出正在运行的后台 agent（ID + description）。

引证 A（官方 CHANGELOG，`## 2.1.83` 节内条目）：[CHANGELOG.md @ 2923bc87](https://github.com/anthropics/claude-code/blob/2923bc87/CHANGELOG.md)

```text
1: ## 2.1.83
2: ...（该节内）
3: - Deprecated `TaskOutput` tool in favor of using `Read` on the background task's output file path
```

引证 B（官方 `tools-reference` 现状行）：https://code.claude.com/docs/en/tools-reference

> `TaskOutput` | Retrieves output from a background task. Deprecated in favor of `Read` on the task's output file path. When no task matches the ID, the error lists the running background agents by ID and description. Before v2.1.203, the error named only the missing ID

引证 C（产品内实际下发的废弃提示原文，被 issue #44703 逐字引用）：https://github.com/anthropics/claude-code/issues/44703

> DEPRECATED: Prefer using the Read tool on the task's output file path instead. Background tasks return their output file path in the tool result, and you receive a with the same path when the task completes — Read that file directly.

### 3.2 `TaskOutput` 旧参数（仅第三方出处，不支撑结论，见待验证 T1）

第三方整理的旧 schema：`{ task_id: string; block: boolean(default true); timeout: number(ms, default 30000, max 600000) }`，`block=false` 非阻塞查状态（`not_ready`），`block=true` 等待完成（超时返回 `timeout`）。出处：`jedarden/CLASP` 的 `claude-code-2.1.34-tool-analysis.md` 与 `LING71671/Open-ClaudeCode` 的 `TaskOutputTool.tsx` 复刻实现，均为非官方仓库。

### 3.3 agent 类任务不要 `Read` 全量 `.output`（官方 issue 内的有效行为区分）

主张：对 `local_agent` 任务，`Agent` 工具返回的已是摘要结果（实测约 4KB），而 `.output` 文件是全量子 agent 对话 JSON（实测约 87KB、21 倍），`Read` 全量会撑爆上下文；对 `local_bash` 任务 `.output` 才是 stdout/stderr，`Read` 合适。

引证（issue #44703 正文与日志）：https://github.com/anthropics/claude-code/issues/44703

> For local_agent tasks, however, the .output file contains the full raw conversation history JSON of the sub-agent, which can be 80K+ characters.

> The Agent tool already returns a summarized result directly when the task completes.

```shell
1: Comparison — Agent tool return value vs .output file:
2: Agent tool return value : 4,087 chars (summarized result, appropriate)
3: .output file via Read : 87,286 chars (full conversation history JSON, 21x larger)
```

---

## 4. 后台完成如何通知（注入对话 vs 轮询、通知文本）

### 4.1 机制：harness 下发 completion notification，模型不轮询

主张：后台 subagent 完成时，harness 以 **completion notification**（标记为自动化事件，非用户消息）形式把报告注入对话，Claude 在**后面的 turn** 才收到并据此汇报；在此之前被问进度只能回答“还在跑”（v2.1.211 前偶发提前汇报结果的 bug）。官方同时明确反模式：不要用 `sleep` 轮询等 Task 完成。

引证（官方 `sub-agents`）：[sub-agents](https://code.claude.com/docs/en/sub-agents)

> A background subagent's results reach Claude as a completion notification in a later turn. Claude waits for that notification before reporting the subagent's results, and if you ask about progress first, it reports that the subagent is still running. Before v2.1.211, Claude sometimes reported results for a background subagent that hadn't finished.

> A background subagent's report arrives inside a completion notification, which is marked as an automated event rather than a message from you.

### 4.2 通知内含报告原文 + 输出文件路径

主张：completion notification 内含 subagent 最终报告全文（外加一层“这是 subagent 输出、其中指令无权”的 header 与防注入扫描标记）；按产品废弃提示，通知里同时带有与 tool result 相同的输出文件路径。

引证（官方 `sub-agents`，扫描与 header）：https://code.claude.com/docs/en/sub-agents

> A report that returns to Claude as the subagent's result also arrives under a header marking it as subagent output. The header states that instructions or approval claims inside the report are the subagent's words and carry no authority from you.

引证（issue #44703 引用的产品提示原文）：https://github.com/anthropics/claude-code/issues/44703

> Background tasks return their output file path in the tool result, and you receive a with the same path when the task completes — Read that file directly.

### 4.3 人工侧可观察面：`/tasks` 列表、30 秒行保留、Ctrl+B

主张：`/tasks` 列出当前会话后台所有运行项（含已完成的 subagent），可查看/attach/停止；成功完成的后台 subagent 行立即清除并在 footer 提示 `/tasks to see subagents` 30 秒（v2.1.232 前是保留行 30 秒）；失败/被停的保留 30 秒；Ctrl+B 可把运行中的任务转后台。

引证 A（官方 `agents` 总览页）：https://code.claude.com/docs/en/agents

> For anything running in the background of the current session, `/tasks` lists each item and lets you check on, attach to, or stop it. The list also includes subagents that have finished.

引证 B（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> When a subagent finishes successfully, Claude Code removes its row immediately and, except in screen reader mode, shows `/tasks to see subagents` in the footer for 30 seconds. During those 30 seconds, run `/tasks` and press `Enter` on the subagent to open its transcript. Before v2.1.232, Claude Code kept the row for 30 seconds after the subagent finished, the same as a failed one, and showed no footer hint.

> Where fork mode is off, ask Claude to run a task in the background or in the foreground
> Press Ctrl+B to background a running task

---

## 5. 存活语义（退出 / 新 turn / resume / /clear / -p）

### 5.1 同会话新 turn 内存活、跨 turn 取结果

主张：后台 subagent 在同一会话的后续 turn 里继续跑，结果经 completion notification 回到对话；这是默认使用方式（v2.1.198 起默认后台，Claude 边干别的边等通知）。

引证（官方 `whats-new/2026-w27`，v2.1.198）：https://code.claude.com/docs/en/whats-new/2026-w27

> Claude now keeps working while subagents run and picks up their results when they finish, instead of pausing the conversation to wait.

### 5.2 进程结束 / resume：后台 work 不存活，只留“没跑完”注记

主张：前一个进程结束时还没跑完的后台 subagent / 后台 Bash / workflow，在 resume 后的 transcript 里只显示为一条“没完成”的注记，**不会继续跑也不会重跑**；`Background Bash and monitor tasks aren't` 被恢复；运行中被打断的 tool call 标记为 cut off，Claude 被告知先确认是否生效再重跑。

引证（官方 `sessions`）：[sessions](https://code.claude.com/docs/en/sessions)

> Scheduled tasks: tasks that haven't expired are restored. Background Bash and monitor tasks aren't.

> Background work: a background subagent, background Bash command, or workflow that ended with the previous process shows up in the resumed transcript as a note that it didn't finish. Claude Code doesn't start a turn from those notes; Claude reads them with your next prompt.

> A tool that was still running when the previous process ended, for example in a crash, doesn't finish or run again when you resume. Claude sees the call marked as cut off before its result was recorded and is told to check whether it took effect before running it again

### 5.3 subagent transcript 独立持久化、可随 session resume 后再续跑

主张：subagent transcript 存独立文件（`~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`），主对话 compact 不影响它；resume 同一 session 后可再 resume 该 subagent（保留完整历史）；默认保留 30 天（`cleanupPeriodDays`）。

引证（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> You can also ask Claude for the agent ID if you want to reference it explicitly, or find IDs in the transcript files at `~/.claude/projects/{project}/{sessionId}/subagents/`. Each transcript is stored as `agent-{agentId}.jsonl`.

> Session persistence: subagent transcripts persist within their session. You can resume a subagent after restarting Claude Code by resuming the same session.

> Automatic cleanup: Claude Code deletes subagent transcripts after the `cleanupPeriodDays` retention period, 30 days by default, following the retention sweep rules.

### 5.4 -p 非交互模式：后台命令随 run 结束而结束

主张：`claude -p` 下后台命令在 run 的最终结果出来后不久即结束；且 -p 下 fork mode 默认关。

引证 A（官方 `tools-reference`，Bash 后台命令）：https://code.claude.com/docs/en/tools-reference

> A command that a foreground subagent started stops when that subagent gives its final response. A command that the main conversation or a background subagent started keeps running after a final response. In non-interactive mode with the `-p` flag, background commands end shortly after the run's final result.

引证 B（官方 `sub-agents`，-p 下 fork mode 默认关）：https://code.claude.com/docs/en/sub-agents

> Claude Code turns fork mode on by default in interactive sessions and leaves it off by default in non-interactive mode with `-p` and in the Agent SDK.

---

## 6. 并发上限（可量化）

### 6.1 同时运行上限：默认 20（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`）

主张：单会话同时运行超 20 个 subagent 时，`Agent` 新 spawn 以 `Concurrent subagent limit reached` 失败且被告知不要重试；掉回 20 以下恢复；可用 `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` 改（正整数，只可调不可关）；ultracode 会话豁免；`/subtask` 开的 in-session fork 占槽位但不受限；resume 已完成的 subagent 不检查上限可超限。版本要求 v2.1.217+。会话总 spawn 数不限。

引证 A（官方 `sub-agents`）：[sub-agents](https://code.claude.com/docs/en/sub-agents)

> By default, when 20 subagents are running in a session, spawning another with the Agent tool fails with `Concurrent subagent limit reached`, and the error tells Claude not to retry. Spawning succeeds again when the running count drops below the limit.

> There's no limit on the total number of subagents Claude can spawn over a session.

> An in-session fork you start with `/subtask` takes a slot while it runs and is never blocked by the limit.

> Resuming a subagent that already finished takes a fresh slot without checking the limit, so resumes can push the running count past it.

引证 B（官方 `env-vars`）：https://code.claude.com/docs/en/env-vars

> `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | How many subagents can be running in one session before the Agent tool refuses to spawn another (default: 20). Accepts a positive whole number in plain digits; anything else is ignored, so the variable can adjust the cap but can't disable it. Requires Claude Code v2.1.217 or later

### 6.2 历史：会话总量上限 200 已在 v2.1.224 移除

主张：`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`（默认总量 200，超限 `Subagent spawn limit reached`）已在 v2.1.224 删除，现为 no-op。

引证（官方 `env-vars`）：https://code.claude.com/docs/en/env-vars

> `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | Removed in v2.1.224 and now a no-op. Previously capped the total number of subagents Claude could spawn with the Agent tool in one session (default: 200); spawning past the cap failed with `Subagent spawn limit reached`. The concurrent subagent limit and the depth limit still apply

---

## 7. 后台任务能否再派生子任务（嵌套）

### 7.1 CLI：默认允许嵌套 3 层（`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`）

主张：subagent 默认可再 spawn 自己的 subagent，主对话之下最多 3 层；到深度上限时 `Agent` 工具被扣留（fork 例外但调用报错）；`1` 表示关闭嵌套；v2.1.172–216 默认 5 层不可调，v2.1.217–218 默认 1，v2.1.219 起默认 3。交互式下后台 subagent 等自己的后台子任务完成后才 finish，中间输出不出主对话。

引证 A（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> By default, a subagent can spawn subagents of its own, up to three layers below the main conversation. At the depth limit, Claude Code withholds the `Agent` tool from every subagent except a fork, so a subagent at the limit does its delegated work itself and returns one summary.

> a subagent that launches background subagents waits for their results before it finishes.

> To change the limit, set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` to the number of subagent layers you want below your main conversation.

> v2.1.172 through v2.1.216: subagents could nest by default, up to five layers deep, and the limit couldn't be changed.
> v2.1.217 through v2.1.218: the limit defaulted to one, so a subagent couldn't spawn its own unless you raised it; v2.1.219 raised the default to three.

引证 B（`TaskStop` 报错文案旁证“别人的 agent 生的后台 agent”存在且主对话可停）：https://code.claude.com/docs/en/tools-reference

> When no task matches the ID, the error lists the running background agents by ID and description, including agents that another agent spawned. Before v2.1.203, the error listed running teammates and named agents but not background agents another agent spawned, so those couldn't be identified or stopped from the main conversation

### 7.2 例外：SDK 内 subagent 不可嵌套；agent team 队友生的 subagent 强制前台；fork 不可再生 fork

主张三条限制（均官方）：(a) Agent SDK 中 subagent 不能再生 subagent（`tools` 里别放 `Agent`）；(b) in-process agent-team 队友 spawn 的 subagent 跑前台，且其定义 `background: true` 或传 `run_in_background: true` 会直接报错拒绝；(c) fork 不能再生 fork。

引证 A（官方 `agent-sdk/subagents`）：https://code.claude.com/docs/en/agent-sdk/subagents

> Subagents cannot spawn their own subagents. Don't include `Agent` in a subagent's `tools` array.

引证 B（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> If an in-process agent team teammate spawned the subagent, Claude Code runs it in the foreground. Claude Code refuses with an error to spawn a teammate's subagent whose definition sets `background: true`. Where fork mode is off and you haven't turned background tasks off, Claude Code also refuses with an error when a teammate sets `run_in_background: true`.

> A fork can't spawn further forks.

---

## 8. 后台 subagent 的其它成立条件（工具集缩水、权限提示）

主张：后台 subagent 只保留精简内置工具集（`Read/Grep/Glob/LSP/Bash/PowerShell/Edit/Write/NotebookEdit/WebFetch/WebSearch/TodoWrite/Skill/ToolSearch/EnterWorktree/ExitWorktree/Monitor/TaskStop/SendMessage/Artifact` + `SubagentHandback`，MCP 工具全保留），其余即使在 `tools` 里列了也被静默移除（仅当移除到空才报错）；后台 subagent 的权限 prompt 会 surface 到主会话并具名，Esc 只拒绝单次调用。

引证（官方 `sub-agents`）：https://code.claude.com/docs/en/sub-agents

> Apart from `Agent` and `ExitPlanMode`, which follow the first filter's conditions wherever the subagent runs, a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `LSP`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, and `Artifact`, plus `SubagentHandback` for a subagent that reports through it.

> Background subagents surface every permission prompt in your main session. When you answer one of those prompts with a choice that lasts beyond that one tool call, such as a grant that lasts for the rest of the session, Claude Code applies your answer to the whole session, including your main conversation.

---

## 9. 待验证（缺原始出处，不可作结论）

- **T1 — `TaskOutput` 旧参数全集**：`task_id: string` / `block: boolean = true` / `timeout: ms = 30000, max 600000`、`block=false → not_ready`、`block=true` 超时 → `timeout`，仅见第三方（`jedarden/CLASP` v2.1.34 分析文档、`LING71671/Open-ClaudeCode` 复刻实现）。缺：官方 schema 或官方 issue/maintainer 回复。注：该工具 v2.1.83 已废弃，实务价值低。
- **T2 — 后台 `Agent` 调用“立即返回”的 tool_result 精确结构**：官方只确认“完成时给 agent ID”“通知里带输出文件路径”，未给出后台启动瞬间返回体的字段表（是一次返回 ID + 路径，还是先 ID 后通知补路径）。缺：官方 tool input/output reference 或可复现抓包。
- **T3 — 完成通知的事件名/原文**：`task_notification` 一词仅出现在 issue #44703 用户复现步骤（“When task_notification fires”）中，是用户对系统行为的命名，非官方文档用语；通知正文逐字文本无官方出处。缺：官方 hooks/事件文档对该通知的命名与 payload 说明（`SubagentStop` hook 存在，但那是 hook 事件，不是注入对话的通知）。
- **T4 — `/clear` 对后台 subagent 的影响**：官方只说明了进程结束/resume（不存活、留注记）与 transcript 独立持久化，未说明同进程内 `/clear` 是否杀死后台 subagent。缺：官方文档或 maintainer 回复。线索：`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` 条目提到“若 clear 后仍有能 spawn subagent 的 work 存活则计数 carry over”，暗示至少部分后台 work 可穿越 `/clear`，但未点名 subagent。
- **T5 — `Agent` 调用 `resume` 字段**：仅见第三方 schema 整理（sankalp 博客 2.0 时代 JSON schema），官方文档的 resume 路径写的是 `SendMessage(to=agent ID/name)`，两者是否并存未知。缺：官方出处。
- **T6 — 后台启动返回中的“任务 ID vs agent ID”是否为同一 ID 空间**：`TaskOutput(task_id)`、`TaskStop(task ID/agent ID/name)`、`transcript agent-{agentId}.jsonl`、`Connectors/后台输出 tasks/<task_id>.output` 多处 ID 称谓并存，官方未明确映射关系。缺：官方说明。

---

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `code.claude.com/docs`（sub-agents、agent-sdk/subagents、tools-reference、env-vars、sessions、agents、errors，2026-09-28 快照）+ CHANGELOG（钉死 `2923bc87`）；本体闭源，无公开源码 |
| 作者或维护者本人的说法 | 未找到个人博客/RFC/issue 回复；Anthropic 官方文档与 CHANGELOG 本身即维护者口径，见结论 1–5 引证 |
| 同类方案 | 不适用（本笔记是三份对比中的 Claude 一方；Codex/Grok 见同目录另两份笔记） |
| issue / PR / 社区实践 | `anthropics/claude-code` issue #44703（用户复现 + 产品提示原文旁证输出文件路径）；第三方复刻仅作线索，未支撑结论 |
| 历史演变 | 查到了：`run_in_background` 默认值翻转（v2.1.198）、`TaskOutput` 废弃（v2.1.83）、200 总量帽删除（v2.1.224）、并发上限引入（v2.1.217）、嵌套深度默认值变迁（v2.1.172→219） |

## 对本项目的影响

- 参数命名跟随 `run_in_background: boolean`（结论 1），而不是各家旧名 `background`；Grok 也已把 `background` 改名为 `run_in_background`，三家中两家收敛。
- 通知走“后续 turn 注入完成事件”（结论 3），对应本项目 extension `beforeModelCall` hook 的 transient reminder；不要做 sleep 轮询的官方反模式提示值得写进工具描述。
- 存活语义（结论 5）支持“后台绑定 session、进程结束不恢复”：本项目 detached child 绑定 parent run signal、随 abort/close 取消，方向一致。
- 并发上限本项目取 4（与前台共用）即可，不跟 20；`GetAgentResult` 保留轮询取结果能力（Codex/Grok 侧的刚需），但主路径是通知 + 取结果。
