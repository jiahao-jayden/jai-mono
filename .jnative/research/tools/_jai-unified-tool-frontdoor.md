# JAI 统一工具前门：稳定 SearchTools + ExecuteTool

核验日期：2026-09-11。源码钉在 `aea677f36e84ab77892be3127893f229e32f461a`（GitHub `jiahao-jayden/jai-mono`），避免后续改动混入结论。核验时工作树非 clean：完整 tracked diff 的 SHA-256 为 `a611b6246d8b37e14fb970c9616f0db12470334a6844590534218fcd33616a9a`，porcelain 状态 SHA-256 为 `64a42de35c25fa16e5d75aad0f770bce40763251f5373d61835e8670de8118ab`。下列 permalink 与摘录一律对应 HEAD；“工作树覆盖层”另行说明，不能冒充 commit permalink。

## 结论

1. 目标模型应只有两个稳定的 provider-visible tool：`SearchTools(query, limit?)` 与 `ExecuteTool(toolRef, input)`；搜索结果不再把真实工具 schema 激活到下一次模型请求。当前 `ToolCatalog` 恰好在搜索后改变下一轮 `context.tools`，这是需要移除的变量面。[`tool-catalog.ts#L72-L93`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/tool-catalog.ts#L72-L93)
2. `ExecuteTool` 不能是“查表后直接调用 `target.execute`”的普通 wrapper。它必须在构造 `ToolCallContext` 之前把外层调用解析成目标工具调用，再让目标工具完整经过 extension hooks、参数二次校验、core permission/approval、effect boundary 与真实 execute；否则会绕过当前责任链。[`agent-loop.ts#L600-L643`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L600-L643)
3. Connector 的五个 meta tools 可映射为：前三个 discovery/read tool 由 `SearchTools` 结果替代；`connector__get_action_guide` 可并入搜索详情或保留为 registry capability；`connector__execute_action` 成为 `ExecuteTool` 的一个目标，但其 `authorization.owner = "extension"` 和 `prepare → approval → execute/discard` 事务必须原样保留。[`connector/index.ts#L167-L230`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/connector/index.ts#L167-L230)
4. 通用前门不能自行推断 side effect。MCP 等 `owner: "core"` 目标必须按 registry 中目标工具自己的 permission resolver 进入 core permission middleware；Connector 等 `owner: "extension"` 目标必须让 core middleware只跳过目标名，再由目标 extension 自己完成授权事务。[`permissions/middleware.ts#L70-L89`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/permissions/middleware.ts#L70-L89)
5. MCP 很适合藏到稳定前门后：它已经把远端工具投影为具名、带 schema、带 authorization 的 catalog entry，并有断线、重连、list-changed invalidation 与 snapshot 替换。统一前门只替换 model projection，不应替换 MCP runtime 或 catalog refresh owner。[`mcp/runtime.ts#L234-L247`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/mcp/runtime.ts#L234-L247)
6. 稳定前门对 Anthropic prompt cache 有直接代码证据：adapter 明确在 system、最后一个 user block、最后一个 tool definition 上放 cache breakpoint；动态工具集合会改变最后一个工具定义及前缀。对 OpenAI Chat/Responses 只能说“有利于 provider 自动缓存”，本仓库 adapter 只读取 cached token 计数，没有显式 cache-control，不能承诺命中率。[`anthropic.ts#L293-L313`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/anthropic.ts#L293-L313) [`openai.ts#L484-L503`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/openai.ts#L484-L503)
7. 最小可行改动应是一个 registry + 一个“调用解析 seam”，而不是新建第二套权限框架或把 Extension contract 改成通用 RPC。现有 `CodingExtensionTool` 已同时拥有 schema、execution mode、authorization 与 execute，足以作为 registry entry。[`extensions/contract.ts#L189-L211`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions/contract.ts#L189-L211)

## 当前 SearchTools 为什么不稳定

HEAD 的 `ToolCatalog` 同时拥有完整 catalog、活跃名称集合与 model-visible projection；`SearchTools.execute` 会写入活跃集合。
[`packages/coding-agent/src/runtime/tool-catalog.ts#L24-L53`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/tool-catalog.ts#L24-L53)

```ts
// packages/coding-agent/src/runtime/tool-catalog.ts:24-53 @ aea677f36e84ab77892be3127893f229e32f461a
/**
 * Owns catalog discovery results and the active model-visible subset. The
 * extension contract only supplies descriptors; ranking and activation stay
 * behind this seam.
 */
export class ToolCatalog {
	readonly searchTool: AgentTool<typeof searchParameters>;
	#tools: readonly AgentTool[];
	readonly #limit: number;
	#activeNames: readonly string[] = [];
	…
	this.searchTool = {
		name: "SearchTools",
		…
		execute: async (_toolCallId, args): Promise<AgentToolResult> => {
			const matches = this.search(String(args.query), args.limit);
```

搜索不是纯查询：它替换 `#activeNames`；下一轮 `toolsForRequest` 把这些真实工具追加给 provider。并行 SearchTools 是 last-writer-wins。
[`packages/coding-agent/src/runtime/tool-catalog.ts#L72-L93`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/tool-catalog.ts#L72-L93)

```ts
// packages/coding-agent/src/runtime/tool-catalog.ts:72-93 @ aea677f36e84ab77892be3127893f229e32f461a
toolsForRequest(staticTools: readonly AgentTool[]): readonly AgentTool[] {
	const active = this.#activeNames.flatMap((name) => this.#tools.filter((tool) => tool.name === name));
	return [...staticTools, ...active];
}
…
// Replaces the previous active set so each search refocuses the tool surface rather than growing
// it without bound. `executionMode: "parallel"` means concurrent searches race here and the last
// writer wins; that is acceptable for refocusing, but callers must not assume both survive.
this.#activeNames = matches.map((tool) => tool.name);
return matches.map((tool) => ({ name: tool.name, description: tool.description }));
```

`AgentHarness` 会在每次 context projection 时重新调用 resolver，因此 active set 的变化确实进入下一次 provider request，而非只留在内存。
[`packages/agent/src/harness/agent.ts#L419-L429`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/harness/agent.ts#L419-L429)

```ts
// packages/agent/src/harness/agent.ts:419-429 @ aea677f36e84ab77892be3127893f229e32f461a
/**
 * 投影必须从完整 transcript 出发：手上的 context 可能已经是上一次投影的结果，
 * 而 compaction 的切点是相对完整历史的位置。
 */
private async projectContext(context: AgentContext, phase: BeforeModelCallPhase): Promise<AgentContext> {
	const projected = this.ledger.project(this.rawMessages);
	return {
		...context,
		tools: this.resolveTools ? [...this.resolveTools(this.staticTools)] : context.tools,
		messages: await this.hooks.runBeforeModelCall(phase, projected, this.agent.signal),
```

因此稳定模型的关键不是把 `SearchTools` 改名，而是让它成为纯 discovery：返回 `toolRef/name/description/inputSchema`，不再修改 provider-visible tools。registry 可刷新，两个前门 descriptor 不刷新。

### 工作树覆盖层

核验时未提交补丁为 catalog 增加 `visibility: "always"`、`alwaysTools` 与 `searchEnabled`，并把 MCP 标为 always-visible。它改善“无需 SearchTools 即可见”，但仍会让 MCP descriptor 集合随发现/重连变化，不能满足“两工具恒定”的 cache 目标。由于这部分没有 commit SHA，本笔记不为其伪造 permalink；上方两个 patch 指纹用于复现同一工作树。

## 不能在 wrapper 内直接调用目标 execute

当前 agent loop 在找到具体 `AgentTool`、按它的 schema 校验后，才构造 `ToolCallContext`。如果先选中普通 `ExecuteTool`，后续闭包捕获的就是 wrapper 的 schema 与 execute。
[`packages/agent/src/core/agent-loop.ts#L567-L603`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L567-L603)

```ts
// packages/agent/src/core/agent-loop.ts:567-603 @ aea677f36e84ab77892be3127893f229e32f461a
async function executeToolCall(run: AgentLoopRuntime, toolCall: ToolCall): Promise<ExecutedToolCall> {
	const { context, config, signal, emit } = run;
	const tool = context.tools.find((candidate) => candidate.name === toolCall.name);
	…
	const validation = validateToolArguments(tool, toolCall);
	…
	const ctx: ToolCallContext = {
		toolCall,
		tool,
		args: validation.value as Record<string, unknown>,
		signal,
	};
	…
	const invoke = async (): Promise<AgentToolResult> => {
		const args = finalArguments(tool, toolCall, ctx.args);
```

真实调用位于所有 middleware 之后；effect boundary 与事件也读取闭包中的 `tool` / `toolCall`。在 wrapper 的 `execute` 内直调目标，会避开目标级中间件、目标 schema 二次校验、目标 effect intent 和目标事件身份。
[`packages/agent/src/core/agent-loop.ts#L600-L643`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L600-L643)

```ts
// packages/agent/src/core/agent-loop.ts:600-643 @ aea677f36e84ab77892be3127893f229e32f461a
const invoke = async (): Promise<AgentToolResult> => {
	const args = finalArguments(tool, toolCall, ctx.args);
	let reservation: EffectEntryReservation | undefined;
	if (config.effectBoundary) {
		await pauseBeforeEffect(config, { type: "tool_intent", toolCallId: toolCall.id, toolName: toolCall.name });
		reservation = await config.effectBoundary.beforeToolEffect({ toolCall, tool, args, signal });
	}
	…
	return tool.execute(toolCall.id, args, signal, …);
};
…
const dispatch = (index: number): Promise<AgentToolResult> => {
	const middleware = middlewares[index];
	if (!middleware) return invoke();
	return middleware(ctx, () => dispatch(index + 1));
};
result = await dispatch(0);
```

正确 seam 必须位于上述 `tool` 查找之前：先验证 `ExecuteTool` envelope，解析 `toolRef`，再以“同一个外层 call id + 目标 name/schema/args”进入现有执行管线。给 provider 的 tool result 仍关联外层 `ExecuteTool` call id；权限、hook、effect 与 telemetry 使用目标 identity。

## authorization owner 必须属于目标工具

Extension contract 已明确把授权 owner 分成 core 与 extension；core-owned 必须携 permission 或 resolver，extension-owned 自己拥有授权事务。
[`packages/coding-agent/src/sdk/extensions/contract.ts#L189-L211`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions/contract.ts#L189-L211)

```ts
// packages/coding-agent/src/sdk/extensions/contract.ts:189-211 @ aea677f36e84ab77892be3127893f229e32f461a
export interface CodingExtensionTool<…> {
	readonly name: string;
	readonly description: string;
	readonly parameters: TParameters;
	readonly authorization:
		| {
				readonly owner: "core";
				readonly permission:
					| CodingToolPermission
					| CodingExtensionToolPermissionResolver<…>;
		  }
		| { readonly owner: "extension" };
	readonly execute: (runtime, call) => CodingExtensionToolResult | Promise<CodingExtensionToolResult>;
	readonly executionMode?: "sequential" | "parallel";
}
```

映射层会把 core-owned 目标加入 permission resolver map，把 extension-owned 目标加入 bypass-name set；这两个 registry 以真实目标名为 key。
[`packages/coding-agent/src/sdk/extensions.ts#L572-L614`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions.ts#L572-L614)

```ts
// packages/coding-agent/src/sdk/extensions.ts:572-614 @ aea677f36e84ab77892be3127893f229e32f461a
function mapExtensionTools(…) {
	const permissions = new Map<string, ResolvedExtensionToolPermission>();
	const extensionAuthorizedToolNames: string[] = [];
	…
	if (authorization.owner === "core") {
		const permission = authorization.permission;
		permissions.set(tool.name, (call) =>
			typeof permission === "function" ? permission(extensionRuntime(extension), call) : permission,
		);
	} else {
		extensionAuthorizedToolNames.push(tool.name);
	}
	…
	execute: (...args) => executeExtensionTool(tool, extensionRuntime(extension), extension.runAgent, ...args),
```

permission middleware 对 extension-owned 目标只在名称命中时跳过 core policy；对 core-owned 目标则解析目标 permission。若它只看到 `"ExecuteTool"`，目标 owner 信息就丢失。
[`packages/coding-agent/src/permissions/middleware.ts#L70-L89`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/permissions/middleware.ts#L70-L89)

```ts
// packages/coding-agent/src/permissions/middleware.ts:70-89 @ aea677f36e84ab77892be3127893f229e32f461a
export function createPermissionMiddleware(options: PermissionMiddlewareOptions): ToolMiddleware {
	const sessionAllowRules = options.sessionAllowRules ?? {};
	return async (context, next) => {
		if (options.extensionAuthorizedToolNames?.has(context.tool.name)) return next();
		const extensionPermission =
			options.coreToolPermissions?.get(context.tool.name) ??
			options.extensionToolPermissions?.get(context.tool.name);
		if (extensionPermission) {
			return evaluateExtensionPermission(
				context.tool.name,
				context.args,
				extensionPermission,
				…
				next,
			);
```

core-owned extension tools的 permission resolver会按 plan/dontAsk、side effect 与 sensitivity 判定审批；这套逻辑不应在 ExecuteTool 中复制。
[`packages/coding-agent/src/permissions/middleware.ts#L264-L307`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/permissions/middleware.ts#L264-L307)

```ts
// packages/coding-agent/src/permissions/middleware.ts:264-307 @ aea677f36e84ab77892be3127893f229e32f461a
const permission = await resolvePermission({
	toolCallId,
	args: structuredClone(args) as JsonObject,
	...(signal ? { signal } : {}),
});
…
const mode = settings.defaultMode ?? "default";
if (mode === "plan" && permission.sideEffect !== "read") {
	throw permissionDeniedError(toolName, "Plan mode only allows read-only work");
}
if (mode === "dontAsk") {
	throw permissionDeniedError(toolName, "Don't Ask denies Extension tools without an Allow rule");
}
const needsApproval =
	permission.sideEffect === "destructive" ||
	(mode !== "bypassPermissions" &&
		(permission.sideEffect === "write" ||
			permission.dataSensitivity === "sensitive" ||
			permission.dataSensitivity === "secret"));
…
if (!needsApproval) return next();
```

此外，extension middleware 在 permission middleware 之前装配：目标调用必须继续按目标名经过 before/after hooks，再进 permission。
[`packages/coding-agent/src/runtime/assemble.ts#L41-L48`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/assemble.ts#L41-L48)

```ts
// packages/coding-agent/src/runtime/assemble.ts:41-48 @ aea677f36e84ab77892be3127893f229e32f461a
return {
	tools: [...(input.extraTools ?? []), ...(input.extensionTools ?? []), ...codingTools],
	aroundToolCall: [
		...(input.extensionToolMiddleware ? [input.extensionToolMiddleware] : []),
		...(input.extraAroundToolCall ?? []),
		...(input.kind === "primary" && input.attachments ? [input.attachments.aroundToolCall] : []),
		...(input.permissionMiddleware ? [input.permissionMiddleware] : []),
	],
```

## Connector 五个 meta tools 的映射

当前五个 provider-visible meta tools 是：

| 当前工具 | 稳定前门映射 | 授权保持 |
|---|---|---|
| `connector__list_apps` | `SearchTools({query:"connector apps"})` 的分类/来源 facet | 只读 discovery |
| `connector__list_connections` | `SearchTools({query:"connector connections"})` 的安全 connection summary facet；若产品仍需要独立枚举，可作为不可执行 search result kind | 只读 discovery |
| `connector__search_actions` | 直接并入统一 `SearchTools`，返回 action `toolRef` | 只读 discovery |
| `connector__get_action_guide` | 搜索详情返回 schema/guide，或作为 registry 中的 read capability 由 `ExecuteTool` 调用 | core-owned read |
| `connector__execute_action` | `ExecuteTool({toolRef:"connector:demo.create", input})` 解析到现有 execute capability | extension-owned；prepare/approval 不变 |

前三个 discovery tool 当前均声明 core-owned read；执行 action 明确声明 sequential + extension-owned。
[`packages/extension/src/connector/index.ts#L80-L123`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/connector/index.ts#L80-L123)

```ts
// packages/extension/src/connector/index.ts:80-123 @ aea677f36e84ab77892be3127893f229e32f461a
tools: [
	{
		name: "connector__list_apps",
		…
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", reason: "Lists available Connector applications." },
		},
		…
	},
	{
		name: "connector__list_connections",
		…
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", reason: "Lists Connector connection summaries." },
		},
		…
	},
	{
		name: "connector__search_actions",
```

guide 与 execute 的授权边界不能合并：guide 是 core read，execute 是 extension owner。
[`packages/extension/src/connector/index.ts#L135-L161`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/connector/index.ts#L135-L161)

```ts
// packages/extension/src/connector/index.ts:135-161 @ aea677f36e84ab77892be3127893f229e32f461a
{
	name: "connector__get_action_guide",
	…
	authorization: {
		owner: "core",
		permission: { sideEffect: "read", reason: "Reads a Connector Action guide." },
	},
	…
},
{
	name: "connector__execute_action",
	description: "Execute one Connector Action after discovering its guide.",
	parameters: executeParameters,
	executionMode: "sequential",
	authorization: { owner: "extension" },
	execute: async (…) => executeConnectorAction(…),
},
```

### Connector 安全 trace

给定模型调用：

```json
{"toolRef":"connector:demo.create","input":{"name":"record"}}
```

1. `ExecuteTool` resolver 只做 envelope 校验与 registry lookup，将有效调用身份解析成 `connector__execute_action`，目标参数保持 `{actionId:"demo.create", input:{name:"record"}}`。
2. extension middleware 以目标名运行 before hooks、目标 schema 校验；permission middleware看到目标在 `extensionAuthorizedToolNames` 中，只跳过 core policy，不代替 Connector approval。
3. `executeConnectorAction` 必须先 `prepareAction`。prepared result是 server-owned opaque token及经 policy 计算出的 side effect、sensitivity、approval mode、expiry。
4. plan mode在 prepared side effect非 read时拒绝；dontAsk 在 approvalMode=ask时拒绝；ask 时通过 extension runtime `requestApproval`。
5. 仅允许后才 `executePreparedAction`；任何未消费路径在 `finally` 中 `discardPreparedAction`。

第 3–5 步由现有 Connector extension完整拥有。
[`packages/extension/src/connector/index.ts#L167-L230`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/connector/index.ts#L167-L230)

```ts
// packages/extension/src/connector/index.ts:167-230 @ aea677f36e84ab77892be3127893f229e32f461a
const request = requestContext(context.sessionId, toolCallId, signal);
const preparedResult = await client.prepareAction(input, request);
if (preparedResult.isErr()) throw preparedResult.error;
const prepared = preparedResult.value;
let consumed = false;
try {
	if (context.permissionMode === "plan" && prepared.sideEffect !== "read") { … }
	if (prepared.approvalMode === "ask") {
		if (context.permissionMode === "dontAsk") { … }
		const approval = await context.requestApproval(…);
		…
	}
	consumed = true;
	const executed = await client.executePreparedAction(prepared, request);
	…
} finally {
	if (!consumed) await client.discardPreparedAction(prepared, request).catch(() => {});
}
```

Connector service在 prepare阶段重做 action existence、hidden/deny policy、connection、scope与 input schema验证，并创建五分钟 preparation。`ExecuteTool` 不能通过 search result里的旧 side effect直接批准。
[`app/connector/src/runtime.ts#L170-L205`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/app/connector/src/runtime.ts#L170-L205)

```ts
// app/connector/src/runtime.ts:170-205 @ aea677f36e84ab77892be3127893f229e32f461a
async prepareAction(input: PrepareActionInput, context: RequestContext) {
	if (context.signal?.aborted) return Result.err(new ConnectorRequestCancelled(…));
	const action = this.#actions.get(input.actionId);
	if (!action) return Result.err(new ConnectorActionNotFound(…));
	const policy = this.#policyFor(action);
	if (this.#isActionHidden(action)) {
		return Result.err(new ConnectorPolicyDenied({ … policy: "hidden" … }));
	}
	if (policy === "deny") {
		return Result.err(new ConnectorPolicyDenied({ … policy: "deny" … }));
	}
```

execute阶段验证 preparation仍存在、与 request/action/描述/风险/expiry完全匹配，然后先删除以保证一次性消费，再检查过期并调用 adapter。
[`app/connector/src/runtime.ts#L278-L318`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/app/connector/src/runtime.ts#L278-L318)

```ts
// app/connector/src/runtime.ts:278-318 @ aea677f36e84ab77892be3127893f229e32f461a
const pending = this.#preparedActions.get(prepared.preparationId);
if (!pending) return Result.err(new ConnectorPreparationInvalid({ … reason: "missing" }));
if (
	pending.requestId !== context.requestId ||
	pending.actionId !== prepared.actionId ||
	…
	pending.expiresAt !== prepared.expiresAt
) {
	return Result.err(new ConnectorPreparationInvalid({ … reason: "mismatch" }));
}
this.#preparedActions.delete(prepared.preparationId);
if (pending.expiresAt <= Date.now()) {
	return Result.err(new ConnectorPreparationInvalid({ … reason: "expired" }));
}
const output = await pending.adapter.execute(…);
```

## MCP 保留 catalog owner，只改变模型投影

MCP runtime发现远端工具后已经创建完整 `CodingExtensionTool`：稳定 namespaced name、远端 schema、core authorization、presentation与真实 call closure。统一前门可以直接把它作为 registry entry，不需要重写 MCP protocol。
[`packages/extension/src/mcp/runtime.ts#L234-L247`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/mcp/runtime.ts#L234-L247)

```ts
// packages/extension/src/mcp/runtime.ts:234-247 @ aea677f36e84ab77892be3127893f229e32f461a
#createTool(tool: McpRemoteTool): CodingExtensionTool<…> {
	const originalName = tool.name;
	return {
		name: `mcp__${sanitize(this.#options.namespace)}__${sanitize(this.#server.name)}__${sanitize(originalName)}`,
		description: tool.description?.trim() || `MCP tool ${originalName} from ${this.#server.name}`,
		parameters: jsonSchemaToTypeBox(tool.inputSchema),
		executionMode: "parallel",
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", reason: `Calls MCP tool "${originalName}" on ${this.#server.name}.` },
		},
		execute: async (_runtime, call) => this.#callTool(originalName, call.args, call.signal),
	};
}
```

其执行仍应走 `#callTool`，这样断线与 SDK failure继续投影为领域错误；不能由 ExecuteTool直接碰 MCP client。
[`packages/extension/src/mcp/runtime.ts#L250-L280`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/extension/src/mcp/runtime.ts#L250-L280)

```ts
// packages/extension/src/mcp/runtime.ts:250-280 @ aea677f36e84ab77892be3127893f229e32f461a
async #callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal) {
	const client = this.#client;
	if (!client) {
		throw new McpExtensionToolCallFailed({
			serverName: this.#server.name,
			toolName,
			message: `MCP server "${this.#server.name}" is disconnected`,
		});
	}
	try {
		const result = await client.callTool(
			{ name: toolName, arguments: args },
			undefined,
			signal ? { signal } : undefined,
		);
		…
	} catch (cause) {
		throw new McpExtensionToolCallFailed({ … cause });
	}
}
```

list-changed只发 invalidation，refresh coordinator串行 rediscover后原子替换 catalog snapshot。稳定前门应让搜索读新 snapshot，但 provider-visible tools仍只有两个。
[`packages/coding-agent/src/sdk/extensions.ts#L695-L699`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions.ts#L695-L699)

```ts
// packages/coding-agent/src/sdk/extensions.ts:695-699 @ aea677f36e84ab77892be3127893f229e32f461a
invalidate(): void {
	if (this.#closed || this.#refreshRequested) return;
	this.#refreshRequested = true;
	this.#refreshTail = this.#refreshTail.then(() => this.#drainRefreshes());
}
```

HEAD 在完整发现、全局名称冲突检查成功后才 commit mappings，并一次替换 ToolCatalog；失败不提交半个 snapshot。
[`packages/coding-agent/src/sdk/extensions.ts#L773-L799`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions.ts#L773-L799)

```ts
// packages/coding-agent/src/sdk/extensions.ts:773-799 @ aea677f36e84ab77892be3127893f229e32f461a
async #discoverAndCommit(): Promise<ResultType<void, CodingExtensionError>> {
	const discovered = new Map<…>();
	for (const extension of this.#extensions) {
		const catalogs = await discoverCatalogTools(extension, this.#abortController.signal);
		if (this.#closed) return Result.ok(undefined);
		if (catalogs.isErr()) return catalogs;
		discovered.set(extension, catalogs.value);
	}
	const names = assertCatalogCapabilityNames(this.#extensions, discovered);
	if (names.isErr()) return names;
	…
	syncActivationRegistries(this.#extensions, this.#registries);
	this.#registries.toolCatalog?.replace(extensionCatalogTools(this.#extensions));
	return Result.ok(undefined);
}
```

## Provider cache adapter 映射

Anthropic adapter有三处显式 ephemeral breakpoint。稳定前门固定 system后的 tools前缀，尤其固定“最后一个工具定义”，避免每次 SearchTools激活不同真实 schema。
[`packages/ai/src/providers/anthropic.ts#L143-L168`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/anthropic.ts#L143-L168)

```ts
// packages/ai/src/providers/anthropic.ts:143-168 @ aea677f36e84ab77892be3127893f229e32f461a
function buildParams(model: Model, context: Context, options?: StreamOptions) {
	const params = {
		model: model.remoteModelId ?? model.id,
		max_tokens: options?.maxTokens ?? model.maxTokens,
		stream: true,
		messages: convertMessages(transformMessagesForModel(context.messages, model)),
	};
	if (context.systemPrompt) {
		params.system = [{
			type: "text",
			text: context.systemPrompt,
			cache_control: CACHE_CONTROL,
		}];
	}
	…
	if (context.tools.length > 0) params.tools = convertTools(context.tools);
```

最后一个工具定义被显式打断点；工具集合的顺序或最后项变化都会改变这个被缓存片段。
[`packages/ai/src/providers/anthropic.ts#L293-L313`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/anthropic.ts#L293-L313)

```ts
// packages/ai/src/providers/anthropic.ts:293-313 @ aea677f36e84ab77892be3127893f229e32f461a
function convertTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	return tools.map((tool, index) => {
		const base = {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: schema.properties ?? {},
				required: schema.required ?? [],
			},
		};
		if (index === tools.length - 1) {
			base.cache_control = CACHE_CONTROL;
		}
		return base;
	});
}
```

OpenAI Chat adapter会把当前 `context.tools` 全量转换为 function tools，但没有写 cache-control；它只从 usage读取 provider报告的 cached tokens。因此稳定前门减少请求前缀变化，但命中策略由 upstream决定。
[`packages/ai/src/providers/openai.ts#L176-L180`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/openai.ts#L176-L180)

```ts
// packages/ai/src/providers/openai.ts:176-180 @ aea677f36e84ab77892be3127893f229e32f461a
if (context.tools.length > 0) {
	params.tools = convertTools(context.tools, compat);
}
return params;
```

[`packages/ai/src/providers/openai.ts#L484-L503`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/openai.ts#L484-L503)

```ts
// packages/ai/src/providers/openai.ts:484-503 @ aea677f36e84ab77892be3127893f229e32f461a
export function makeUsage(raw: {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	…
}): Usage {
	const input = raw.prompt_tokens ?? 0;
	const output = raw.completion_tokens ?? 0;
	const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? 0;
	return {
		input,
		output,
		cacheRead,
		cacheWrite: 0,
```

OpenAI Responses同样只发送固定 tools数组并读取 `cached_tokens`，没有 adapter-owned cache write/control。
[`packages/ai/src/providers/openai-responses.ts#L136-L148`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/openai-responses.ts#L136-L148)

```ts
// packages/ai/src/providers/openai-responses.ts:136-148 @ aea677f36e84ab77892be3127893f229e32f461a
function buildParams(model: Model, context: Context, options?: StreamOptions) {
	return {
		model: model.remoteModelId ?? model.id,
		stream: true,
		store: false,
		include: ["reasoning.encrypted_content"],
		instructions: context.systemPrompt || undefined,
		input: convertMessages(transformMessagesForModel(context.messages, model)),
		max_output_tokens: options?.maxTokens ?? model.maxTokens,
		…
		...(context.tools.length === 0 ? {} : { tools: convertTools(context.tools) }),
	};
}
```

[`packages/ai/src/providers/openai-responses.ts#L456-L469`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/ai/src/providers/openai-responses.ts#L456-L469)

```ts
// packages/ai/src/providers/openai-responses.ts:456-469 @ aea677f36e84ab77892be3127893f229e32f461a
function applyUsage(output: AssistantMessage, usage: ResponseUsage | null | undefined): void {
	if (usage) output.usage = makeResponsesUsage(usage);
}
function makeResponsesUsage(raw: ResponseUsage): Usage {
	return {
		input: raw.input_tokens,
		output: raw.output_tokens,
		cacheRead: raw.input_tokens_details.cached_tokens,
		cacheWrite: 0,
		…
	};
}
```

## 最小可行 interface

不新增第二种 Extension tool contract。保留现有 `CodingExtensionTool → AgentTool` mapping与 authorization registries，只把 catalog的 model projection改为两个稳定 descriptor，并在 agent loop进入中间件前增加一个可选调用解析 seam。

```ts
interface ToolFrontdoor {
	search(
		query: string,
		limit?: number,
	): readonly {
		toolRef: string;       // snapshot 内不可猜测的 opaque ref
		name: string;
		description: string;
		inputSchema: JsonObject;
	}[];

	resolve(
		toolRef: string,
		input: JsonObject,
		call: { toolCallId: string; signal?: AbortSignal },
	): Result<ResolvedToolInvocation, ToolFrontdoorFailure>;
}

interface ResolvedToolInvocation {
	readonly tool: AgentTool;     // 现有 mapped target，保留 execute closure
	readonly toolCall: ToolCall;  // id 沿用外层；name 改为 target name
	readonly args: JsonObject;    // 目标 schema 的输入
}
```

Provider-visible schema固定为：

```ts
SearchTools({ query: string, limit?: 1..8 })
ExecuteTool({ toolRef: string, input: Record<string, unknown> })
```

`resolve` 的接入点必须早于 `context.tools.find` / `validateToolArguments` / `ToolCallContext` 构造。它只做 registry lookup与 envelope解包，不执行目标、不做授权、不复制 approval。解析后的 `ResolvedToolInvocation` 走当前单一责任链。

现有 Extension execution adapter也应保留，因为它绑定 call signal、子 agent lifetime、update projection与 settle。
[`packages/coding-agent/src/sdk/extensions/execution.ts#L7-L16`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/sdk/extensions/execution.ts#L7-L16)

```ts
// packages/coding-agent/src/sdk/extensions/execution.ts:7-16 @ aea677f36e84ab77892be3127893f229e32f461a
/** Every child belongs to one tool call; even an unawaited child is aborted and joined. */
export async function executeExtensionTool(
	tool: CodingExtensionTool<any, any, any>,
	runtime: CodingExtensionRuntime<any, any, any>,
	executeAgent: RunAgentExecution | undefined,
	...[toolCallId, args, signal, onUpdate]: Parameters<AgentTool["execute"]>
): ReturnType<AgentTool["execute"]> {
	const lifetime = new AbortController();
	const callSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
	const pending = new Set<Promise<unknown>>();
```

### 为什么 toolRef 应 opaque

若只用公开 `name`，catalog refresh后同名工具可能对应新 schema或新 execute closure；若 SearchTools结果携 opaque ref（至少绑定 catalog generation + target identity），ExecuteTool可在 stale时明确返回“重新搜索”，而不是拿旧 guide配新工具。当前 refresh会替换 descriptor snapshot并只保留仍存在的 active names，已经说明 snapshot变化是正常事件。
[`packages/coding-agent/src/runtime/tool-catalog.ts#L64-L70`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/coding-agent/src/runtime/tool-catalog.ts#L64-L70)

```ts
// packages/coding-agent/src/runtime/tool-catalog.ts:64-70 @ aea677f36e84ab77892be3127893f229e32f461a
/** Replaces the descriptor snapshot for future requests and retains only still-valid active names. */
replace(tools: readonly AgentTool[]): void {
	const next = validateCatalogTools(tools);
	const nextNames = new Set(next.map((tool) => tool.name));
	this.#tools = next;
	this.#activeNames = this.#activeNames.filter((name) => nextNames.has(name));
}
```

## 失败模式与边界

| 失败模式 | 当前证据 | 稳定前门要求 |
|---|---|---|
| 直接 `target.execute` 绕过权限与 hooks | agent loop只在外层 tool周围派发 middleware；见[执行责任链](#不能在-wrapper-内直接调用目标-execute) | resolver必须在责任链之前替换 effective target |
| Connector批准旧风险、执行新风险 | prepare阶段重新计算 policy/connection/scope/schema；execute校验prepared全部字段 | 永远调用现有 `prepareAction`，不相信 SearchTools返回的sideEffect |
| 用户拒绝/plan/dontAsk后泄漏 preparation | Connector `finally` discard | ExecuteTool不得吞异常或提前标记consumed |
| preparation重放、串会话、过期 | service校验request/action/metadata/expiry并在adapter前delete | 保持同一外层toolCallId/requestId贯穿resolve→prepare→execute |
| MCP断线 | `#callTool`在无client时抛领域错误 | registry entry仍调用MCP runtime closure，不缓存client handle |
| MCP list_changed与执行并发 | refresh coordinator commit新snapshot；旧closure可能随后断线 | opaque ref含generation；stale在执行前失败并要求重搜 |
| SearchTools并发 | 当前last-writer-wins | 新SearchTools纯读，无active-set写入，结果互不覆盖 |
| 未知toolRef | 当前未知真实tool名会得到ToolNotFound | 返回白名单错误DTO，不回传内部registry或cause |
| core/extension owner混淆 | owner registry均以目标名为key | permission middleware必须看到目标名，不得只看到ExecuteTool |
| provider cache未命中 | Anthropic有显式breakpoint；OpenAI只有usage观察 | 只保证请求tools descriptor稳定，不承诺OpenAI命中率 |
| sequential目标被并发 | Connector execute声明`executionMode: "sequential"` | batch调度必须按resolved target mode判断，不能按ExecuteTool固定mode |

最后一项要求 resolver发生在 batch的 sequential判定之前。当前 batch用 provider call name查 `context.tools` 并读取该工具的 mode；若所有调用都叫 ExecuteTool且它被标parallel，Connector write会错误并发；若标sequential，则所有MCP read也被不必要串行。
[`packages/agent/src/core/agent-loop.ts#L516-L524`](https://github.com/jiahao-jayden/jai-mono/blob/aea677f36e84ab77892be3127893f229e32f461a/packages/agent/src/core/agent-loop.ts#L516-L524)

```ts
// packages/agent/src/core/agent-loop.ts:516-524 @ aea677f36e84ab77892be3127893f229e32f461a
async function executeToolCallBatch(run: AgentLoopRuntime, toolCalls: ToolCall[]): Promise<ExecutedToolBatch> {
	const { context, config, signal, emit } = run;
	const hasSequentialTool = toolCalls.some((toolCall) => {
		const tool = context.tools.find((candidate) => candidate.name === toolCall.name);
		return tool?.executionMode === "sequential";
	});
	const sequential = config.toolExecution === "sequential" || hasSequentialTool;
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 只读核验本仓库一手源码，钉 `aea677f36e84ab77892be3127893f229e32f461a`；覆盖 Agent loop、Coding Agent catalog/permission/Extension、MCP、Connector、Anthropic/OpenAI adapters及相关测试。 |
| 作者或维护者本人的说法 | 未找到独立 RFC/ADR；源码注释与测试是本次唯一可钉版本的维护者意图证据。 |
| 同类方案 | 未查。用户明确要求“只读仓库机制调研”，本笔记不引入仓库外方案，也不把外部常识当结论。 |
| issue / PR / 社区实践 | 未查。问题是当前仓库内部机制映射，不需要以 issue 支撑。 |
| 历史演变 | 只核验当前 HEAD 与工作树 overlay；未追 git history。overlay以diff/status指纹固定，因未提交而不能生成SHA permalink。 |

## 对本项目的影响

最小方向是：

1. `ToolCatalog`继续拥有可刷新的完整目标 registry，但 `SearchTools`只返回结果，不再写active set。
2. provider固定只看 `SearchTools`和`ExecuteTool`；MCP、Connector与其它Extension tool不再进入provider tools数组。
3. 在 Agent执行管线最前面解析frontdoor call，并在batch scheduling、schema validation、extension hooks、permission、effect boundary之前得到目标tool。
4. 不改Connector prepare/approval/service，不改MCP connection/reconnect/catalog refresh，不复制permission evaluator，不新增第二套tool authorization DTO。
5. 增加最小测试：provider每轮tools descriptor byte-stable；ExecuteTool到MCP仍触发core permission；ExecuteTool到Connector严格得到`prepare → approve → execute`，deny/plan得到`prepare → discard`；sequential target仍使batch串行；stale ref拒绝执行。

被证伪的方案是“把五个Connector meta tools和所有MCP tools都简单包进一个普通ExecuteTool.execute”。它只稳定了provider schema，却破坏了目标identity驱动的权限、hook、effect boundary、executionMode与Connector事务，安全上不可接受。
