# pi-subagents 如何作为扩展运行，对 JAI 有什么参考价值

核验日期：2026-09-09。目标固定 SHA `e955e29c51b7a6cce37e1108cd2d6c57a77e151c`（2026-09-03 提交），包声明版本 0.19.0，但 HEAD 含 Unreleased 修复，不能把本文等同于已发布 0.19.0 的全部行为。

本次核验源码、公开文档、讨论与发布记录，未安装目标依赖、未运行模型或测试；以下执行流程为静态推演。固定版本避免把同名项目、旧 CLI 示例与当前 SDK 实现混在一起。

## 结论

1. **普通子 Agent 通过公开 SDK 在同一进程创建独立 session。** 不依赖专用 Subagent 核心接口，也不是逐任务启动 pi CLI；workflow 的 Worker 是另一层编排。[创建路径](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L995-L1008)
2. **Extension 拥有委派产品规则。** 工具注册、Agent 类型定义与调度由扩展组织；core 提供可复用的 session 和工具机制。这里的 Agent 类型不是核心原生类型。[工具注册](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2295-L2302)
3. **不能把它的工具选择直接当成 JAI 的权限边界。** 动态工具限制甚至包装底层 beforeToolCall；isolated 也不是安全沙箱。[调用拦截](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L295-L308)
4. **当前顶层默认后台执行。** 先返回任务 ID，再通知或查询结果；任务仍依赖宿主存活，因此不同于跨重启任务服务。[后台入口](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2055-L2068)
5. **取消是协作式停止。** running 记录收到 abort 后立即标 stopped；这个状态本身不证明底层资源已全部释放。[取消路径](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1407-L1425)

## 扩展与 SDK 的职责

### C1 SDK 而非专用子 Agent core 接口

目标扩展在进程内直接调用公开 SDK `createAgentSession(sessionOpts)`，不经 pi CLI；core 交付通用 AgentSession、工具和资源加载机制。限制：这是本 SHA 的正常子 Agent 路径，不是断言所有 pi 扩展都不启动 CLI。

[src/agent-runner.ts:995–1008](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L995-L1008)

```ts
// src/agent-runner.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
995:     ...(parentModelRuntime !== undefined && { modelRuntime: parentModelRuntime as never }),
996:     model,
997:     tools: sessionTools,
998:     customTools: [...nestedTools, ...structuredTools],
999:     resourceLoader: loader,
1000:   };
1001:   if (sessionExcludeTools) {
1002:     sessionOpts.excludeTools = sessionExcludeTools;
1003:   }
1004:   if (thinkingLevel) {
1005:     sessionOpts.thinkingLevel = thinkingLevel;
1006:   }
1007: 
1008:   const { session } = await runInChildSessionContext(() => createAgentSession(sessionOpts));
```

### C3 扩展入口与 Agent 类型注册是两层

包只声明一个 extension 入口 `src/index.ts`；入口注册模型可调用的 Agent 工具，Agent 类型则是扩展自己的配置 Map，非 core 的原生 Agent 类型。限制：`registerAgents` 是该包私有产品逻辑，不是 ExtensionAPI。

[src/index.ts:2295–2302](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2295-L2302)

```ts
// src/index.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
2295:   function registerToolReportingUsage(tool: any): void {
2296:     pi.registerTool(withUsageReporting(tool));
2297:   }
2298: 
2299:   // The mention path is handed THIS object, not the bare `agentTool` — see the
2300:   // mention-clone header on why the clone must call the registered tool.
2301:   const registeredAgentTool = withUsageReporting(agentTool);
2302:   pi.registerTool(registeredAgentTool);
```

这对 JAI 的启示是职责划分，而不是照抄 API：扩展拥有任务策略；通用执行机制负责会话、工具调用和生命周期。以下是本项目适配判断，未宣称 pi 本身提供父权限收紧保证。

