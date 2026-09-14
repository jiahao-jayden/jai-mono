# Jai Agent Loop 工具契约审计：搜索重复与收敛

核验日期：2026-09-12（UTC+8）。

当前 git SHA：`78ce62007ec54166c63622ef09e88da8a438b384`，当前分支为
`main`。源码链接全部钉在这个 commit；工作树另有未提交修改，因此不把未提交 UI
改动当作当前 Agent/ACP 契约证据。

范围：只读本仓库源码、测试和已有 `.jnative` 研究笔记；不查外部项目，不研究 UI
动画/滚动，不修改产品代码。先读了 `AGENTS.md`、`.jnative/research/tools/` 的
相关工具契约笔记，以及 `.jnative/research/harness/` 的 `we0` 运行轨迹。

## 结论

1. **当前机制确实允许模型跨 turn 重复执行 `ls/find/rg` 而不收敛，但“模型为何
   选择重复”仍是推断。** Agent loop 把普通工具结果加入下一轮 context；只要该批
   结果没有全部声明 `terminate: true`，就继续请求 provider。代码没有根据命令相似
   度、结果重叠、信息增益或已覆盖目录来停止。[`agent-loop.ts#L167-L204`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204)

   ```ts
   while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
   	if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
   		const message = createIterationLimitMessage(config, turnCount);
   		…
   		return;
   	}
   	let turn: TurnResult;
   	try {
   		turn = await runTurn(run, pendingMessages);
   	} catch (error) {
   		…
   	}
   	turnCount += 1;
   ```

   **已知结果并非不存在，而是没有独立的“搜索覆盖/已知候选”事实。** 之前的
   `toolResult` 会留在消息 transcript 中，模型理论上能重读；但当前 `AgentContext`
   只有 `systemPrompt/messages/tools`，未见 operation 级 search ledger、结果
   fingerprint 或 no-progress 状态。后半句是基于当前源码检索的**静态缺口判断**，不
   是对 provider 隐藏 reasoning 的断言。[`types.ts#L263-L267`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L263-L267)

   ```ts
   export interface AgentContext {
   	systemPrompt: string;
   	messages: AgentMessage[];
   	tools: AgentTool[];
   }
   ```

