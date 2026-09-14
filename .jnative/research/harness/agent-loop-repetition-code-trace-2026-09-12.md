# Desktop Agent Loop 重复搜索的代码追踪

核验日期：2026-09-12（Asia/Shanghai）。钉住当前 git commit：
`78ce62007ec54166c63622ef09e88da8a438b384`（`fix(desktop): align work timeline with run lifecycle`）。

本笔记只追踪 `jai-mono` 当前源码和本机已有的真实 SQLite run 记录；不做外部同类产品调研，不研究 UI CSS/滚动，不修改产品源码。工作树在核验时已有其他未提交修改；所有源码链接都固定到上述 commit，因此不会把未提交内容当成当前版本证据。已先阅读 `AGENTS.md` 以及已有 harness/desktop/tools 研究笔记；其中 `.jnative/research/harness/we0-run-trace.md` 提供了目标 run 的数据库取证，本笔记补上它对应的运行代码因果链。

## 结论

1. **重复 `ls/find/rg` 是模型跨多个 turn 的重新规划，不是 Bash、FFF 或 ACP 在内部自动重试。** 当前真实 run 有 8 次模型尝试、14 个模型 tool call、14 个 tool result；其中 11 次是 `Bash`、2 次是 FFF `find`，最后一次 Bash 权限请求被拒绝。Agent loop 在普通工具结果后把结果加入上下文，并继续下一次 provider request；它没有“相似命令”“重复 query”或“无信息增益”停止条件。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L223-L270)

2. **实际 run 的第一层放大器是搜索范围和工具契约的错配。** Desktop 把 Session 的 `cwd` 作为 ACP `session/resume`/`session/new` 的工作区；真实 run 的 cwd 是 `jai-mono/app/desktop`。第一次 FFF `find` 命中的是模糊候选并返回 continuation cursor，但模型没有续 cursor；第二次 FFF `find` 传入绝对路径，被源码明确判为越过 workspace boundary。模型随后用多批 Bash `ls`、`find`、`rg` 补偿。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L98)

3. **FFF `find`/`grep` 在 Desktop 当前装配中是静态 extension tools，不经过 `SearchTools`/`ExecuteTool`。** Tool catalog 仍有独立的动态能力路径：它只对声明 catalog 的 Extension 暴露稳定前门，搜索是 lexical score，重复 query 没有去重；stale `toolRef` 也会要求“search again”。这能解释另一类反复 `SearchTools` 的路径，但不能把本次真实 run 的 `find` 归因于 tool catalog。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L107-L132)

4. **失败和空结果是“可继续的模型反馈”，不是 run stop signal。** Agent loop 将工具异常转成 `isError: true` 的 `toolResult`，仍把它喂回模型；Bash 空输出被规范化为 `"(no output)"`，FFF 空结果是成功文本 `"No files found matching pattern"`/`"No matches found"`。这些结果都没有 `terminate: true`，所以普通搜索后仍然会请求模型。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L585-L689)

5. **ACP/Desktop projection 只显示和重放 durable 事实，不会生成下一次 shell 调用。** Runtime 在 tool result journal entry 完成后才投影 ACP `tool_call_update`；Desktop 再把它转成 `DesktopToolItem`。重复动作的决定点在 provider 返回的下一条 assistant tool call 和 core loop，不在 projection 层。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L737-L768)

6. **真正的硬停止是自然结束、显式 terminate、abort/error/context overflow，或可选的 `maxIterations`；没有“搜索已经足够”的内建停止。** 本次记录最后一轮是 permission deny 后的 `stopReason: "aborted"`，不是模型正常总结；目标 operation 因此以 `aborted` 结束，没有本地 fallback summary。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L176)

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 当前仓库源码，全部链接钉在 `78ce62007ec54166c63622ef09e88da8a438b384`；覆盖 Desktop RPC/ACP、Runtime Host、Coding Agent、Agent loop、FFF、tool catalog 和 projection。 |
| 作者或维护者本人的说法 | 未查。用户明确要求只追踪本仓库真实运行链路，不引入外部说法。 |
| 同类方案 | 不适用。本任务边界禁止外部同类产品调研。 |
| issue / PR / 社区实践 | 未查。当前问题可由本仓库源码和本机 durable run 直接核验。 |
| 历史演变 | 未查。目标是当前 commit 的真实链路，不把历史实现混入当前结论。 |

## 从用户消息进入 Desktop ACP

### 发现 1：普通首条消息只提交一次 `agent.send`；运行中再次输入走 `followUp`

**主张。** Desktop renderer 的 `useChat.sendMessage()` 在没有 active run 时调用 `desktop.agent.send()`；如果 Agent 已经 `running`，同一入口调用 `desktop.agent.followUp()`。因此，题目所说的“一个用户请求内部连续搜索”不能由 renderer 自己重复提交同一条首条消息来解释；它首先是一次 `send` 进入一个 operation，后续搜索来自该 operation 的 Agent loop。  

