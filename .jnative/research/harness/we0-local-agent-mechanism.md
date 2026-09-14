# “帮我看看最新的 we0 项目”本地 Agent 机制审计

核验日期：2026-09-12。源码钉定为 `jiahao-jayden/jai-mono@78ce62007ec54166c63622ef09e88da8a438b384`；本文链接均固定到该 SHA，避免后续 prompt、工具目录和循环实现变化后行号失真。审计只使用本仓库源码、测试、git 历史和本地仓库配置，不依赖目标数据库 trace，也未查询外部产品。

## 结论

1. **模型并没有收到“当前项目是 jai-mono、项目根目录是 `/Users/jayden/code/jai-mono`、它的父目录下有哪些 Desktop 项目”的显式上下文。** Desktop 把 Session 所属 Project 的 canonical path 作为 `cwd` 传给 Runtime Host，后者再把它用于工具执行环境；默认 system prompt 没有 cwd、Project id、display name 或项目列表。因此模型只能从相对路径工具行为、`pwd` 或主动 shell 探索中反推出 cwd。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)
2. **“最新的 we0 项目”跨越当前 workspace，而专用 `find/grep` 被硬限制在当前 cwd，且没有 Project Catalog/邻居项目发现工具。** FFF 明确关闭 filesystem-root 与 home 扫描并拒绝 `../`；若“项目”指本地 checkout，模型只能主动选择 `Bash` 的 `pwd/ls/find/rg/stat` 等通用命令。这正是近似 shell 搜索的结构性来源。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L224-L248)
3. **正常 Desktop Operation 可见的最小工具面是 11 个，但“项目发现”仍为空缺。** 4 个 built-in（`Read/Bash/Edit/Write`）+ 5 个静态扩展工具（`UpdateTodos/SpawnAgent/Skill/find/grep`）+ 2 个动态目录 front door（`SearchTools/ExecuteTool`）；Connector/Web Search/MCP/Agent Plugin 的实际动态工具可再增加。`SearchTools` 搜的是动态工具描述，不是磁盘项目。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/test/tools/index.test.ts#L4-L14)
4. **默认 prompt 会减少单次搜索的低效写法，但没有任务级去重、相似调用抑制、目录探索预算或“先列一层再停止”的策略。** Agent core 只要模型继续返回 tool call 就继续下一 turn；工具失败也被包装成结果回灌，让模型自行决定重试。唯一硬预算是可选 `maxTurns/maxIterations`；本机当前确实未设置，因而没有迭代上限。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204)
5. **模型收到的是完整 tool result 文本，而 Desktop 的人类化投影不会反向影响模型；真正会丢信息的是工具自身与 compaction。** Bash 只保留最后 2,000 行/50 KiB/单行 2,000 字符，但提供临时文件路径；Read 保留开头同样阈值并给 next offset；FFF grep 每页最多 50 条且每行裁到 500 字符；compaction 摘要输入再把每条历史 tool result 裁到 2,000 字符。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L211)
6. **“大量近似 shell 搜索”是机制允许的推断，不是仅凭源码能证明已经发生的事实。** 已证实的是：缺少邻居项目上下文与专用发现工具、Bash 对 `pwd/ls/find/rg/stat` 默认按只读命令放行、无重复抑制、失败后循环继续；具体某次请求究竟调用了多少次、每条命令是什么，仍需 model-request/tool trace 才能确认。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/evaluate.ts#L24-L42)
7. **本机配置里 `we0` 是 MCP server 名，不是已登记的 Desktop Project。** 因而模型还有 `SearchTools("we0") → ExecuteTool` 这条动态能力路径；如果它把“项目”理解成本地 checkout 才会走 shell。当前唯一登记 Project 是 `/Users/jayden/jai-work`，这进一步说明请求本身存在实体歧义。[源码](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/mcp/runtime.ts#L286-L299)

## 具体调用链 trace

给定 Desktop 中某个归属 `jai-mono` Project 的 Session，用户发送“帮我看看最新的 we0 项目”：

1. Desktop 先用 `sessionId` 查询 Session Catalog；仅当项目仍可访问时，取 Project `canonicalPath` 作为 cwd，否则退回 `process.cwd()` 且后续 local capability 会按这个 cwd 打开。Project id/displayName 没有附加到 prompt。
2. `DesktopAcpAgentHost` 建立/恢复 ACP Session 时发送 `{sessionId, cwd}`，随后把用户原文作为唯一 text block 发到 `session/prompt`。
3. ACP `AcpV2Agent` 将 blocks 拼成 text，`RuntimeSession.prompt` 先拒绝空白输入，再将用户消息与 Operation admission 持久化。
4. Runtime Host 用 Session 的 `info.cwd` 打开 `CodingAgentOperationDriver`；Desktop local capability source 用同一 cwd 创建 file capabilities、Skills、Agent Plugins、FFF Search、MCP，产品配置再追加 Todo、Subagent 等扩展。
5. Public Coding Agent 组装默认 system prompt 与可选语言 instruction；`cwd` 只进入 `NodeExecutionEnvironment`、permission workspace root、FFF `basePath`，没有拼入 system/user message。
6. 第一次 provider 请求至少看到 11 个工具。对于“最新的 we0 项目”，模型可以先用 `SearchTools("we0")` 发现本机配置的 we0 MCP 工具；若把“项目”理解为本地 checkout，`find` 又只能查当前 workspace、不能用 `../`，于是必须转向 `Bash`，常见候选会是 `pwd`、对 `/Users/jayden/code` 的 `ls/find/rg/stat` 或 git 查询。
7. 每个 shell 结果成为 `toolResult` durable message，并在下一次 provider 请求中回灌。若结果为空，Bash 返回 `(no output)`；若路径错误/权限/超时，则错误文本以 `isError: true` 回灌。core 不终止，模型可改写搜索条件再试。
8. 只要 assistant 继续输出至少一个 tool call，loop 就继续。直到 assistant 给出无 tool call 的普通回复、abort/error/context overflow、所有工具结果都声明 `terminate`，或命中可选 `maxIterations`。

入口与 cwd 传递的直接证据：[`app/desktop/electron/agent/acp-host.ts#L284-L315`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L284-L315)

```ts
const cwd = await this.#resolveSessionCwd(sessionId);
const runtime: AcpSessionRuntime = {
	sessionId,
	cwd,
	…
};
…
const resumed = await this.#client.request("session/resume", { sessionId, cwd, replayFrom: { type: "start" } });
…
const created = await this.#client.request("session/new", { sessionId, cwd });
```

用户原文进入 ACP 的直接证据：[`app/desktop/electron/agent/acp-host.ts#L326-L346`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/agent/acp-host.ts#L326-L346)

```ts
const runtime = await this.#ensureSession(input.sessionId, input.modelRef, input.mode);
await this.#setConfiguration(runtime, input.modelRef, input.mode);
const prompt = [
	{ type: "text", text: input.message } as const,
	… 
];
const response = await this.#request("session/prompt", {
	sessionId: runtime.sessionId,
	prompt,
});
```

Operation 用 Session cwd 创建 Coding Agent 的直接证据：[`app/server/src/agents/coding-agent.ts#L94-L106`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/agents/coding-agent.ts#L94-L106)

```ts
const created = await createCodingAgent({
	...configured.value,
	…
	permissionMode: permissionModeFor(input.runtimeConfiguration.mode),
	cwd: input.cwd,
	session: { kind: "resume", id: input.sessionId, store: input.sessionStore },
	effectBoundary: input.effectBoundary,
	modelRequestTelemetryObserver: telemetryObserver,
	permissionTelemetryObserver: telemetryObserver,
});
```

## 逐项发现

### 1. 项目事实只进入执行环境，不进入模型提示词

**主张（已证实）：** Desktop Session Catalog 知道 `projectId`、Project canonical path 与 project metadata；但 Agent 路径只投影 `cwd/configRoot/defaultAllowedDirectories`，没有把 Project id、display name、父目录或 Project 列表传入 Coding Agent。

[`app/desktop/electron/session-catalog/remote.ts#L237-L247`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L237-L247)

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

**主张（已证实）：** SDK 将 cwd 设为工具环境、配置根和默认允许目录，但 instructions 只由固定默认 prompt 与调用方额外 instructions 构成。

[`packages/coding-agent/src/sdk/create-coding-agent.ts#L89-L120`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/create-coding-agent.ts#L89-L120)

```ts
const cwd = input.cwd ?? process.cwd();
…
executionContext: {
	localFileAccess: true,
	cwd,
	configRoot: fileCapabilities.workspaceDirectory,
	defaultAllowedDirectories: [cwd] as readonly [string, ...string[]],
},
…
instructions: [DEFAULT_CODING_AGENT_INSTRUCTIONS, input.instructions].filter(Boolean).join("\n\n"),
```

**主张（已证实）：** 默认 system prompt 不出现 cwd、Project、metadata 或邻居目录，只给通用搜索策略。

[`packages/coding-agent/src/runtime/default-instructions.ts#L1-L6`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/default-instructions.ts#L1-L6)

```ts
export const DEFAULT_CODING_AGENT_INSTRUCTIONS = `You are Jai, a coding agent. Inspect the workspace before editing, keep changes scoped, and explain the result clearly.

Do not narrate every routine tool call. …

Search the workspace with grep and find. For multiple OR terms, use one regex grep or parallel grep calls. If you must search through Bash, use rg; never bash grep or find.
After locating a hit, Read only nearby lines with offset and limit. Known files outside the workspace: Read them directly.`;
```

**边界：** Project 不可访问或 Session 无 Project 时，Desktop 返回 `localFileAccess: false`，但 `resolveSessionCwd` 当前会用 `process.cwd()` 发给 Runtime Host；源码未证明这个 fallback 一定是用户期望的 `/Users/jayden/code`。

[`app/desktop/electron/runtime.ts#L48-L55`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/runtime.ts#L48-L55)

```ts
const config = await DesktopConfigService.open();
const locale = createDesktopLocaleService();
await config.setAgentLanguage(locale.get().locale);
const agentHost = await DesktopAcpAgentHost.open(broadcast, {
	resolveSessionCwd: async (sessionId) => {
		const execution = await sessions.resolveExecutionContext(sessionId);
		return execution.localFileAccess ? execution.cwd : process.cwd();
	},
});
```

### 2. 搜索能力只覆盖当前 workspace

**主张（已证实）：** Desktop local runtime 确实注入了专用 `find/grep`，不是所有搜索都应走 Bash。

[`app/server/src/runtime-capabilities/desktop-local.ts#L57-L72`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime-capabilities/desktop-local.ts#L57-L72)

```ts
const fileCapabilities = {
	homeDirectory: this.#homeDirectory,
	workspaceDirectory: input.cwd,
	workspaceTrusted: trust.isOk() && trust.value.trusted,
};
const skillsExtension = createSkillsExtension({
	...fileCapabilities,
	pluginSkills: agentPlugins.skillCards,
});
const fffSearchExtension = createFffSearchExtension({ … });
return Result.ok({
	fileCapabilities,
	extensions: [skillsExtension, agentPlugins, fffSearchExtension, createMcpExtension()],
```

**主张（已证实）：** FFF 的扫描根就是 `context.cwd`，并显式关闭 filesystem root 和 home 扫描；因此它无法发现 `/Users/jayden/code/jai-mono` 的兄弟目录。

[`packages/extension/src/search/index.ts#L224-L248`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L224-L248)

```ts
const created = FileFinder.create({
	basePath: context.cwd,
	aiMode: true,
	enableFsRootScanning: false,
	enableHomeDirScanning: false,
	…
});
…
const ready = await created.value.waitForIndexReady(INDEX_TIMEOUT_MS);
```

**主张（已证实）：** 即使模型尝试 `path: "../"`，扩展也拒绝越界；测试覆盖了该行为。

[`packages/extension/src/search/index.ts#L268-L279`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L268-L279)

```ts
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
```

**主张（已证实）：** 没有“列出 Desktop Project”“按更新时间找项目”或“发现 cwd 邻居”的模型工具。Desktop Catalog 自身虽有 `listProjects()`，该接口没有进入 Coding Agent capability assembly。仓库搜索只找到 Skills 的 project roots 与 Desktop Catalog 的 host-side `listProjects`，没有对应 AgentTool。

[`app/desktop/electron/session-catalog/remote.ts#L21-L39`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/desktop/electron/session-catalog/remote.ts#L21-L39)

```ts
export interface DesktopSessionCatalogPort {
	createProject(input: CreateProjectInput): Promise<Project>;
	relinkProject(projectId: string, input: CreateProjectInput): Promise<Project>;
	…
	getProject(id: string): Promise<Project>;
	listProjects(): Promise<readonly Project[]>;
	…
	resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext>;
	close(): Promise<void>;
}
```

### 3. Desktop 最小工具面为 11 个，但没有项目发现工具

**主张（已证实）：** built-in 固定为 4 个，顺序是 `Read/Bash/Edit/Write`。

[`packages/coding-agent/test/tools/index.test.ts#L4-L14`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/test/tools/index.test.ts#L4-L14)

```ts
describe("createCodingTools", () => {
	test("returns the stable built-in tool set", () => {
		const tools = sdk.createCodingTools({ cwd: process.cwd() });

		expect(tools.map((tool) => tool.name)).toEqual(["Read", "Bash", "Edit", "Write"]);
		expect(tools.map((tool) => tool.executionMode)).toEqual([
			"parallel",
			"sequential",
			"sequential",
			"sequential",
		]);
```

**主张（已证实）：** Desktop 默认 capability source 再注入 4 个扩展，其中 FFF 暴露 `find/grep`；测试明确断言这些扩展。

[`app/server/test/runtime-capabilities/desktop-local.test.ts#L49-L62`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/test/runtime-capabilities/desktop-local.test.ts#L49-L62)

```ts
expect(resolved.value.fileCapabilities).toEqual({
	homeDirectory,
	workspaceDirectory,
	workspaceTrusted: true,
});
expect(resolved.value.extensions).toHaveLength(4);
expect(resolved.value.extensions.map((extension) => extension.id)).toEqual([
	"jai.skills",
	"agent-plugins",
	"jai.fff-search",
	"mcp",
]);
…
expect(fffSearch?.tools?.map((tool) => tool.name)).toEqual(["find", "grep"]);
```

**主张（已证实）：** 产品 composition 还总是加 `UpdateTodos` 与 `SpawnAgent` 所属扩展；动态 catalogs 存在时只向模型暴露两个 front door。因此最小可见工具数为 `4 + (Todo 1 + Subagent 1 + Skill 1 + FFF 2) + 2 = 11`。

[`app/server/src/runtime/daemon.ts#L105-L118`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/daemon.ts#L105-L118)

```ts
return Result.ok({
	model: current.value.model,
	…
	extensions: [
		createTodoExtension(),
		createSubagentExtension(),
		...connector.value.extensions,
		...webSearch.value.extensions,
	],
	extensionRuntime: connector.value.extensionRuntime,
});
```

[`packages/coding-agent/src/runtime/tool-catalog.ts#L66-L95`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L66-L95)

```ts
this.searchTool = {
	name: "SearchTools",
	description: "Search the dynamic tool catalog. …",
	…
};
this.executeTool = {
	name: "ExecuteTool",
	description: "Execute a dynamic tool returned by SearchTools. …",
	…
};
…
get frontdoorTools(): readonly AgentTool[] {
	return [this.searchTool, this.executeTool];
}
```

**边界：** `SearchTools` 单次最多返回 8 个匹配，按工具 name/description 的词项分数排序；它不会搜索文件系统。

[`packages/coding-agent/src/runtime/tool-catalog.ts#L114-L130`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/runtime/tool-catalog.ts#L114-L130)

```ts
const limit = Math.min(requestedLimit ?? this.#limit, this.#limit);
const terms = query
	.toLowerCase()
	.split(/[^a-z0-9_/-]+/)
	.filter(Boolean);
const matches = this.#tools
	.map((tool) => ({ tool, score: score(tool, terms) }))
	.filter((entry) => entry.score > 0)
	.sort(…)
	.slice(0, limit)
```

### 3.1 本机配置把 we0 定义为 MCP server，而非 Desktop Project

**主张（已证实）：** 对本机非敏感配置做定向只读查询后，当前模型是 `provider/deepseek-v4-flash-ga-260731`，`maxTurns` 未设置；Desktop Project Catalog 只有 `jai-work|/Users/jayden/jai-work`，而 `~/.jai/settings.json` 的 MCP server key 包含 `we0`。这不是目标会话 trace，但它会改变“we0”的最可能指代与停止预算。

本机命令输出（只投影 model、maxTurns、Project displayName/canonicalPath 与 MCP server key；未读取 secret）：

```text
runtime_model=provider/deepseek-v4-flash-ga-260731|maxTurns=<unset>
project=jai-work|/Users/jayden/jai-work
mcp_servers=we0
model=provider/deepseek-v4-flash-ga-260731
contextWindow=1000000
maxTokens=384000
```

配置 owner 的查询形状由当前 SHA 固定：[`app/server/src/config/runtime-agent-settings.ts#L816-L829`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/config/runtime-agent-settings.ts#L816-L829)

```ts
const row = this.database
	.prepare("SELECT settings_json FROM runtime_agent_settings WHERE key = 'default'")
	.get() as { readonly settings_json: string } | undefined;
…
this.database
	.prepare("UPDATE runtime_agent_settings SET settings_json = ?, updated_at = ? WHERE key = 'default'")
```

**主张（已证实）：** MCP 动态工具名显式包含 server name，所以 `SearchTools("we0")` 可以按 name/description 的 ASCII token 匹配这些工具；但是否连接成功、实际暴露哪些 remote tools 仍是运行时事实。

[`packages/extension/src/mcp/runtime.ts#L286-L299`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/mcp/runtime.ts#L286-L299)

```ts
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
```

### 4. Prompt 与工具描述会把跨 workspace 发现推向 Bash

**主张（已证实）：** 默认 prompt 和 Bash 描述都要求 workspace 搜索优先 `grep/find`，若必须 Bash 搜索则用 `rg`。这对当前 workspace 有效；当目标是邻居项目时，专用工具的 boundary 使“必须 Bash”条件成立。

[`packages/agent/src/harness/tools/bash.ts#L66-L72`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L66-L72)

```ts
return {
	name: "Bash",
	description:
		"Execute a POSIX shell command in the workspace with timeout, cancellation, and bounded output. Do not use grep, find, cat, ls, head, or tail to explore the workspace; search with the grep or find tools, or rg if Bash search is required. Read files with Read.",
	parameters: bashParameters,
	executionMode: "sequential",
```

**主张（已证实）：** 权限层把 `cd/find/grep/ls/pwd/rg/stat` 都列为 read-only，并默认允许整条只读 Bash command；因此这种邻居发现一般不会触发审批来迫使模型停下来澄清。

[`packages/coding-agent/src/permissions/evaluate.ts#L24-L42`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/evaluate.ts#L24-L42)

```ts
const readOnlyCommands = new Set([
	"cat",
	"cd",
	"diff",
	"du",
	"echo",
	"find",
	"grep",
	"head",
	"ls",
	"pwd",
	"rg",
	"sleep",
	"stat",
	"tail",
	"wc",
	"which",
]);
```

[`packages/coding-agent/src/permissions/evaluate.ts#L104-L125`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/evaluate.ts#L104-L125)

```ts
const subcommands = scan?.patterns ?? splitBashCommand(command);
if (!subcommands || subcommands.length === 0) {
	return decision("ask", "danger-layer", "Bash command could not be parsed safely", …);
}
const asked = subcommands.filter((subcommand) => !isReadOnlySubcommand(subcommand));
if (asked.length === 0) {
	return decision("allow", "built-in", "Built-in safe Bash command", …);
}
return decision("ask", "built-in", `No bash permission rule matched for: ${asked[0]}`, …);
```

**推断：** 对“最新”没有定义（目录 mtime、git commit time、Desktop `updatedAt`、最近打开时间都可能），且本机的 `we0` 是 MCP server 而不是 Desktop Project。prompt 没要求遇到实体或排序语义歧义先澄清，模型可能在 `SearchTools("we0")` 与 basename、mtime、git log 等本地信号间试探，表现为不同类型的近似搜索。源码能证明这些路径可用，不能证明特定模型一定采用哪个序列。

### 5. 结果先原样回灌模型，Desktop 投影不参与决策

**主张（已证实）：** tool 执行结果的 `content` 直接构造成 `ToolResultMessage`，持久化后加入 context；下一 provider turn 会看到它。Desktop 人类化 title、terminal card 与 web-search details 都发生在 SDK event projection 之后，不回写 Agent transcript。

[`packages/agent/src/core/agent-loop.ts#L531-L548`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L531-L548)

```ts
const publish = async (outcome: ExecutedToolCall): Promise<void> => {
	const message: ToolResultMessage = {
		role: "toolResult",
		toolCallId: outcome.toolCall.id,
		toolName: outcome.toolCall.name,
		content: outcome.result.content,
		…
		isError: outcome.isError,
		timestamp: Date.now(),
	};
	outcomes.push(outcome);
	messages.push(message);
	await emit({ type: "message_start", message });
	await emit({ type: "message_end", message, entryId: outcome.resultEntryId });
};
```

**主张（已证实）：** 测试验证第二次 provider request 的 role 序列包含 `user → assistant → toolResult`。

[`packages/agent/test/core/agent-loop.test.ts#L262-L280`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/test/core/agent-loop.test.ts#L262-L280)

```ts
const { events, messages } = await collect(
	agentLoop([user("read a.txt")], context([readTool]), {
		model,
		provider: providerFor([first, final], contexts),
	}),
);
expect(calls).toEqual(["a.txt"]);
expect(contexts).toHaveLength(2);
expect(contexts[1]?.messages.map((message) => message.role)).toEqual([
	"user",
	"assistant",
	"toolResult",
]);
```

**主张（已证实）：** Bash 输出采用 tail 截断，阈值是 2,000 行、50 KiB、单行 2,000 字符；完整输出只有在截断时保存在临时文件并把路径告诉模型。默认超时 120 秒，可请求到最多 10 分钟。

[`packages/agent/src/harness/tools/bash.ts#L8-L18`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L8-L18)

```ts
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 100;
const TAIL_BUFFER_BYTES = DEFAULT_MAX_BYTES * 4;
…
command: Type.String({ minLength: 1 }),
timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS })),
```

[`packages/agent/src/harness/tools/truncate.ts#L3-L5`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/truncate.ts#L3-L5)

```ts
export const DEFAULT_MAX_LINES = 2_000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINE_LENGTH = 2_000;
```

[`packages/agent/src/harness/tools/bash.ts#L186-L211`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/bash.ts#L186-L211)

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
…
text: final.truncated ? `${text}\n\n[Output truncated. Full output: ${temporaryFile.path}]` : text,
```

**主张（已证实）：** FFF grep 默认 20 条、硬上限 50 条、context 上限 20 行、输出中的每一行最多 500 字符；find 默认每页 30。cursor 最多保留 200 个。

[`packages/extension/src/search/index.ts#L16-L21`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L16-L21)

```ts
const DEFAULT_FIND_LIMIT = 30;
const DEFAULT_GREP_LIMIT = 20;
const MAX_GREP_LIMIT = 50;
const MAX_CONTEXT = 20;
const INDEX_TIMEOUT_MS = 15_000;
const MAX_CURSOR_COUNT = 200;
```

[`packages/extension/src/search/index.ts#L336-L345`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L336-L345)

```ts
function truncateLine(value: string): string {
	const trimmed = value.trim();
	return trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 500)}...`;
}

function trimCursors<T>(cursors: Map<string, T>): void {
	while (cursors.size > MAX_CURSOR_COUNT) {
		const first = cursors.keys().next().value;
```

**主张（已证实）：** compaction 的摘要输入再把每一条历史 tool result 截为 2,000 字符；这是长期对话中真正可能丢失早期搜索细节的位置。

[`packages/agent/src/harness/compaction/serialize.ts#L1-L13`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/compaction/serialize.ts#L1-L13)

```ts
import type { AssistantMessage } from "@jai/ai";
import type { AgentMessage } from "../../core/types";

/** 一个 tool result 不该独占摘要预算，超长部分对摘要没有边际价值。 */
const TOOL_RESULT_MAX_CHARS = 2_000;

export function serializeConversation(messages: readonly AgentMessage[]): string {
	return messages.map(serializeMessage).filter(Boolean).join("\n\n");
}
```

**边界：** Desktop projection 通过 JSON serialization 复制结果；若不可 JSON 序列化，UI 只得到 `{message: "Value was not JSON-serializable"}`，但模型已使用 `result.content`，两者不是同一条信息路径。

[`packages/coding-agent/src/sdk/project.ts#L218-L223`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/project.ts#L218-L223)

```ts
export function projectJson(value: unknown): JsonValue {
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return { message: "Value was not JSON-serializable" };
	}
}
```

### 6. 停止条件由模型与可选 turn 上限决定

**主张（已证实）：** 一个 turn 只要产生 tool calls，执行后 `hasMoreToolCalls` 就继续；自然停止是模型不再调用工具且没有 steering/follow-up。没有基于命令相似度、重复结果、累计 shell 次数或 elapsed time 的 task-level stop。

[`packages/agent/src/core/agent-loop.ts#L167-L204`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L167-L204)

```ts
while (hasMoreToolCalls || pendingMessages.length > 0 || shouldRunCurrentContext) {
	if (config.maxIterations !== undefined && turnCount >= config.maxIterations) {
		const message = createIterationLimitMessage(config, turnCount);
		…
		return;
	}
	…
	turnCount += 1;
	…
	if (turn.stopped || signal?.aborted) {
		await emit({ type: "agent_end", messages: newMessages });
		return;
	}
	hasMoreToolCalls = turn.hasMoreToolCalls;
	pendingMessages = (await config.getSteeringMessages?.()) ?? [];
}
```

**主张（已证实）：** provider error、abort、context overflow 立即停止；普通 tool error 不停止，而是转成 `isError` tool result 回灌。这个设计允许模型在路径不存在、参数错误、permission block 或 timeout 后继续换一种命令。

[`packages/agent/src/core/agent-loop.ts#L237-L270`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L237-L270)

```ts
if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "contextOverflow") {
	await emit({ type: "turn_end", message, toolResults: [] });
	return { hasMoreToolCalls: false, stopped: true };
}
const toolCalls = message.content.filter((content) => content.type === "toolCall");
…
if (toolCalls.length > 0) {
	const batch = await executeToolCallBatch(run, toolCalls);
	toolResults = batch.messages;
	hasMoreToolCalls = !batch.terminate;
	…
}
```

[`packages/agent/src/core/agent-loop.ts#L661-L689`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L661-L689)

```ts
result = await dispatch(0);
} catch (error) {
	if (isEffectGateInterrupted(error)) throw error;
	// 工具执行错误不能成为阻塞，而是让 agent-loop 可见
	result = {
		content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
	};
	isError = true;
}
…
await emit({ type: "tool_execution_end", … result, isError });
return outcome;
```

**主张（已证实）：** `maxTurns` 只是 optional SDK input，只有设置时才映射到 `maxIterations`；Desktop 配置只要求它若存在必须为正整数，没有默认值或最大值。因此“默认预算”在源码层是未设置，而非某个固定数字。

[`packages/coding-agent/src/sdk/create-coding-agent.ts#L126-L135`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/create-coding-agent.ts#L126-L135)

```ts
resolveProvider: () => {
	const runtime = resolveSdkModel(input.model, input.provider);
	modelRuntime = runtime;
	return runtime;
},
resolveAgentOptions: () => ({
	...(input.maxTurns === undefined ? {} : { maxIterations: input.maxTurns }),
	...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
	…
}),
```

[`app/server/src/config/runtime-agent-settings.ts#L1244-L1250`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/config/runtime-agent-settings.ts#L1244-L1250)

```ts
const maxTurns = value.maxTurns;
if (maxTurns !== undefined && (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1)) {
	return Result.err(
		new RuntimeAgentSettingsInvalid({
			message: "Runtime Agent maxTurns must be a positive integer",
		}),
	);
}
```

### 7. Context 限制触发压缩，不会抑制重复搜索

**主张（已证实）：** context token 估算采用 `字符数 / 4`；默认 reserve 为 `model.maxTokens + 4096` 并夹在 8,192–20,000，保留最近 2 turns 和 2,000–8,000 tokens。超过 `contextWindow - reserveTokens` 才压缩。

[`packages/agent/src/harness/compaction/estimate.ts#L8-L20`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/compaction/estimate.ts#L8-L20)

```ts
const CHARS_PER_TOKEN = 4;
const IMAGE_CHARS = 4_800;
…
/**
 * 字符数除以 4 的启发式估算。不是账单数据，只用来决定"是否该压缩了"，
 * 以及比较压缩前后的体积。
 */
export function estimateTokens(value: AgentMessage | AgentContext): number {
	return Math.ceil(countChars(value) / CHARS_PER_TOKEN);
}
```

[`packages/agent/src/harness/compaction/estimate.ts#L119-L136`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/compaction/estimate.ts#L119-L136)

```ts
const reserveTokens = overrides.reserveTokens ?? clamp(model.maxTokens + 4_096, 8_192, 20_000);
const usableContext = Math.max(0, model.contextWindow - reserveTokens);
const settings: CompactionSettings = {
	reserveTokens,
	tailTurns: overrides.tailTurns ?? 2,
	preserveRecentTokens:
		overrides.preserveRecentTokens ??
		Math.min(usableContext, clamp(Math.floor(usableContext * 0.25), 2_000, 8_000)),
};
```

**边界：** compaction 是容量恢复，不是行为预算；它甚至可能忘掉被压缩 tool result 的完整细节，只保留摘要，从而不能作为重复调用抑制。

按本机 catalog 的 `contextWindow=1,000,000`、`maxTokens=384,000` 代入当前 clamp：reserve 为 20,000，主动 compaction 阈值为 `>980,000` tokens，recent tail 为 8,000 tokens。这意味着几十次 shell 搜索通常远未触发容量保护。

### 8. 已证实与推断

#### 已证实

- 当前 Project canonical path 被用作 cwd、workspace boundary、FFF basePath。
- Project id/displayName/list/parent directory 没有进入默认 prompt 或模型消息。
- Desktop 有 workspace 内 `find/grep`，但没有邻居 Project discovery tool；FFF 拒绝绝对路径与 `..`。
- read-only Bash 搜索命令默认可执行；Bash 自身为 sequential，同一 assistant turn 只要含 sequential tool，整批串行。
- tool result 成功或失败都会回灌；失败不会自动停止。
- 没有重复 tool call cache、相似参数检测、shell 次数预算或 task wall-clock budget。
- `maxTurns` 可配置但可省略；省略时 core 不设 iteration limit。
- Bash/Read 为 50 KiB、2,000 行、2,000 字符/行；FFF grep 50 match/page、500 字符/行；compaction 2,000 字符/tool result。

#### 推断

- “大量近似 shell 搜索”的主要因果链很可能是：**语义目标在 workspace 外 + 没有 Project Catalog tool + cwd 未显式提示 + “最新”定义不清 + tool error/空结果后自动继续 + 无重复预算**。
- 模型可能先错误使用 workspace `find`，收到空结果或 boundary error 后改用 Bash；也可能一开始 `pwd` 再搜索父目录。源码不能决定模型的具体选择。
- 如果本机 Agent Plugin 或 MCP 恰好提供项目管理工具，`SearchTools` 可能找到替代能力；仓库无法在不读取运行时 catalog/配置的情况下证明该工具是否存在。默认内建能力中不存在。

## 失败模式与边界

### 空输入

**主张（已证实）：** Runtime Host 在任何 Operation 创建前拒绝空白 prompt。

[`app/server/src/runtime/host.ts#L620-L629`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/runtime/host.ts#L620-L629)

```ts
async prompt(input: RuntimePromptInput): Promise<Result<PromptAdmission, RuntimeHostPromptError>> {
	if (this.#closed) return Result.err(this.closed());
	if (!input.text.trim()) {
		return Result.err(
			new RuntimeHostPromptRejected({
				message: "Prompt must not be empty",
				sessionId: this.id,
			}),
		);
	}
```

### 路径不存在、越界、无结果

**主张（已证实）：** Read 要求路径存在且是文件；FFF 返回明确空结果并拒绝越界；这些错误最终成为 tool result，模型可继续。

[`packages/agent/src/harness/tools/read.ts#L45-L60`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/harness/tools/read.ts#L45-L60)

```ts
return {
	name: "Read",
	description: "Read a UTF-8 text file with line numbers. …",
	parameters: readParameters,
	executionMode: "parallel",
	async execute(_toolCallId, args, signal) {
		const resolved = await options.fileSystem.resolvePath(args.path, {
			base: options.workspaceRoot,
			boundary: options.workspaceRoot,
			mustExist: true,
			expectedKind: "file",
			signal,
		});
```

[`packages/extension/test/search-extension.test.ts#L64-L76`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/test/search-extension.test.ts#L64-L76)

```ts
const empty = await runtime.grep({ pattern: "does-not-exist" });
expect(textContent(empty.content[0])).toBe("No matches found");
await expect(runtime.find({ pattern: "app", path: "../" })).rejects.toMatchObject({
	_tag: "filesearch.outside_boundary",
});
await expect(runtime.grep({ pattern: "(" })).rejects.toMatchObject({
	_tag: "filesearch.invalid_pattern",
});
const controller = new AbortController();
controller.abort();
await expect(runtime.grep({ pattern: "TODO" }, controller.signal)).rejects.toMatchObject({
```

### 权限审批

**主张（已证实）：** Read workspace 外路径默认 ask；只读 Bash 默认 allow。ACP 交互失败 fail-closed 为 deny，deny 作为工具错误回到 loop，而不是自动终止整个 Agent。

[`packages/coding-agent/src/permissions/evaluate.ts#L80-L101`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/permissions/evaluate.ts#L80-L101)

```ts
if (resolved.defaultMode === "dontAsk") {
	return decision("deny", "mode", "Don't Ask denies calls without a matching Allow rule");
}
…
if (isReadCall(call)) {
	return isInsideReadableBoundary(call, resolved.additionalDirectories)
		? decision("allow", "built-in", "Read is inside the workspace boundary")
		: decision("ask", "built-in", "Read is outside the workspace boundary");
}
…
if (call.toolName === "Bash") {
	return evaluateDefaultBash(call);
}
```

[`app/server/src/protocol/acp-v2/agent.ts#L363-L375`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/app/server/src/protocol/acp-v2/agent.ts#L363-L375)

```ts
let decision: "deny" | "allowOnce" | "alwaysAllow" = "deny";
try {
	const response = await this.options.clientRequestSink?.request(
		"session/request_permission",
		projectPermissionRequest(session.id, request),
	);
	decision = permissionDecision(response, request.canAlwaysAllow);
} catch {
	// The ACP connection is an interaction channel, never an authorization source.
	// Its failure becomes an explicit denial at the canonical SDK permission evaluator.
}
await session.respondToApproval({ requestId: request.requestId, decision });
```

### 工具慢、超时、失败

**主张（已证实）：** FFF 初始化最多等 15 秒，失败会让整个 Operation capability assembly 失败；Bash 默认 120 秒超时，最大 10 分钟。普通执行失败可见于模型并继续； capability source 构建失败则 Operation 根本打不开。动态 Extension catalog discovery 只有 `AbortSignal`，没有统一 deadline；若实现保持 pending 且不响应 abort，刷新与下一次 capability notice 都可能一直等。

[`packages/extension/src/search/index.ts#L243-L255`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/extension/src/search/index.ts#L243-L255)

```ts
if (!created.ok) {
	return Result.err(
		new CodingExtensionOperationFailed({ message: `FFF could not initialize: ${created.error}` }),
	);
}
const ready = await created.value.waitForIndexReady(INDEX_TIMEOUT_MS);
if (!ready.ok || !ready.value) {
	created.value.destroy();
	return Result.err(
		new CodingExtensionOperationFailed({ message: ready.ok ? "FFF index did not become ready" : ready.error }),
	);
}
```

[`packages/coding-agent/src/sdk/extensions.ts#L644-L678`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/src/sdk/extensions.ts#L644-L678)

```ts
async function discoverCatalogTools(
	extension: InitializedExtension,
	signal?: AbortSignal,
) {
	…
	try {
		discovered = await catalog.discover(extensionRuntime(extension), signal);
	} catch (cause) {
		return Result.err(extensionCatalogDiscoveryFailed(…));
	}
	…
	discoveredCatalogs.set(catalog.id, discovered.value.tools);
}
```

### Context overflow 与 abort

**主张（已证实）：** provider 返回 context overflow 时当前 partial response 保留但其中 tool calls 不执行；下一次请求前由上层 compaction 恢复。用户 abort 会终止当前 loop，并取消等待中的审批。

[`packages/agent/src/core/agent-loop.ts#L235-L250`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/agent/src/core/agent-loop.ts#L235-L250)

```ts
const message = await streamAssistantResponse(run);

// contextOverflow 是"成功但被截断"：partial 保留下来，但其中的 tool calls 不再执行。
// core 认识的只是 provider-neutral 的 StopReason，压缩由上层在下次请求前处理。
…
newMessages.push(message);
if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "contextOverflow") {
	await emit({ type: "turn_end", message, toolResults: [] });
	return { hasMoreToolCalls: false, stopped: true };
}
```

## Git 历史

**主张（已证实）：** 当前搜索 prompt 与 FFF 工具面来自同一阶段的两次变更：`a7b3b6b feat(search): switch default tools to Pi surface and FFF`，随后 `2151a74 feat: steer agents to grep/find instead of bash search`。这解释了当前“基础 harness 只有 4 工具、Desktop 扩展补 grep/find”的分层，而不是偶然遗漏。

本地 `git log --follow` 原样输出：

```text
2151a74 feat: steer agents to grep/find instead of bash search
a7b3b6b feat(search): switch default tools to Pi surface and FFF
66ee163 refactor: merge @jai/coding into @jai/coding-agent
5b93dd4 feat(coding): prepare the coding package for multi-host SDK consumption
```

对应当前测试仍固定该契约：[`packages/coding-agent/test/runtime/default-instructions.test.ts#L4-L10`](https://github.com/jiahao-jayden/jai-mono/blob/78ce62007ec54166c63622ef09e88da8a438b384/packages/coding-agent/test/runtime/default-instructions.test.ts#L4-L10)

```ts
test("keeps tool-use guidance aligned with the current harness", () => {
	expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("Search the workspace with grep and find");
	expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("use rg");
	expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("never bash grep or find");
	expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).toContain("offset and limit");
	expect(DEFAULT_CODING_AGENT_INSTRUCTIONS).not.toContain("agent-browser");
});
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 仅本仓库一手源码与测试，钉定 `78ce62007ec54166c63622ef09e88da8a438b384`；覆盖 Desktop Session Catalog、ACP client/agent、Runtime Host、Operation driver、Coding Agent SDK/runtime、extensions、Agent core loop、tools、compaction。 |
| 作者或维护者本人的说法 | 未查外部；用户明确限定本仓库。仓库内注释与 commit message 作为设计意图辅助证据，不单独替代当前源码。 |
| 同类方案 | 不适用；本题是本仓库机制审计，用户明确要求不查外部产品。 |
| issue / PR / 社区实践 | 未查；问题不要求外部 issue，且来源边界禁止外部调查。 |
| 历史演变 | 查了 default instructions、FFF search、agent-loop 的本地 git history；关键节点为 `a7b3b6b` 与 `2151a74`。另定向读取了本机非敏感 runtime settings、Project Catalog 投影与 MCP server key，未读取会话 trace 或 secret。 |

## 待验证

1. **we0 MCP 当前暴露哪些 remote tools。** 本机配置只证明 server key 是 `we0`；审计没有连接外部 MCP，因此不知道它是否有“latest project”能力。
2. **本机动态 catalog 是否另有项目发现工具。** Agent Plugins/MCP/Connector 可在运行时扩充 `SearchTools`，其具体成功 discovery snapshot 不在静态仓库事实中。
3. **“大量”到底是多少次以及具体命令序列。** 必须读取那次 Operation 的 model/tool content trace 才能从推断升级为事实；用户本次明确要求不依赖 trace。
4. **“最新”应采用哪个 durable fact。** Desktop Project 有 `updatedAt`，文件系统有 mtime，git 有 commit time，但当前用户请求没有定义，且这些事实没有统一暴露给模型。
5. **fallback `process.cwd()` 的生产值。** 源码只证明无可用 Project 时会采用该进程 cwd，不能静态证明部署时它等于 `/Users/jayden/code` 或任何特定目录。

## 对本项目的影响

本次审计没有修改产品代码。若后续要减少此类 shell fan-out，最直接的机制缺口不是再优化 Bash 文案，而是决定“项目”是否指 Desktop Project Catalog，并把一个只读、结构化的 Project discovery 能力或明确的邻居根上下文交给模型；同时为重复的同名工具调用设可观察预算。若产品语义仍是“只允许当前 workspace”，则应在 prompt 明说不能发现兄弟项目并要求用户选择 Project，而不是让模型通过 Bash 猜测。