| 层次 | pi 已核验行为 | JAI 拟采用的边界 |
|---|---|---|
| 工具入口 | 扩展注册 Agent | 扩展注册 SpawnAgent |
| 任务策略 | 扩展解析类型、prompt 与运行选项 | 扩展拥有参数、并发上限、提示词、结果处理 |
| 执行机制 | 通用 createAgentSession | 优先复用已有公开 SDK；不足时补最小受控执行能力 |
| 运行对象 | 独立 session，同进程 | 保留当前上下文隔离与取消关系 |
| 状态存储 | 见恢复边界 | 保留 JAI 单一 SQLite journal 规则，不引入它的文件恢复路径 |

### C4 Agent 定义由扩展发现与覆盖

三处 Markdown 目录按 global → .agents/agents → .pi/agents 顺序加载，后者覆盖前者，再覆盖三个嵌入默认类型；name frontmatter 优先、缺失用文件名。限制：目录是当前 cwd 下直读 *.md，不是自动扫描所有 package 的 agent manifest。

[src/custom-agents.ts:44–56](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/custom-agents.ts#L44-L56)

```ts
// src/custom-agents.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
44: export function loadCustomAgents(cwd: string, strict = false): Map<string, AgentConfig> {
45:   const globalDir = join(getAgentDir(), "agents");
46:   const workspaceProjectDir = join(cwd, ".agents", "agents");
47:   const projectDir = join(cwd, ".pi", "agents");
48: 
49:   const agents = new Map<string, AgentConfig>();
50:   loadFromDir(globalDir, agents, "global", strict);            // lowest priority
51:   loadFromDir(workspaceProjectDir, agents, "project", strict); // shared workspace
52:   loadFromDir(projectDir, agents, "project", strict);          // highest priority (overwrites)
53: 
54:   warnedLastLoad = warnedThisLoad;
55:   warnedThisLoad = new Set();
56:   return agents;
```

## 工具选择与权限边界

### C2 权限拦截并非全部停留在高层公开 SDK

动态扩展工具的限制除公开 active-tools API 外，还包装 `session.agent.beforeToolCall`，并链回原钩子；作者测试明确指出它越过 documented surface。限制：不能将该方案描述成完全通过稳定的高层子会话权限接口实现。

[src/agent-runner.ts:295–308](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L295-L308)

```ts
// src/agent-runner.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
295:   session.subscribe((event: AgentSessionEvent) => {
296:     if (event.type === "turn_end") renarrow();
297:   });
298: 
299:   const priorBeforeToolCall = session.agent.beforeToolCall;
300:   session.agent.beforeToolCall = async (context, signal) => {
301:     if (!inScope().has(context.toolCall.name)) {
302:       return {
303:         block: true,
304:         reason: `Tool "${context.toolCall.name}" is not available to this subagent.`,
305:       };
306:     }
307:     return priorBeforeToolCall?.(context, signal);
308:   };
```

### C10 isolated 是资源配置模式

isolated 强制关闭扩展、skills、ext selectors，并不注入嵌套工具；未把 built-in 数量强制归零，也不取消 parent model/auth runtime。限制：不提供 OS 隔离，append prompt、显式上下文继承是另外的开关。

[src/agent-runner.ts:635–640](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L635-L640)

```ts
// src/agent-runner.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
635:   // Resolve extensions/skills: isolated overrides to false
636:   const extensions = options.isolated ? false : config.extensions;
637:   // Nulling excludes under isolated also suppresses the orphaned-exclude warning —
638:   // isolation is an intentional override, not a misconfiguration.
639:   const excludeExtensions = options.isolated ? undefined : config.excludeExtensions;
640:   const skills = options.isolated ? false : config.skills;
```

### C11 父子工具权限不会自动相交

嵌套目标根据自身 AgentConfig 重新构造工具、extensions、isolated；父 Agent 的限制没有成为子会话权限上限。限制：allowed_subagents 实际授予被列 Agent 的能力，不能把它仅当路由白名单。

[src/nested-tools.ts:224–230](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/nested-tools.ts#L224-L230)

```ts
// src/nested-tools.ts @ e955e29c51b7a6cce37e1108cd2d6c57a77e151c
224:       const config = getAgentConfigIn(registry, resolvedType);
225:       // Foreground regardless of `backgroundByDefault` — see the reasoning on
226:       // ResolveOptions. An explicit `true` here still opts in.
227:       const invocation = resolveAgentInvocationConfig(config, params, {
228:         worktreeAllowed: isWorktreeIsolationEnabled(),
229:         defaultRunInBackground: false,
230:       });
```

嵌套配置片段显示目标 Agent 的配置会重新解析；“不自动取交集”的结论还来自对子入口和 runner 全链路的静态检查，不是单靠这一片段推导安全性质。

项目安全政策明确按本机用户权限运行。[安全政策](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/SECURITY.md#L5-L12)

> “Sub-agents run with the local user account's privileges”

**对 JAI 的判断：** 应保留工具执行时的权限链、父取消关联和资源清理。扩展可选择更少工具，但不能因为创建新 Agent 而扩大已批准的访问范围。不要复制动态修改 session.agent 内部字段的做法。

## 一次委派的具体流程

以顶层 `Agent({subagent_type: "general-purpose", prompt: "检查测试失败原因"})` 为例，未显式指定前后台模式，以下为源码静态推演。

| 步骤 | 实际动作 | 依据 |
|---|---|---|
| 1 | 扩展解析任务配置；顶层默认后台 | 下方默认值与后台入口 |
| 2 | manager 创建记录并调度；有空位后进入 runAgent | 下方 manager 调用 |
| 3 | runner 调 createAgentSession，得到独立会话 | “扩展与 SDK 的职责”中的创建摘录 |
| 4 | 把任务交给 session.prompt | 下方 prompt 摘录 |
| 5 | Agent 工具先返回 ID；最终结果通过通知或 get_subagent_result 交付 | 下方返回文案 |

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1164-L1171)

```ts
1164:   function setDefaultJoinMode(mode: JoinMode) { defaultJoinMode = mode; }
1165: 
1166:   // What an unqualified top-level spawn means. Defaults to background,
1167:   // following Claude Code; `backgroundByDefault: false` restores the previous
1168:   // foreground default. Nested spawns ignore this — see nested-tools.ts.
1169:   let backgroundByDefault = true;
1170:   function getBackgroundByDefault(): boolean { return backgroundByDefault; }
1171:   function setBackgroundByDefault(b: boolean) { backgroundByDefault = b; }
```

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2055-L2068)

```ts
2055:         id = manager.spawn(pi, ctx, subagentType, params.prompt, {
2056:           description: params.description,
2057:           name: params.name as string | undefined,
2058:           model,
2059:           maxTurns: effectiveMaxTurns,
2060:           isolated,
2061:           inheritContext,
2062:           thinkingLevel: thinking,
2063:           isBackground: true,
2064:           isolation,
2065:           invocation: agentInvocation,
2066:           rootSessionId: ctx.sessionManager.getSessionId(),
2067:           ...bgCallbacks,
2068:         });
```

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L761-L774)

