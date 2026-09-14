# Coding agent 工具循环的停止条件与搜索收敛：成熟方案对比

核验日期：2026-09-12。范围只覆盖 Claude Code、OpenAI Agents/Responses、Pi、OpenCode 与 Gemini CLI 的官方文档、源码、维护者说法、issue/PR 和历史记录；不分析 jai-mono 内部实现、不研究 UI。Claude Code、OpenAI Agents 文档按访问日期固定；Pi 主要源码固定在 `badlogic/pi-mono@71dca871bc80b6bc97be37f0ca3189399d651fff`，agent-loop README 使用 `dd6bea41`；OpenCode 的 step-limit 修复固定在 `4f1a9d7aef56163d8fe265f7f9cbe295cc1df95a`；Gemini loop detector 固定在 `9c1b0a610534d6f8120964cf2672c07807d8fc90`。固定版本是为了避免后续 loop、工具契约和停止语义混入本次判断。

## 结论

1. **工具结果回来后，默认动作是继续一次模型请求；“结果足够了”必须由显式 final-output、tool-result policy、post-turn hook 或预算/步数状态决定。** OpenAI Agents 的公开 loop 顺序最明确：final output 结束，handoff 或 tool call 都继续；Pi 把“当前 turn 正常完成后是否再请求模型”单独做成 `shouldStopAfterTurn`。[OpenAI Runner loop](https://openai.github.io/openai-agents-python/running_agents/) · [Pi post-turn stop](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/README.md)
2. **最大步数只有在请求边界真正撤掉工具时才是硬停止；只给模型一段“请停止”的文字仍是软停止。** OpenCode 的历史 issue 记录了最后一步仍把完整工具表传给 provider 的缺陷，后续合并修复明确要求最终 turn text-only、没有 advertised/executable tools。[OpenCode issue #24505](https://github.com/anomalyco/opencode/issues/24505) · [OpenCode PR #33142](https://github.com/anomalyco/opencode/pull/33142)
3. **截断、摘要和 compaction 解决的是上下文成本，不是重复搜索判定。** Pi 会在工具结果追加后、下一次 assistant response 前 compaction，并把送给 summarizer 的 tool result 截到 2,000 字符；OpenCode 默认把工具输出限制在 2,000 行或 50 KiB，并把全文落盘。两者都没有把“已覆盖哪些目录/查询”自动变成 no-progress 判定。[Pi compaction](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md) · [OpenCode tool truncation](https://github.com/anomalyco/opencode/blob/46f243fe/packages/opencode/src/tool/truncate.ts)
4. **完全相同的工具调用可以用低成本指纹拦截，但它不是近似搜索的完整答案。** Gemini CLI 当前 detector 用工具名和 JSON 参数生成 key，连续 5 次相同调用才报告 loop；OpenCode 的 doom-loop 也以 3 次相同 tool+input 为边界并走 permission ask。参数顺序、路径规范化、换工具表达同一搜索、跨消息边界都可能绕过 exact detector。[Gemini loop detector](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts) · [OpenCode doom-loop PR](https://github.com/anomalyco/opencode/pull/3445)
5. **搜索工具必须携带有界 contract：working directory、输入范围、结果上限和截断状态，而不是把 `find`/`ls`/`rg` 的原始 stdout 当成唯一状态。** Claude Agent SDK 明确暴露 `cwd`、`add_dirs` 和 `max_turns`；OpenAI Sandbox 的 `cwd` 只改变内置工具的相对路径解析，不等于安全边界；Pi 将 `find` 与 `grep` 分开并给出不同结果上限。[Claude SDK options](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python) · [OpenAI Sandbox cwd](https://openai.github.io/openai-agents-python/ref/run_config/) · [Pi find/grep contract](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/find.ts)
6. **停止必须留下机器可读原因，否则上层会把“达到预算”“工具被拒绝”“模型完成”“被中断”混成同一种结束。** Claude SDK 返回 `terminal_reason` 和 `error_max_turns`；OpenAI Agents 超过 `max_turns` 抛出 `MaxTurnsExceeded`，并允许用 error handler 生成受控输出；Pi 的正常 post-turn stop 通过 `agent_end` 结束，而不是伪造工具错误。[Claude terminal reason](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python) · [OpenAI max turns](https://openai.github.io/openai-agents-python/running_agents/) · [Pi agent_end](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/src/agent-loop.ts)
7. **working directory 是运行时事实，不应依赖模型反复 `pwd` 或从当前目录向上猜 sibling 项目。** Claude 的 `cwd` 是 session 选项，`add_dirs` 是额外可访问目录；OpenAI Sandbox 要求相对 workspace root 的 `cwd`，且明确“不限制访问”；Pi 通过 `createAgentSession({ cwd })` 为该 cwd 构造内置工具。[Claude `cwd`/`add_dirs`](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python) · [OpenAI cwd semantics](https://openai.github.io/openai-agents-python/sandbox/guide/) · [Pi custom cwd](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/sdk.md)
8. **成熟方案的公开证据并不支持“默认都已有语义级重复搜索 detector”。** Gemini 和 OpenCode 明确公开了 exact detector；Pi 暴露停止 seam 但没有默认重复指纹策略；Claude Code 与 OpenAI Agents 的公开文档/源码核验到的是预算、tool-choice 和停止 API，没有找到针对 `ls → find → rg --files` 这类跨工具等价调用的内建 detector。因此不能把专用搜索工具、compaction 或更强 prompt 当成重复调用保护。[Pi stop seam](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/README.md) · [OpenAI tool-choice reset](https://github.com/openai/openai-agents-python/blob/7029ea8f/src/agents/run_internal/tool_execution.py)

## 工具调用循环：从结果到下一步

### OpenAI Agents：循环结构公开，停止点可配置

OpenAI Agents 的官方文档把 runner 写成一个明确的状态机：模型输出 final output 就返回；handoff 更新当前 agent 后再跑；tool calls 执行、追加结果后再跑；超过 `max_turns` 抛错。[OpenAI Agents Running agents](https://openai.github.io/openai-agents-python/running_agents/)

> 1. If the runner classifies the LLM's output as final output, the loop ends and we return the result.
>
> 2. If the LLM requests a handoff, we update the current agent and input, and re-run the loop.
>
> 3. If the LLM produces tool calls, we run those tool calls, append the results, and re-run the loop.
>
> 3. If we exceed the `max_turns` passed, we raise a `MaxTurnsExceeded` exception. Pass `max_turns=None` to disable this turn limit.

它还定义了“final output”不是“有任何文本就结束”，而是有目标类型的文本且没有 tool calls。这对搜索收敛很关键：一个工具结果只是下一次判断的输入，不是自动终点。

> The rule for whether the LLM output is considered as a "final output" is that it produces text output with the desired type, and there are no tool calls.

OpenAI Agents 同时有 `tool_use_behavior`：默认 `run_llm_again`，也可把首个工具结果作为 final output，或由 `ToolsToFinalOutputFunction` 决定继续/停止。[Agent tool-use behavior](https://openai.github.io/openai-agents-python/ref/agent/)

> `"run_llm_again": The default. Tools are run, and then the LLM receives the results and gets to respond.`
>
> `"stop_on_first_tool": The output from the first tool call is treated as the final result.`
>
> `A function: ... determines whether the tool calls result in a final output.`

**不成立条件：** `tool_use_behavior` 的自定义 final-output function 只适用于 FunctionTools；官方文档明确 hosted tools（包括 file search、web search）仍由 LLM 处理。因此不能用一个全局“首个搜索结果即终点”规则覆盖所有工具。

> NOTE: This configuration is specific to FunctionTools. Hosted tools, such as file search, web search, etc. are always processed by the LLM.

### OpenAI Responses API：循环责任在调用方

直接使用 Responses API 时，工具调用不是“API 自动完成”的结束事件。官方 function-calling guide 要求调用方保存模型输出、执行函数、将 `function_call_output` 连同 `call_id` 发起下一次 request；下一次 response 仍可能继续要求工具。[OpenAI function calling guide](https://platform.openai.com/docs/guides/function-calling)

> Tool calling is a multi-step conversation between your application and a model via the OpenAI API.
>
> 1. Make a request to the model with tools it could call
>
> 2. Receive a tool call from the model
>
> 3. Execute code on the application side with input from the tool call
>
> 4. Make a second request to the model with the tool output
>
> 5. Receive a final response from the model (or more tool calls)
>
> With Responses, your application can continue this flow for as many tool calls as the task requires.

**不成立条件：** `previousResponseId` 只是下一轮 server-managed continuation，不是 SSE 断点重放 cursor；若调用方没有保存工具执行状态，重启后可能再次执行有副作用的工具。已有 OpenAI Agents SDK changelog 也记录过“避免已确认工具结果在 resume 时重放”的修复。[Agents SDK changelog](https://github.com/openai/openai-agents-js/blob/064fcb20c40706feb4a4ffec4249490e5bc3e9b3/packages/agents-core/CHANGELOG.md)

> `f064c56: fix: prevent acknowledged tool results from replaying on resume (#1435)`
>
> `a081190: fix: #1190 reconcile streamed function calls when server-managed runs abort`

### Pi：工具批次、post-turn stop 与 graceful termination 分开

Pi 的低层 agent loop 提供两种停止语义：工具结果可以返回 `terminate: true`，避免自动 follow-up；宿主也可以在当前 turn 完成后用 `shouldStopAfterTurn` 退出。[Pi agent README](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/README.md)

> Tools can also return `terminate: true` to hint that the automatic follow-up LLM call should be skipped. The loop only stops early when every finalized tool result in that batch sets `terminate: true`. Mixed batches continue normally.
>
> `shouldStopAfterTurn` runs after `turn_end` is emitted and after the assistant response and any tool executions have completed normally. If it returns `true`, the loop emits `agent_end` and exits ... before starting another LLM call.

Pi 的源码把这个顺序固定为：工具结果先追加，发出 `turn_end`，再调用 `shouldStopAfterTurn`；只有它返回 true 才发 `agent_end` 并退出。[Pi agent-loop source](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/src/agent-loop.ts)

```typescript
for (const result of toolResults) {
  currentContext.messages.push(result);
  newMessages.push(result);
}

await emit({ type: "turn_end", message, toolResults });

if (await config.shouldStopAfterTurn?.({ message, toolResults, context: currentContext, newMessages })) {
  await emit({ type: "agent_end", messages: newMessages });
  return;
}
```

**不成立条件：** `shouldStopAfterTurn` 不会取消正在运行的 provider stream 或 tool，也不能撤销本批次已经执行的并行重复调用；`terminate` 只在批次内所有 finalized results 都为 true 时生效。Pi 的 maintainer 讨论明确把它定位为“当前 turn 完成后退出”，不是 hard abort。[Pi PR #3197](https://github.com/badlogic/pi-mono/pull/3197)

> It runs only after the current turn has fully completed:
>
> - assistant response finished normally
> - any requested tools finished normally
> - tool results were appended
> - `turn_end` was emitted
>
> It does not abort the provider stream ... [or] cancel running tools.

## 搜索 / shell 工具 contract 与 working directory

下表只比较工具边界，不把它们误读成重复检测器：

| 方案 | working directory 传递 | 搜索 / shell contract | 结果边界 | 停止边界 |
|---|---|---|---|---|
| Claude Agent SDK | `cwd`；`add_dirs` 作为额外访问目录 | SDK 选项把运行目录传给 Claude Code；工具 schema 之外的 shell 语义不在该页完整公开 | `max_buffer_size`、自动 compact 等另有选项；本次没有找到通用 search ledger | `max_turns`、`max_budget_usd`，结束时带 `terminal_reason` |
| OpenAI Agents Sandbox | `SandboxRunConfig.cwd`，必须是 workspace-relative | `exec_command`、`view_image`、`apply_patch` 的相对路径从此 cwd 解析 | 工具执行并发可设上限；结果裁剪/摘要由 sandbox 或调用方管理 | `max_turns`、tool-use behavior、error handler |
| Pi coding agent | `createAgentSession({ cwd })` 构造 cwd-bound 内置工具 | `find` 按文件名/glob，`grep` 按内容；都尊重 `.gitignore` | `find` 默认 1,000 path；`grep` 默认 100 matches；共享 2,000 行/50 KiB | `terminate`、`shouldStopAfterTurn` |
| OpenCode | 以 session / tool runtime 传递路径；本次只固定 loop 与 truncation 源码 | 内置 tool wrapper 对结果做统一截断；doom loop 在 processor 层检查 tool+input | 默认 2,000 行或 50 KiB，全文保存到文件 | `agent.steps` / max-step final turn；doom-loop permission ask |

### Claude：cwd、预算与终止原因是公开选项

Claude Agent SDK 的 `ClaudeAgentOptions` 同时列出 `max_turns`、`max_budget_usd`、`cwd` 和 `add_dirs`。[Claude Agent SDK reference](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python)

> `max_turns: int | None = None`
>
> `max_budget_usd: float | None = None`
>
> `cwd: str | Path | None = None`
>
> `add_dirs: list[str | Path] = []`

官方解释把 `max_turns` 定义为 tool-use round trips，把 `cwd` 定义为当前工作目录，并说明 `add_dirs` 会作为 `--add-dir` 传给 Claude Code。[Claude SDK option table](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python)

> `max_turns` | `int | None` | `None` | Maximum agentic turns (tool-use round trips)
>
> `cwd` | `str | Path | None` | `None` | Current working directory
>
> `add_dirs` | `list[str | Path]` | `[]` | Additional directories Claude can access.

CLI 也公开了 `--max-turns` 和 `--max-budget-usd`；`--max-turns` 默认没有上限，达到上限以 error 结束。[Claude CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference)

> `--max-budget-usd` | Maximum dollar amount to spend on API calls before stopping
>
> `--max-turns` | Limit the number of agentic turns (print mode only). Exits with an error when the limit is reached. No limit by default.

SDK 结果还带 `terminal_reason`，例如 `completed`、`max_turns`、`api_error`、`aborted_streaming` 和 `aborted_tools`。[Claude SDK result reference](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python)

> `terminal_reason`: why the query loop ended, such as `"completed"`, `"max_turns"`, `"api_error"`, `"aborted_streaming"`, or `"aborted_tools"`.

**不成立条件：** `max_turns` 只提供预算式边界，不判断搜索结果是否已经覆盖目标；CLI 文档还注明该 flag 只适用于 print mode。另有 Claude Code issue 报告历史版本/特定 sub-agent frontmatter 的 maxTurns 曾未按声明执行，故不能把文档契约当成所有旧版本的实测保证。[Claude issue #41143](https://github.com/anthropics/claude-code/issues/41143)

> The `maxTurns` field in agent frontmatter ... is documented as a hard limit that stops the sub-agent after N turns. In practice, it is **not enforced** — the agent runs freely past the declared limit.

该 issue 钉在报告的 Claude Code v2.1.97，属于版本限定的回归证据，不足以推断当前文档契约已经失效。

### OpenAI Sandbox：cwd 改变相对路径，不等于访问边界

OpenAI Agents Sandbox 的官方 `RunConfig` 明确规定 `cwd` 影响内置工具的相对路径解析，但不改变 workspace manifest root，也不限制其它已获允许的路径。[OpenAI RunConfig](https://openai.github.io/openai-agents-python/ref/run_config/)

> Relative paths used by the built-in `exec_command`, `view_image`, and `apply_patch` tools resolve from this directory.
>
> This setting changes relative-path resolution only. It does not confine the run to `cwd`, prevent access to other paths allowed by the shared session's workspace policy, or change `Manifest.root`.

Sandbox guide 对模型-facing working directory 的描述同样强调：cwd 必须是 workspace-relative，不能包含 `..` 或绝对路径；它是路径解析语义，不是授权边界。[OpenAI Sandbox concepts](https://openai.github.io/openai-agents-python/sandbox/guide/)

> The directory must exist and be accessible to the configured sandbox user ...
>
> The setting changes relative-path resolution only: it does not confine the run to `cwd` or prevent access to other paths allowed by the shared session's workspace policy.

**不成立条件：** 如果把 OpenAI 的 cwd 当成 sandbox/read boundary，模型仍可能访问 workspace policy 已允许的其它路径；安全范围必须由 sandbox manifest / policy 另行确定。

### Pi：文件名发现和内容搜索分层，并给出不同上限

Pi 的 `find` 工具默认最多返回 1,000 个路径，`grep` 默认最多返回 100 个匹配；两者都受 50 KiB 输出上限约束。[Pi find source](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/find.ts) · [Pi grep source](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/grep.ts)

```typescript
const DEFAULT_LIMIT = 1000;

description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```

```typescript
const DEFAULT_LIMIT = 100;

description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```

Pi SDK 文档把 `cwd` 直接传给 `createAgentSession`，并用同一个 cwd 构造内置 read/bash/grep tools。[Pi SDK custom cwd](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/sdk.md)

> When you pass a custom `cwd`, `createAgentSession()` builds selected built-in tools for that cwd.

**不成立条件：** `find` 的“limit 翻倍”提示只解决单次截断后的 continuation，不表示此前 scope 已经被记账；如果 runtime 不保存 coverage，模型仍可能在 1,000 → 2,000 → 4,000 的路径上反复宽搜。

## 上下文压缩、结果摘要与重复检测

### Compaction 发生在工具结果之后，但不自动形成搜索 coverage

Pi 的 compaction 文档明确说明检查点位于工具完成、结果追加之后，下一次 assistant response 之前；给 summarizer 的 tool result 另有 2,000 字符截断。[Pi compaction guide](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md)

> During a multi-turn agent run, Pi checks this threshold after tools finish and their results are appended, before starting the next assistant response.
>
> Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated.

文档还说明若完成的 tool batch 已经 terminate，则会跳过这次 between-turn compaction check；所以“需要先压缩再停止”的策略不能只靠 terminate 结果隐含完成。[Pi compaction guide](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md)

> It skips this between-turn check when the completed tool batch terminates the run and no queued message requires another response.

**不成立条件：** compaction 只保留摘要/最近消息时，如果“已搜索 root、query、结果完整性”没有独立结构化保存，下一轮可能把被摘要掉的搜索状态当成未知，再次调用等价工具。

### OpenCode：输出截断和 loop detector 是两条独立管线

OpenCode 的工具输出截断器用 2,000 行与 50 KiB 两个上限，超限时保存完整输出，并返回 bounded preview 与 output path。[OpenCode truncate source](https://github.com/anomalyco/opencode/blob/46f243fe/packages/opencode/src/tool/truncate.ts)

```typescript
export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }
```

同一实现把完整文本落盘，并在模型可见 output 中加入截断标记。[OpenCode tool-output-store](https://github.com/anomalyco/opencode/blob/846d5481/packages/core/src/tool-output-store.ts)

> `const marker = \`... output truncated; full content saved to ${outputPath} ...\``

**不成立条件：** 这只限制单次结果进入上下文的大小，不阻止下一次用略改 query、不同 path 或不同工具重新搜索。OpenCode 自己的 issue #25254 还记录了早期 doom-loop detector 只看当前 assistant message，跨 message 重复会漏检。[OpenCode issue #25254](https://github.com/anomalyco/opencode/issues/25254)

> `MessageV2.parts(ctx.assistantMessage.id)` returns only parts from the **current** assistant message.
>
> When the model repeats the same tool call across multiple turns ... the doom loop is never detected.

### Gemini：exact detector 有明确阈值，但不是语义覆盖

Gemini CLI 的当前源码以工具名和 JSON 参数生成 key；连续 5 次相同 key 才报告 `CONSECUTIVE_IDENTICAL_TOOL_CALLS`。[Gemini loop detector source](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts)

```typescript
private getToolCallKey(toolCall: { name: string; args: object }): string {
  const argsString = JSON.stringify(toolCall.args);
  const keyString = `${toolCall.name}:${argsString}`;
  return createHash('sha256').update(keyString).digest('hex');
}

if (this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD) {
  return true;
}
```

当前固定源码的阈值为 5，且 detector 可以被 session/config 禁用。[Gemini loop detector source](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts)

```typescript
const TOOL_CALL_LOOP_THRESHOLD = 5;

if (disabledForSession || config.getDisableLoopDetection()) {
  return { count: 0 };
}
```

**不成立条件：** `JSON.stringify(args)` 不是语义规范化；`./src` 与 `src`、glob 等价改写、`find` 与 `rg --files`、以及长度超过 detector 观察窗口的周期都可能绕过。PR #3919 的作者也把该实现描述为“simplest and safest approach”，并把更复杂 loop 留作 future enhancement。[Gemini PR #3919](https://github.com/google-gemini/gemini-cli/pull/3919)

> Added the simplest and safest approach to stop loops.
>
> Future enhancements will focus on expanding this logic to identify and mitigate more intricate and extensive looping behaviors.

### OpenAI 的 tool-choice reset 解决一种 loop，不等于搜索去重

OpenAI Agents SDK 默认在工具使用后 reset tool choice，以避免被 `required` 或特定函数名持续强迫调用同一个工具。[OpenAI Agent reference](https://openai.github.io/openai-agents-python/ref/agent/)

> `reset_tool_choice: bool = True`
>
> Whether to reset the tool choice to the default value after a tool has been called. Defaults to True. This ensures that the agent doesn't enter an infinite loop of tool usage.

源码将已使用工具的 model settings 中 `tool_choice` 置为 `None`。[OpenAI tool execution source](https://github.com/openai/openai-agents-python/blob/7029ea8f/src/agents/run_internal/tool_execution.py)

```python
if agent.reset_tool_choice is True and tool_use_tracker.has_used_tools(agent):
    return dataclasses.replace(model_settings, tool_choice=None)
```

**不成立条件：** 该机制针对“强制 tool choice 持续生效”的循环；如果模型自由选择 `rg`、`find`、`ls`，并且每次参数略有变化，它不会比较搜索覆盖范围，也不会证明结果带来了新信息。OpenAI issue #191 记录了 `tool_choice="required"` 导致搜索工具重复到 `max_turns` 的真实案例，随后由 PR #263/#335 引入 reset 行为。[OpenAI issue #191](https://github.com/openai/openai-agents-python/issues/191)

> The the agent is calling the one tool I provided for multiple times until the max_turn runs out.

## 最大步数：软提示与硬约束的差别

### OpenCode 的历史失败与修复

OpenCode issue #24505 记录：最后一步虽然注入了“tools are disabled”的 assistant message，但同一 request 仍传完整 `tools`，模型仍可以继续调用工具。[OpenCode issue #24505](https://github.com/anomalyco/opencode/issues/24505)

> In `packages/opencode/src/session/prompt.ts`, when `isLastStep` is true ... a prefilled assistant message claims that tools are disabled. However, the full `tools` object is still passed to `handle.process()`, which allows the model to continue making tool calls.

之后的 PR #33142 把修复目标写成“configured final turn text-only with no advertised or executable tools”，并移除 V2 的 hard-coded 25-step 行为，未配置时回到 unlimited continuation。[OpenCode PR #33142](https://github.com/anomalyco/opencode/pull/33142)

> honor optional agent `steps` by forcing the configured final turn to text-only with no advertised or executable tools
>
> default unconfigured agents to unlimited continuation, matching V1

修复提交中的共享 prompt 也明确写了最终状态：工具禁用、只输出总结和未完成项。[OpenCode max-steps source](https://github.com/anomalyco/opencode/blob/4f1a9d7aef56163d8fe265f7f9cbe295cc1df95a/packages/core/src/session/runner/max-steps.ts)

```text
CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.
```

**不成立条件：** 即使 V2 修复了最终 turn 的工具暴露，OpenCode 的历史 issue #45328 仍记录 V1 在 1.18.23 的最后一步只靠 prompt、工具仍在 wire 上；这说明“step counter 存在”与“最终请求不可调用工具”是两个必须分别验证的契约。[OpenCode issue #45328](https://github.com/anomalyco/opencode/issues/45328)

> In v1 the guarantee is prose-only. Models that follow the instruction are fine; the ones that ignore it call a tool anyway and it executes.

### Claude 与 OpenAI：预算停止也必须可辨认

Claude CLI 文档允许 `--max-turns`，但默认没有上限；OpenAI Agents 默认给 Runner 一个 `max_turns`，超过后抛 `MaxTurnsExceeded`。两者都把“走完预算”作为 run-level 结果，而不是搜索工具自己的结果。[Claude CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-reference) · [OpenAI Running agents](https://openai.github.io/openai-agents-python/running_agents/)

> Claude: `--max-turns` ... Exits with an error when the limit is reached. No limit by default.
>
> OpenAI: `If we exceed the max_turns passed, we raise a MaxTurnsExceeded exception.`

OpenAI 官方还提供 max-turn error handler，把“没在预算内完成”投影成可控 final output。[OpenAI error handler example](https://openai.github.io/openai-agents-python/running_agents/)

> `final_output="I couldn't finish within the turn limit. Please narrow the request."`

**不成立条件：** 步数上限不判断“搜索已收敛”；如果最后一步仍允许工具，模型可能在硬停止前制造未结算 tool calls；如果结束原因未投影，调用方可能把 partial result 当成功。

## 历史演变与 issue / PR 证据

| 时间 / 项目 | 变化 | 一手摘录与限制 |
|---|---|---|
| OpenAI Agents，2025-03 | PR #263 先修复强制 `tool_choice` 持续导致的无限工具循环；PR #335 将 reset 行为做成可配置 | [PR #263](https://github.com/openai/openai-agents-python/pull/263)：> This PR fixes an issue where setting `tool_choice` to `"required"` or a specific function name could cause models to get stuck in an infinite tool call loop.；[PR #335](https://github.com/openai/openai-agents-python/pull/335)：> Making the reset behavior on tool use configurable |
| Pi，2025-2026 | 从 hard abort / higher-level handoff 需求收敛为低层 `shouldStopAfterTurn`；v0.72.0 发布 post-turn stop，随后更高层 Agent 暴露入口 | [PR #3197](https://github.com/badlogic/pi-mono/pull/3197)：> we definitely will not implement a new stop ... We added a smaller low-level primitive: `shouldStopAfterTurn`.；[release v0.72.0](https://github.com/badlogic/pi-mono/releases/tag/v0.72.0)：> Agent loop can now exit gracefully after a completed turn via `shouldStopAfterTurn`. |
| Gemini，2025-至今 | PR #3919 先加入 exact repeated tool/content loop；当前实现把 tool-call threshold 固定为 5，并保留 disable 开关 | [PR #3919](https://github.com/google-gemini/gemini-cli/pull/3919)：> Repeated Tool Calls: If we detect 5 consecutive instances of an identical tool call ...；当前源码仍有 `TOOL_CALL_LOOP_THRESHOLD = 5`，所以不能把它写成语义级 detector。 |
| OpenCode，2026-04 至 2026-08 | #24505 暴露 max-step 仍传 tools；#33142 合并 final-turn text-only；#45328 又记录 V1 在 1.18.23 的同类缺口 | [#24505](https://github.com/anomalyco/opencode/issues/24505)：> the full `tools` object is still passed ...；[PR #33142](https://github.com/anomalyco/opencode/pull/33142)：> forcing the configured final turn to text-only with no advertised or executable tools；[历史限制 #45328](https://github.com/anomalyco/opencode/issues/45328)：> In v1 the guarantee is prose-only. |
| Claude Code，2025-2026 | 官方 SDK/CLI 逐步公开 `max_turns`、`max_budget_usd`、`terminal_reason`；issue 记录旧版本 sub-agent maxTurns enforcement 与 error surface 的边界 | [Claude SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python)：> `terminal_reason`: why the query loop ended ...；[issue #41143](https://github.com/anthropics/claude-code/issues/41143)：> In practice, it is **not enforced** — the agent runs freely past the declared limit. 该 issue 只限定 v2.1.97。 |

这些历史记录共同说明：停止机制通常是先解决一个可重现的窄 loop，再逐步补上机器可读的停止状态或 wire-level enforcement；不能把一个项目的当前 prompt、历史 issue 或单次修复扩大成所有模型/版本的保证。

## 统一机制 trace：一次“找配置文件”的搜索如何收敛

以下是把上述一手契约对齐后的抽象 trace，不是任何一个项目的内部实现描述：

1. **建立运行范围。** Host 给本轮 runtime 注入 `cwd`、允许的额外 roots、工具 allowlist 和预算；相对 path 按该 cwd 解析。Claude 的 `cwd`、OpenAI 的 Sandbox `cwd`、Pi 的 cwd-bound tool 都是直接先例。[Claude SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-python) · [OpenAI RunConfig](https://openai.github.io/openai-agents-python/ref/run_config/) · [Pi SDK](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/sdk.md)
2. **执行有界候选搜索。** 模型先调用文件名/glob 工具，contract 带 `path/cwd`、`limit`、`truncated`；内容 grep 只有在候选 root 明确后再调用。Pi 的 `find`/`grep` 分离和上限证明了这种工具边界。[Pi find](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/find.ts)
3. **封存结果状态。** Tool result 不能只有文本；至少要区分 returned count、是否完整、被截断的原因、可继续读取的 output path/cursor，以及本次覆盖的 canonical scope。OpenCode 的 `truncated/outputPath` 是结果 envelope 的直接先例。[OpenCode truncate](https://github.com/anomalyco/opencode/blob/46f243fe/packages/opencode/src/tool/truncate.ts)
4. **先查 exact duplicate，再查 no-progress。** 完全相同的 tool+canonical args 可以复用；短周期 detector 可拦截重复；再检查新 query 是否扩大 scope 或带来新候选。Gemini 的 SHA key/5 次阈值和 OpenCode 的 3 次 doom-loop 是 exact 层证据，但两者都留下语义近似的缺口。[Gemini detector](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts) · [OpenCode doom-loop](https://github.com/anomalyco/opencode/pull/3445)
5. **在下一次模型请求前判断终点。** 若模型已返回无 tool call 的 final output，结束；若命中 tool-result policy、post-turn stop、预算或 max steps，结束；否则追加结果再请求模型。OpenAI 的 runner 顺序和 Pi 的 post-turn seam 将这个边界公开化。[OpenAI loop](https://openai.github.io/openai-agents-python/running_agents/) · [Pi stop](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/README.md)
6. **预算终点强制 no-tool。** 最后一轮不要只追加“请停止”的文本，应该从模型请求中移除工具/设置 tool choice none，并返回可识别的 `max_steps`/`max_turns` terminal reason。OpenCode 的 #24505 → #33142 演变正是这一条件的反例到修复。[OpenCode PR](https://github.com/anomalyco/opencode/pull/33142)
7. **压缩但保留 coverage。** 如果工具结果使上下文超过阈值，先摘要消息/截断 payload；不把 search ledger、权限状态、terminal state 一起丢掉。Pi 文档证明 compaction 的时机，不能证明它会替宿主维护搜索 coverage。[Pi compaction](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md)

### 失败模式

- **完全相同调用：** Gemini 第 5 次才触发，前 4 次仍会执行；如果 detector 被配置禁用，则没有该保护。[Gemini source](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts)
- **语义相近调用：** `ls`、`find`、`rg --files` 或 `./x`、`x` 可能有相同目标但不同 key；exact detector 不足。
- **跨消息重复：** OpenCode #25254 记录只看当前 assistant message 会漏掉跨 turn 重复；必须按 user-turn / compaction 边界收集历史。[OpenCode #25254](https://github.com/anomalyco/opencode/issues/25254)
- **最终步仍有工具：** OpenCode #24505/#45328 证明模型可能忽略软提示并实际执行工具；必须检查 wire 上的 tool roster。[OpenCode #45328](https://github.com/anomalyco/opencode/issues/45328)
- **批次混合 terminate：** Pi 明确要求同一 finalized tool batch 全部 `terminate: true`，混合批次会继续；不能只看其中一个结果。[Pi README](https://github.com/badlogic/pi-mono/blob/dd6bea41/packages/agent/README.md)
- **上下文压缩后重搜：** Pi 会截短 tool results；如果 coverage 不在摘要外保存，压缩后模型可能忘记已经查过的 root。
- **cwd 被误当安全边界：** OpenAI Sandbox 明确 cwd 只改变相对路径解析，不限制 workspace policy 已允许的其它路径。[OpenAI Sandbox](https://openai.github.io/openai-agents-python/sandbox/guide/)

## 方案对比

| 维度 | Claude Code / Agent SDK | OpenAI Agents / Responses | Pi | OpenCode | Gemini CLI |
|---|---|---|---|---|---|
| 工具结果后的默认动作 | 继续 agent loop；预算命中返回 error result | Agents Runner 追加结果再 loop；Responses 调用方自己继续 | 追加结果；可由 `terminate` 或 post-turn callback 跳过下一次 LLM | 继续到 step/doom-loop/模型结束 | 继续，detector 命中才打断 |
| 最大步数 / 预算 | `max_turns`、`max_budget_usd`；CLI 默认无 turn cap | `max_turns`；`MaxTurnsExceeded`；tool-use policy 可提前结束 | 未以默认 max-turn 为核心；host 用 `shouldStopAfterTurn` | `agent.steps`；修复后 final turn 应无工具；未配置可 unlimited | 本次核验未找到与 max-turn 等价的核心契约 |
| 工具是否在最后一步物理禁用 | 本次公开资料未找到通用 final-step tool stripping 证明 | tool-use behavior 可停止，但 max-turn 的最后请求语义不等于搜索 detector | stop seam 在工具执行后，不能撤销本批次工具 | 历史 V1 曾未禁用；V2 修复要求 no advertised/executable tools | detector 命中后触发 LoopDetected/取消 |
| 重复调用检测 | 未找到公开通用 exact/near detector | reset forced `tool_choice`；未找到 search coverage detector | 暴露 stop seam；未找到默认 detector | 3 次相同 tool+input doom loop；历史上有跨 message 漏检 | 5 次相同 tool+JSON(args)，可禁用 |
| 结果摘要 / compaction | `--autocompact`/自动会话管理；本次未找到 search coverage schema | 可由 session/input filter 管理；本次未找到 Runner 自动 search summarizer | 工具后、下一次 assistant 前 compaction；tool result 摘要截 2,000 chars | tool output 2,000 lines/50 KiB，全文保存 | detector 不是 compaction |
| working directory | `cwd` + `add_dirs` | Sandbox `cwd`，相对 workspace root；不等于访问边界 | cwd-bound session/tool | session/tool runtime；本次不据此推导完整多-root contract | 本题不展开 |
| 停止原因 | `terminal_reason` / `error_max_turns` | `MaxTurnsExceeded` / error handler | `agent_end` / runtime callback | max-step prompt、permission/doom-loop 状态 | `LoopDetectedEvent` |

每个方案的局限已经在各自章节列出：Claude 的预算不是语义收敛；OpenAI 的 tool-choice reset 不是搜索去重且 hosted tools 有例外；Pi 的 stop seam 不会取消已执行工具且没有默认 detector；OpenCode 的历史实现证明 prompt-only final step 不可靠；Gemini 的 exact key 会漏掉语义等价调用。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Claude Agent SDK/CLI reference；OpenAI Agents Runner、Agent、RunConfig、Responses function-calling；Pi agent-loop、coding-agent compaction、find/grep；OpenCode max-steps、truncation；Gemini loop detector。版本/commit 与访问日期见本文开头。 |
| 作者或维护者本人的说法 | 找到 OpenAI `rm-openai` 在 PR #263/#335 对 forced tool-choice infinite loop 与 reset 取舍的说明；Pi 维护者在 PR #3197 对 hard abort 与 post-turn stop 的取舍；Gemini PR #3919 的设计说明。Claude/OpenCode 本题未找到足以代表当前完整 loop 设计的独立作者长文，未把普通用户评论当作者立场。 |
| 同类方案 | 核心比较 Claude Code、OpenAI Agents/Responses、Pi、OpenCode；Gemini CLI 作为有公开 detector 的对照，满足至少两个成熟同类方案的同维比较。 |
| issue / PR / 社区实践 | OpenAI issue #191（`tool_choice=required` 搜索循环）、OpenCode #24505/#25254/#45328（max-step 与跨消息 doom-loop 缺口）、Claude #41143（旧版 sub-agent maxTurns 回归）用于限定版本的失败模式；已区分维护者修复、用户复现与普通讨论。 |
| 历史演变 | OpenAI PR #263→#335；Pi PR #3197→v0.72.0；Gemini PR #3919→当前 exact detector；OpenCode #24505→#33142→#45328；Claude docs/SDK 逐步公开 max budget、terminal reason。未将 issue 关闭本身当成修复证据。 |

## 待验证

- Claude Code 当前闭源 core 是否有未公开的 exact/near-duplicate search detector；公开文档只足以确认 budgets、hooks、cwd 与结果字段。
- OpenAI Agents 当前 SDK 的完整 release version 与 hosted search tool 的内部 loop 细节；公开 docs 足以确认 FunctionTools 的 loop 与 Sandbox cwd，但不能外推 provider-hosted tools 的所有停止实现。
- OpenCode 当前所有产品面是否统一走已修复的 V2 runner；#45328 只证明 1.18.23 的 V1 缺口，不能外推 2026-09-12 全部发行形态。
- 各项目实际误报率、token 节省、重复调用平均次数和不同模型上的 detector 覆盖率；本次没有运行 benchmark，也没有私有 telemetry。

## 对本项目的影响

以下只提出可映射到 jai-mono 的设计原则，不判断当前代码，也不要求本次研究修改源码：

1. **把 `cwd`、authorized roots、tool allowlist 和预算作为 runtime facts。** 不让模型靠 `pwd`、`ls ..` 或反复 shell 试探恢复工作范围；候选可见、内容可读、可写授权应是不同状态。
2. **把搜索分成候选发现和内容搜索。** 每个 read-only search contract 至少携带 canonical root、normalized query、depth/limit，并返回 canonical paths、returned count、`complete/truncated`、continuation 信息和覆盖范围。
3. **维护跨 compaction 的 search ledger。** exact fingerprint 命中且上次结果完整时复用；参数略变但 coverage 已包含且没有明确增量理由时判为 no-progress，不再执行。
4. **采用两级 loop guard。** 先用低成本 canonical fingerprint / 短周期 detector 拦截完全重复，再用“是否新增候选、是否扩大合法 scope、是否改变假设”的 no-progress 判定拦截 `ls → find → rg --files` 等跨工具等价循环；LLM 判断只能做后备。
5. **max steps 到最后一轮必须是 wire-level no-tool。** 删除工具定义或明确设置 tool choice none，并产出机器可读 `max_steps` terminal reason；不要只往 prompt 里加“请停止”。
6. **把 compaction 与 convergence 分开。** 结果摘要可以降低 token，但不能替代 coverage ledger、权限状态、未完成 continuation 和已执行副作用记录。
7. **把停止原因作为协议字段。** 至少区分 `completed`、`max_steps`、`loop_blocked`、`needs_authorization`、`search_truncated`、`tool_error`、`aborted`；上层据此决定总结、询问、重试还是转人工。
8. **read-only 搜索可做结果复用，side-effect 工具不能只靠 fingerprint。** 读操作重复通常可以复用结果；写入、发送、删除等仍需要 call id、执行状态和幂等/去重语义，不能把搜索缓存规则泛化到所有工具。
