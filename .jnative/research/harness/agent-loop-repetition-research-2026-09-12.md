# 为什么 Desktop Agent 会重复搜索而不收敛

核验日期：2026-09-12（UTC+8）。源码固定在 commit `78ce62007ec54166c63622ef09e88da8a438b384`。本笔记把本机真实 `we0` run、当前仓库源码和成熟方案的一手资料放在一起，区分已确认事实与对模型内部决策的推断。

## 结论

1. **这不是 ACP、Bash 或 Desktop transcript 在内部重试。** 真实 run 是一次用户输入触发的 8 次模型尝试、14 个模型 tool call 和 14 个 tool result，其中 13 次实际进入 effect boundary；重复调用来自普通工具结果回到 context 后，Agent loop 继续请求 provider。当前 loop 没有按相似命令、结果重叠或信息增益停止的逻辑。[`agent-loop.ts#L167-L204`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204) [`we0-run-trace.md`](./we0-run-trace.md)

2. **这次 run 的第一处放大器是工作范围没有进入模型可见 context。** Session 的 cwd 是 `jai-mono/app/desktop`，但用户要找的是它旁边的项目。模型先用 `pwd`、`ls`、FFF `find` 在当前 workspace 内试探；FFF 的相对路径约束又拒绝了它传入的绝对路径，模型才改用多批 Bash 去扩大范围。[`remote.ts#L237-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)

3. **工具结果有文本，但没有搜索状态。** FFF 的 cursor、命中数量、Bash 的 exit code 和截断信息主要存在于工具结果的结构化 `details`；模型收到的核心是 `content` 文本。没有 operation 级的已访问 root、query fingerprint、候选集合、结果完整性或 no-progress ledger，因此系统无法告诉模型“这个范围已经查过、这次没有新增信息”。[`types.ts#L18-L32`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L32)

4. **“最新”以及 `we0` 指什么，都没有被定义成可执行条件。** 本机配置里的 `we0` 是 MCP server key，而不是已登记的 Desktop Project；真实 run 后半段却按本地目录、mtime 和 git 状态寻找项目。13 次实际工具执行合计约 0.833 秒，主要耗时来自 8 次模型往返和最后约 32.272 秒的权限等待；最后 run 以 `aborted` 结束，没有 partial summary。[`middleware.ts#L188-L196`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/middleware.ts#L188-L196) [`we0-run-trace.md`](./we0-run-trace.md) [`we0-local-agent-mechanism.md`](./we0-local-agent-mechanism.md)

5. **成熟方案通常把预算、精确重复检测、post-turn stop 和工具契约分开实现。** Gemini CLI 和 OpenCode 有 exact doom-loop 检测；Pi 暴露 `shouldStopAfterTurn`；Claude/OpenAI 暴露 cwd、turn budget 和终止原因。但这些方案也不自动解决 `ls → find → rg` 这种跨工具语义重复，因此 jai-mono 仍需要自己的搜索 coverage 和 no-progress 语义。[外部对比笔记](../agent-ui/agent-loop-stop-conditions-comparison-2026-09-12.md)

## 这次 `we0` run 实际发生了什么

本机 SQLite 记录的原始用户文本是“帮我看看我最新的 we0的项目怎么样了”，与截图文字略有差异；以下按同一意图引用真实记录，不把两句话伪装成逐字相同。

### 具体 trace

1. 一次 `send` 进入 `session/prompt`，Runtime 创建一个 operation；没有证据表明 renderer 重复提交了首条消息。[`use-chat.ts#L180-L261`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/src/hooks/use-chat.ts#L180-L261) [`acp-host.ts#L326-L347`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L326-L347)

2. 首轮调用 `Bash("pwd && ls -la")` 和 FFF `find({ pattern: "we0" })`。实际 cwd 是 `jai-mono/app/desktop`；FFF 返回了一批模糊命中并带 continuation cursor。

[`remote.ts#L237-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)

```ts
return {
	localFileAccess: true,
	cwd: project.canonicalPath,
	configRoot: project.canonicalPath,
	defaultAllowedDirectories: [project.canonicalPath],
};
```

3. 下一轮枚举 `jai-mono` 根目录、git status、git log，并调用 `find` 传入 `/Users/jayden/code/jai-mono`。FFF 明确拒绝这个绝对 path，因为它只接受 workspace 内的相对约束。

4. 接下来模型在 `jai-mono` 内重复 `rg -l -i "we0"`、`ls docs packages plugins app .jnative`，随后再次读取 `.jnative/CONTEXT.md` 并改写相近查询。

5. 到第五个 model turn，模型才执行 `ls /Users/jayden/code` 和 `find /Users/jayden/code -maxdepth 2 ...`，得到 `we0claw`、`wecode/we0-agent-sdk`、`we0agent`、`we0conatiner`、`new-we0` 等候选。此时定位阶段已经有足够候选，但没有代码级“定位已收敛”状态。

6. 后续又枚举 `wecode` 子目录和 `new-we0` 的内部目录，并尝试批量 `git -C ... status`。这次 Bash 跨 workspace 触发权限请求，用户拒绝后工具结果为 permission denied。

7. provider 随后返回空 content、`stopReason: "aborted"`，operation 以 aborted 结束，没有根据已经找到的候选自动生成“已完成部分 + 未完成部分”的总结。

原始调用序列摘录：

```text
14  Bash  pwd && ls -la
14  find  we0
21  Bash  cd /Users/jayden/code/jai-mono && ls -la && git status ... && git log ...
21  find  we0*
28  Bash  cd /Users/jayden/code/jai-mono && rg -l -i "we0" ...
28  Bash  cd /Users/jayden/code/jai-mono && ls docs packages plugins app .jnative
35  Bash  cd /Users/jayden/code/jai-mono && ls -la .jnative && cat .jnative/CONTEXT.md ...
35  Bash  cd /Users/jayden/code/jai-mono && rg -l -i "we0|w0" ...
42  Bash  ls /Users/jayden/code
42  Bash  find /Users/jayden/code -maxdepth 2 -iname "*we0*" ...
49  Bash  cd /Users/jayden/code/wecode && ls -la && git status ...
56  Bash  cd /Users/jayden/code/wecode/new-we0 && ls -la && git status ...
```

这次重复不是工具执行慢：13 次已执行调用的结果延迟为 0.003–0.123 秒，总和约 0.833 秒；最后一次权限等待约 32.272 秒。补充取证还显示本机配置为 `mcp_servers=we0`，而 Desktop Project Catalog 只有 `jai-work`，所以用户说的“we0 项目”存在实体歧义。[`we0-run-trace.md`](./we0-run-trace.md) [`we0-local-agent-mechanism.md`](./we0-local-agent-mechanism.md)

```text
tool dispatch latency: 0.003–0.123 s
13 executed tool calls total: approximately 0.833 s
permission wait before denial: approximately 32.272 s
project=jai-work|/Users/jayden/jai-work
mcp_servers=we0
```

完整本地取证见 [`agent-loop-repetition-code-trace-2026-09-12.md`](./agent-loop-repetition-code-trace-2026-09-12.md)。

## 工具结果为什么会进入下一轮

Agent loop 的职责是反复执行 turn，直到没有工具调用、steering 或 follow-up。普通工具结果不是终点信号：

[`agent-loop.ts#L167-L204`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204)

```ts
while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
	if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
		…
		return;
	}
	const turn = await runTurn(run, pendingMessages);
	turnCount += 1;
	hasMoreToolCalls = turn.hasMoreToolCalls;
}
```

工具批次执行完后，结果会被追加进下一次模型请求：

[`agent-loop.ts#L253-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L253-L270)

```ts
const batch = await executeToolCallBatch(run, toolCalls);
toolResults = batch.messages;
hasMoreToolCalls = !batch.terminate;
for (const result of toolResults) {
	context.messages.push(result);
	newMessages.push(result);
}
```

因此，`ls` 之后出现 `find`、`rg` 或另一批 `ls`，是 provider 在看到上轮结果后再次选择工具；不是 ACP 或 Desktop 把同一调用复制了一遍。

`terminate` 只由工具作者显式设置，并且同一批次需要所有结果都为 `true` 才提前停止。当前 Bash、FFF `find`/`grep` 都没有把普通成功结果设为 terminate：

[`types.ts#L18-L33`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L33)

```ts
/**
 * 提示 agent 在当前这批工具执行完后停止。
 * 早停仅当本批次每个工具结果都为 true 时才生效
 */
terminate?: boolean;
```

## 工具契约缺少哪些收敛信息

当前 Desktop 同时提供静态 FFF `find`/`grep` 和任意字符串型 `Bash.command`。FFF 的 description 建议不要用 Bash `find/ls/grep`，但 Bash 仍允许模型把 `ls`、`rg`、git 和多个命令组合进一个字符串：

[`search/index.ts#L168-L221`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L168-L221)

```ts
name: "find",
description:
	"Fuzzy file and path search. Use this instead of Bash find or ls. Results are ranked by frecency and Git status, with cursor pagination.",
```

[`bash.ts#L66-L73`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L66-L73)

```ts
description:
	"Execute a POSIX shell command in the workspace with timeout, cancellation, and bounded output. Do not use grep, find, cat, ls, head, or tail to explore the workspace; search with the grep or find tools, or rg if Bash search is required.",
```

FFF 的 cursor 需要模型自己传回，空结果是成功文本，错误也会以普通 tool result 回灌：

[`search/index.ts#L70-L98`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L98)

```ts
const pageIndex = resumed?.nextPageIndex ?? 0;
…
const text = result.value.items.length
	? result.value.items.map(…).join("\n")
	: "No files found matching pattern";
return { content: [{ type: "text", text: appendCursor(text, nextCursor) }] };
```

工具的 `details` 给运行侧和 UI 使用，不进入模型的 `content`：

[`types.ts#L18-L32`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L32)

```ts
/** 回给模型的内容（会被包进 ToolResultMessage 送回 LLM）。 */
content: (TextContent | ImageContent)[];
/** 给日志 / UI 的结构化数据，不进 LLM 上下文。 */
details?: TDetails;
```

这解释了三个具体缺口：

- 模型能读到以前的文本，但没有机器可读的“这个 root 已完整搜索”；
- cursor、命中总数、scope 和 truncation 没有统一进入模型可判定的结果 envelope；
- 错误有 `isError` 和 message，但没有 `invalid_scope`、`wrong_root`、`no_new_candidates`、`next_action` 之类的恢复语义。

## 为什么最后没有给出总结

真实 run 最后一次跨 workspace Bash 被权限拒绝。权限拒绝被转成工具错误，之后 provider 返回 `aborted`；Runtime 的 outcome 映射只把它标为 aborted，不会从已有候选路径自动生成 partial summary。

[`middleware.ts#L188-L196`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/middleware.ts#L188-L196)

```ts
if (approval === "deny") {
	settlePermission(options.telemetryObserver, context.toolCall.id, "denied");
	throw permissionDeniedError(toolName, "User denied the permission request");
}
```

[`coding-agent.ts#L493-L498`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L493-L498)

```ts
if (!finalAssistant) return "failed";
if (finalAssistant.stopReason === "aborted") return "aborted";
if (finalAssistant.stopReason === "error" || finalAssistant.stopReason === "contextOverflow") return "failed";
return "completed";
```

这里有一个产品决策边界：是否要在权限拒绝后输出 partial summary，应该属于 Runtime/Agent 的明确终态语义，不应该由 Desktop transcript projection 偷写 journal。

## 成熟方案说明了什么

外部对比不是为了照搬某一个项目，而是确认哪些机制已经被实践验证：

- **OpenAI Agents** 把 final output、handoff、tool call 和 `max_turns` 明确分开；工具结果默认继续下一轮。
- **Pi** 提供 `terminate` 和 `shouldStopAfterTurn`，允许宿主在当前 turn 完成后停止。
- **Gemini CLI** 对连续 5 次完全相同的 tool + JSON 参数做 loop detection。
- **OpenCode** 有 doom-loop 和 max-step final turn；历史修复表明只在 prompt 里写“请停止”不够，最后一轮要在线路上撤掉工具。
- **Claude Agent SDK** 暴露 `cwd`、`add_dirs`、`max_turns` 和 `terminal_reason`，但公开资料没有证明它有跨工具语义级搜索 coverage detector。

这些方案的共同点和限制：

| 机制 | 能解决 | 不能解决 |
|---|---|---|
| `cwd` / authorized roots | 减少模型用 `pwd` 和父目录枚举猜工作范围 | 不自动定义“最新”的业务排序 |
| max turns / max steps | 防止 run 无限增长 | 不知道结果是否已经足够 |
| exact tool fingerprint | 拦截完全相同调用 | 拦不住 `find`、`ls`、`rg` 的语义等价变体 |
| post-turn stop | 在当前工具批次完成后安全退出 | 不能撤销已经执行的工具 |
| tool result envelope | 让模型知道 count、truncated、cursor、scope | 仍需要 operation 级 coverage/no-progress 判断 |

完整外部来源和版本固定信息见 [`agent-loop-stop-conditions-comparison-2026-09-12.md`](../agent-ui/agent-loop-stop-conditions-comparison-2026-09-12.md)。

> “Repeated Tool Calls: If we detect 5 consecutive instances of an identical tool call ...” —— Gemini CLI 的 exact detector 证据，不能覆盖 `ls → find → rg` 的语义等价调用。

## 建议落地顺序

按风险和收益排序，建议后续拆成四个独立工作项：

1. **先把 cwd、project metadata 和允许的额外 roots作为模型可见的运行事实。** 这能直接减少首轮 `pwd`、在错误 workspace 内重复搜索和非法绝对 path。
2. **补统一的搜索结果 envelope。** 至少包括 canonical root、normalized query、returned count、total count、`complete/truncated`、cursor 和明确的错误 code/next action。
3. **在统一 tool execution boundary 增加两级 guard。** 先拦完全相同的 canonical tool + args，再按 operation 维护候选/范围 fingerprint，识别 `ls → find → rg` 这类无新增信息的跨工具循环。不要只在 Desktop UI 里修。
4. **补机器可读的终止原因和 partial-result policy。** 至少区分 `completed`、`max_steps`、`loop_blocked`、`needs_authorization`、`tool_error`、`aborted`；权限拒绝后是否总结已有事实需单独定产品语义。

不要把以下方案当成完整修复：

- 只加强 system prompt；
- 只设置 `maxIterations`；
- 只做输出 compaction；
- 只在 transcript 中折叠重复工具卡片。

这些只能减少表现、成本或 UI 噪音，不能让模型知道搜索已覆盖什么，也不能阻止它继续选择相似工具。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 当前仓库 Agent loop、FFF、Bash、ToolCatalog、Runtime、ACP 和 Desktop cwd；全部固定在 `78ce62007ec54166c63622ef09e88da8a438b384`。 |
| 作者或维护者本人的说法 | Pi `shouldStopAfterTurn`、OpenAI forced tool-choice reset、Gemini loop detector 的维护者/PR 说明；收录在外部对比笔记。 |
| 同类方案 | OpenAI Agents/Responses、Pi、OpenCode、Gemini CLI、Claude Agent SDK 的 stop、cwd、结果 contract 和 detector。 |
| issue / PR / 社区实践 | OpenAI tool-choice loop、OpenCode max-step/doom-loop、Claude maxTurns 回归；按版本和证据强度区分。 |
| 历史演变 | OpenAI reset、Pi post-turn stop、Gemini exact detector、OpenCode final-turn tool stripping 的演变。 |

## 待验证

- provider 为什么没有续 FFF cursor，为什么在已有候选后继续扩大搜索；源码无法读取 provider 隐藏 reasoning。
- 当前 provider 的完整 request payload 是否包含了 cwd、project 或其它未落 durable journal 的上下文。
- “最新”在产品上应该按 mtime、git commit time、最近打开时间还是 Desktop metadata 定义。
- exact/no-progress guard 的阈值、误报处理和 side-effect tool 排除规则，需要基于真实运行样本 benchmark，而不是直接照搬 Gemini/OpenCode 的次数。

## 对本项目的影响

这次问题的修复边界在 Agent runtime 与工具执行契约，不在 Desktop transcript projection：应先补模型可见的工作范围和统一搜索结果状态，再补 operation 级重复/无进展保护；UI 只需要如实展示终止原因。`maxIterations`、prompt 加强和结果折叠可以保留作为兜底或降噪，但不能单独解决这次重复搜索。

