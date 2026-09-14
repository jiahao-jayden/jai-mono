# badlogic/pi-mono 官方 subagent 示例：会话、消息与结果存储

核验日期：2026-09-10。固定版本：`773f91f40a36a3d7380fbb48bedba35993a556b8`，提交时间为 2026-04-06，提交标题为 `docs: add OSS session sharing call to action`。GitHub API 将旧的 `badlogic/pi-mono` 解析到官方仓库 `earendil-works/pi`，以下 permalink 使用该 canonical 仓库和完整 SHA，避免 `main` 后续变化混入结论。

本笔记是源码和文档静态核验，不是运行实测：没有启动模型、没有执行官方 subagent example，也没有验证操作系统在父进程崩溃时对未 detached 子进程的具体处理。

## 结论

1. **官方 `packages/coding-agent/examples/extensions/subagent` 不为子代理创建持久 session 文件。** 每次子代理启动都显式使用 `--no-session`；CLI 将该标志映射为 `SessionManager.inMemory()`。因此官方示例没有可用于 child reopen/resume 的 child session path、session UUID 文件或 JSONL transcript。[F1](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267)[F2]
2. **子代理消息和结果只在父扩展进程的本次调用内聚合。** 子进程通过 `--mode json` 输出事件；父进程只把 `message_end` 与 `tool_result_end` 事件中的消息放入内存 `SingleResult.messages`，再把最终文本和 `details.results` 返回给父 Agent。[F3](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L321-L345)[F4]
3. **父子关系是进程调用关系，不是 SessionManager 的 parentSession 关系。** 该示例的结果结构没有 `sessionId`、`sessionFile`、`parentSession` 或 child run ID；示例也没有调用 `SessionManager.newSession({ parentSession })`、`forkFrom()` 或 `createBranchedSession()`。[F4](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L142-L160)[F7]
4. **若父会话启用持久化，父会话可以保存完成后的 tool result；这不等于保存 child transcript。** `AgentSession` 在父会话收到 `toolResult` 的 `message_end` 时调用父 `SessionManager.appendMessage()`；官方示例返回的结果会因此成为父 JSONL 的一个消息条目，但 child 的中间消息只存在于扩展内存。[F5](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/agent-session.ts#L513-L531)
5. **通用 coding-agent session manager 另有完整的 JSONL 树存储能力。** 默认路径是 `~/.pi/agent/sessions/--<cwd 编码>--/<timestamp>_<uuid>.jsonl`；每行一个 JSON 对象，首行是 session header，消息条目用 `id`/`parentId` 形成单文件内的树。[F6](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/session.md#L1-L12)[F8][F9]
6. **重启恢复边界很窄。** 通用持久 session 可以通过 `open()`、`continueRecent()` 或 `createAgentSession()` 重建上下文；官方 subagent example 的 child 因为从未落盘，不能被 `open()`、`continueRecent()` 或 `/resume` 找回。父进程重启最多恢复已经写入父 session 的 tool result，不会自动重启或重建正在运行、已失败或已中断的 child。[F10](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1275-L1282)[F11]
7. **显式 abort 有终止路径，但没有崩溃恢复协议。** 父扩展收到 abort signal 后向 child 发 `SIGTERM`，5 秒后若仍未结束再发 `SIGKILL`；child close/error 被转换为 exit code。该实现没有 detached runner、外部任务表、child session journal 或重启 reconciliation。[F12](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L369-L384)

## 官方示例实际保存了什么

### F1 — 子代理启动参数明确关闭 session

**主张：** `runSingleAgent()` 构造的 CLI 参数包含 `--mode json -p --no-session`；因此这条官方示例路径不是“创建一个默认持久 session 再读取结果”，而是显式选择无 session 模式。[`index.ts#L264-L267`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:264-267
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
```

**成立条件/限制：** 这是固定 commit 中官方 example 的单任务、并行任务和 chain 任务共同使用的 `runSingleAgent()` 路径。若用户改写示例并移除 `--no-session`，或改为 SDK 的 `SessionManager.create()`，结论不再适用。

### F2 — `--no-session` 由 CLI 映射到内存 SessionManager

**主张：** coding-agent CLI 对 `--no-session` 的定义不是“把文件写到临时目录”，而是直接返回 `SessionManager.inMemory()`；这个 manager 的 `persist` 标志为 `false`，所以 child 没有 session 文件可供 reopen。[`main.ts#L213-L221`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/main.ts#L213-L221)；[`session-manager.ts#L1299-L1302`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1299-L1302)

```ts
// packages/coding-agent/src/main.ts:213-221
async function createSessionManager(
	parsed: Args,
	cwd: string,
	sessionDir: string | undefined,
	settingsManager: SettingsManager,
): Promise<SessionManager> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
```

```ts
// packages/coding-agent/src/core/session-manager.ts:1299-1302
	/** Create an in-memory session (no file persistence) */
	static inMemory(cwd: string = process.cwd()): SessionManager {
		return new SessionManager(cwd, "", undefined, false);
	}
```

**成立条件/限制：** `SessionManager.inMemory()` 仍会在内存中有 header、entry index 和 `sessionId`，但 `getSessionFile()` 为 `undefined`，且不会把 entry 写入磁盘；“有内存 session ID”不能被误读成“有可恢复文件”。

### F3 — JSON 模式把事件写到 stdout，父扩展在内存中挑选消息

**主张：** child 的 `--mode json` 是事件流协议，不是 session 文件协议。print mode 将每个事件 JSONL 写到 stdout，并在开始时输出内存 session header；父扩展只解析 `message_end` 和 `tool_result_end`，把消息推入本次调用的 `currentResult.messages`。[`print-mode.ts#L81-L95`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/modes/print-mode.ts#L81-L95)；[`index.ts#L321-L345`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L321-L345)

```ts
// packages/coding-agent/src/modes/print-mode.ts:81-95
		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (mode === "json") {
				writeRawStdout(`${JSON.stringify(event)}\n`);
			}
		});
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}
```

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:321-335
				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
```

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:343-347
				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};
```

**成立条件/限制：** stdout 事件只有在父进程仍然存活并持续读取 pipe 时才会进入 `currentResult`；父扩展没有把收到的 child JSON 事件逐条写入另一个 child journal。`session` header 也只是 stdout 中的事件前导信息，不能提供磁盘恢复能力。

### F4 — 结果对象没有 child session 身份

**主张：** 官方示例的 `SingleResult` 只包含 agent 名称、任务、exit code、内存 `messages`、stderr、usage、model、stopReason 和 errorMessage；`SubagentDetails` 只包含模式、agent scope、project agents 目录和 results，没有 child session path、session ID 或 parent link。[`index.ts#L142-L160`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L142-L160)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:142-160
interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}
```

**成立条件/限制：** `messages` 是父扩展自己构造的内存数组，不是 `SessionManager.getEntries()` 的结果；它包含解析到的完整消息对象，但其生命周期不超过该 extension tool invocation 及父端 UI/Agent 的持有范围。

### F5 — 最终结果回到父工具；父 session 是否持久化取决于父配置

**主张：** 单任务成功时，工具返回最后一条 assistant 文本作为 `content`，并把 `SingleResult` 放入 `details`；如果错误则把错误文本返回并标记 `isError`。父 Agent 收到这个 tool result 后，若父 session 是持久化 session，`AgentSession` 会在 `message_end` 对 `toolResult` 调用父 `SessionManager.appendMessage()`。[`index.ts#L636-L660`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L636-L660)；[`agent-session.ts#L513-L531`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/agent-session.ts#L513-L531)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:648-660
				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
```

```ts
// packages/coding-agent/src/core/agent-session.ts:524-531
			} else if (
				event.message.role === "user" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				this.sessionManager.appendMessage(event.message);
			}
```

**成立条件/限制：** 只有父会话启用持久化且父进程成功处理到 tool result，父 JSONL 才会有该结果；这保存的是父上下文中的一个 `toolResult`，不是 child 的每个 assistant/tool message，也没有把 child 的 `messages` 自动转换成 child session entries。父若使用 `--no-session`，父 tool result 也只在内存中。

## SessionManager 的持久化模型

### F6 — 默认 session 文件路径和文件名格式

**主张：** 官方文档定义 session 文件为 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`；源码将 cwd 的首个路径分隔符去掉、其余 `/`、`\`、`:` 替换为 `-`，并在目录不存在时创建目录。[`session.md#L1-L12`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/session.md#L1-L12)；[`session-manager.ts#L419-L429`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L419-L429)

```markdown
<!-- packages/coding-agent/docs/session.md:1-12 -->
# Session File Format

Sessions are stored as JSONL (JSON Lines) files. Each line is a JSON object with a `type` field. Session entries form a tree structure via `id`/`parentId` fields, enabling in-place branching without creating new files.

## File Location

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

Where `<path>` is the working directory with `/` replaced by `-`.
```

```ts
// packages/coding-agent/src/core/session-manager.ts:419-429
/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.pi/agent/sessions/.
 */
export function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}
	return sessionDir;
}
```

**成立条件/限制：** `agentDir` 可由配置替换，`SessionManager.create(cwd, customSessionDir)` 也可直接指定目录；所以这是默认路径，不是所有 SDK 使用者必须遵守的绝对路径。官方 subagent example 由于 `--no-session` 不会触发这条默认持久路径。

### F7 — session header、版本和文件创建时机

**主张：** 持久 session 创建时首行 header 包含 `type:"session"`、version、UUID、ISO timestamp、cwd，并可选 `parentSession`；文件名使用替换过冒号和点号的 timestamp 加 UUID。`newSession()` 先在内存设置 header，只有持久 manager 才设置 session file。[`session-manager.ts#L725-L746`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L725-L746)

```ts
// packages/coding-agent/src/core/session-manager.ts:725-735
	newSession(options?: NewSessionOptions): string | undefined {
		this.sessionId = options?.id ?? randomUUID();
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: this.sessionId,
			timestamp,
			cwd: this.cwd,
			parentSession: options?.parentSession,
		};
		this.fileEntries = [header];
```

```ts
// packages/coding-agent/src/core/session-manager.ts:736-746
		this.byId.clear();
		this.labelsById.clear();
		this.leafId = null;
		this.flushed = false;

		if (this.persist) {
			const fileTimestamp = timestamp.replace(/[:.]/g, "-");
			this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
		}
		return this.sessionFile;
	}
```

**成立条件/限制：** header 的存在不代表立即有磁盘文件。`_persist()` 会在没有 assistant message 时延后写入；空 session 或只有 user 输入时，文件可能还未创建或尚未包含完整历史。

### F8 — JSONL entry 格式：消息是一个 entry，entry 内嵌 AgentMessage

**主张：** session 文件是 append-only 的 JSONL；普通 user、assistant、toolResult message 被包在 `type:"message"` entry 中，entry 有短 `id`、`parentId` 和 timestamp，实际消息位于 `message` 字段。[`session.md#L171-L207`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/session.md#L171-L207)；[`session-manager.ts#L829-L838`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L829-L838)

```markdown
<!-- packages/coding-agent/docs/session.md:171-181 -->
## Entry Base

All entries (except `SessionHeader`) extend `SessionEntryBase`:

```typescript
interface SessionEntryBase {
  type: string;
  id: string;           // 8-char hex ID
  parentId: string | null;  // Parent entry ID (null for first entry)
  timestamp: string;    // ISO timestamp
}
```
```

````markdown
<!-- packages/coding-agent/docs/session.md:200-207 -->
### SessionMessageEntry

A message in the conversation. The `message` field contains an `AgentMessage`.

```json
{"type":"message","id":"a1b2c3d4","parentId":"prev1234","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"Hello"}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2024-12-03T14:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"provider":"anthropic","model":"claude-sonnet-4-5","usage":{...},"stopReason":"stop"}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"2024-12-03T14:00:03.000Z","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"output"}],"isError":false}}
```
````

```ts
// packages/coding-agent/src/core/session-manager.ts:829-838
	appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: generateId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			message,
		};
		this._appendEntry(entry);
		return entry.id;
	}
```

**成立条件/限制：** `parentId` 是同一个 session 文件中 entry 的树链接，不是父进程 PID、child session ID 或跨文件 foreign key。单独拥有某个 message JSON 对象不足以重建 child 的运行状态或 tool process。

### F9 — parentSession 是显式 session fork/new 的文件路径

**主张：** generic SessionManager 支持在 session header 中记录 `parentSession` 文件路径，并在 `forkFrom()` 时写入 source path、复制 source 的非 header entries；这是 session 文件之间的显式 fork 关系，不是官方 subagent example 自动建立的关系。[`session-manager.ts#L1333-L1348`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1333-L1348)

```ts
// packages/coding-agent/src/core/session-manager.ts:1333-1347
		// Write new header pointing to source as parent, with updated cwd
		const newHeader: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: newSessionId,
			timestamp,
			cwd: targetCwd,
			parentSession: sourcePath,
		};
		appendFileSync(newSessionFile, `${JSON.stringify(newHeader)}\n`);

		// Copy all non-header entries from source
		for (const entry of sourceEntries) {
			if (entry.type !== "session") {
				appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
			}
		}
```

**成立条件/限制：** `parentSession` 只在调用者选择 `forkFrom()` 或传入 `newSession({ parentSession })` 等路径时出现；官方 example 的 child 使用独立 CLI + `--no-session`，没有 source session path 可以写入，也没有调用这些 fork API。

### F10 — reopen/continue 如何工作，以及为何不能恢复官方 child

**主张：** `SessionManager.open(path)` 读取指定 JSONL、从 header 取 cwd，再通过 constructor 加载并建立 index；`continueRecent(cwd)` 列出默认目录中的有效 JSONL，按 mtime 选最新，否则创建新 session。SDK 文档将这些方法列为持久 session 的 reopen/continue API。[`session-manager.ts#L1275-L1282`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1275-L1282)；[`session-manager.ts#L1290-L1301`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1290-L1301)

```ts
// packages/coding-agent/src/core/session-manager.ts:1275-1282
	static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager {
		// Extract cwd from session header if possible, otherwise use process.cwd()
		const entries = loadEntriesFromFile(path);
		const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
		const cwd = cwdOverride ?? header?.cwd ?? process.cwd();
		// If no sessionDir provided, derive from file's parent directory
		const dir = sessionDir ?? resolve(path, "..");
		return new SessionManager(cwd, dir, path, true);
	}
```

```ts
// packages/coding-agent/src/core/session-manager.ts:1290-1301
	static continueRecent(cwd: string, sessionDir?: string): SessionManager {
		const dir = sessionDir ?? getDefaultSessionDir(cwd);
		const mostRecent = findMostRecentSession(dir);
		if (mostRecent) {
			return new SessionManager(cwd, dir, mostRecent, true);
		}
		return new SessionManager(cwd, dir, undefined, true);
	}

	/** Create an in-memory session (no file persistence) */
	static inMemory(cwd: string = process.cwd()): SessionManager {
		return new SessionManager(cwd, "", undefined, false);
```

**成立条件/限制：** `open()` 需要已有合法 path；`continueRecent()` 只搜索有效 `.jsonl` 文件。官方 child 的 `sessionFile` 是 `undefined`，因此没有 path 能传入 `open()`，也不会被 `list()` 或 `continueRecent()` 发现。SDK 默认 factory 若没有传 manager 会创建持久 manager，但官方 child 已由 CLI 先选定 in-memory manager。[`sdk.md#L658-L695`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/sdk.md#L658-L695)

### F11 — append 和 crash 时的 durability 边界

**主张：** SessionManager 的持久化是 append-only；在第一个 assistant message 到达前，`_persist()` 会把整个内存 entry 列表留在未 flush 状态，assistant 到达后才首次 append 全部 entries，之后再逐条 append。因而父 session 的已完成 tool result可以落盘，但崩溃窗口和无 assistant 的空 session 不能当作严格 transaction。[`session-manager.ts#L796-L810`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L796-L810)

```ts
// packages/coding-agent/src/core/session-manager.ts:796-810
	_persist(entry: SessionEntry): void {
		if (!this.persist || !this.sessionFile) return;

		const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
		if (!hasAssistant) {
			// Mark as not flushed so when assistant arrives, all entries get written
			this.flushed = false;
			return;
		}

		if (!this.flushed) {
			for (const e of this.fileEntries) {
				appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
			}
			this.flushed = true;
```

**成立条件/限制：** 这里证明的是源码设定的写入边界，不是本次运行中测得的 crash consistency。源码使用同步 `appendFileSync`，但笔记不把它升级为 fsync、跨机器 durability 或数据库事务保证；child 本身因 F2 的 `persist=false` 根本不进入这条持久路径。

## 具体 trace：spawn → child session → append → reopen/resume

输入设定：父 Agent 调用 `{ agent: "scout", task: "查找认证代码" }`；父会话本身使用默认持久 SessionManager；child 采用固定版本官方 example 的默认路径。以下是源码 trace，不是运行日志。

| 步骤 | 发生的动作 | 证据与状态变化 |
|---|---|---|
| 1. spawn | `runSingleAgent()` 组装 `["--mode","json","-p","--no-session"]`，将任务包装成 `Task: 查找认证代码`，再用 `spawn()` 建立 stdout/stderr pipe。 | [`index.ts#L264-L267`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L264-L267)、[`index.ts#L300-L309`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L300-L309)。child 是独立 OS 进程，但没有设置 detached runner。 |
| 2. child session | CLI `createSessionManager()` 看到 `noSession`，创建 `SessionManager.inMemory()`；`sessionFile` 为 `undefined`，没有 child JSONL 文件。 | [`main.ts#L213-L221`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/main.ts#L213-L221)、[`session-manager.ts#L1299-L1302`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1299-L1302)。 |
| 3. stream | child 的 print mode 将 header 和后续 `message_*`/tool 事件写为 stdout JSONL；header 即便出现也只是内存 header 的序列化。 | [`print-mode.ts#L81-L95`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/modes/print-mode.ts#L81-L95)。 |
| 4. append（内存） | 父扩展解析 child stdout；每个 `message_end` 和 `tool_result_end` 的消息被 push 到 `currentResult.messages`，同时更新 usage、stopReason 和 final output。 | [`index.ts#L321-L345`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L321-L345)。这里的 append 是 JS array append，不是 JSONL append。 |
| 5. child close | child `close` 事件 resolve exit code；成功时返回 `currentResult`，错误或 abort 则按 exit code/stopReason 进入错误结果路径。 | [`index.ts#L360-L384`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L360-L384)。 |
| 6. result delivery | extension 用最后 assistant 文本作为 tool content，并将 `SingleResult` 放入 details；chain 会把成功结果的最终文本替换 `{previous}`，parallel 以结果数组聚合。 | [`index.ts#L500-L550`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L500-L550)、[`index.ts#L636-L660`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L636-L660)。 |
| 7. parent append | 父 Agent 将该 tool result 作为 `message_end` 处理；若父 manager 持久化，则包装为父 JSONL 的 `type:"message"` entry，并以父当前 leaf 为 `parentId`。 | [`agent-session.ts#L513-L531`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/agent-session.ts#L513-L531)、[`session-manager.ts#L829-L838`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L829-L838)。 |
| 8. reopen/resume | 父进程之后可用 `SessionManager.open(parentPath)` 或 `continueRecent(parentCwd)` 读取父 JSONL、建立 index、从当前 leaf 构造上下文；child 没有 path，因此不会被 reopen，也不会自动重跑。 | [`session-manager.ts#L1275-L1282`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1275-L1282)、[`session-manager.ts#L1290-L1301`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/core/session-manager.ts#L1290-L1301)。 |

## 失败、退出与重启边界

### F12 — 显式 abort、spawn error 和 chain failure

**主张：** 官方示例对显式 abort 有进程终止动作：先 `SIGTERM`，5 秒后仍未 killed 则 `SIGKILL`；child `error` 事件 resolve 为 exit code 1；abort 会抛出 `"Subagent was aborted"`。chain 遇到非零 exit code、`stopReason:"error"` 或 `"aborted"` 时停止后续 step。[`index.ts#L369-L384`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L369-L384)；[`index.ts#L536-L548`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/examples/extensions/subagent/index.ts#L536-L548)

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:369-380
			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
```

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:382-384
		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
```

```ts
// packages/coding-agent/examples/extensions/subagent/index.ts:536-548
					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
```

**成立条件/限制：** 这些是“显式收到 abort signal”或 child 正常触发 close/error 的处理；不是 parent crash detector，也不是 durable queue。源码没有为 `currentResult` 写外部状态、记录 child PID/run ID、重启后扫描未完成任务或自动重试的路径。chain 停止并不意味着之前已完成 step 的消息获得了独立 session 文件。

### 崩溃/重启矩阵

| 情况 | 固定源码能证明的行为 | 不能声称的行为 |
|---|---|---|
| child 正常完成，父仍存活 | 父读完 JSON 事件，等待 `close`，拿到 exit code 和内存 `SingleResult`；父 tool result 可进入父 JSONL。 | 不能声称 child transcript 被另存为 JSONL。 |
| child 返回非零 exit code | 结果保留已解析的内存消息、stderr 和 exit code；single/chain 标记错误。 | 不能声称失败 child 可通过 `/resume` 继续。 |
| child 被显式 abort | `SIGTERM`，5 秒后可能 `SIGKILL`；调用抛出 abort 错误。 | 不能声称 kill 后有 checkpoint 或精确续跑。 |
| 父进程正常结束 | print mode finally 会 dispose runtime 并 flush stdout；官方 child 仍是 `--no-session`。[`print-mode.ts#L126-L134`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/src/modes/print-mode.ts#L126-L134) | 不能把 stdout flush 当成 child session durability。 |
| 父进程崩溃/机器重启 | 静态源码没有 child journal、外部任务表或恢复扫描；若父 crash 前已写入父 session 的 tool result，该父 entry 仍可能被 `open()` 读取。 | 未进行 OS 级崩溃实测，不能断言不同平台一定会不会自动终止未 detached child，也不能断言 partial JSONL 的 fsync/原子性。 |
| 父进程重启后 `/resume` | generic parent JSONL 可被 `open()`/`continueRecent()` 恢复其已有 entries。 | 官方 extension 没有 child run ID 或 session path，因此不会自动重建当时的 child。 |

## parentSession、entry parentId 与 child process 的区别

| 概念 | 官方 coding-agent 语义 | 是否由官方 subagent example 使用 |
|---|---|---|
| `parentId` | 同一 JSONL 文件内 entry 到上一个 tree entry 的链接；用于当前 leaf 和分支上下文。 | 父 session 若持久化，会给父 tool result 设置父文件内的 `parentId`；不是 child process 关系。 |
| `parentSession` | 新 session header 中可选的 source session 文件路径，供 new/fork 关系展示或追踪。 | 否。示例没有 child session file，也没有调用 fork/new with parent。 |
| `sessionFile` | 持久 manager 的具体 JSONL 路径；in-memory 时为 `undefined`。 | child 为 `undefined`。 |
| `SingleResult.messages` | 示例扩展为 JSON 事件解析创建的临时消息数组。 | 是，生命周期受父 tool invocation 约束。 |
| 父 `toolResult` | 父 Agent session 的普通消息 entry，可被父 session manager append。 | 是，前提是父 session 持久化且调用走到结果写入。 |

`buildSessionContext()` 从当前 leaf 沿 `parentId` 回溯到 root，再把 path 转成给 LLM 的消息；这解释了为什么父 JSONL 能恢复“父看到了 child 的结果”，但不会凭空恢复一个没有写入该文件的 child branch。[`session-manager.ts#L341-L347`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8)

```ts
// packages/coding-agent/src/core/session-manager.ts:341-347
	// Walk from leaf to root, collecting path
	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
```

## 官方 SDK 的对照路径：有持久 child 的做法是另一种配置

### F13 — SDK 明确区分 in-memory、create、continueRecent、open

**主张：** 官方 SDK 文档把 `SessionManager.inMemory()`、`SessionManager.create(process.cwd())`、`continueRecent(process.cwd())` 和 `open(path)` 列为四种不同 session 管理方式；因此“官方 coding-agent 支持 JSONL session”不能反推“官方 subagent example 已启用 JSONL session”。[`sdk.md#L658-L695`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/docs/sdk.md#L658-L695)

```markdown
<!-- packages/coding-agent/docs/sdk.md:658-695 -->
### Session Management

Sessions use a tree structure with `id`/`parentId` linking, enabling in-place branching.

// In-memory (no persistence)
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});

// New persistent session
const { session: persisted } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd()),
});

// Continue most recent
const { session: continued, modelFallbackMessage } = await createAgentSession({
  sessionManager: SessionManager.continueRecent(process.cwd()),
});
```

**成立条件/限制：** 这是 SDK 能力表，不是 subagent example 的额外行为。若要让 child 可 reopen，调用方需要自己选择 `SessionManager.create(childCwd, childSessionDir)` 或 `open(existingPath)`，并自行定义 child 与 parent 的关系和 result delivery；固定版本的示例没有这么做。

## 同类方案对照

同类方案只用于校准“持久 child”与“临时 child”是不同产品选择，不把第三方行为投射成 badlogic/pi-mono 的保证。

### F14 — nicobailon/pi-subagents 选择持久 child session

**主张：** `nicobailon/pi-subagents` 在固定 commit `11fae32e180fb26730359e0358fcc3efddf9365e` 的文档把 parent 描述为父 session、child 描述为 focused child Pi session，并区分父进程内 foreground 与 detached runner 中的 background；其配置文档明确 session 总是启用。[`README.md#L41-L45`](https://github.com/nicobailon/pi-subagents/blob/11fae32e180fb26730359e0358fcc3efddf9365e/README.md#L41-L45)；[`configuration.md#L365-L371`](https://github.com/nicobailon/pi-subagents/blob/11fae32e180fb26730359e0358fcc3efddf9365e/docs/configuration.md#L365-L371)

```markdown
## How it works

Pi is the parent session. A subagent is a focused child Pi session with its own job.

When you ask for a subagent, Pi starts the child, gives it the task, and brings the result back. Foreground children run as sessions inside the parent Pi process and stream in the conversation. Background children run as sessions inside a detached runner process that keeps working and can be checked later.
```

```markdown
## `defaultSessionDir`

{ "defaultSessionDir": "~/.pi/agent/sessions/subagent/" }

Session directory precedence is: `params.sessionDir`, then `config.defaultSessionDir`, then a directory derived from the parent session. Sessions are always enabled.
```

**成立条件/限制：** 这是第三方实现的文档静态证据，不能用来证明其所有代码路径、跨重启边界或性能；它只说明该方案显式承担了持久 child/detached runner 的产品语义，而官方示例没有。

### F15 — tintinweb/pi-subagents 同时提供 session reopen 和受限 workflow journal

**主张：** `tintinweb/pi-subagents` 在固定 commit `e955e29c51b7a6cce37e1108cd2d6c57a77e151c` 的 README 宣称 finished child 可以从现有 session resume、记录消失后从 disk reopen；其 workflow 文档又明确 journal 只按 session 生效，重启 pi 后 run ID 失效。这正好说明“child session 恢复”和“编排 journal 恢复”是两个边界，不应混为一谈。[`README.md#L160-L165`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/README.md#L160-L165)；[`docs/workflows.md#L100-L111`](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/docs/workflows.md#L100-L111)

```markdown
| State | `@explore fix the flaky test` does |
|-------|-----------------------------------|
| running or queued | sends the message into its conversation, exactly as `steer_subagent` would |
| finished | **resumes** it in the background from its existing session, continuing where it left off |
| finished long ago, record gone | **reopens** its session from disk and continues there |
| never started | **starts** it — by default, through a clone of this conversation |
```

```markdown
Every run journals each settled `agent()` call beside its script as `<run id>.workflow.jsonl`, and the resume replays the **unchanged prefix** of that journal.

Four things it will not do:

- **Cross sessions.** The journal is keyed to the session that wrote it. Restart pi and the run id is dead — you get `No workflow run "<id>" in this session.`
- **Resume a live run.** Stop it from `/agents → Workflows` first; while it is running you get `Workflow "<id>" is still running.`
- **Replay a failure.** A journaled failure ends the prefix, so resuming a run that died at agent 5 retries exactly agent 5.
```

**成立条件/限制：** 这不是官方示例的实现，也不是本次目标的推荐替代；它只作为反方边界证据：要得到 child reopen，必须把 session 或 journal 的身份、路径、生命周期和恢复策略显式设计出来。

## 历史演变与作者/维护者说法

### F16 — subagent orchestration example 从 0.24.0 起就是独立、无 session 文件的示例方向

**主张：** coding-agent changelog 在 `0.24.0` 将 subagent orchestration example 记录为新增功能，明确包含 scout/planner/reviewer/worker 和 workflow command；同一版本的后续说明记录了 parallel streaming、chain streaming、Markdown expanded view 和 usage footer 等结果展示演进。代码层面的 `--no-session` 则是固定 commit 对当前实现的直接证据。[`CHANGELOG.md#L2866-L2874`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/CHANGELOG.md#L2866-L2874)；[`CHANGELOG.md#L2884-L2888`](https://github.com/earendil-works/pi/blob/773f91f40a36a3d7380fbb48bedba35993a556b8/packages/coding-agent/CHANGELOG.md#L2884-L2888)

```markdown
## [0.24.0] - 2025-12-19

### Added

- **Subagent orchestration example**: Added comprehensive custom tool example for spawning and orchestrating sub-agents with isolated context windows. Includes scout/planner/reviewer/worker agents and workflow commands for multi-agent pipelines. ([#215](https://github.com/badlogic/pi-mono/pull/215) by [@nicobailon](https://github.com/nicobailon))

### Changed

- **Subagent example improvements**: Parallel mode now streams updates from all tasks. Chain mode shows all completed steps during streaming. Expanded view uses proper markdown rendering with syntax highlighting. Usage footer shows turn count.
```

**成立条件/限制：** changelog 说明的是功能演变，不是 crash/restart 测试结果。PR [#215](https://github.com/badlogic/pi-mono/pull/215) 的作者说明也明确写出原始设计使用 `pi -p --no-session`，并记录已测试 single、parallel、chain、错误处理和 project overrides；该 PR 讨论属于作者/维护者说法，不能替代固定 commit 源码核验。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 `773f91f40a36a3d7380fbb48bedba35993a556b8` 的 subagent README/index、CLI main、print mode、AgentSession、SessionManager、session/sdk 文档和 coding-agent changelog；确认 example 的 child 是 `--no-session`，generic SDK 另有 JSONL persistence API。 |
| 作者或维护者本人的说法 | 官方 PR [#215](https://github.com/badlogic/pi-mono/pull/215) 中 nicobailon 提交设计，badlogic 的 follow-up comment 说明 `pi -p --no-session`、JSON 输出截取、任务输出限制和已覆盖测试；这些说法与固定 commit 的代码相互印证。 |
| 同类方案 | 固定 `nicobailon/pi-subagents@11fae32e180fb26730359e0358fcc3efddf9365e`：session 总是启用、foreground/background 有不同宿主；固定 `tintinweb/pi-subagents@e955e29c51b7a6cce37e1108cd2d6c57a77e151c`：支持 child session reopen，同时 workflow journal 明确不跨父 session。 |
| issue / PR / 社区实践 | 读取官方 PR [#215](https://github.com/badlogic/pi-mono/pull/215) 正文、合并信息和 badlogic 的 follow-up comment；它承担设计意图和测试范围证据。未把第三方 issue 或用户案例当作官方行为证据。 |
| 历史演变 | 固定 commit 的 `CHANGELOG.md` 追到 `0.24.0`（2025-12-19）新增 orchestration example，以及同版本后续 streaming/rendering/usage 改进；未把后续 `main` 的新 session 变化混入固定版本结论。 |

## 对本项目的影响

1. 如果只需要一次委派并把最终答案返回给父 Agent，官方 example 的最小模型是：独立 child process、stdout JSON event stream、父内存聚合、最终 tool result 进入父会话；它**不**提供 child durable transcript 或 restart resume。
2. 如果产品要求 child 在父进程退出后继续、跨重启 reopen、查看完整 child transcript 或精确从 tool call 继续，就不能只复用该 example；必须显式增加 child session path/format、parent-child identity、durable result/journal、进程监督和恢复策略。
3. 不应把父 JSONL 中的 `toolResult` 当作 child session。它最多证明父在某个 turn 收到了结果；它不包含 child session header、entry tree、未返回的中间事件、运行中的 tool 状态或可重启的 process identity。
4. 本次没有修改任何 `.ts`/`.tsx` 产品源码，也没有将静态推断写成运行实测。