```ts
761:     const promise = runAgent(ctx, type, prompt, {
762:       pi,
763:       agentId: id,
764:       model: options.model,
765:       maxTurns: options.maxTurns,
766:       isolated: options.isolated,
767:       inheritContext: options.inheritContext,
768:       thinkingLevel: options.thinkingLevel,
769:       structuredOutput: options.structuredOutput,
770:       resumeSessionFile: options.resumeSessionFile,
771:       nested: options.parentAgentId !== undefined,
772:       workflow: options.workflowId !== undefined,
773:       // Worktree wins for the working dir (the agent must run in the copy —
774:       // which, with a custom cwd, was created from that target). Config stays
```

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts#L1108-L1114)

```ts
1108:   // Boundary for the history fallback: only assistant text produced from here
1109:   // on counts as this run's output (a fresh session, so usually 0).
1110:   const startLen = session.messages.length;
1111:   let structuredRetried = false;
1112:   try {
1113:     await session.prompt(effectivePrompt);
1114: 
```

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L2111-L2121)

```ts
2111:         const isQueued = record?.status === "queued";
2112:         return textResult(
2113:           `${fallbackNote}Agent ${isQueued ? "queued" : "started"} in background.\n` +
2114:           `Agent ID: ${id}\n` +
2115:           `Type: ${displayName}\n` +
2116:           `Description: ${params.description}\n` +
2117:           (record?.outputFile ? `Output file: ${record.outputFile}\n` : "") +
2118:           (isQueued ? `Position: queued (max ${manager.getMaxConcurrent()} concurrent)\n` : "") +
2119:           `\nYou will be notified when this agent completes.\n` +
2120:           `Use get_subagent_result to retrieve full results, or steer_subagent to send it messages.\n` +
2121:           `Do not duplicate this agent's work.`,
```


## 并发、取消和恢复的边界

### 6. 两个顶层池与一个每 workflow 信号量

事实：后台默认 10，前台默认 0；只有顶层 background 或 blocking 记录占相应槽位，nested 和 workflowId 有值的记录不占。队列从最早的“自己所属池有空位”项启动，因此池内 FIFO、池间不互相堵队头。新启动在第一个 await 前计数，正常/失败 settle 后归还。限定：这不是所有后代的总并发上限；bypassQueue 可越过排队；前台 resume 的实现另列在恢复节。

[src/agent-manager.ts:55–67](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L55-L67)

```ts
55: const DEFAULT_MAX_CONCURRENT = 10;
56: 
57: /**
58:  * Default max concurrent foreground (blocking) agents — `0` = unlimited, the
59:  * extension's existing convention for "no ceiling" (`defaultMaxTurns`).
60:  *
61:  * Off by default because nothing here ever bounded foreground work, and pi
62:  * dispatches a message's tool calls through `Promise.all`, so an unqualified
63:  * fan-out of blocking `Agent` calls has always run all at once. Users who want
64:  * it bounded — chiefly local models, where parallel agents thrash the prompt
65:  * cache (#253) — opt in; everyone else keeps today's behaviour exactly.
66:  */
67: const DEFAULT_MAX_CONCURRENT_FOREGROUND = 0;
```

### 14. manager.abort 是协作取消，不是进程 kill

事实：queued 直接出队并唤醒 startGate；running 发 AbortController.abort 后立即标 stopped。运行槽位在 settleRun 才递减，不在 abort 时释放；runner 注册 signal listener 调 session.abort。限定：源码未给普通任务设置统一 wall-clock kill timer；如果底层不 settle，单凭 stopped 状态不能证明已停止消耗资源或槽位已释放。

[src/agent-manager.ts:1407–1425](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts#L1407-L1425)

```ts
1407:   abort(id: string): boolean {
1408:     const record = this.agents.get(id);
1409:     if (!record) return false;
1410: 
1411:     // Remove from queue if queued. No decrement — the slot was never taken —
1412:     // and no onComplete, matching what a queued background abort has always
1413:     // done; a blocking caller learns of the stop from its own tool result.
1414:     if (record.status === "queued") {
1415:       this.dequeue(q => q.id === id);
1416:       record.status = "stopped";
1417:       record.completedAt = Date.now();
1418:       return true;
1419:     }
1420: 
1421:     if (record.status !== "running") return false;
1422:     record.abortController?.abort();
1423:     record.status = "stopped";
1424:     record.completedAt = Date.now();
1425:     return true;
```

**宿主退出会主动中止后台任务并清理保留的子会话。** 因此“后台”只表示本次工具调用不用等待，不代表脱离宿主运行。

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/index.ts#L1109-L1122)

```ts
1109:     scheduler.stop();
1110:     // Before abortAll, and not folded into it: a workflow owns a worker thread
1111:     // as well as its children, and only its own signal terminates that.
1112:     for (const task of workflowTasks.values()) task.abortController.abort();
1113:     workflowTasks.clear();
1114:     manager.abortAll();
1115:     for (const timer of pendingNudges.values()) clearTimeout(timer);
1116:     pendingNudges.clear();
1117:     fleet.dispose();
1118:     // Awaited: it emits `session_shutdown` into every retained child session so
1119:     // extensions bound there can release what they armed in `session_start` (#242).
1120:     // pi awaits this handler, and the process exits right after — unawaited, those
1121:     // handlers would never run. Internally bounded, so a hung one can't strand quit.
1122:     await manager.dispose(pi);
```

**恢复也分层：** 子 Agent 的 resume 是续已有会话；workflow 的 resume 是按顺序复用成功且匹配的执行前缀，遇到缺口后重新执行。不能从 resume 一词推出崩溃后精确恢复正在执行的工具。

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/workflow/runtime.ts#L708-L717)

```ts
708:   /** The journal entry to reuse at `index`, or undefined to run it live. */
709:   function replayAt(index: number, key: string): WorkflowJournalEntry | undefined {
710:     if (!prefixIntact) return undefined;
711:     const entry = journalEntries[index];
712:     if (entry === undefined || entry.index !== index || entry.key !== key || !entry.ok) {
713:       prefixIntact = false;
714:       return undefined;
715:     }
716:     return entry;
717:   }
```

workflow 文档明确限制跨会话恢复。[恢复限制](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/docs/workflows.md#L397-L408)

> “No cross-session resume.”

其 journal 写入失败只降低恢复能力，不让当前任务失败；这与 JAI 的持久化要求不能直接互换。

[源码](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/workflow/journal.ts#L144-L151)

```ts
144: /** Append one settled call. Failure to write is not failure to run. */
145: export function appendJournal(path: string, entry: WorkflowJournalEntry): void {
146:   try {
147:     appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
148:   } catch {
149:     // A journal that cannot be written costs a future resume, nothing more.
150:   }
151: }
```

## 与另外两个 pi 实现比较

另两个源码版本分别固定为：官方 badlogic/pi-mono `be26e32704f7cab048e2b356206350ef7ad65999`；nicobailon/pi-subagents `11fae32e180fb26730359e0358fcc3efddf9365e`。均为 2026-09-09 核验的提交。

| 维度 | tintinweb/pi-subagents | pi 官方示例 | nicobailon/pi-subagents |
|---|---|---|---|
| 普通执行 | 同进程 SDK session | 独立 pi 进程 | 前台同进程 session |
| 后台执行 | 宿主内任务和结果通知 | 本次示例范围未建立后台服务保证 | detached runner 进程 |
| 数量限制 | 顶层后台默认 10；前台默认不限 | 最多 8 个 parallel tasks、4 并发 | 本次未核验并发常量 |
| 不能推导的保证 | 后台不等于跨重启继续；isolated 非沙箱 | 进程隔离不等于 OS 权限隔离 | 单文件 pi binary 不支持后台；managed worktree 要求干净源目录 |

本表各项证据来自上文目标源码与下列两组一手摘录；没有执行基准，不能据此判断谁更快。

**O1 — 官方示例是独立 pi 进程实现，且默认只加载用户级 agent。** 文档提供 single、parallel、chain 三种模式；项目 agent 需要显式改变 scope。本次不把项目目录受信任策略理解为沙箱。[官方示例](https://github.com/badlogic/pi-mono/blob/be26e32704f7cab048e2b356206350ef7ad65999/packages/coding-agent/examples/extensions/subagent/README.md)

> “Each subagent runs in a separate `pi` process”
>
> “Only loads **user-level agents**”
>
> “Single” / “Parallel” / “Chain”

**O2 — 官方源码有硬数量上限与模型可见输出上限。** 并行最多 8 个任务，4 个同时运行，每任务输出上限 50×1024；因此不是任意规模 fan-out。这里仅静态核验，未执行。[常量](https://github.com/badlogic/pi-mono/blob/be26e32704f7cab048e2b356206350ef7ad65999/packages/coding-agent/examples/extensions/subagent/index.ts#L33-L36)

```ts
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const PER_TASK_OUTPUT_CAP = 50 * 1024;
```

此文件另已读取实际 `spawn(invocation.command, invocation.args, …)` 调用，位于 L346；它佐证 README 的进程说明。为控制同源逐字引文总量，不重复摘录。

**O3 — 官方没有把 subagents 固定在核心。** pi 主 README 将此选择留给 tmux、扩展或第三方 package；官方示例的存在不代表核心统一保证这类扩展的运行语义。[pi 设计立场](https://github.com/badlogic/pi-mono/blob/be26e32704f7cab048e2b356206350ef7ad65999/packages/coding-agent/README.md#L501)

> “**No sub-agents.** There's many ways to do this.”

**N1 — nicobailon 的前后台宿主不同。** 文档说前台在父 Pi 进程中，后台使用 detached runner；后台需要 npm package 目录，单文件 binary 不成立。此限制来自安装说明，未运行验证。[nicobailon](https://github.com/nicobailon/pi-subagents/blob/11fae32e180fb26730359e0358fcc3efddf9365e/README.md)

> “inside the parent Pi process”
>
> “inside a detached runner process”
>
> “cannot run background children”

**N2 — nicobailon 的 managed worktree 有干净源目录约束。** 工作流可为并行写入 child 各建 worktree，但 dirty source checkout 不是文档支持的入口；不能把该能力直接用于未提交差异的无准备审查。[worktree 条件](https://github.com/nicobailon/pi-subagents/blob/11fae32e180fb26730359e0358fcc3efddf9365e/docs/workflows.md#L367-L385)

> “each writing child a separate managed git worktree”
>
> “The source checkout must still be clean”

**N3 — 不是只找到一个 README：真实实现使用 pi 的 session API。** 已读取共享 child-session 源码，传递模型 runtime、cwd 等进入 session 创建。这里不推导进程级隔离或沙箱保证。[session 创建](https://github.com/nicobailon/pi-subagents/blob/11fae32e180fb26730359e0358fcc3efddf9365e/src/runs/shared/child-session.ts#L253-L258)

```ts
const { session } = await pi.createAgentSession({
    cwd: launch.cwd,
    agentDir,
    modelRuntime,
    …
```

## 历史：功能变化与发布日期分开

**H1 — 初版已经包含委派和结果/steering 工具；工作流是后来的增量。** 初版日期 2026-03-05 来自 changelog，不等同于核验了当日 npm 发布时间。[初版](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/CHANGELOG.md#L755-L767)

> “## [0.1.0] - 2026-03-05”
>
> “Autonomous sub-agents” / “`get_subagent_result` tool” / “`steer_subagent` tool”

**H2 — v0.18.0 改变默认执行模式。** 2026-08-20 GitHub release 明确不写 background 参数时默认后台；这不是自初版起就不变的行为。[v0.18.0](https://github.com/tintinweb/pi-subagents/releases/tag/v0.18.0)

> “an `Agent` call that doesn't say now runs in the background”

该 release API 的日期字段原文（元数据，非正文引文）：

```json
{"tag_name":"v0.18.0","published_at":"2026-08-20T12:30:29Z"}
```

**H3 — v0.19.0 引入脚本工作流；changelog 日期与发布日不同。** changelog 写 2026-08-25，GitHub release API 写 2026-08-27；不得合并成一个“发布时间”。[版本变更](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/CHANGELOG.md#L13-L20)、[v0.19.0](https://github.com/tintinweb/pi-subagents/releases/tag/v0.19.0)

> “## [0.19.0] - 2026-08-25”
>
> “dynamic workflows”

GitHub release 元数据原文：

```json
{"tag_name":"v0.19.0","published_at":"2026-08-27T12:17:36Z"}
```

**H4 — HEAD 修复不等于 release 已发布。** 9 月 3 日的 #283 修复处于当前 changelog 的 Unreleased 段。读取的最近五个 GitHub releases 中，最新为 v0.19.0；未查询 npm dist-tags，因此不宣称 npm 的绝对最新发布状态。[未发布段](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/CHANGELOG.md#L8-L13)

> “## [Unreleased]”

## 已知问题：用户案例、作者确认、提交和发布分层

**I1 — 进程死亡后的后台记录丢失是具体用户报告。** Naoki326 在 2026-08-29 提交 #272；环境为 pi-subagents 0.19.0、Node v25.9.0、Windows、宿主 pi-web 0.8.11。报告指出宿主死亡后无法查询子任务结果；用户称该宿主有 idle shutdown。本次未复现，也未深入 manager 来独立证明。[#272](https://github.com/tintinweb/pi-subagents/issues/272)

> “the parent conversation is never told”
>
> “`@tintinweb/pi-subagents@0.19.0`”
>
> “Node v25.9.0, Windows”
>
> “`@agegr/pi-web@0.8.11`”

核验状态 `open`、`closed_at: null`、`comments: 0`；另取完整 comments endpoint 返回 `[]`。发帖账号 association 为 `NONE`，不能写作维护者确认；不能外推故障发生率或所有 pi 宿主都受影响。未发现此条讨论给出已合并修复。

**I2 — #283 有明确复现条件。** zampierilucas 于 2026-09-02 报告，在 pi 0.84.3、pi-subagents 0.19.0 与 pi-dynamic-workflows 3.10.0 并装且 workflowsEnabled 未设时，两个工作流工具同时保留。[#283](https://github.com/tintinweb/pi-subagents/issues/283)

> “pi 0.84.3, pi-subagents 0.19.0, pi-dynamic-workflows 3.10.0”
>
> “both `SubagentWorkflow` and `workflow` end up in the tool spec”

**I3 — 作者确认且实际提交存在，但不能叫已发布修复。** 完整评论只有一条，账号 tintinweb、association `OWNER`，2026-09-03T12:10:44Z 确认修复；issue 同时 closed，state_reason `completed`。[作者确认 #283](https://github.com/tintinweb/pi-subagents/issues/283#issuecomment-5525524208)

> “fixed with …, thanks!”

已读取该回复指向的完整提交 diff：新增小写 workflow 名称并增加回归测试。本次只核验修复证据，不继续分析注册过程。[修复提交](https://github.com/tintinweb/pi-subagents/commit/e955e29c51b7a6cce37e1108cd2d6c57a77e151c)

```diff
+  "workflow",
```

提交元数据：`2026-09-03T12:10:17Z`。它与 OWNER 回复构成“源码已修复”的证据；H4 的 Unreleased 则限制“已发布”主张。没有把关闭按钮当作修复证明。


## 待验证

- 未实际运行目标代码：吞吐、内存、费用、取消延迟与崩溃恢复均没有测量。
- 源码核验不覆盖目标声明的全部 pi >=0.84.0 版本。注册子调研参考的 pi core 为 0.84.2；同类官方示例另钉了 9 月 9 日提交，不能混称同一版本。
- #272 是用户案例，未收到维护者确认；不能当成普遍故障率。
- 需要在 JAI 实施前验证：公开 SDK 能否直接复用现有模型与权限而不暴露凭据、递归加载 Subagent 或复制宿主装配。若不能，补一个最小受控执行接口；具体签名尚未决定。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 目标固定 SHA 的 index、agent-runner、agent-manager、nested-tools、custom-agents、workflow、README、SECURITY、CHANGELOG；另核验两个同类源码。 |
| 作者或维护者本人的说法 | 项目安全政策与设计文档；#283 中 tintinweb 的 OWNER 回复。未把用户报告当维护者结论。 |
| 同类方案 | pi 官方 subagent 示例、nicobailon/pi-subagents；执行载体和限制见比较章节。 |
| issue / PR / 社区实践 | 完整读取 #272、#283 正文和全部评论；核对 #283 提交与 release，区分报告、源码修复和发布。 |
| 历史演变 | 初版、v0.18.0 默认后台、v0.19.0 工作流，以及 HEAD 的 Unreleased 修复。 |

## 对本项目的影响

这是适配建议，未变更实现，也未把下列建议视为已批准的新需求。

1. **保留扩展化方向。** Todo 与 Subagent 分别安装；工具 schema、提示词、并发规则与结果展示归扩展，核心删除工具名称特例。
2. **收紧此前计划里的接口承诺。** pi 证明通用 SDK 足以承载委派，不能仅因为要做扩展就预先新增专用 spawn 接口。先验证既有公开执行能力；缺少的仅是权限、安全 DTO、取消和资源清理时，补最小通用接口，不把 manager、队列和 Agent 类型塞回核心。
3. **当前范围继续保留一次委派并等待结果。** 不照搬后台默认、resume、steer、嵌套和 workflow；这些都有额外的运行寿命、结果消费和恢复语义，属于产品扩展，不是把现有工具迁成 Extension 的必要条件。
4. **不照搬权限和持久化路径。** JAI 仍使用原有权限链与单一 SQLite journal；拒绝依赖 prompt 保证只读、静默放宽工具或另加文件恢复存储。
5. **Todo 方案不由这个仓库直接证明。** 本次主要核验 Subagent；Todo 仍依据 JAI 已有 Extension sessionState / beforeModelCall 能力迁移。