2. **“有搜索专用能力”要分层回答：基础 Coding Agent 只有 `Read/Bash/Edit/Write`；
   Desktop 本地 capability source 额外挂载 FFF 的 `find/grep`；`SearchTools` 是
   动态工具 catalog discovery，不是文件系统搜索。** 因此 Desktop 中 `find` 是
   专用工具，但 `ls` 与 `rg` 仍可被塞进任意字符串型 `Bash.command`。[`names.ts#L8-L12`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/tools/names.ts#L8-L12)

   ```ts
   export const defaultCodingToolNames = ["Read", "Bash", "Edit", "Write"] as const;
   
   export const codingToolNames = defaultCodingToolNames;
   
   export type CodingToolName = (typeof codingToolNames)[number];
   ```

   Desktop 本地装配把 FFF extension 放进每个 Operation 的 extensions；这解释了
   Desktop 可以直接出现 `find/grep`，但不是基础 SDK 的统一保证。[`desktop-local.ts#L57-L72`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime-capabilities/desktop-local.ts#L57-L72)

   ```ts
   const fileCapabilities = {
   	homeDirectory: this.#homeDirectory,
   	workspaceDirectory: input.cwd,
   	workspaceTrusted: trust.isOk() && trust.value.trusted,
   };
   …
   const fffSearchExtension = createFffSearchExtension({
   	dataDirectory: join(this.options.dataDirectory, "fff", input.sessionId),
   });
   return Result.ok({
   	fileCapabilities,
   	extensions: [skillsExtension, agentPlugins, fffSearchExtension, createMcpExtension()],
   ```

   FFF 的两个工具描述明确要求替代 Bash `find/ls` 与 Bash `grep`；它们支持
   `cursor`，但模型必须自己把返回的 cursor 传回下一次调用，runtime 不会自动续页。
   [`search/index.ts#L70-L97`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L97)

   ```ts
   const pageSize = resumed?.pageSize ?? Math.max(1, input.limit ?? DEFAULT_FIND_LIMIT);
   const pageIndex = resumed?.nextPageIndex ?? 0;
   const result = this.#finder.fileSearch(query, { pageIndex, pageSize });
   …
   const nextCursor =
   	result.value.totalMatched > pageIndex * pageSize + result.value.items.length
   		? this.#storeFindCursor({ query, pageSize, nextPageIndex: pageIndex + 1 })
   		: undefined;
   const text = result.value.items.length
   	? result.value.items.map((item) => `${item.relativePath}${annotation(item.gitStatus, item.totalFrecencyScore)}`).join("\n")
   	: "No files found matching pattern";
   return {
   	content: [{ type: "text", text: appendCursor(text, nextCursor) }],
   ```

   `SearchTools` 的描述和返回值则是动态工具名、description、schema、opaque
   `toolRef`，不是磁盘候选路径；它只在有 catalog Extension 时进入 front door。
   [`tool-catalog.ts#L66-L95`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L66-L95)

   ```ts
   this.searchTool = {
   	name: "SearchTools",
   	description:
   		"Search the dynamic tool catalog. When calling ExecuteTool, copy the exact toolRef returned here; do not use the tool name.",
   	parameters: searchParameters,
   	executionMode: "parallel",
   	execute: async (_toolCallId, args): Promise<AgentToolResult> => {
   		const matches = this.search(String(args.query), args.limit);
   		return {
   			content: [{ type: "text", text: JSON.stringify({ tools: matches }) }],
   			details: { tools: matches },
   		};
   ```

3. **工具描述把搜索规则写成自然语言，但没有把它变成 loop-level contract。** 默认
   instructions 要求使用 `grep/find`，Bash 描述又要求不要用 Bash 的
   `grep/find/ls`，必要时用 `rg`；Desktop 有 FFF 时这条指引成立，若 FFF 未挂载，
   模型拿到的基础工具面却没有 `grep/find`。自然语言没有“已搜过哪些 root”或
   “达到什么条件必须总结”的字段。[`default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6)

   ```ts
   export const DEFAULT_CODING_AGENT_INSTRUCTIONS = `You are Jai, a coding agent. Inspect the workspace before editing, keep changes scoped, and explain the result clearly.
   
   Do not narrate every routine tool call. Keep tool-use commentary for user-relevant decisions, discoveries, risks, blockers, or meaningful phase changes; the interface already shows the underlying work activity.
   
   Search the workspace with grep and find. For multiple OR terms, use one regex grep or parallel grep calls. If you must search through Bash, use rg; never bash grep or find.
   After locating a hit, Read only nearby lines with offset and limit. Known files outside the workspace: Read them directly.`;
   ```

   Bash 的 schema 只有一个任意 command 字符串和 timeout；这使 `ls/find/rg` 可以被
   自由组合，也没有单独的搜索参数、scope、limit、coverage 或 continuation 字段。
   [`bash.ts#L15-L20`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L15-L20)

   ```ts
   const bashParameters = Type.Object(
   	{
   		command: Type.String({ minLength: 1 }),
   		timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS })),
   	},
   	{ additionalProperties: false },
   );
   ```

4. **Shell 内部结果有少量结构化字段，但模型可见结果主要是文本。** `ShellResult`
   只保留 `exitCode/durationMs`；stdout/stderr chunk 虽带 stream 字段，Bash 的
   `append()` 只追加 `chunk.text`，没有把 stream 名称写入模型文本。`AgentToolResult.details`
   明确只给日志/UI，不进 LLM context。[`environment/types.ts#L62-L80`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/environment/types.ts#L62-L80)

   ```ts
   export interface ShellOutputChunk {
   	stream: "stdout" | "stderr";
   	text: string;
   }
   
   export interface ShellExecuteOptions extends AbortOptions {
   	cwd: string;
   	shell?: string;
   	timeoutMs: number;
   	onOutput?: (chunk: ShellOutputChunk) => void | Promise<void>;
   }
   
   export interface ShellResult {
   	exitCode: number | null;
   	durationMs: number;
   }
   ```

   `details` 的排除是 core contract，而不是 UI 约定：模型收到的是 `content` 被包成
   `toolResult`，结构化 `details` 留在运行侧。[`types.ts#L18-L32`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L32)

   ```ts
   export interface AgentToolResult<TDetails = unknown> {
   	/** 回给模型的内容（会被包进 ToolResultMessage 送回 LLM）。 */
   	content: (TextContent | ImageContent)[];
   	/** 给日志 / UI 的结构化数据，不进 LLM 上下文。 */
   	details?: TDetails;
   	/**
   	 * 提示 agent 在当前这批工具执行完后停止。
   	 * 早停仅当本批次每个工具结果都为 true 时才生效
   	 */
   	terminate?: boolean;
   }
   ```

5. **Bash 的裁剪是有界的，但不是搜索收敛信息。** 默认保留 tail 方向最多
   2,000 行、50 KiB、单行 2,000 字符；裁剪时把临时文件路径附到文本。空 stdout/stderr
   归一为 `(no output)`，非零退出附加 `Command exited with code N`，timeout/abort/
   spawn 失败也都以文本错误进入统一 loop。[`bash.ts#L186-L212`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L212)

   ```ts
   const final = snapshot();
   const text = final.text || "(no output)";
   keepOutput = final.truncated;
   const details: BashToolDetails = {
   	exitCode: shellResult.exitCode,
   	durationMs: shellResult.durationMs,
   	timedOut: false,
   	fullOutputPath: final.truncated ? temporaryFile.path : undefined,
   	truncation: final.truncation,
   };
   const diagnosticText = final.truncated
   	? appendStatus(final.text, `[Output truncated. Full output: ${temporaryFile.path}]`)
   	: final.text;
   if (shellResult.exitCode !== 0) {
   ```

   上限常量是明确的数值，而不是“输出很大”这种模糊描述。[`truncate.ts#L3-L5`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/truncate.ts#L3-L5)

   ```ts
   export const DEFAULT_MAX_LINES = 2_000;
   export const DEFAULT_MAX_BYTES = 50 * 1024;
   export const DEFAULT_MAX_LINE_LENGTH = 2_000;
   
   export interface TruncateOptions {
   	direction?: "head" | "tail";
   	maxLines?: number;
   	maxBytes?: number;
   ```

6. **失败和空结果会显示给模型，但没有统一的可恢复错误 DTO 或停止语义。** Agent
   loop 捕获普通工具异常，取 `error.message`/`String(error)` 做文本，设置 `isError`，
   再照常发布 `tool_execution_end`；因此内部 TaggedError 的 `_tag`、cause、结构化
   `details` 不会自动成为模型可判定的 `reason/nextAction` 字段。[`agent-loop.ts#L661-L689`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L661-L689)

   ```ts
   result = await dispatch(0);
   } catch (error) {
   	if (isEffectGateInterrupted(error)) throw error;
   	// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
   	result = {
   		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
   	};
   	isError = true;
   } finally {
   	acceptingUpdates = false;
   }
   
   const outcome: ExecutedToolCall = {
   ```

   FFF 的空 find/grep 是成功文本，不是 error；Read 的空文件是 `(empty file)`，Read
   超出 offset 才抛 typed error；这使“没有命中”“空文件”“参数越界”在模型侧都是
   不同的文本形状，而非统一的 `empty_result`/`invalid_scope` DTO。[`search/index.ts#L85-L97`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L85-L97)

   ```ts
   const text = result.value.items.length
   	? result.value.items
   			.map((item) => `${item.relativePath}${annotation(item.gitStatus, item.totalFrecencyScore)}`)
   			.join("\n")
   	: "No files found matching pattern";
   return {
   	content: [{ type: "text", text: appendCursor(text, nextCursor) }],
   	details: {
   		count: result.value.items.length,
   		totalMatched: result.value.totalMatched,
   ```

   Read 的空/截断/offset 行为则是以下明确文本；但它仍通过上面的通用 error path
   回灌，未形成跨工具的“已查过 path”事实。[`read.ts#L137-L175`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/read.ts#L137-L175)

   ```ts
   if (offset > Math.max(1, totalLines)) {
   	throw readError("offset_out_of_range", {
   		message: `Offset ${offset} is beyond end of file (${totalLines} lines)`,
   	});
   }
   const hasMore = offset - 1 + selected.length < totalLines;
   const truncated = hasMore || bytesCapped || linesTruncated;
   …
   if (!text && totalLines === 0) text = "(empty file)";
   if (truncated) {
   	const endLine = offset + selected.length - 1;
   	const continuation = nextOffset ? ` Use offset=${nextOffset} to continue.` : "";
   	text += `\n\n[Showing lines ${offset}-${Math.max(offset, endLine)} of ${totalLines}.${continuation}]`;
   ```

7. **ACP transcript projection不会改善下一次模型决策。** Runtime 的 live operation
   event 明确是可丢弃的进度；durable tool-result entry 才投影为 ACP
   `tool_call_update`，文本/图片/diff 和 `isError` 被投影到客户端，Bash terminal 的
   exit 也等 T2 result entry。这里没有把 Desktop `DesktopToolItem` 反写为
   `AgentContext` 或追加模型消息。[`runtime.ts#L25-L31`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/operations/runtime.ts#L25-L31)

   ```ts
   /**
    * Whitelisted, disposable progress emitted by a running Operation.
    *
    * These are intentionally not a second journal: message and tool terminal
    * facts are published separately when their Session Journal entries commit.
    * The Host may drop this stream at any time and reconstruct a client from its
    * durable snapshot.
    */
   export type RuntimeOperationEvent =
   ```

   durable ACP 投影只做状态/内容映射；它不会决定是否发下一次 provider request。
   [`acp-v2/agent.ts#L737-L767`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L737-L767)

   ```ts
   const content: object[] = [];
   for (const part of message.content) {
   	if (part.type === "text") {
   		content.push({ type: "content", content: { type: "text", text: part.text } });
   	} else {
   		content.push({ type: "content", content: { type: "image", data: part.image, mimeType: part.mimeType } });
   	}
   }
   const updates = [
   	toolCallUpdate(sessionId, {
   		toolCallId: message.toolCallId,
   		status: message.isError ? "failed" : "completed",
   		content,
   		operationId,
   		toolName: message.toolName,
   	}),
   ];
   // The result Session entry is T2. Only now may ACP learn that the display
   ```

   模型真正看见的路径是 `toolResult → context.messages → provider request`，而不是
   ACP/UI card；这条回灌由 core 明确完成。[`agent-loop.ts#L253-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L253-L270)

   ```ts
   if (toolCalls.length > 0) {
   	const batch = await executeToolCallBatch(run, toolCalls);
   	toolResults = batch.messages;
   	hasMoreToolCalls = !batch.terminate;
   
   	for (const result of toolResults) {
   		context.messages.push(result);
   		newMessages.push(result);
   	}
   }
   
   await emit({ type: "turn_end", message, toolResults });
   return { hasMoreToolCalls, stopped: false };
   ```

8. **模型不会从当前模型 context 中直接得到 cwd、Project id、Project name 或邻居
   项目列表。** Desktop 将 Session project 的 canonical path 解析成 `cwd`，再传给
   Runtime；SDK 把它用于 execution context、config root 和 default allowed directory，
   但默认 instructions 只含通用搜索提示。provider-ready context 的字段也只有
   `systemPrompt/messages/tools`。因此模型通常需要通过 `pwd` 或路径错误反推工作区；
   “模型不知道 cwd”是模型可见上下文层面的事实，不代表 runtime 没有 cwd。
   [`remote.ts#L237-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)

   ```ts
   async resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext> {
   	const session = await this.getSession(sessionId);
   	if (session.projectId === null || !(await this.isProjectAvailable(session.projectId)))
   		return { localFileAccess: false };
   	const project = await this.getProject(session.projectId);
   	return {
   		localFileAccess: true,
   		cwd: project.canonicalPath,
   		configRoot: project.canonicalPath,
   		defaultAllowedDirectories: [project.canonicalPath],
   	};
   }
   ```

   ACP prompt 请求只把用户文本和附件 resource link 发给 `session/prompt`，没有把
   `cwd`、Project metadata 或 search scope 放进 prompt block。[`acp-host.ts#L326-L346`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L326-L346)

   ```ts
   const runtime = await this.#ensureSession(input.sessionId, input.modelRef, input.mode);
   await this.#setConfiguration(runtime, input.modelRef, input.mode);
   const prompt = [
   	{ type: "text", text: input.message } as const,
   	...(input.resolvedAttachments ?? []).map((attachment) => ({
   		type: "resource_link" as const,
   		uri: pathToFileURL(attachment.sourcePath).toString(),
   		name: attachment.filename,
   	})),
   ];
   const response = await this.#request("session/prompt", {
   	sessionId: runtime.sessionId,
   	prompt,
   ```

   当前 provider request 也只组装 system prompt、messages、tools；`cwd` 没有独立字段。
   [`agent-loop.ts#L373-L398`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L373-L398)

   ```ts
   async function attemptModelCall(run: AgentLoopRuntime, request: AgentContext): Promise<ModelCallAttempt> {
   	const { config, signal, emit } = run;
   	
   	const llmContext: Context = {
   		systemPrompt: request.systemPrompt,
   		messages: projectToolCallProtocol(request.messages),
   		tools: request.tools,
   	};
   	
   	const reservation = await reserveModelEffect(config, request, signal);
   	await pauseBeforeEffect(config, {
   		type: "model_intent",
   	});
   	observeModelRequest(config, {
   ```

   FFF 自己也把扫描根绑定为 `context.cwd`，并关闭 filesystem root/home scanning；所以
   “找 cwd 外的 sibling project”不是 FFF 的默认能力，而是模型必须另走 Bash 或额外能力。
   [`search/index.ts#L224-L242`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L224-L242)

   ```ts
   async function createFinder(
   	context: CodingExtensionContext,
   	options: FffSearchExtensionOptions,
   ): Promise<ResultType<FileFinderApi, CodingExtensionOperationFailed>> {
   	try {
   		const dataDirectory = options.dataDirectory;
   		if (dataDirectory) await mkdir(dataDirectory, { recursive: true });
   		const created = FileFinder.create({
   			basePath: context.cwd,
   			aiMode: true,
   			enableFsRootScanning: false,
   			enableHomeDirScanning: false,
   			…
   		});
   ```

9. **当前唯一通用硬预算是可选的 turn 上限，不是搜索预算；没有当前源码证据表明
   有重复检测。** `AgentLoopConfig.maxIterations` 是可选字段，`CodingAgent` 只有在
   `maxTurns` 存在时才映射它。当前已有搜索范围内没有命中 `same query/command`、
   `repeat search/tool`、`no progress`、`information gain` 等 guard 词；这只能证明
   本次静态检索范围内没有显式命名的 guard，不能证明 provider 内部没有隐藏机制。
   [`core/types.ts#L198-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L198-L247)

   ```ts
   export interface AgentLoopConfig {
   	model: Model;
   	provider: Provider;
   	temperature?: number;
   	maxTokens?: number;
   	providerOptions?: Record<string, Record<string, unknown>>;
   	/** 单次 invoke 中可发起的最大 model turn 数。 */
   	maxIterations?: number;
   	toolExecution?: ToolExecutionMode;
   	toolCallResolver?: ToolCallResolver;
   	toolMiddlewares?: ToolMiddleware[];
   	effectBoundary?: EffectBoundary;
   	modelRequestObserver?: ModelRequestObserver;
   	effectGate?: ManualEffectGate;
   ```

   `maxTurns` 的映射是直通关系，没有默认值注入。[`create-coding-agent.ts#L126-L135`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/create-coding-agent.ts#L126-L135)

   ```ts
   resolveProvider: () => {
   	const runtime = resolveSdkModel(input.model, input.provider);
   	modelRuntime = runtime;
   	return runtime;
   },
   resolveAgentOptions: () => ({
   	...(input.maxTurns === undefined ? {} : { maxIterations: input.maxTurns }),
   	...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
   	...(input.effectBoundary ? { effectBoundary: input.effectBoundary as EffectBoundary } : {}),
   }),
   ```

   仓库已有的定向检索没有发现重复/无进展 guard；这是负面证据，范围限于列出的
   Agent/Coding Agent/Extension/Runtime/ACP 源码目录：

   ```text
   rg -n -i 'same.{0,30}(query|command)|repeat.{0,30}(search|tool)|no.?progress|information gain|similar.{0,30}(search|tool)' \
     packages/agent/src packages/coding-agent/src packages/extension/src \
     app/desktop/electron/agent app/server/src/runtime app/server/src/protocol/acp-v2 app/server/src/agents || true
   
   # 无输出
   ```

   注意：Operation recovery 的 `repeats model attempt`、`dispatches tool call twice`
   是 durable journal 完整性检查，不是“模型重复搜索”的运行时抑制；它在发现坏日志
   时报 corruption，不能阻止 provider 下一轮发出相似 Bash。[`recovery.ts#L47-L87`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/operations/recovery.ts#L47-L87)

   ```ts
   case "model_attempted":
   	if (attempts.has(record.attemptId)) {
   		return corrupted(`Operation "${operationId}" repeats model attempt "${record.attemptId}"`);
   	}
   	attempts.set(record.attemptId, record);
   	break;
   
   case "tool_dispatched":
   	if (!hasAssistantEntry(attempts, record.assistantEntryId)) {
   		return corrupted(
   			`Tool "${record.toolCallId}" was dispatched without a matching model attempt in operation "${operationId}"`,
   		);
   	}
   ```

10. **run 的结束条件是 loop 结构，不是“搜索质量足够”。** 自然结束需要没有
    未终止的工具调用、没有 steering/follow-up；显式 abort、provider error、
    context overflow 会停；`maxIterations` 到达会生成 `iterationLimit`；
    `terminate: true` 只有批次内所有结果都为 true 才停。[`agent-loop.ts#L206-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L206-L216)

    ```ts
    const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];
    
    if (followUpMessages.length > 0) {
    	pendingMessages = followUpMessages;
    	continue;
    }
    
    break;
    }
    await emit({ type: "agent_end", messages: newMessages });
    ```

    provider 的 `stop`、`length` 或 `toolUse` 会继续按消息内容判断；`error`、
    `aborted`、`contextOverflow` 则立即收尾。[`agent-loop.ts#L237-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L237-L270)

    ```ts
    if (isModelOutputProtocolViolation(message)) {
    	const failure = createProtocolRepairFailureMessage(message);
    	…
    	return { hasMoreToolCalls: false, stopped: true };
    }
    
    newMessages.push(message);
    if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "contextOverflow") {
    	await emit({ type: "turn_end", message, toolResults: [] });
    	return { hasMoreToolCalls: false, stopped: true };
    }
    ```

    Runtime Host 最后再把 Coding Agent 的最终 assistant message 映射成
    `completed/failed/aborted`；这里没有“已有候选结果的 partial summary”兜底。
    [`coding-agent.ts#L493-L499`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L493-L499)

    ```ts
    function resolveOutcome(messages: readonly CodingAgentMessage[]): RuntimeOperationOutcome {
    	const finalAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    	if (!finalAssistant) return "failed";
    	if (finalAssistant.stopReason === "aborted") return "aborted";
    	if (finalAssistant.stopReason === "error" || finalAssistant.stopReason === "contextOverflow") return "failed";
    	return "completed";
    }
    ```

run 在没有更多 follow-up 时退出；这里没有搜索质量判断。[`agent-loop.ts#L206-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L206-L216)

```ts
const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];

if (followUpMessages.length > 0) {
	pendingMessages = followUpMessages;
	continue;
}

break;
}
```

## “pwd / ls / find / rg”逐步上下文缺口

下列步骤以仓库已有的 `we0-run-trace.md` 为运行记录依据。它不是当前 commit 中的
源码 permalink，而是工作树里的本地研究笔记；因此这里只把它当作该次运行的观测，
不把它扩大成所有运行的普遍事实。步骤背后的静态机制见上面的结论。

run 在没有更多 follow-up 时退出；这里没有搜索质量判断。[`agent-loop.ts#L206-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L206-L216)

```ts
const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];

if (followUpMessages.length > 0) {
	pendingMessages = followUpMessages;
	continue;
}

break;
}
```

### 1. `pwd && ls -la`

**观测。** 模型先用 Bash 反推当前目录；已有 trace 记录该命令确认的是
`.../app/desktop`，而不是用户想找的 sibling project 根。[`we0-run-trace.md#L99-L105`](../harness/we0-run-trace.md#L99-L105)

```text
2. **15:04:31.513，turn 1（调用 1–2）。**
   - `Bash: pwd && ls -la`：确认 cwd 是 `[USER_HOME]/code/jai-mono/app/desktop`，只看到 Desktop 子项目。
   - `find: {pattern:"we0",limit:50}`：返回 50 个近似字符串命中，主要是 bundle/hash/`web-search`；结尾为 `[Continue with cursor="fff_c1"]`，明确发生工具分页截断。模型没有使用 cursor 继续。
3. **15:04:39.195，turn 2（调用 3–4）。**
   - 枚举 `jai-mono` 根目录、git status、git log：发现这是 `jai-mono`，与用户要找的项目无直接关系。
   - `find` 指定 `path:"[USER_HOME]/code/jai-mono"`：0.003 秒即失败，错误为 `Search path must stay inside the workspace`。
```

**可能缺口。** `cwd` 存在于执行环境和 ACP session metadata，不在 model context；
模型必须付出一次 shell 调用才能获得它。**推断：** 如果首轮直接得到
`workspaceRoot`、`candidateDiscoveryRoots` 和“当前 Session 属于 jai-mono/app/desktop”
这类只读事实，这一步可能被省掉；源码不能证明该模型一定会省掉。

循环本身只在可选 turn 上限或后续消息耗尽时推进/退出；没有搜索完成判定。[`agent-loop.ts#L167-L204`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204)

```ts
while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
	if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
		const message = createIterationLimitMessage(config, turnCount);
		…
		return;
	}
	let turn: TurnResult;
```

### 2. `find we0`

**观测。** FFF `find` 是专用工具，但默认根是当前 `context.cwd`，并且结果分页；
trace 记录了 cursor，却没有下一次带 cursor 的调用。[`search/index.ts#L70-L97`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L97)

```ts
const resumed = input.cursor ? this.#findCursors.get(input.cursor) : undefined;
if (input.cursor && !resumed) throw fileSearchError("search_failed", "Unknown find cursor");
const query = resumed?.query ?? buildQuery(input.path, input.pattern, input.exclude);
const pageSize = resumed?.pageSize ?? Math.max(1, input.limit ?? DEFAULT_FIND_LIMIT);
const pageIndex = resumed?.nextPageIndex ?? 0;
const result = this.#finder.fileSearch(query, { pageIndex, pageSize });
…
const nextCursor =
	result.value.totalMatched > pageIndex * pageSize + result.value.items.length
		? this.#storeFindCursor({ query, pageSize, nextPageIndex: pageIndex + 1 })
		: undefined;
```

**可能缺口。** 结果没有结构化的 `scopeComplete`、`rootSearched` 或“该 query 已
在当前 root 的第一页命中但未覆盖完整”的模型状态；cursor 只是文本 marker 和
details 字段。**推断：** 模型可能把“有命中但截断”解释成“还需要换 query”，
进而重复 `find`/Bash，而不是续页。

默认指令确实只提供自然语言搜索偏好，没有 root、coverage 或停止字段。[`default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6)

```ts
export const DEFAULT_CODING_AGENT_INSTRUCTIONS = `You are Jai, a coding agent. Inspect the workspace before editing, keep changes scoped, and explain the result clearly.

Do not narrate every routine tool call. Keep tool-use commentary for user-relevant decisions, discoveries, risks, blockers, or meaningful phase changes; the interface already shows the underlying work activity.

Search the workspace with grep and find. For multiple OR terms, use one regex grep or parallel grep calls. If you must search through Bash, use rg; never bash grep or find.
```

### 3. `ls`/git 枚举 `jai-mono`

**观测。** 第二轮继续列当前仓库、git status、git log，并再次用 `find we0*`；
已有记录明确说该根目录与目标无直接关系。[`we0-run-trace.md#L103-L108`](../harness/we0-run-trace.md#L103-L108)

```text
3. **15:04:39.195，turn 2（调用 3–4）。**
   - 枚举 `jai-mono` 根目录、git status、git log：发现这是 `jai-mono`，与用户要找的项目无直接关系。
   - `find` 指定 `path:"[USER_HOME]/code/jai-mono"`：0.003 秒即失败，错误为 `Search path must stay inside the workspace`。路径并非目录不存在，而是该工具只接受 workspace 内的相对 constraint。
4. **15:04:44.276，turn 3（调用 5–6）。**
   - 在 `jai-mono` 内 `rg -l -i "we0"`：只得到 8 个包含字符串的文档/测试/字体索引文件，没有项目。
   - `ls docs packages plugins app .jnative`：重复枚举当前仓库领域目录，没有产生 we0 项目候选。
```

**可能缺口。** Tool result 只告诉模型这一轮输出，不生成“`jai-mono` 已作为
candidate root 排除/已完整覆盖”的事实。**推断：** 没有 coverage ledger 时，模型
会把“当前 root 没找到”当成继续改 query 的理由，而不是进入 `not_found_in_root`
状态。

模型可见的 tool result 只有 `content`；结构化 `details` 不进 LLM。[`types.ts#L18-L32`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L32)

```ts
export interface AgentToolResult<TDetails = unknown> {
	/** 回给模型的内容（会被包进 ToolResultMessage 送回 LLM）。 */
	content: (TextContent | ImageContent)[];
	/** 给日志 / UI 的结构化数据，不进 LLM 上下文。 */
	details?: TDetails;
	/**
	 * 提示 agent 在当前这批工具执行完后停止。
	 * 早停仅当本批次每个工具结果都为 true 时才生效
	 */
	terminate?: boolean;
}
```

### 4. `rg -l -i "we0"` + 再次 `ls`

**观测。** 该步骤仍在 `jai-mono` 内做内容搜索和目录枚举；它没有新增 sibling
candidate。[`we0-run-trace.md#L106-L111`](../harness/we0-run-trace.md#L106-L111)

```text
5. **15:04:47.458，turn 4（调用 7–8）。**
   - 读取 `.jnative/CONTEXT.md` 前 60 行：与找项目无关。
   - 再次 `rg "we0|w0"` 并列 `docs/point docs/record`：结果与上轮高度重合，仍没有候选。
6. **15:04:51.552，turn 5（调用 9–10）。**
   - `ls [USER_HOME]/code`：首次把范围扩大到用户的代码根目录，直接看到 `we0claw` 与 `wecode`。
   - `find [USER_HOME]/code -maxdepth 2 ...`：直接返回 5 个候选：`we0claw`、`wecode/we0-agent-sdk`、`we0agent`、`we0conatiner`、`new-we0`。
```

**可能缺口。** shell 文本没有“与上次结果相似度/新增候选数/搜索 scope”的机器
字段；compaction 也只是文本摘要，不是 search ledger。**推断：** 结果高度重合仍
不足以触发本地 no-progress circuit breaker。

Bash 的结果细节虽记录退出码和裁剪信息，模型仍只获得文本 content。[`bash.ts#L186-L212`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L212)

```ts
const final = snapshot();
const text = final.text || "(no output)";
keepOutput = final.truncated;
const details: BashToolDetails = {
	exitCode: shellResult.exitCode,
	durationMs: shellResult.durationMs,
	timedOut: false,
	fullOutputPath: final.truncated ? temporaryFile.path : undefined,
	truncation: final.truncation,
};
```

### 5. 第一次扩大到 `/Users/.../code`

**观测。** 第 5 个 turn 才从当前 workspace 走到用户 code 根目录，并一次得到多个
候选；trace 判断调用 10 已足以让定位阶段收敛。[`we0-run-trace.md#L112-L117`](../harness/we0-run-trace.md#L112-L117)

```text
6. **15:04:51.552，turn 5（调用 9–10）。**
   - `ls [USER_HOME]/code`：首次把范围扩大到用户的代码根目录，直接看到 `we0claw` 与 `wecode`。
   - `find [USER_HOME]/code -maxdepth 2 ...`：直接返回 5 个候选：`we0claw`、`wecode/we0-agent-sdk`、`we0agent`、`we0conatiner`、`new-we0`。**到调用 10，定位阶段已经足以收敛。**
7. **15:04:53.996，turn 6（调用 11–12）。**
   - `ls [USER_HOME]/code/wecode`：看到多个项目及目录时间；根目录 `git status` 无输出，不能证明子项目状态。
   - 枚举 4 个相关目录：得到 `package.json`/`pyproject.toml`/README 等框架线索。
```

**可能缺口。** 系统没有把“允许扩大到哪个 root”作为模型可见的授权状态，也没有
结构化返回候选、匹配理由、完整性和下一步建议。Bash 可以完成这个动作，但把
候选发现、排序、读取项目元数据混在一个宽入口内。

Session catalog 返回的是 runtime 的 cwd/allowed directory，不是 model context 字段。[`remote.ts#L237-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)

```ts
	const project = await this.getProject(session.projectId);
	return {
		localFileAccess: true,
		cwd: project.canonicalPath,
		configRoot: project.canonicalPath,
		defaultAllowedDirectories: [project.canonicalPath],
	};
```

### 6. 在候选父目录继续 `ls`

**观测。** 得到候选后，模型继续列 `wecode` 和相关目录，并开始凭目录时间推断
“最新”。trace 明确指出只比较了 `wecode` 直系目录，结论未证实。[`we0-run-trace.md#L115-L120`](../harness/we0-run-trace.md#L115-L120)

```text
7. **15:04:53.996，turn 6（调用 11–12）。**
   - `ls [USER_HOME]/code/wecode`：看到多个项目及目录时间；根目录 `git status` 无输出，不能证明子项目状态。
   - 枚举 4 个相关目录：得到 `package.json`/`pyproject.toml`/README 等框架线索。模型此时宣称“`new-we0` 是最新的（8月10日更新）”，但证据只比较了 `wecode` 直系目录，未比较 `we0claw`，也未读取项目说明，结论未证实。
8. **15:04:57.595，turn 7（调用 13–14）。**
   - 调用 13 枚举 `new-we0`：发现它只是非 git 容器目录；其子目录 `we0` 时间为 9 月 9 日、`we0-agent-x` 为 9 月 6 日；`git status` 返回 `fatal: not a git repository`。
```

**可能缺口。** 用户词“最新”没有被工具契约定义为 mtime、git commit time、
Desktop `updatedAt` 或最近打开时间，模型也没有结构化排序字段可直接比较。
**推断：** 这会让模型继续用 `ls`、`stat`、`git status/log` 探索不同“最新”信号，
而不是先询问排序定义或使用统一候选表。

turn 上限是可选配置，而不是搜索专用预算。[`core/types.ts#L198-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L198-L247)

```ts
export interface AgentLoopConfig {
	model: Model;
	provider: Provider;
	temperature?: number;
	maxTokens?: number;
	providerOptions?: Record<string, Record<string, unknown>>;
	/** 单次 invoke 中可发起的最大 model turn 数。 */
	maxIterations?: number;
```
### 7. 对错误的路径/仓库继续试探

**观测。** `new-we0` 本身不是 git root，但 shell 组合命令仍能返回内部
`fatal: not a git repository`；Bash contract 只有整体 shell exit code，且组合命令
可以自行隐藏子命令错误。[`we0-run-trace.md#L118-L122`](../harness/we0-run-trace.md#L118-L122)

```text
8. **15:04:57.595，turn 7（调用 13–14）。**
   - 调用 13 枚举 `new-we0`：发现它只是非 git 容器目录；其子目录 `we0` 为 9 月 9 日、`we0-agent-x` 为 9 月 6 日；`git status` 返回 `fatal: not a git repository`。
   - 调用 14 计划对 6 个子目录批量 `git -C ... status`。该跨 workspace Bash 触发审批；等待约 32.272 秒后用户拒绝，结果为 `isError:true`。
9. **15:05:29.939，turn 8。** 权限拒绝后 provider 调用立即得到 `content:[]`、0 tokens、`stopReason:"aborted"`、`error.message:"Request was aborted"`。
10. **15:05:31.793，operation finished。** durable outcome 是 `aborted`，没有最终自然语言回复。
```

**可能缺口。** 失败结果只有文本和 `isError`，没有 `wrong_project_root`、
`git_root=false`、`subcommandExitCodes` 或“不要在这个候选上继续”的结构化恢复
动作。**推断：** 模型可能把“命令整体可执行但其中某个路径不是 git root”当成需要
继续探测的普通证据。

工具异常会被做成文本 error result，并标记 `isError`，而不是生成终止消息。[`agent-loop.ts#L661-L689`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L661-L689)

```ts
result = await dispatch(0);
} catch (error) {
	if (isEffectGateInterrupted(error)) throw error;
	// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
	result = {
		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
	};
	isError = true;
```

### 8. 最后一批跨 workspace Bash 被拒绝

**观测。** 该次 permission deny 后，provider 返回 `aborted`，运行结束，没有本地
partial summary；这是既有 trace 的终态，不能解释为模型正常 stop。[`we0-run-trace.md#L377-L405`](../harness/we0-run-trace.md#L377-L405)

```text
**主张。** 最后一个权限决定为 deny；权限中间件生成 `Permission denied...`。下一次模型消息是 `stopReason:"aborted"`，runtime 的 `resolveOutcome` 明确映射成 aborted。
…
packages/coding-agent/src/permissions/middleware.ts @ 78ce6200, L188-L190:
if (approval === "deny") {
  settlePermission(options.telemetryObserver, context.toolCall.id, "denied");
  throw permissionDeniedError(toolName, "User denied the permission request");
}
…
app/server/src/agents/coding-agent.ts @ 78ce6200, L493-L498:
if (finalAssistant.stopReason === "aborted") return "aborted";
```

**可能缺口。** Runtime 没有把已持久化的候选路径/工具结果投影成“已完成部分 + 未
完成部分”的最终摘要；abort 直接是 operation 终态。是否需要 partial summary 是产品
语义问题，本审计不建议通过 ACP/UI projection 偷写 journal。

运行中的 operation event 是可丢弃进度，不是第二份 journal。[`runtime.ts#L25-L31`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/operations/runtime.ts#L25-L31)

```ts
/**
 * Whitelisted, disposable progress emitted by a running Operation.
 *
 * These are intentionally not a second journal: message and tool terminal
 * facts are published separately when their Session Journal entries commit.
 * The Host may drop this stream at any time and reconstruct a client from its
 * durable snapshot.
 */
export type RuntimeOperationEvent =
```

## 逐项契约速查

| 问题 | 当前答案 | 限制 |
|---|---|---|
| 是否有搜索专用能力 | 基础 SDK 没有；Desktop 有 FFF `find/grep`；`SearchTools` 只搜动态工具 catalog | `find/grep` 的 root 是当前 `cwd`，`ls/rg` 仍走任意 Bash |
| Shell 结果是否结构化 | 内部有 `exitCode/durationMs/truncation`；模型主要收到文本 `content` | `details` 不进 LLM，stdout/stderr stream 标签也没有进入文本 |
| 空结果如何显示 | Bash `(no output)`；FFF find/grep 是成功文本；Read `(empty file)` | 没有统一 empty-result DTO 或 `complete=true` |
| 失败如何显示 | `isError:true` + error message 文本 | `_tag/cause/details` 不自动进入模型恢复协议 |
| 模型如何知道 cwd | runtime、权限、文件解析知道；模型 context 不显式知道 | ACP prompt 只带用户文本/附件，不带 cwd/project metadata |
| 模型如何知道已有结果 | 可从历史 `toolResult` 文本回看 | 无 search coverage ledger、结果 fingerprint、候选状态或增量字段 |
| 最大步数/重复检测 | 可选 `maxTurns → maxIterations`；没有搜索专用预算/静态重复 guard | recovery 的 duplicate checks 只防坏日志 |
| run 何时结束 | 无工具/steering/follow-up，或 terminate/maxIterations/abort/error/overflow | 不按“候选足够”“无信息增益”自然结束 |

表中每一行的具体证据已在上文紧跟对应主张；表格只做索引，不新增结论。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 仅本仓库源码与测试，钉定 `78ce62007ec54166c63622ef09e88da8a438b384`；覆盖 Agent loop、工具 harness、FFF、ToolCatalog、Coding Agent context、Runtime Host、ACP projection、Desktop cwd 解析。 |
| 作者或维护者本人的说法 | 未查外部；仓库内注释、测试和已有 `.jnative` 研究笔记只作为本地设计意图/运行记录辅助证据。 |
| 同类方案 | 不适用；用户明确要求不查外部项目。 |
| issue / PR / 社区实践 | 未查；本题的结论可由当前仓库源码与已有本地 `we0` trace 核验，外部资料会越界。 |
| 历史演变 | 未作为本审计结论依据；只读取已有笔记中的历史背景，不把旧实现混入当前 SHA。 |

## 对本项目的影响

- 当前假设“模型会自己从多次 `ls/find/rg` 中收敛”被源码证伪为不可靠：
  loop 只有消息/工具/可选 turn 上限语义，没有搜索质量停止语义。
- 当前假设“ACP transcript card 能告诉模型已经查过什么”被架构证伪：
  ACP/Desktop 是单向 disposable projection，模型回灌走 durable `toolResult`；
  UI card 不会成为下一轮 context。
- 当前事实是“工具结果并非完全丢失”：成功/失败结果会回到模型；真正缺少的是
  结构化的 scope、coverage、候选状态、结果摘要和可判定 next action。
- 输出裁剪、timeout、compaction 只能控制一次调用的成本和 context 容量，不能替代
  search budget 或 no-progress detector。
- ToolCatalog 的 stale `toolRef → search again` 是独立的潜在重复路径；它不能解释
  本次已有 trace 中的 `ls/find/rg`，因为该 trace 没有 `SearchTools/ExecuteTool`。
- 本审计没有修改产品代码，也没有提出必须实现的具体 patch。

### 证伪当前假设所需的运行日志/数据

下面这些数据可以把“源码允许重复”与“某次模型确实因某个缺口重复”区分开：

1. **每次 provider request 的完整最终 context**：system prompt、工具 schema、按顺序
   的 messages、当前 operation/turn id；必须包含是否有 cwd/project/scope 注入。
2. **每个 tool call 的原始参数与规范化参数**：tool name、canonical cwd/root、
   query/path/pattern/cursor、command、timeout、call id、assistant attempt id。
3. **每个结果的结构化执行记录**：stdout/stderr 分开、exit code、duration、timeout、
   truncation totals、returned count、total count、cursor、empty/error code；不能只保留
   合并后的文本。
4. **模型可见结果与 UI/ACP 结果的对照**：验证是否发生二次裁剪、compaction、摘要
   丢失、以及 ACP projection 是否真的被错误地回灌模型。
5. **按 Operation 的搜索覆盖 ledger 或等价事件**：已访问 root、query fingerprint、
   结果 fingerprint、候选集合、是否 complete、是否新增候选、是否触发 stop/deny。
6. **终止原因与用户交互**：provider stop reason、`maxIterations` 配置快照、abort
   source、permission request/decision timestamp、是否有 follow-up/steer。
7. **目标运行的 provider 原始请求/响应或脱敏 trace**：确认模型是否看到上一轮完整
   toolResult、是否请求过 cursor、以及在候选足够后隐藏 reasoning 给出的下一步理由。
8. **目标 workspace/project 解析记录**：Session project id/display name、canonical
   cwd、允许的额外 roots、trust 状态、动态 Extension catalog snapshot；用于判断
   “we0”是 sibling checkout、MCP server 还是其它实体。