[`use-chat.ts#L180-L261`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/src/hooks/use-chat.ts#L180-L261)

```ts
const sendMessage = useCallback(
	async ({ text: rawText, mode, attachments = [] }: ChatMessageInput): Promise<boolean> => {
		…
		if (current.agentStatus === "running") {
			…
			await desktop.agent.followUp({
				sessionId: current.sessionId,
				message: text,
				modelRef: latest.modelRef,
				mode,
			});
			…
		}
		…
		if (current.sessionId) {
			await desktop.agent.send({
				sessionId: current.sessionId,
				message: text,
				modelRef: latest.modelRef,
				mode,
```

**限制。** 这只排除了 renderer 首条消息的重复提交；它不排除用户在运行中主动追加 follow-up。真实 run 的 SQLite tool-call 列表见后文，没有把重复搜索拆成多个独立首条 prompt 的证据。

### 发现 2：RPC router 和 Desktop ACP host 将一次 send 变成一次 `session/prompt`

**主张。** Electron RPC 只做 schema 校验和转发；`DesktopAcpAgentHost.send()` 调用 `#admitPrompt()`，先确保 Session、配置 model/mode，再向 ACP 发送一次 `session/prompt`，可选地携带 `delivery: "steer"` 或 `"follow_up"`。  

[`router.ts#L337-L364`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/rpc/router.ts#L337-L364)

```ts
agent: {
	send(_event, input) {
		const parsed = parse(desktopAgentMessageInputSchema, input, "Invalid agent message input");
		return rt.agentHost.send({ …parsed, … });
	},
	…
	steer(_event, input) {
		rt.agentHost.steer(parse(desktopAgentMessageInputSchema, input, "Invalid agent message input"));
	},
	followUp(_event, input) {
		return rt.agentHost.followUp(parse(desktopAgentMessageInputSchema, input, "Invalid agent message input"));
	},
```

[`acp-host.ts#L326-L347`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L326-L347)

```ts
async #admitPrompt(
	input: DesktopAcpSendInput,
	delivery?: "steer" | "follow_up",
): Promise<{ readonly accepted: true }> {
	const runtime = await this.#ensureSession(input.sessionId, input.modelRef, input.mode);
	await this.#setConfiguration(runtime, input.modelRef, input.mode);
	const response = await this.#request("session/prompt", {
		sessionId: runtime.sessionId,
		prompt,
		...(delivery ? { delivery } : {}),
	});
```

### 发现 3：Desktop 是 ACP client/projection，Runtime Host 才持有 Agent 和 journal

**主张。** Desktop host 的注释和实现都把 ACP 连接、volatile projection、permission routing 留在 Electron；Runtime Host 负责 Session journal、Coding Agent 和 recovery。Desktop 建立或恢复 Session 时将 `cwd` 传给 ACP，但没有在 renderer/Electron 内执行 Agent loop。  

[`acp-host.ts#L83-L86`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L83-L86)

```ts
/**
 * Desktop's Agent seam. It owns only volatile ACP projections and approval
 * routing; Runtime Host owns the Session journal, Coding Agent and recovery.
 */
export class DesktopAcpAgentHost {
```

[`acp-host.ts#L284-L315`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L284-L315)

```ts
const cwd = await this.#resolveSessionCwd(sessionId);
…
const resumed = await this.#client.request("session/resume", {
	sessionId,
	cwd,
	replayFrom: { type: "start" },
});
…
const created = await this.#client.request("session/new", { sessionId, cwd });
```

## Desktop ACP host 与运行时装配

### 发现 4：Desktop 本地 runtime 由单个 ACP Runtime Host 提供

**主张。** Desktop 启动时创建 `DesktopAcpAgentHost`；它连接或启动 Runtime Host。Runtime Server 打开唯一的 `data.sqlite`、`RuntimeHost` 和本地 ACP endpoint，再把 Coding Agent operation driver 注入 Host。这个架构没有第二个 Desktop-side Agent loop 可以与 Server loop 叠加。  

[`runtime.ts#L43-L56`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/runtime.ts#L43-L56)

```ts
export async function createDesktopRuntime(dependencies: {
	readonly sessions: DesktopSessionCatalogPort;
}): Promise<DesktopRuntime> {
	…
	const agentHost = await DesktopAcpAgentHost.open(broadcast, {
		resolveSessionCwd: async (sessionId) => {
			const execution = await sessions.resolveExecutionContext(sessionId);
			return execution.localFileAccess ? execution.cwd : process.cwd();
		},
	});
```

[`server.ts#L64-L124`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/server.ts#L64-L124)

```ts
database = await ProductSqliteDatabase.open(join(options.dataDirectory, "data.sqlite"));
const persistence = new SqliteProductSessionPersistence(database.connection);
…
const host = new RuntimeHost({
	persistence,
	operationDriver: assembled.value,
	initialAppState: () => emptyPersistedCodingSessionState(),
	configurationPolicy: createRuntimeSessionConfigurationPolicy(agentSettings),
});
const opened = await openLocalRuntimeHost({
	dataDirectory: options.dataDirectory,
	host,
	info: options.info,
```

### 发现 5：一次 prompt 先 durable admission，再启动 active operation

**主张。** `RuntimeSession.prompt()` 在已有 active operation 时进入 `queueActiveInput()`；否则创建 operation id、从 journal 读取 leaf、构造 user message 和 `operation_accepted`，成功写入后才标记 active、发布 running 并调用 `startOperation()`。这说明首条用户消息不会直接跳过 durable admission，也不会因为模型尚未返回而自动开启第二个 operation。  

[`host.ts#L620-L695`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L620-L695)

```ts
const admitted = await this.enqueue(async () => {
	if (this.#suspended) return Result.err(…);
	if (this.#indeterminate) return Result.err(this.#indeterminate);
	if (this.operationDriver && this.#active) return this.queueActiveInput(this.#active, input);
	const operationId = this.createId();
	const loaded = await this.persistence.load(this.id);
	…
	const accepted = await this.persistence.admitPrompt({
		sessionId: this.id,
		inputEntry,
		operation,
	});
	if (accepted.isErr()) return Result.err(this.reject(accepted.error));
	if (this.operationDriver) this.#active = createActiveOperation(operationId);
```

```ts
if (admitted.isOk() && !this.#suspended) {
	this.publish({ type: "state_changed", state: "running", operationId: admitted.value.operationId });
	if (this.operationDriver) this.startOperation(admitted.value.operationId);
}
```

### 发现 6：Runtime operation 创建 Coding Agent，并从 durable Session context 继续

**主张。** `CodingAgentOperationDriver.openOperation()` 将 Runtime Host 的 durable SessionStore、EffectBoundary、审批函数和当前 operation 配置传给 `createCodingAgent()`；`CodingAgentOperation` 构造后立即调用 `advance(pendingInputs)`。对于首条 prompt，`advance()` 由 durable context 开始一次模型/工具运行。  

[`coding-agent.ts#L83-L146`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L83-L146)

```ts
async openOperation(input: RuntimeOperationOpenInput) {
	try {
		const configured = await this.#resolveOptions(input);
		…
		const created = await createCodingAgent({
			…configured.value,
			permissionMode: permissionModeFor(input.runtimeConfiguration.mode),
			cwd: input.cwd,
			session: { kind: "resume", id: input.sessionId, store: input.sessionStore },
			effectBoundary: input.effectBoundary,
			…
		});
		…
		return Result.ok(new CodingAgentOperation(input, created.value, telemetryObserver));
```

[`coding-agent.ts#L264-L289`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L264-L289)

```ts
constructor(
	private readonly input: RuntimeOperationOpenInput,
	private readonly agent: CodingAgent,
	telemetryObserver: CodingAgentTelemetryObserver,
) {
	…
	this.#stopAgentObservation = this.agent.subscribe((event) => {
		this.#telemetryObserver.observeAgentEvent(event);
		this.observe(event);
	});
	this.#outcome = this.advance(input.pendingInputs ?? []);
}
```

## packages/coding-agent runtime 与工具装配

### 发现 7：Desktop 当前确实把 FFF `find`/`grep` 作为静态工具装入 Agent

**主张。** `DesktopLocalRuntimeCapabilitySource` 为每个 operation 创建 FFF extension，并返回 `[skills, agentPlugins, fffSearch, mcp]`；FFF extension 自己声明静态 `tools: [findTool, grepTool]`。因此本次真实 run 中 `find` 是模型可直接调用的工具，不需要先调用 `SearchTools`。  

[`desktop-local.ts#L29-L72`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime-capabilities/desktop-local.ts#L29-L72)

```ts
const fffSearchExtension = createFffSearchExtension({
	dataDirectory: join(this.options.dataDirectory, "fff", input.sessionId),
});
return Result.ok({
	fileCapabilities,
	extensions: [skillsExtension, agentPlugins, fffSearchExtension, createMcpExtension()],
	extensionRuntime: { … },
});
```

[`search/index.ts#L168-L221`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L168-L221)

```ts
export function createFffSearchExtension(…): CodingAgentExtension<…> {
	…
	const findTool = {
		name: "find",
		description:
			"Fuzzy file and path search. Use this instead of Bash find or ls. Results are ranked by frecency and Git status, with cursor pagination.",
		…
	};
	const grepTool = {
		name: "grep",
		description:
			"Search file contents with smart-case literal or regex matching. Use this instead of Bash grep. Results are grouped by file and support cursor pagination.",
		…
	};
	return defineExtension({
		id: "jai.fff-search",
		tools: [findTool, grepTool],
```

**修正一个容易误读的点。** 默认 prompt 写的是 `grep/find`，Bash description 也要求不要用 Bash 做 `ls/find/grep`；但这不是“工具不存在”。`find`/`grep` 在 Desktop 当前路径是静态 extension tools；`ls` 和 `rg` 没有独立的常驻工具，实际会被模型放进 `Bash.command`。  

[`default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6)

```ts
export const DEFAULT_CODING_AGENT_INSTRUCTIONS = `You are Jai, a coding agent. …
Search the workspace with grep and find. For multiple OR terms, use one regex grep or parallel grep calls. If you must search through Bash, use rg; never bash grep or find.
After locating a hit, Read only nearby lines with offset and limit. …`;
```

[`bash.ts#L66-L73`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L66-L73)

```ts
return {
	name: "Bash",
	description:
		"Execute a POSIX shell command in the workspace with timeout, cancellation, and bounded output. Do not use grep, find, cat, ls, head, or tail to explore the workspace; search with the grep or find tools, or rg if Bash search is required. Read files with Read.",
	parameters: bashParameters,
	executionMode: "sequential",
```

### 发现 8：FFF 是直接执行的 extension tool，结果支持 cursor 但不会自动续页

**主张。** FFF `find()` 把无 cursor 的请求固定为 page 0；只有模型显式把返回的 cursor 放入下一次调用，才会继续下一页。无命中是成功结果 `"No files found matching pattern"`；`grep()` 无命中是 `"No matches found"`。源码没有把空结果转成错误，也没有自动发起下一页。  

[`search/index.ts#L70-L98`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L98)

```ts
const resumed = input.cursor ? this.#findCursors.get(input.cursor) : undefined;
if (input.cursor && !resumed) throw fileSearchError("search_failed", "Unknown find cursor");
const query = resumed?.query ?? buildQuery(input.path, input.pattern, input.exclude);
const pageIndex = resumed?.nextPageIndex ?? 0;
…
const text = result.value.items.length
	? result.value.items.map(…).join("\n")
	: "No files found matching pattern";
return { content: [{ type: "text", text: appendCursor(text, nextCursor) }], details: { … } };
```

[`search/index.ts#L100-L145`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L100-L145)

```ts
const cursor = input.cursor ? this.#grepCursors.get(input.cursor) : undefined;
…
const nextCursor = result.value.nextCursor ? this.#storeGrepCursor(result.value.nextCursor) : undefined;
const text = formatGrep(…);
return {
	content: [{ type: "text", text: appendCursor(text, nextCursor) }],
	details: { matches: result.value.totalMatched, … },
};
```

[`search/index.ts#L294-L306`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L294-L306)

```ts
function formatGrep(items: readonly { … }[]): string {
	if (items.length === 0) return "No matches found";
	…
}
```

**推断。** 真实记录第一次 `find` 返回了 `[Continue with cursor="fff_c1"]`，后续调用列表没有传 `cursor`；因此模型重新发起 `find`/Bash 补偿，而不是沿 cursor 读取同一个结果集。这个因果方向由工具 API 和 run 参数共同支持，但模型为什么没有选择 cursor，源码无法观察其内部决策。

## tool catalog 的边界

### 发现 9：Tool catalog 只在存在 catalog Extension 时增加 `SearchTools`/`ExecuteTool`

**主张。** `createCodingAgent()` 只有在 Extension 声明 `catalogs` 时才创建 `ToolCatalog`；FFF 没有 `catalogs`，只有静态 `tools`，所以真实 FFF 调用不经过 catalog。主 Agent 的工具数组由 `extensionTools`、内置 coding tools 和 catalog front-door tools 拼起来。  

[`create-coding-agent.ts#L97-L117`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/create-coding-agent.ts#L97-L117)

```ts
const preparedExtensions = prepareExtensions(input.extensions ?? []);
…
const extensionCatalogs = extensions.flatMap((extension) => extension.extension.catalogs ?? []);
const extensionToolCatalog = extensionCatalogs.length ? new ToolCatalog([]) : undefined;
…
extensionTools: extensionTools(extensions),
extensionBeforeModelCall: async (messages) => { … },
```

[`create-coding-agent.ts#L422-L451`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/create-coding-agent.ts#L422-L451)

```ts
const primaryTools = extensionToolCatalog.current?.frontdoorTools ?? [];
const capabilities = assembleAgentCapabilities({
	…
	extensionTools: options.extensionTools,
	extraTools: primaryTools,
});
…
tools: staticTools,
…
...(extensionToolCatalog.current
	? { toolCallResolver: (toolCall) => resolveCatalogToolCall(extensionToolCatalog.current!, toolCall) }
	: {}),
```

### 发现 10：catalog 搜索是 lexical score，没有同 query 去重；stale reference 失败会要求再次搜索

**主张。** `ToolCatalog.search()` 每次从当前 `#tools` 重新计算 score、截取结果并生成 `toolRef`；没有 last-query、去重集合或“相同 query 直接返回/停止”的逻辑。动态 snapshot 替换会让旧 reference 失效，`ExecuteTool` 抛出的错误明确要求“search again”。这是一条可能放大 `SearchTools → ExecuteTool → SearchTools` 的代码路径，但当前真实 run 的 14 个 tool call 中没有 `SearchTools` 或 `ExecuteTool`。  

[`tool-catalog.ts#L46-L89`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L46-L89)

```ts
export class ToolCatalog {
	…
	searchTool = {
		name: "SearchTools",
		…
		execute: async (_toolCallId, args) => {
			const matches = this.search(String(args.query), args.limit);
			return { content: [{ type: "text", text: JSON.stringify({ tools: matches }) }], details: { tools: matches } };
		},
	};
	executeTool = {
		name: "ExecuteTool",
		…
		execute: async (_toolCallId, args) => {
			throw new ToolCatalogReferenceUnavailable({
				message: `The ExecuteTool toolRef "${args.toolRef}" is unavailable. … search again before retrying.`,
```

[`tool-catalog.ts#L107-L132`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L107-L132)

```ts
/** Replaces the whole dynamic snapshot, making every prior reference stale. */
replace(tools: readonly AgentTool[]): void {
	this.#tools = [...tools];
	this.#references = new Map(tools.map((tool) => [randomUUID(), tool]));
}

search(query: string, requestedLimit?: number): readonly ToolCatalogMatch[] {
	…
	const matches = this.#tools
		.map((tool) => ({ tool, score: score(tool, terms) }))
		.filter((entry) => entry.score > 0)
		.sort(…)
		.slice(0, limit)
		.map((entry) => entry.tool);
	return matches.map((tool) => ({ toolRef: this.#referenceFor(tool), … }));
}
```

[`tool-catalog.ts#L157-L166`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L157-L166)

```ts
function score(tool: AgentTool, terms: readonly string[]): number {
	if (terms.length === 0) return 0;
	…
	if (name === term) return total + 16;
	if (name.includes(term)) return total + 8;
	if (description.includes(term)) return total + 2;
	return total;
}
```

## Agent loop：为什么一个工具结果会打开下一轮

### 发现 11：每个普通工具结果都会回到 context，非 terminate batch 会继续 provider request

**主张。** `driveAgentLoop()` 的 task 条件是“仍有工具调用、steering 消息或需要运行当前 context”；`runTurn()` 将 assistant tool call 执行后得到的每个 `ToolResultMessage` push 到 `context.messages`。只要本批工具结果没有全部显式 `terminate: true`，`hasMoreToolCalls` 就为 true，从而再次进入 `runTurn()`。这正是一次 `ls` 后出现下一次 `find`/`rg` 的最小代码机制。  

[`agent-loop.ts#L123-L176`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L123-L176)

```ts
/**
 * 驱动一次 run：反复执行 turn，直到没有更多工具调用且没有 follow-up。
 */
async function driveAgentLoop(…) {
	…
	while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
		if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
			…
			return;
		}
		const turn = await runTurn(run, pendingMessages);
		turnCount += 1;
		…
		hasMoreToolCalls = turn.hasMoreToolCalls;
```

[`agent-loop.ts#L223-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L223-L270)

```ts
const message = await streamAssistantResponse(run);
…
const toolCalls = message.content.filter((content) => content.type === "toolCall");
…
const batch = await executeToolCallBatch(run, toolCalls);
toolResults = batch.messages;
hasMoreToolCalls = !batch.terminate;
for (const result of toolResults) {
	context.messages.push(result);
	newMessages.push(result);
}
…
return { hasMoreToolCalls, stopped: false };
```

[`agent-loop.ts#L518-L568`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L518-L568)

```ts
const publish = async (outcome: ExecutedToolCall): Promise<void> => {
	const message: ToolResultMessage = { …, isError: outcome.isError, timestamp: Date.now() };
	…
	await emit({ type: "message_end", message, entryId: outcome.resultEntryId });
};
…
return {
	messages,
	terminate: outcomes.length > 0 && outcomes.every((outcome) => outcome.result.terminate === true),
};
```

### 发现 12：工具异常不会自动终止，也不会由 core 做相似搜索判定

**主张。** `executeToolCall()` 捕获普通工具异常，构造文本 `AgentToolResult` 并设置 `isError = true`；之后它仍然作为一个普通 batch outcome 发布。没有“error result 后停止”“搜索失败后换一次策略并停止”或“同 command 拒绝执行”的分支。  

[`agent-loop.ts#L585-L689`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L585-L689)

```ts
try {
	…
	result = await dispatch(0);
} catch (error) {
	if (isEffectGateInterrupted(error)) throw error;
	// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
	result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
	isError = true;
}
…
await emit({
	type: "tool_execution_end",
	toolCallId: toolCall.id,
	toolName: toolCall.name,
	result,
	isError,
});
return outcome;
```

目标源码中没有针对“重复搜索”的同义守卫。核验命令及原始输出：

```sh
$ rg -n -i 'same.{0,30}(query|command)|repeat.{0,30}(search|tool)|no.?progress|information gain|similar.{0,30}(search|tool)' \
    packages/agent/src packages/coding-agent/src packages/extension/src \
    app/desktop/electron/agent app/server/src/runtime app/server/src/protocol/acp-v2 app/server/src/agents || true

# 无输出
```

**边界。** 这证明当前检索范围内没有命中这些显式 guard 名称/注释；不能证明未来新增的语义 guard 不会用完全不同的命名，也不能观察 provider 的隐藏 reasoning。

### 发现 13：普通搜索工具没有设置 terminate；只有工具作者显式设置才会提前停

**主张。** `AgentToolResult.terminate` 的语义是“提示当前批次完成后停止”，并且要求 batch 内每个结果都为 true。Bash、FFF `find`/`grep` 和 `SearchTools` 返回对象都没有设置该字段，因此一次普通搜索结果按设计打开下一次模型请求。  

[`types.ts#L18-L33`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/types.ts#L18-L33)

```ts
export interface AgentToolResult<TDetails = unknown> {
	content: (TextContent | ImageContent)[];
	…
	/**
	 * 提示 agent 在当前这批工具执行完后停止。
	 * 早停仅当本批次每个工具结果都为 true 时才生效
	 */
	terminate?: boolean;
}
```

[`bash.ts#L186-L212`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L212)

```ts
const text = final.text || "(no output)";
…
return {
	content: [{ type: "text", text: final.truncated ? `${text}\n\n[…]` : text }],
	details,
};
```

[`search/index.ts#L85-L97`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L85-L97)

```ts
return {
	content: [{ type: "text", text: appendCursor(text, nextCursor) }],
	details: {
		count: result.value.items.length,
		totalMatched: result.value.totalMatched,
		...(nextCursor ? { cursor: nextCursor } : {}),
	},
};
```

## model context、prompt、steering 与 follow-up

### 发现 14：下一次 provider request 看见的是上一轮 tool result；工具 schema 是每次请求的 snapshot

**主张。** 在发出 provider request 前，core 复制当前 messages/tools；`prepareContext` 可投影/压缩/追加临时 context；然后把 provider-ready messages 和同一份工具 snapshot 传给 provider。工具结果不是只显示在 UI，而是进入下一次 model context。  

[`agent-loop.ts#L312-L365`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L312-L365)

```ts
const input: AgentContext = {
	systemPrompt: context.systemPrompt,
	messages: [...context.messages],
	tools: [...context.tools],
};
const prepared = config.prepareContext ? await config.prepareContext(input) : input;
// Tool definitions are a per-request snapshot.
context.tools = [...prepared.tools];
…
const llmContext: Context = {
	systemPrompt: request.systemPrompt,
	messages: projectToolCallProtocol(request.messages),
	tools: request.tools,
};
const response = config.provider.stream(config.model, llmContext, { … });
```

### 发现 15：Session Ledger 在下一次 provider request 前持久化每个 message_end

**主张。** Core 的每个事件先 `reduce`，再等待 `commitEvent`，最后发布观察事件；Harness 的 `commitEvent` 对 `message_end` 调用 `SessionLedger.appendMessage()`。而工具 batch 的注释明确要求等待 `message_end`，以保证 tool-result 的 T2 journal entry 在下一次 provider request 观察它之前已 durable。  

[`agent.ts#L235-L255`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent.ts#L235-L255)

```ts
const stream = agentLoop(
	prompts,
	this.createContextSnapshot(),
	this.createLoopConfig(),
	…
	async (event) => {
		this.reduce(event);
		await this.commitEvent?.(event);
		await this.publish(event);
	},
);
```

[`agent.ts#L505-L519`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/agent.ts#L505-L519)

```ts
private async handleCoreEvent(event: CoreAgentEvent): Promise<void> {
	const entryId = await this.persist(event);
	await this.publish(event.type === "message_end" && entryId ? { …event, entryId } : event);
}
…
if (event.type === "message_end" && …) {
	return (await this.ledger.appendMessage(event.message, entryId)).id;
}
```

### 发现 16：steering/follow-up 是可插入的额外输入，不是搜索去重器

**主张。** CoreAgent 将 steering/follow-up 分成两个内存队列；loop 在每个工具 turn 后 drain steering，在 task 自然结束后才 drain follow-up。Runtime Host 将 Desktop 的 queued input 先写 `input_queued`，再调用 Agent 的 `steer()` 或 `followUp()`。这些机制会合法地增加 model turn，但不会比较搜索命令是否重复。  

[`agent.ts#L219-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent.ts#L219-L270)

```ts
private startRun(input: AgentInput, runFromContext = false): Promise<AgentMessage[]> {
	if (this.activeRun) throw agentError("already_running", { message: "Agent is already running. Use steer() or followUp()." });
	…
}
steer(message: AgentMessage): void {
	this.assertActiveRun();
	this.steeringQueue.enqueue(message);
}
followUp(message: AgentMessage): void {
	this.assertActiveRun();
	this.followUpQueue.enqueue(message);
}
```

[`agent-loop.ts#L201-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L201-L216)

```ts
hasMoreToolCalls = turn.hasMoreToolCalls;
// 获取业务产生的 steering 消息，下一个 turn 前注入。
pendingMessages = (await config.getSteeringMessages?.()) ?? [];
…
// task 自然结束后，才开始 follow-up 消息注入，开启下一个 task。
const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];
if (followUpMessages.length > 0) {
	pendingMessages = followUpMessages;
	continue;
}
```

[`host.ts#L1044-L1088`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L1044-L1088)

```ts
const queued: RuntimeQueuedInput = {
	inputId,
	delivery: input.delivery === "follow_up" ? "follow_up" : "steer",
	…
};
await this.persistence.appendOperation({
	…
	type: "input_queued",
	delivery: queued.delivery,
	text: input.text,
});
…
const delivered = await active.resource.enqueueInput(queued);
```

**当前 run 的边界。** 现有目标 run 的首条用户消息只在 sequence 10；本笔记没有把任何 UI follow-up 归因到 14 个搜索调用。若用户在另一条 run 中主动发送 follow-up，以上机制会增加任务，但那是不同输入，不是隐藏重复。

### 发现 17：默认 before-model hooks 会追加 Extension context，但当前没有搜索重复检测

**主张。** `CodingAgent` 把附件、Extension context 和 command prompt context 接成 before-model hook；Extension hook 只能追加 synthetic user message。当前默认实现中，Todo extension 的 hook 追加 Todo state；没有拿到工具历史并按 search query 去重的 hook。  

[`create-coding-agent.ts#L307-L334`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/create-coding-agent.ts#L307-L334)

```ts
const beforeModelCall = [...(hooks?.beforeModelCall ?? [])];
beforeModelCall.unshift(async ({ messages }) => {
	const projected = await attachments.project(messages);
	return projected ? { messages: projected } : undefined;
});
if (options.extensionBeforeModelCall) {
	beforeModelCall.push(async ({ messages }) => ({
		messages: await options.extensionBeforeModelCall!(messages),
	}));
}
if (options.commands) {
	beforeModelCall.push(({ messages }) => {
		const context = options.commands?.promptContext();
		…
```

[`extensions.ts#L362-L392`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/extensions.ts#L362-L392)

```ts
const current = [...messages] as AgentMessage[];
for (const extension of extensions) {
	…
	if (result?.context === undefined) continue;
	…
	current.push({
		role: "user",
		content: [{ type: "text", text: result.context }],
		metadata: { synthetic: true },
		timestamp: Date.now(),
	});
}
return Result.ok([...current]);
```

## tool result 到 ACP 再到 Desktop 的投影

### 发现 18：durable tool result 才会产生 ACP completed/failed update

**主张。** ACP `projectEntry()` 只把 durable `toolResult` message 交给 `toolResultUpdate()`；该函数把文本/图片/diff 转为 ACP content，并按 `isError` 设置 `completed` 或 `failed`。Bash 的 terminal exit 也要等 T2 result entry，live terminal output 本身是 volatile。  

[`acp-v2/agent.ts#L617-L645`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L617-L645)

```ts
case "toolResult":
	return toolResultUpdate(sessionId, entry.message, operationId, Date.parse(entry.timestamp));
```

[`acp-v2/agent.ts#L737-L768`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L737-L768)

```ts
const content: object[] = [];
for (const part of message.content) {
	if (part.type === "text") content.push({ type: "content", content: { type: "text", text: part.text } });
	…
}
const updates = [
	toolCallUpdate(sessionId, {
		toolCallId: message.toolCallId,
		status: message.isError ? "failed" : "completed",
		content,
		…
	}),
];
// The result Session entry is T2. Only now may ACP learn that the display terminal has exited.
```

### 发现 19：Desktop host 只把 ACP update 合并成一个 tool card

**主张。** Desktop `#toolUpdate()` 根据 ACP status 更新同一个 `tool:${toolCallId}` item，复制 details、searchQuery、fileChanges 和 activityKind；它没有调用 `agent.send`、`session/prompt` 或任何搜索工具。因而截图里多个工具卡片是多个真实 tool call 的 projection，不是 projection 自己复制了调用。  

[`acp-host.ts#L603-L686`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L603-L686)

```ts
const id = `tool:${update.toolCallId}`;
…
const status =
	update.status === "completed" || update.status === "failed"
		? "complete"
		: update.status === "pending" || update.status === "in_progress"
			? "running"
			: (previousTool?.status ?? "running");
…
runtime.items.set(id, item);
this.#emitEvent(runtime, { type: "transcript_upsert", item });
```

## 错误、空结果与没有尽早收敛

### 发现 20：Bash 明确允许 `rg`，但仍是一个可执行任意 shell command 的单一入口

**主张。** Bash 的 description 要求用 `rg`，但参数只有一个任意 `command` 字符串；因此 `ls`、`find`、`rg` 都可以由模型组合在 Bash 内执行。Bash 还是 `sequential` 工具，会让同一 assistant batch 中的 Bash 先成为串行屏障，但不会限制下一轮再发 Bash。  

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

[`bash.ts#L186-L212`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L212)

```ts
const text = final.text || "(no output)";
…
if (shellResult.exitCode !== 0) {
	throw bashError("non_zero_exit", {
		message: appendStatus(diagnosticText, `Command exited with code ${shellResult.exitCode}`),
	});
}
return { content: [{ type: "text", text: … }], details };
```

### 发现 21：FFF absolute path 失败是工具契约错误，core 仍继续

**主张。** FFF 的 `path` 不是任意绝对 filesystem root；`validateConstraint()` 明确拒绝 `/`、`~` 和 `../`，抛出 `outside_boundary`。真实 run 第二次 `find` 正是传了 `/Users/jayden/code/jai-mono`，因此失败原因是参数契约而不是目录不存在；该错误随后仍被 Agent loop 作为 `toolResult` 送给模型。  

[`search/index.ts#L261-L280`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L261-L280)

```ts
function validateConstraint(value: string): string {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("~") ||
		trimmed === ".." ||
		trimmed.startsWith("../") ||
		trimmed.includes("/../")
	) {
		throw fileSearchError("outside_boundary", `Search path must stay inside the workspace: ${value}`);
	}
	return trimmed;
}
```

**真实 tool result 摘录。**

```text
sequence 25:
... "Search path must stay inside the workspace: /Users/jayden/code/jai-mono" ... "isError":true
```

### 发现 22：默认 instructions 是行为提示，不是 loop-level enforcement

**主张。** 默认 instructions 和 Bash description 都要求“找到命中后只 Read 附近行”“不要用 Bash find/grep/ls”；但它们只是传给模型的文字。当前 core 的硬约束是 schema validation、permission middleware、tool execution 和 maxIterations，没有把这些自然语言规则编译成重复搜索 guard。  

[`default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6)

```ts
Search the workspace with grep and find. …
If you must search through Bash, use rg; never bash grep or find.
After locating a hit, Read only nearby lines with offset and limit.
```

[`agent-loop.ts#L599-L620`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L599-L620)

```ts
if (!tool) {
	throw new ToolNotFound({ message: `Tool ${toolCall.name} not found` });
}
const validation = validateToolArguments(tool, toolCall);
if (validation.status === "error") {
	throw new ToolInvalidArguments({ message: validation.error.message });
}
```

### 发现 23：真实 run 已经在第 10 个 tool call 得到候选，但没有代码级收敛点

**主张。** 本机 durable run 的真实调用序列显示：前四个模型 turn 都围绕 `jai-mono` 内部搜索；第 5 个 turn 的 `ls /Users/jayden/code` 和 `find /Users/jayden/code -maxdepth 2 …` 已返回多个 `we0` 候选；之后模型又发起两轮目录枚举和 git status。这个“找到候选后继续扩大检查”的行为与 loop“普通 tool result → 下一轮模型”的机制一致，而不是工具内部重复。  

**核验命令及原始输出。**

```sh
$ sqlite3 -readonly -header -column "$HOME/.jai/data.sqlite" \
  "SELECT e.sequence,
          json_extract(part.value,'$.name') AS tool,
          COALESCE(json_extract(part.value,'$.arguments.command'),
                   json_extract(part.value,'$.arguments.pattern')) AS request
   FROM session_journal_entries e
   JOIN json_each(e.entry_json,'$.message.content') part
   WHERE e.session_id='03755a6d-b687-41a6-a9bf-2543668f8393'
     AND part.type='object'
     AND json_extract(part.value,'$.type')='toolCall'
     AND e.sequence>=10
   ORDER BY e.sequence, CAST(part.key AS INTEGER);"

sequence  tool  request
--------  ----  ----------------------------------------------------------------
14        Bash  pwd && ls -la
14        find  we0
21        Bash  cd /Users/jayden/code/jai-mono && ls -la && git status 2>/dev/null | head -20 && git log --oneline -10 2>/dev/null
21        find  we0*
28        Bash  cd /Users/jayden/code/jai-mono && rg -l -i "we0" --hidden -g '!node_modules' -g '!.git' -g '!dist' -g '!out' -g '!bun.lock' -g '!*.map' 2>/dev/null | head -30
28        Bash  cd /Users/jayden/code/jai-mono && ls docs packages plugins app .jnative 2>/dev/null
35        Bash  cd /Users/jayden/code/jai-mono && ls -la .jnative && cat .jnative/CONTEXT.md 2>/dev/null | head -60
35        Bash  cd /Users/jayden/code/jai-mono && rg -l -i "we0|w0" --hidden -g '!node_modules' -g '!.git' -g '!bun.lock' -g '!*.map' 2>/dev/null | head; echo "---docs---"; ls docs/point docs/record 2>/dev/null
42        Bash  ls /Users/jayden/code 2>/dev/null; echo "---"; ls -d /Users/jayden/code/*/ 2>/dev/null | head -50
42        Bash  find /Users/jayden/code -maxdepth 2 -iname "*we0*" -o -maxdepth 2 -iname "*w0*" 2>/dev/null | grep -v node_modules | head -20
49        Bash  cd /Users/jayden/code/wecode && ls -la && echo "=== git status ===" && git status 2>/dev/null | head -40
49        Bash  cd /Users/jayden/code/wecode && for d in new-we0 we0-agent-sdk we0agent we0conatiner; do echo "=== $d ==="; ls "$d" 2>/dev/null | head -15; done
56        Bash  cd /Users/jayden/code/wecode/new-we0 && ls -la && echo "=== git? ===" && git status 2>&1 | head -5
56        Bash  cd /Users/jayden/code/wecode && for d in new-we0/we0 new-we0/we0-agent-x we0-agent-sdk we0agent we0conatiner new_wecontainer; do echo "=== $d ==="; git -C "$d" status 2>&1 | head -3; echo; done
```

**原始结果摘录。**

```text
sequence 18:
... "dist/assets/fortran-free-form-BxgE0vQu.js\nnode_modules/.vite/deps/elm-WEQEBQTC.js...
\n[Continue with cursor=\"fff_c1\"]" ... "isError":false

sequence 25:
... "Search path must stay inside the workspace: /Users/jayden/code/jai-mono" ... "isError":true

sequence 46:
... "[USER_HOME]/code/we0claw
[USER_HOME]/code/wecode/we0-agent-sdk
[USER_HOME]/code/wecode/we0agent
[USER_HOME]/code/wecode/we0conatiner
[USER_HOME]/code/wecode/new-we0" ... "isError":false
```

**推断。** 代码只能证明每个结果会继续进入下一轮；“第 10 个调用后模型仍认为需要更多证据”是对 provider tool-call 序列的行为解释，不是源码能直接证明的模型内部理由。可确认的是：当前 loop 没有一个以“已有候选足够”为条件的本地短路。

## 具体 trace：从“帮我看看最新的 we0 项目怎么样”到多次搜索

### 输入与实际本机记录的差异

题目给定的 trace 输入是“帮我看看最新的 we0 项目怎么样”。本机已有真实记录的 user message 原文是“帮我看看我最新的 we0的项目怎么样了”，不是逐字相同；以下将它作为同一意图的实测 trace，并明确标注差异，不把两句话伪装成同一条记录。

**实测输入/终态原始输出。**

```sh
$ sqlite3 -readonly -header -column "$HOME/.jai/data.sqlite" \
  "SELECT sequence,
          json_extract(entry_json,'$.message.role') AS role,
          json_extract(entry_json,'$.message.stopReason') AS stop_reason,
          substr(json_extract(entry_json,'$.message.content'),1,180) AS content
   FROM session_journal_entries
   WHERE session_id='03755a6d-b687-41a6-a9bf-2543668f8393'
     AND sequence IN (10,59,62)
   ORDER BY sequence;"

sequence  role        stop_reason  content
--------  ----------  -----------  ----------------------------------------------------
10        user                     帮我看看我最新的 we0的项目怎么样了
59        toolResult               [{"type":"text","text":"Permission denied for Bash: User denied the permission request"}]
62        assistant   aborted      []
```

### 逐步链路

1. **renderer 输入。** `useChat.sendMessage()` 调用 `desktop.agent.send`；RPC router 转到 `DesktopAcpAgentHost.send`；host 发出一次 `session/prompt`。[`use-chat.ts#L235-L261`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/src/hooks/use-chat.ts#L235-L261) [`acp-host.ts#L326-L347`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L326-L347)

2. **ACP admission。** ACP server 的 `prompt()` 解析 `sessionId`、prompt 和 `delivery`，调用已经 attach 的 `RuntimeSession.prompt()`；RuntimeSession 把 user message 与 `operation_accepted` 落 journal，随后启动 operation。[`acp-v2/agent.ts#L215-L234`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L215-L234) [`host.ts#L654-L695`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L654-L695)

3. **operation 打开。** `RuntimeSession.runOperation()` 打开 `CodingAgentOperationDriver`；driver 以 `session: { kind: "resume" }` 创建 Coding Agent，并从 `advance()` 开始。[`host.ts#L1135-L1171`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L1135-L1171) [`coding-agent.ts#L94-L123`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L94-L123)

4. **首轮 context。** `CodingAgent` 的默认 instructions 要求用 `grep/find`，Bash 仅在必要时用 `rg`；Desktop capability source 同时装入静态 FFF `find/grep` 与内置 `Bash/Read`。[`default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6) [`assemble.ts#L27-L47`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/assemble.ts#L27-L47)

5. **模型首轮 tool call。** provider 返回 `Bash("pwd && ls -la")` 和 FFF `find({ pattern: "we0" })`。同一 assistant batch 含 Bash 时，Bash 的 `executionMode: "sequential"` 使执行串行；这是一个 Bash + find 的模型 batch，不是 ACP 自动复制。[`bash.ts#L66-L73`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L66-L73) [`agent-loop.ts#L522-L563`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L522-L563)

6. **结果回上下文。** Bash/FFF 结果各自产生 `toolResult`；loop 把它们 push 到 `context.messages`，等待 durable `message_end` 后才继续 provider request。[`agent-loop.ts#L531-L549`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L531-L549)

7. **继续尝试。** 第 2–4 个 model turn 继续在 `jai-mono` 内部用 `ls`/FFF `find`/Bash `rg`。第 5 个 model turn 才通过 Bash `ls /Users/jayden/code` 和 `find /Users/jayden/code -maxdepth 2 …` 找到 `we0` 候选。由于这些普通结果没有 terminate，loop 对每个 turn 再次请求模型；这就把“一次 ls”扩展成多轮搜索。[`agent-loop.ts#L167-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L216)

8. **低信号/错误反馈。** 第一次 FFF `find` 的结果带 cursor，模型未续页；第二次 `find` 因绝对 path 失败；错误仍被封装为 `isError: true` tool result，不会自动停。[`search/index.ts#L70-L97`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L70-L97) [`agent-loop.ts#L662-L689`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L662-L689)

9. **已经有候选后仍继续。** 到 sequence 46 已得到 5 个候选路径；随后 model turn 6、7 又枚举 `wecode` 子目录、父目录和 git status。第 7 turn 最后一个跨 workspace Bash 触发 permission request；tool result 是 `Permission denied for Bash: User denied the permission request`。[真实调用输出](#发现-23真实-run已经在第-10-个-tool-call-得到候选但没有代码级收敛点)

10. **结束。** permission denial 后 provider 返回空 content、`stopReason: "aborted"`；core 对 aborted turn 立即结束，Runtime `resolveOutcome()` 把它映射为 `aborted`，Host durable finish 后发布 idle/error 语义。没有一个“权限拒绝后用已有结果生成总结”的本地 fallback。[`agent-loop.ts#L247-L250`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L247-L250) [`coding-agent.ts#L493-L498`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L493-L498)

## run stop 条件

### 发现 24：自然 stop 只依赖“没有工具/steering/follow-up”，不是搜索质量

**主张。** Agent loop 的自然结束发生在当前 task 没有未终止工具调用、没有 steering、没有 `runFromContext` 待运行时；随后如果没有 follow-up 才 emit `agent_end`。代码不计算目录候选数、query 相似度、结果重叠率或信息增益。  

[`agent-loop.ts#L167-L216`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L216)

```ts
while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
	…
	hasMoreToolCalls = turn.hasMoreToolCalls;
	pendingMessages = (await config.getSteeringMessages?.()) ?? [];
}
const followUpMessages = (await config.getFollowUpMessages?.()) ?? [];
if (followUpMessages.length > 0) {
	pendingMessages = followUpMessages;
	continue;
}
break;
```

### 发现 25：可选 `maxTurns` 是轮数上限，不是重复搜索上限

**主张。** SDK 把 `maxTurns` 直接映射到 core 的 `maxIterations`；达到后只生成一条 `iterationLimit` assistant message。Runtime settings 的 `maxTurns` 是 optional，Server 只有存在且 truthy 时才传给 SDK。因此没有配置时，当前代码没有默认的“最多 N 次搜索”；即使配置了，也只按 turn 数停止。  

[`create-coding-agent.ts#L125-L135`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/create-coding-agent.ts#L125-L135)

```ts
resolveAgentOptions: () => ({
	...(input.maxTurns === undefined ? {} : { maxIterations: input.maxTurns }),
	…
}),
```

[`daemon.ts#L69-L123`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/daemon.ts#L69-L123)

```ts
return Result.ok({
	model: current.value.model,
	…
	...(current.value.maxTurns ? { maxTurns: current.value.maxTurns } : {}),
	…
});
```

[`agent-loop.ts#L167-L176`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L176)

```ts
if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
	const message = createIterationLimitMessage(config, turnCount);
	…
	return;
}
```

**目标 run 的配置输出。**

```text
configuration_json = {"model":"provider/deepseek-v4-flash-ga-260731","mode":"manual"}
configuration_json = {"model":"provider/deepseek-v4-flash-ga-260731","mode":"manual"}
configuration_json = {"model":"provider/deepseek-v4-flash-ga-260731","mode":"manual"}
```

该输出没有 `maxTurns` 字段；它支持“目标 run 没有按配置轮数提前停止”的判断，但不证明所有 Desktop Session 都没有配置该字段。

### 发现 26：abort、工具未完成和 pending input 是不同的 Host 终止/挂起路径

**主张。** Runtime Host 完成 operation 前会重读 durable state：如果有未完成 tool result，进入 `indeterminate_tool`；如果 queued input 未到 journal，进入 suspended；否则写 `operation_finished`。正常 Agent outcome 只在这里转成 completed/failed/aborted。  

[`host.ts#L1225-L1314`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L1225-L1314)

```ts
const verdict = recovered.value.find((candidate) => candidate.operationId === active.operationId);
if (verdict?.status === "indeterminate_tool") {
	…
	return Result.err(indeterminate);
}
if (hasPendingInputs(verdict)) {
	…
	this.suspend(active, failed);
	return Result.err(failed);
}
…
const terminal: OperationFinished = {
	type: "operation_finished",
	operationId: active.operationId,
	outcome: terminalOutcome,
	timestamp: this.now().toISOString(),
};
```

[`coding-agent.ts#L338-L344`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L338-L344)

```ts
private async advance(inputs: readonly RuntimeQueuedInput[]) {
	const result = await this.agent.advance(inputs.map((input) => ({ text: input.text, entryId: input.entryId })));
	if (result.isErr()) return Result.err(this.failed("failed", result.error));
	return Result.ok(resolveOutcome(result.value.messages));
}
```

[`coding-agent.ts#L493-L498`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L493-L498)

```ts
if (!finalAssistant) return "failed";
if (finalAssistant.stopReason === "aborted") return "aborted";
if (finalAssistant.stopReason === "error" || finalAssistant.stopReason === "contextOverflow") return "failed";
return "completed";
```

## 失败模式

### 1. cwd 过窄，模型在错误的局部 workspace 内反复证明“没有找到”

**主张。** 当前 Desktop cwd 来自 Session execution context，并原样进入 ACP；真实 run 的前四个 turn 都在 `jai-mono` 内部搜索，直到第 5 turn 才扩大到 `/Users/jayden/code`。  

[`runtime.ts#L51-L55`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/runtime.ts#L51-L55)

```ts
resolveSessionCwd: async (sessionId) => {
	const execution = await sessions.resolveExecutionContext(sessionId);
	return execution.localFileAccess ? execution.cwd : process.cwd();
},
```

**实测命令输出。**

```text
14  Bash  pwd && ls -la
21  Bash  cd /Users/jayden/code/jai-mono && ls -la && git status …
28  Bash  cd /Users/jayden/code/jai-mono && rg -l -i "we0" …
35  Bash  cd /Users/jayden/code/jai-mono && ls -la .jnative …
42  Bash  ls /Users/jayden/code …
```

### 2. 相对 path API 与模型传入的绝对 path 冲突

**主张。** FFF 只接受 workspace 内相对 constraint；真实第二次 `find` 的绝对 path 触发明确错误，错误结果仍继续 loop。证据见 [发现 21](#发现-21fff-absolute-path-失败是工具契约错误core-仍继续) 的源码摘录和 tool result。

### 3. 分页 cursor 暴露但没有运行级“必须续页/必须换策略”协议

**主张。** FFF 返回 cursor 文本和 details，但 Agent loop 不理解 cursor 语义，只把它当普通文本反馈；模型可选择重复相似 query、切换 Bash 或继续分页。证据见 [发现 8](#发现-8fff-findgrep与-bash-的真实行为) 与 [发现 11](#发现-11每个普通工具结果都会回到-context非-terminate-batch会继续-provider-request)。

### 4. Bash 是宽入口，权限拒绝可能丢掉最后总结

**主张。** Bash command 可以把多个 `ls/find/rg/git` 串成一次跨目录操作；跨 workspace 的 command 可能触发 approval。权限拒绝会成为 tool error，随后 provider 返回 aborted；当前 runtime 没有从已有 durable facts 自动生成 summary 的 fallback。  

[`middleware.ts#L188-L196`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/middleware.ts#L188-L196)

```ts
if (approval === "deny") {
	settlePermission(options.telemetryObserver, context.toolCall.id, "denied");
	throw permissionDeniedError(toolName, "User denied the permission request");
}
```

**实测终态。**

```text
sequence 59: toolResult  Permission denied for Bash: User denied the permission request
sequence 62: assistant   stopReason=aborted, content=[]
```

### 5. Tool catalog 的 stale reference 会诱发“再 SearchTools”，但不是本次 FFF 重复的来源

**主张。** catalog 的旧 `toolRef` 明确失败并要求再次搜索；这条失败模式存在，但真实调用列表没有 `SearchTools`/`ExecuteTool`，所以不能用它解释本次 `ls/find/rg` 序列。证据见 [发现 10](#发现-10catalog-搜索是-lexical-score没有同-query-去重stale-reference-失败会要求再次搜索) 和 [发现 23](#发现-23真实-run已经在第-10-个-tool-call-得到候选但没有代码级收敛点)。

## 最小修复建议（只建议，不实现）

以下是代码级最小方向，不是本次任务的实现结果：

1. **在 Agent loop 或统一 tool middleware 增加搜索收敛 guard。** 按 `(toolName, normalized query/path)` 记录当前 operation 的重复次数和结果 fingerprint；对重复且无新增结果的 `ls/find/rg/grep` 返回明确的“换策略或总结”反馈，达到小阈值后让 run 进入可控停止。应放在共享执行边界，避免只修 Desktop 某个入口。
2. **把“搜索范围”作为工具契约的一部分。** 对 FFF 的相对 path boundary 返回结构化的 allowed root/建议相对路径，减少模型把绝对 cwd 当作 `path` 参数重试；同时把 continuation cursor 作为明确的 next-page 字段，而不是只嵌在文本中。
3. **给一次 operation 一个可观察的搜索预算，但不要把 `maxTurns` 当作唯一修复。** `maxIterations` 能挡住无限增长，却不能识别相似搜索；建议保留轮数上限作为硬兜底，再加搜索调用/无增益预算。
4. **允许 abort/error 后用已有 durable facts 生成最小结果。** 如果已有候选路径和 tool result，权限拒绝或 provider abort 时可生成“已找到什么、哪一步未完成”的明确终态；这需要明确的 runtime/SDK 产品语义，不能让 UI projection 偷写 journal。
5. **对 catalog 增加同 query 去重或 stale-ref 的一次性策略。** 这是独立于 FFF 的防护：相同 `SearchTools` query 不应在无 catalog 变化时无限重复；stale reference 应在有限次数后停止，而不是无条件要求 search again。

## 当前已确认与未能确认的盲点

### 已确认

- 当前 commit 是 `78ce62007ec54166c63622ef09e88da8a438b384`；上述源码 permalink 都固定到该 SHA。
- Desktop `send → RPC → ACP session/prompt → RuntimeSession.prompt → CodingAgentOperation → Agent loop` 的入口和继续路径。
- FFF `find`/`grep` 在 Desktop 是静态 extension tools；`Bash` 是唯一可直接承载 `ls`/`rg` 的常驻 shell 入口。
- tool result 会进入 Agent context 和 durable Session journal；ACP/Desktop 只做后续 projection。
- 普通工具异常、空结果、分页 cursor 都没有让 core 自动 stop；普通搜索结果没有 `terminate: true`。
- 本机目标 run 的量化记录：8 次 model attempt、14 个 emitted/distinct tool call、14 个 tool result、2 个 error result；调用列表中 `Bash` 11 次、FFF `find` 2 次，未出现 `SearchTools`/`ExecuteTool`。
- 目标 run 最终是 permission denial 后 `assistant stopReason: aborted`，不是自然语言总结。

### 未能确认

1. 题目给定的精确文本与本机 SQLite 记录文本不同；代码路径相同，但不能把实测记录声明为逐字复现题目输入。
2. provider 为什么没有续 `fff_c1`、为什么在已经有候选后仍继续枚举；源码只能证明 loop 提供了继续机会，不能读取 provider 的隐藏 reasoning。
3. 本次 8 个模型请求的原始 HTTP payload、首 token 延迟和 provider 服务端原因；本地 durable journal 只有 model attempts/usage 和消息结果。
4. 当前 run 是否经历了用户主动 stop、关闭窗口或审批 UI 的具体交互来源；journal 只保留了 permission deny 文本和 aborted 结果。
5. 真实 run 的 settings snapshot 没有 `maxTurns`，但不能据此推断所有 Desktop 用户配置都未设置最大迭代次数。
6. `Bash` 组合命令中被 `2>/dev/null` 隐藏的子命令逐项 exit status；journal 只保留整体 tool result。
7. FFF 首次模糊命中的完整剩余分页内容；模型没有传 cursor，当前 journal 只保存首批 result。

## 对本项目的影响

当前最小的代码级结论是：重复搜索的直接控制点在 Agent loop/统一工具执行边界，而不是 Desktop transcript projection。默认 prompt 可以继续作为行为指导，但不能替代 operation 级的搜索预算、重复 fingerprint 或无信息增益判定；`maxIterations` 只能作为轮数兜底。FFF 的 relative-path/cursor 错误反馈和 Bash 的宽 shell 入口应分别补充结构化恢复信息。权限 abort 后是否生成 partial summary 属于独立的 Runtime 产品语义，不能由 UI projection 越权写回 journal。
