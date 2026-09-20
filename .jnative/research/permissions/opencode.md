# OpenCode 权限系统调研

核验日期：2026-09-19。源码基线固定为官方仓库 `anomalyco/opencode` 的 `fee476bb90043a1012abda156dd9af9e5c71b19d`（`dev`/远端 `HEAD`），包版本为 `1.18.31`。固定 SHA 是为了避免活跃仓库后续变更混入结论。

## 结论

1. **当前代码同时存在 V1 与 V2 两套权限模型。** 普通 session 的 tool runner 仍把 agent/session ruleset 传给 V1 `Permission.Service.ask`；V2 使用 `action/resource/effect`，并通过独立的 HTTP API 暴露。V1 是当前普通工具执行链的主要路径，V2 是正在落地的持久授权路径。[session tool runner](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L81-L89)；[V1 service](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L67-L107)；[V2 service](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L131-L162)
2. **权限主体是“能力/动作 + 资源模式”，不是单纯的工具开关。** V1 的规则是 `permission + pattern + action`；V2 是 `action + resource + effect`。规则支持 `*`/`?`，并且最后一个匹配规则胜出；没有匹配规则时默认得到 `ask`。[V1 schema](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/v1/config/permission.ts#L5-L12)；[V1 evaluate](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L28-L37)；[V2 evaluate](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L76-L85)
3. **默认策略是宽松但带两个安全护栏：大多数能力 allow，`external_directory` 与 `doom_loop` ask，`.env` 文件 read ask。** agent 默认构造还把非交互模式的 `question`、plan enter/exit 等能力设为 deny；用户配置按 ruleset 顺序覆盖默认规则。[官方权限文档](https://opencode.ai/docs/permissions)；[agent defaults](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/agent.ts#L119-L152)
4. **审批触发点在工具真正产生副作用之前。** bash 先解析 AST、扫描命令和外部路径，再调用 `ctx.ask`；webfetch/websearch、外部目录访问、task/subagent 也显式调用 `ctx.ask`。通过后才进入子进程或网络调用。[bash scan/ask](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L392-L411)；[bash execute](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L620-L641)；[webfetch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/webfetch.ts#L33-L49)
5. **审批有三种结果：once、always、reject。** V1 的 `always` 只加入当前进程内存中的 approved rules；UI 文案也明确它持续到 OpenCode 重启。V2 只有在 request 带 `save` 资源且回复 `always` 时才写入项目级 SQLite。[V1 reply](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L109-L166)；[V2 save branch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L220-L283)
6. **持久化分成两类：session rules 持久化，pending request 不持久化；V2 saved approvals 按 project 持久化。** session 表有 JSON `permission` 列；V2 `permission` 表按 `(project_id, action, resource)` 唯一索引保存授权。[session SQL](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/session/sql.ts#L22-L60)；[saved permission SQL](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission/sql.ts#L7-L19)
7. **非交互 `opencode run` 不会阻塞等待审批：默认把 permission request reject，`--auto`/隐藏 yolo 标志则 reply once；显式 deny 仍由权限引擎执行。** 同一入口还额外 deny question 和 plan enter/exit。[run flags/rules](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L242-L255)；[non-interactive handling](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L430-L448)；[auto/reject](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L801-L821)
8. **失败/取消以 fail-closed 为主：reject 会失败等待中的 tool effect；进程/实例结束时 finalizer 会拒绝所有 pending request；同一 session 的一个 reject 会连带拒绝其他 pending request。** 这保证审批不会在资源已变更后“悬空放行”，但也意味着一次拒绝会取消同 session 其他并发请求。[V1 finalizer/reject](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L54-L65)；[V1 reject cascade](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L121-L139)
9. **路径约束以工作目录边界为核心。** 工作目录内的路径不触发 `external_directory`；工作目录外会把目标归一成父目录 glob，并以该 glob 同时作为本次 patterns 和 always 候选。`~`/`$HOME` 只是在规则书写时展开，不会自动绕过 workspace 边界。[external directory guard](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/external-directory.ts#L15-L44)；[官方外部目录说明](https://opencode.ai/docs/permissions)
10. **bash 的命令约束不是完整命令策略，而是 AST 提取后的命令片段/前缀模式。** 它对文件类参数额外收集外部目录；对其他命令把原始 command 作为本次 pattern，并用 arity 表生成 `git checkout *`、`npm run dev *` 一类的 always 前缀。未知命令的 arity 默认只有第一个 token。[shell collect](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L378-L414)；[arity](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/arity.ts#L1-L9)
11. **网络和外部工具纳入同一审批面。** `webfetch` 以 URL 为 pattern、`websearch` 以 query 为 pattern，并把 `always` 候选设成 `*`；MCP resource 工具则把 server/URI 投影成 `mcp:<server>:*` 资源模式。[websearch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/websearch.ts#L110-L133)；[MCP read permission](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L338-L350)
12. **子 agent 权限不是简单继承父 agent 的全部 allow。** 派生 session 只复制父 session 的 deny 和 external-directory 规则，再根据子 agent 自身规则补 `todowrite`/`task` deny；task 工具本身还先请求父 session 对该 subagent type 的 permission。[subagent derivation](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/subagent-permissions.ts#L4-L26)；[task ask/create](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/task.ts#L119-L172)
13. **跨进程边界是事件 + HTTP API，而不是把内部 Deferred/SDK 错误直接暴露。** 权限服务发布 asked/replied 事件；V1 API 只提供 pending list 和 reply，V2 API 另提供 session-scoped create/list/get/reply 与 project saved list/remove，并经过 instance/workspace authorization middleware。[V1 HTTP handlers](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts#L8-L39)；[V2 API handlers](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/server/src/handlers/permission.ts#L14-L95)
14. **恢复模型是“重新观察当前 session/事件状态”，不是恢复 pending approval。** pending 存在内存 Map，实例 finalizer 会清空；但 session permission rules 存进 SQLite，可在重启后恢复。V2 saved permissions 也可按 project 重新读取。源码没有发现把 pending request 写入 journal/database 的路径。[V1 pending state](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L18-L26)；[V2 pending state](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L103-L129)
15. **测试覆盖了规则 precedence、unknown/no-match 默认 ask、V2 saved allow 与 configured deny precedence、once/reject 生命周期、外部目录 glob、CLI UI 状态机和 bash arity；没有看到完整的“进程崩溃后 pending request 恢复”测试。** 这说明核心 reducer/adapter 有单元测试，但恢复边界仍主要由实现结构推断。[V1 tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/test/permission/next.test.ts#L131-L174)；[V2 tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/test/permission.test.ts#L232-L313)

## 结论摘录

### 1. V1/V2 并存

[session tool runner](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L81-L89)

```ts
    ask: (req) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
```

[V2 service](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L131-L145)

```ts
    const savedRules = EffectRuntime.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({ action: item.action, resource: item.resource, effect: "allow" }),
      )
    })
    const configured = EffectRuntime.fn("PermissionV2.configured")(function* (
      sessionID: SessionV2.ID,
      agentID?: AgentV2.ID,
```

### 2. 规则主体与最后匹配

[V1 schema](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/v1/config/permission.ts#L5-L12)

```ts
export const Action = Schema.Literals(["ask", "allow", "deny"])
export type Action = Schema.Schema.Type<typeof Action>
export const Object = Schema.Record(Schema.String, Action)
export type Object = Schema.Schema.Type<typeof Object>
export const Rule = Schema.Union([Action, Object])
export type Rule = Schema.Schema.Type<typeof Rule>
```

[V1 evaluate](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L28-L37)

```ts
export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
```

### 3. 默认策略

[agent defaults](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/agent.ts#L119-L152)

```ts
        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
```

### 4. 审批在副作用前

[bash scan/ask](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L392-L411)

```ts
      for (const node of commands(root)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]
        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          for (const arg of pathArgs(command, ps, shellKind === "cmd")) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
```

[bash execute](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L620-L641)

```ts
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan, params)
                }),
              )
              return yield* run(
```

### 5. once/always/reject

[V1 reply](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L109-L166)

```ts
      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )
      }
      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return
```

[V2 save branch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L250-L259)

```ts
          if (input.reply === "always" && existing.request.save?.length) {
            yield* saved.add({
              projectID: location.project.id,
              action: existing.request.action,
              resources: existing.request.save,
            })
          }
          yield* Deferred.succeed(existing.deferred, undefined)
```

### 6. 持久化边界

[session SQL](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/session/sql.ts#L43-L51)

```ts
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    revert: text({ mode: "json" }).$type<Revert.State>(),
    permission: text({ mode: "json" }).$type<PermissionV1.Ruleset>(),
    agent: text(),
```

[saved permission SQL](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission/sql.ts#L7-L19)

```ts
export const PermissionTable = sqliteTable(
  "permission",
  {
    id: text().$type<PermissionSaved.ID>().primaryKey(),
    project_id: text().$type<ProjectV2.ID>().notNull(),
    action: text().notNull(),
    resource: text().notNull(),
  },
  (table) => [uniqueIndex("permission_project_action_resource_idx")
```

### 7. 非交互模式

[run flags/rules](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L242-L255)

```ts
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
```

[auto/reject](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L801-L821)

```ts
            if (event.type === "permission.asked") {
              const permission = event.properties
              if (!sessions.has(permission.sessionID)) continue
              if (auto) {
                await client.permission.reply({ requestID: permission.id, reply: "once" })
              } else {
                UI.println("permission requested; auto-rejecting")
                await client.permission.reply({ requestID: permission.id, reply: "reject" })
              }
```

### 8. 失败与取消

[V1 finalizer/reject](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L54-L65)

```ts
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
            state.pending.clear()
          }),
        )
        return state
```

[V1 reject cascade](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L121-L139)

```ts
        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
```

### 9. 外部目录

[external directory guard](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/external-directory.ts#L15-L44)

```ts
  const ins = yield* InstanceState.context
  const full = process.platform === "win32" ? FSUtil.normalizePath(target) : target
  if (containsPath(full, ins)) return false
  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob = path.join(dir, "*").replaceAll("\\", "/")
  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
```

### 10. bash 命令模式

[shell collect](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L407-L410)

```ts
        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }
      return scan
    })
```

[arity](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/arity.ts#L1-L9)

```ts
export function prefix(tokens: string[]) {
  for (let len = tokens.length; len > 0; len--) {
    const prefix = tokens.slice(0, len).join(" ")
    const arity = ARITY[prefix]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  if (tokens.length === 0) return []
  return tokens.slice(0, 1)
}
```

### 11. 网络/MCP

[websearch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/websearch.ts#L119-L133)

```ts
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
```

[MCP read permission](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L338-L350)

```ts
            yield* ctx.ask({
              permission: "read",
              metadata: { server: parsed.server, uri: parsed.uri },
              patterns: [`mcp:${parsed.server}:${parsed.uri}`],
              always: [`mcp:${parsed.server}:*`],
            })
            const content = yield* mcp.readResource(parsed.server, parsed.uri)
```

### 12. 子 agent

[subagent derivation](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/subagent-permissions.ts#L4-L26)

```ts
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
```

[task ask/create](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/task.ts#L119-L128)

```ts
      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
```

### 13. 跨进程边界

[V1 HTTP handlers](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts#L8-L39)

```ts
    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })
    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionV1.ID }
      payload: PermissionV1.ReplyBody
    }) {
      yield* svc.reply({
        requestID: ctx.params.requestID,
```

[V2 API handlers](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/server/src/handlers/permission.ts#L60-L75)

```ts
        "session.permission.get",
        Effect.fn(function* (ctx) {
          const request = yield* (yield* PermissionV2.Service).get(ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* missingRequest(ctx.params.requestID)
          return { data: request }
        }),
      )
      .handle(
        "session.permission.reply",
```

### 14. 恢复

[V1 pending state](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L18-L26)

```ts
interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
}
interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
}
```

[V2 pending state](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L103-L129)

```ts
interface Pending {
  readonly request: Request
  readonly agent?: AgentV2.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
}
const pending = new Map<ID, Pending>()
yield* EffectRuntime.addFinalizer(() =>
  EffectRuntime.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new DeclinedError()), {
```

### 15. 测试

[V1 tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/test/permission/next.test.ts#L131-L174)

```ts
test("fromConfig - preserves top-level config key order", () => {
  const wildcardFirst = Permission.fromConfig({ "*": "deny", bash: "allow" })
  const specificFirst = Permission.fromConfig({ bash: "allow", "*": "deny" })
  expect(wildcardFirst.map((r) => r.permission)).toEqual(["*", "bash"])
  expect(specificFirst.map((r) => r.permission)).toEqual(["bash", "*"])
  expect(Permission.evaluate("bash", "ls", wildcardFirst).action).toBe("allow")
  expect(Permission.evaluate("bash", "ls", specificFirst).action).toBe("deny")
})
```

[V2 tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/test/permission.test.ts#L286-L313)

```ts
  it.effect("stores and removes saved resources for a project", () =>
    Effect.gen(function* () {
      yield* setup()
      const service = yield* PermissionV2.Service
      const asked = yield* Deferred.make<PermissionV2.Request>()
      const events = yield* EventV2.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === PermissionV2.Event.Asked.type
          ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
```

## 权限模型速查

| 维度 | 当前 OpenCode 行为 | 证据 |
|---|---|---|
| 权限主体与能力 | V1 `permission` key 对应工具/安全护栏，pattern 对应命令、路径、URL、query 或 subagent type；V2 改名为 action/resource | [V1 config](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/v1/config/permission.ts#L5-L12)；[V2 schema](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/schema/src/permission.ts#L25-L65) |
| 默认策略 | V1 agent defaults 为大体 allow；`external_directory`、`doom_loop` ask；read 对 `.env` ask；`question`、plan enter/exit 等按 agent 设定 | [agent defaults](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/agent.ts#L119-L152) |
| 审批触发 | 工具执行体显式 `ctx.ask`，权限服务先 evaluate，再将 ask 请求放入 pending | [service ask](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L67-L107) |
| 一次性授权 | `once` 只完成当前 deferred，不追加 approved/saved rule | [V1 reply](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L142-L151) |
| 持久授权 | V1 `always` 仅当前进程；V2 `always + save` 写 project permission table | [V2 save](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L250-L259) |
| 路径约束 | workspace 内不问 external_directory；workspace 外按目录 glob 询问 | [external directory](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/external-directory.ts#L24-L44) |
| 命令约束 | bash AST 扫描 + exact command/prefix pattern；不是 syscall sandbox | [shell run](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L481-L559) |
| 网络/外部工具 | webfetch URL、websearch query、MCP server/resource 均可 ask/allow/deny | [webfetch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/webfetch.ts#L39-L49)；[websearch](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/websearch.ts#L119-L133) |
| 非交互 | 默认 reject pending permission；`--auto` reply once；显式 deny 仍有效 | [run handling](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L801-L821)；[official docs](https://opencode.ai/docs/permissions) |
| 失败/取消/恢复 | reject 失败等待中的 tool；shutdown finalizer reject pending；session rules/saved approvals 可恢复，pending 不恢复 | [V1 finalizer](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L54-L65)；[session permission column](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/session/sql.ts#L43-L51) |
| 跨进程 | Event asked/replied + HTTP list/reply；V2 API 做 session ownership/project filtering，HTTP API 有 authorization middleware | [V2 handlers](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/server/src/handlers/permission.ts#L52-L95) |
| 测试 | 规则、保存、拒绝、并发 pending、glob/arity、CLI 状态机有覆盖；crash recovery 未见专项测试 | [permission tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/test/permission.test.ts#L253-L313) |

## 具体 Trace：`npm run build` 触发一次审批后执行

1. session tool runner 创建 `Tool.Context`，把 agent permission 与 session permission 合并后交给 `Permission.Service.ask`。[trace start](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L59-L89)

```ts
const context = (...) => ({
  ...,
  ask: (req) => permission.ask({
    ...req,
    sessionID: input.session.id,
    ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
  }),
})
```

2. bash 工具用 tree-sitter 解析命令，收集 command node；`BashArity.prefix` 将 `npm run build` 转成可复用的 `npm run build *` 候选。[scan](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L392-L410)

```ts
if (tokens.length && (!cmd || !CWD.has(cmd))) {
  scan.patterns.add(source(node))
  scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
}
```

3. 权限服务按 ruleset 最后匹配项评估；如果是 `allow` 直接返回，如果是 `deny` 失败，如果是 `ask` 创建 Deferred、放入 pending Map、发布 `permission.asked` 事件。[evaluate/queue](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L72-L107)

```ts
const rule = evaluate(request.permission, pattern, ruleset, approved)
if (rule.action === "deny") return yield* new PermissionV1.DeniedError(...)
if (rule.action === "allow") continue
needsAsk = true
...
pending.set(id, { info, deferred })
yield* events.publish(Event.Asked, info)
return yield* Deferred.await(deferred)
```

4. TUI/HTTP/ACP 客户端回复 `once`、`always` 或 `reject`。`once` 唤醒本次 Deferred；`always` 把 `always` patterns 加入内存 approved；`reject` 失败本次并清理同 session 的其他 pending。[reply](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L109-L166)

5. 审批完成后，shell 才调用 `ChildProcessSpawner.spawn`，使用选定 shell、cwd、环境变量和 timeout；代码没有显示出 OS sandbox 或 syscall allowlist，因此这里的安全边界是“OpenCode 权限判定 + 子进程 shell 本身”。后一句是基于执行代码的推断，不等同于官方安全保证。[spawn](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L481-L559)

## 失败模式与边界

| 场景 | 行为 | 限制/风险 | 证据 |
|---|---|---|---|
| 无匹配规则 | 返回 ask | 新工具默认不会静默 allow；但 agent 默认 ruleset 可能提前覆盖成 allow | [evaluate](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L28-L37) |
| 规则顺序错误 | 最后匹配规则胜出 | 把 catch-all deny 放在具体 allow 后面会覆盖 allow；文档推荐 catch-all 在前 | [tests](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/test/permission/next.test.ts#L131-L174) |
| 工作目录外路径 | 先请求 external_directory，再请求工具本身 | allow 目录只解决路径边界；edit/bash 仍需各自规则，不能推导出“全能力 allow” | [external guard](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/external-directory.ts#L24-L43) |
| shell 动态路径/变量 | 动态参数通常无法精确解析成路径，命令仍作为 permission pattern | 这是策略匹配，不是命令语义证明；复杂 shell 组合可能只得到较粗粒度的 prefix | [dynamic/path parsing](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L154-L179) |
| 用户 reject | 本次 tool 失败；V1 同 session 其他 pending 一并 reject | 一个审批 UI 操作可能取消并发中的多个 tool call | [reject cascade](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L121-L139) |
| 进程退出/实例销毁 | finalizer reject pending 并清空 Map | pending approval 不会跨重启自动恢复 | [finalizer](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L54-L65) |
| 非交互无 `--auto` | permission.asked 自动 reject 并继续结束 session | 用户不能在标准输出流程中交互式授权 | [run](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L801-L821) |
| ACP 无 requestPermission 回调 | 直接 reject | ACP host 未实现审批 UI 时默认 fail-closed | [ACP handler](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/acp/permission.ts#L51-L59) |
| V2 saved allow 与 configured deny 冲突 | configured deny 先返回 deny，saved allow 不绕过 | 项目持久授权不是绕过显式拒绝的后门 | [V2 evaluate input](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L155-L162) |

## 反方证据与不成立条件

- **“always 一定持久化”不成立。** 官方文档对普通 UI 的说明是“当前 OpenCode session”；当前 V1 服务只把 patterns 推入内存 `approved`。只有 V2 request 携带 `save`，并且回复 `always`，才写入 SQLite。[V1 memory](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L23-L26)；[V2 persistence condition](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L250-L255)
- **“父 agent 的 allow 会自动授予子 agent”不成立。** 子 session 只继承父 deny 与 external-directory 规则，子 agent 自己的 permission 决定能力，并且 task/todowrite 缺省会补 deny。[subagent rules](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/agent/subagent-permissions.ts#L5-L26)
- **“允许 external_directory 就等于允许外部目录内所有动作”不成立。** 文档明确它是路径边界；工具权限（例如 edit/bash）仍需要自己的 allow/ask/deny 规则。源码也分别发起 external_directory 与 bash permission request。[official docs](https://opencode.ai/docs/permissions)；[shell asks both](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L263-L290)
- **“有审批系统就有沙箱”不成立。** shell 最终直接通过 `ChildProcess.make` 运行命令，并传入 shell/cwd/env/timeout；在本次检查的权限与执行路径中没有看到 OS sandbox、容器隔离或 syscall policy。这个结论仅说明源码未在该路径实现这些边界，不代表整个产品绝对没有其他宿主级隔离。[child process](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L293-L309)
- **“V1 与 V2 是同一个已完全替换的模型”不成立。** 普通 session tool runner 仍 import `PermissionV1`，而 V2 service 使用另一套 schema/API；因此任何接入都必须先明确目标路径。[V1 runner](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/session/tools.ts#L1-L8)；[V2 schema](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/schema/src/permission.ts#L54-L65)

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 查阅 `packages/opencode/src/permission`、`packages/core/src/permission`、tool runner、bash/web/MCP tools、session/schema/sql、HTTP handlers、CLI run、ACP handler、tests；全部固定到 `fee476bb90043a1012abda156dd9af9e5c71b19d`。官方权限文档核对了 allow/ask/deny、auto、外部目录和默认值。 |
| 作者或维护者本人的说法 | 未找到独立作者博客/RFC；官方 docs 中的权限说明作为项目一手文档使用。 |
| 同类方案 | 未查。用户明确要求本次只调研 OpenCode，不查 pi agent、grok cli、Codex。 |
| issue / PR / 社区实践 | 未作为主要证据展开；源码和官方文档已覆盖当前行为，且本题目标是实现设计而非回归追踪。 |
| 历史演变 | 只核对了当前 commit 中 V1/V2 并存的代码与 `v1.1.1` 文档说明；未扩展到历史 commit，因为当前版本的并存状态已经直接影响接入设计。 |

## 待验证项

1. V2 API 在默认发行版中覆盖哪些具体 UI/CLI/ACP 调用路径，当前源码显示它存在且有 handler，但不能仅凭本次静态检查断言所有普通 session 已切换到 V2。
2. “没有看到 sandbox”需要在发行版启动脚本、桌面宿主和部署环境继续核验；本报告只覆盖 OpenCode tool execution path。
3. 需要补一条真实 crash/restart 测试，确认 pending request 被清理后 session runner 的最终消息状态，以及 V2 saved permissions 在实际迁移/重启后的读取行为。
4. 需要验证复杂 shell 语法（命令替换、重定向、管道、PowerShell provider path）是否会产生过宽的 permission pattern；现有测试覆盖 arity 和若干外部路径，但未覆盖完整 shell 语法矩阵。

## 对本项目的影响

如果要借鉴 OpenCode，最值得复用的是“默认策略 + 有序覆盖 + 资源模式 + 一次性/会话级/项目级授权分层”，以及把审批请求通过事件/API 投影到 UI 的边界。不要直接把 OpenCode 的 `always` 命名理解成 durable grant，也不要把 pattern matcher 当成沙箱。对本项目的实现设计，首先应明确采用 V1 式 tool/pattern 还是 V2 式 action/resource，并单独定义 pending request 的恢复语义；否则会把 session 权限、运行时审批和项目持久授权混成一个 durable fact。
