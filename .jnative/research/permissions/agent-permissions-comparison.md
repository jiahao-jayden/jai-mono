# Pi Agent、OpenCode、Grok CLI、Codex 权限系统设计对比

核验日期：2026-09-19（Asia/Singapore）。源码按 commit 固定，避免快速演进中的权限、审批和 sandbox 变化混入同一结论：Pi `earendil-works/pi@36b60d2e8985899743c4cf5bd5f8929832a3f05d`，OpenCode `anomalyco/opencode@fee476bb90043a1012abda156dd9af9e5c71b19d`，Grok Build `xai-org/grok-build@a28ee2b2063426e8816e380ccea528b9de95e5da`，Codex `openai/codex@78245b47af2a7aafcabe025828ceecca69db4df1`。Grok 的公开仓库是官方 monorepo 的周期同步镜像，仓库内 `SOURCE_REV` 另记为 `e8563f8f182296ebb53cadb3e1eab7615d76408e`；因此本文不把公开镜像 HEAD 当成完整内部 monorepo 的最新版本。

## 结论

1. **不要把权限系统设计成一个 `Permission` 开关。** 四个项目实际都在拆分“项目输入信任、动作策略、审批交互、执行 sandbox、网络策略、持久授权”中的不同子集。Pi 只内建输入信任，OpenCode 主要做工具/资源规则，Grok 组合规则与 OS sandbox，Codex 再把 profile、approval policy、exec policy 和 network policy 分开。各层不能互相替代。[Pi 证据](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L1-L7) · [Grok 证据](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L1-L46) · [Codex 证据](https://developers.openai.com/codex/agent-approvals-security)
2. **应用层策略的核心不是“是否弹窗”，而是对具体资源求值。** OpenCode 用 `permission + pattern`，Grok 用 `tool + pattern` 并对 chained shell 逐段求值，Codex 用 exec policy 对 command prefix 求值；Pi 没有内置这层。请求必须携带经过规范化的资源，而不是只携带工具名。[OpenCode 规则](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L68-L113) · [Grok shell 规则](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs#L127-L232) · [Codex exec policy](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L394-L454)
3. **一次性批准、session grant、project grant、policy amendment 必须是不同的结果类型。** OpenCode 的 `once` 不改规则，Grok 细分 `AllowOnce`、session edit grant 和 command/domain/MCP 持久 grant，Codex 细分 `Accept`、`AcceptForSession` 和 exec/network policy amendment。把 `alwaysAllow` 作为单一布尔值会丢失作用域和审计语义。[OpenCode reply](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L109-L166) · [Grok outcome](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/prompter.rs#L178-L218) · [Codex decisions](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L63-L85)
4. **deny 必须是不可被普通批准覆盖的硬边界；无法安全解析也不能自动 allow。** OpenCode 的显式 deny 仍压过 `--auto`，Grok 的 precedence 是 deny > ask > allow，Codex 在 `Never` 或无 sandbox 时把 prompt 转为 forbidden；Pi 的这一层由扩展或外部 sandbox 自己实现。[OpenCode auto 语义](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L6-L38) · [Grok precedence](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs#L127-L232) · [Codex forbidden](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/exec_policy.rs#L793-L838)
5. **审批不是 sandbox。** OpenCode 和 Pi 的批准动作最终仍在宿主进程权限下执行；Grok 和 Codex 才把文件、进程、网络边界下沉到 Landlock/Seatbelt/bwrap 等 OS 层。即使用户批准了一个动作，也不应自动获得超出当前 execution profile 的文件或网络能力。[OpenCode shell 执行路径](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L481-L559) · [Pi 安全边界](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L31-L53) · [Codex deny-read escalation](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L270-L296)
6. **headless 默认应 fail closed，但策略要明确而不是隐式“全自动”。** OpenCode 无 `--auto` 时 reject pending，Pi 无 UI 时 project trust 不加载，Grok 未知配置/断连回到 Ask 或 cancelled，Codex `codex exec` 默认 `approval_policy=Never`，需要审批的动作变 forbidden。自动模式也应是明确的 reviewer/policy，而不是 resolver 中的隐藏 bypass。[OpenCode CLI](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/cli/cmd/run.ts#L801-L821) · [Grok headless](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/resolution.rs#L294-L328) · [Codex headless](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/exec/src/lib.rs#L563-L590)
7. **恢复应恢复 durable policy，不应假装恢复旧进程的 pending approval 或 session cache。** OpenCode pending 只在内存，Codex resume 重新解析 profile 并恢复持久 policy，Grok 断连后重新 park 审批，Pi 的 trust store 与 runtime sandbox 重新初始化。审批请求本身若要跨进程/重启恢复，需要额外设计 durable request fact 和重放协议。[OpenCode pending](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L103-L129) · [Grok resume](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-shell/src/session/acp_session_tests/plan_approval_resume_tests.rs#L139-L249) · [Codex resume](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1581-L1700)
8. **跨进程协议应传安全 DTO 和关联 id，不传内部 permission object。** Grok frame 保留 session/tool/call/hook correlation，Codex RPC 对 profile 使用 `deny_unknown_fields` 和显式 `TryFrom`，OpenCode API 校验 session ownership；这与本项目现有“白名单投影 + session/operation/toolCall 关联”方向一致。[Grok frame](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/common/xai-tool-protocol/src/frames.rs#L891-L931) · [Codex DTO](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/permissions.rs#L215-L245) · [OpenCode API](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/server/src/handlers/permission.ts#L52-L95)

## 四个方案速查

| 维度 | Pi Agent | OpenCode | Grok CLI / Build | Codex |
|---|---|---|---|---|
| 权限主体 | 启动进程的用户；project trust 只决定本地输入是否加载 | 工具/资源 pattern | capability + tool access + host/managed policy | permission profile + approval policy + exec policy |
| 默认姿态 | 无内置动作审批与 sandbox | 多数工具 allow；敏感/外部目录 ask | 只读 allowlist，其余默认 ask/deny；sandbox 另配 | workspace-write、默认无网络；按 policy 请求审批 |
| 规则粒度 | tool name allowlist；细粒度由扩展实现 | `permission + pattern`，last match wins | `tool + pattern`，deny > ask > allow；shell 逐 segment | command prefix、filesystem path、network host |
| 一次性批准 | 无 core 语义；扩展自定义 | `once`，只完成本次 pending | `AllowOnce` | `Accept` |
| Session 授权 | 无通用动作 grant | V1 memory approved；V2 可按请求 save | edit session grant，另有 session capability | `AcceptForSession` 内存 cache；`Turn/Session` profile grant |
| 持久授权 | project trust；动作授权由扩展/容器实现 | V1 当前进程；V2 `save` 写 project store | repo-scoped `permission.toml`，command/domain/MCP 分类型 | exec/network policy amendment、profile/config |
| Sandbox | 无 built-in，建议容器/VM | 本次检查的执行路径无 OS sandbox | Landlock/Seatbelt/bwrap，默认 off | sandbox profile + network policy |
| 非交互 | trust 无 UI 时不加载；动作 gate 不由 core 提供 | 默认 reject；`--auto` 只 reply once | 未知/断连 fail closed；受 policy 约束的 headless hint | `codex exec` 默认 `Never` |
| 恢复 | transcript/tool loadout + trust store；不恢复 runtime approval | saved rules/session rules；pending 不恢复 | 断连后重新 park approval | policy/profile 恢复；session cache 不保证跨进程 |
| 主要不成立条件 | trust 不是 sandbox；工具默认拥有宿主权限 | pattern 不是 sandbox；V1/V2 并存 | sandbox 默认关且有平台差异；grant store 有并发风险 | standalone `process/spawn` 不带 Codex sandbox；profile override 可能静默覆盖 |

## 统一模型：六个边界

四个项目的实现可以压成下面六个相互独立的概念。它们不是要求每个项目都完整实现，而是比较时必须分开问：

| 概念 | 要回答的问题 | 本次四项目的代表实现 |
|---|---|---|
| Input trust | 项目里的 settings、skills、hooks、extensions、instructions 能否加载？ | Pi project trust；Codex folder trust；Grok folder trust |
| Capability profile | 当前 agent/process 具备哪些文件、进程、网络、工具能力？ | Grok `ReadOnly/ReadWrite/Execute/All`；Codex named permission profile |
| Action policy | 这一次具体 command/path/domain/tool 是否 allow、ask、deny？ | OpenCode rules；Grok rules；Codex exec policy |
| Approval interaction | 谁可以批准、批准什么作用域、取消/超时如何表达？ | OpenCode `once/always/reject`；Grok PromptOutcome；Codex ReviewDecision |
| Execution sandbox | 获准后，OS 还能实际限制什么？ | Grok Landlock/Seatbelt/bwrap；Codex sandbox/backend；Pi/OpenCode 交给宿主 |
| Durable grant | 哪些规则或 profile 会跨 session/restart 生效？ | Grok `permission.toml`；OpenCode V2 saved permission；Codex policy amendment |

Pi 的官方说明很明确：project trust 是 input-loading guard，“does not make untrusted code, untrusted prompts, or untrusted model output safe”。[原文](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L18-L37)

Codex 则明确把 sandbox 和 approval policy 分开：sandbox 决定技术上能做什么，approval policy 决定什么时候必须询问用户。[官方说明](https://developers.openai.com/codex/agent-approvals-security)

## 具体 Trace：同一条 shell 输入在四个系统中的差异

输入：`npm test && rm -rf build`。

1. **Pi：** 默认 shell 直接继承 host 权限。没有 core permission popup；只有用户安装的 `tool_call` extension 或外部容器可以拦截。extension 返回 `block` 时可把错误作为 tool result 返回；是否 `terminate` 由扩展决定。[shell operations](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/bash.ts#L80-L102) · [tool gate](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L662-L722)
2. **OpenCode：** shell 先由 tree-sitter 拆出 command nodes，再为 `npm test` 和 `rm -rf build` 分别生成 permission patterns；任一资源 deny，整次拒绝；有 ask 则创建 pending、发布 `permission.asked`，客户端回 `once/always/reject`，批准后才 spawn shell。[shell scan](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/tool/shell.ts#L392-L410) · [permission queue](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L72-L166)
3. **Grok：** chained segment、wrapper、inline `bash -c` 递归解析；managed deny/ask 先于 allow，无法安全解析或 cwd 无法锚定时保持 ask。即使应用层 allow，OS sandbox 仍对文件/网络施加 profile 限制；可持久化的 grant 必须满足 safe replay 条件。[policy](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/policy.rs#L127-L232) · [grant validation](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/bash_grants.rs#L83-L129)
4. **Codex：** orchestrator 先组合 environment、workspace roots、permission profile 和 exec policy；危险或 sandbox override 在 `OnRequest` 下进入 `NeedsApproval`，`AcceptForSession` 只写内存 cache，`AcceptWithExecpolicyAmendment` 才改变持久规则。若 profile 有 deny-read，即使批准 escalation 也不能 unsandboxed retry。[orchestrator](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/orchestrator.rs#L131-L223) · [approval decisions](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L63-L85) · [deny-read](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L270-L296)

这条 trace 的共同点是：**先得到结构化 resource/command，再决定是否审批；批准只影响 action，不自动取消 execution sandbox。** Pi 是反例：该层不在 core 内置能力中。

## 失败模式和反方证据

| 方案 | 不成立条件 | 证据/限制 |
|---|---|---|
| Pi | “project trust 已开启，所以工具安全”不成立 | trust 只控制项目输入加载；内置工具仍以 pi 进程权限运行。[安全文档](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L1-L53) |
| OpenCode | “`--auto` 是全局 allow”不成立 | 只对原本为 ask 的请求回 `once`；显式 deny 仍生效。[文档](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/web/src/content/docs/permissions.mdx#L6-L38) |
| OpenCode | “`always` 一定跨重启”不成立 | V1 approved 是进程内；V2 只有 request 提供 save 且 reply always 才写 project store。[V1](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/opencode/src/permission/index.ts#L18-L26) · [V2](https://github.com/anomalyco/opencode/blob/fee476bb90043a1012abda156dd9af9e5c71b19d/packages/core/src/permission.ts#L250-L259) |
| Grok | “sandbox 一定生效”不成立 | sandbox 默认关闭；Linux glob deny 只覆盖启动时存在的文件；macOS child-network blocking 是 no-op；built-in profile 失败可能告警后继续。[sandbox 文档](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md#L1-L46) |
| Grok | “持久 grant 可任意扩大命令权限”不成立 | 危险 verb、exec vehicle、catch-all glob 和不能 safe replay 的 prefix 不生成 grant。[grant 校验](https://github.com/xai-org/grok-build/blob/a28ee2b2063426e8816e380ccea528b9de95e5da/crates/codegen/xai-grok-workspace/src/permission/bash_grants.rs#L11-L21) |
| Codex | “`AcceptForSession` 是 durable policy”不成立 | 它只进 session memory cache；持久化要 exec/network policy amendment。[缓存](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/core/src/tools/sandboxing.rs#L40-L116) |
| Codex | “standalone process 也受 Codex sandbox”不成立 | app-server `process/spawn` 注释明确是 without Codex sandbox。[协议](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server-protocol/src/protocol/v2/process.rs#L19-L24) |
| Codex | “profile 删除后 resume 会继续用旧能力”不成立 | cold resume 按当前配置重新解析，profile 删除时回落 default。[测试](https://github.com/openai/codex/blob/78245b47af2a7aafcabe025828ceecca69db4df1/codex-rs/app-server/tests/suite/v2/thread_resume.rs#L1581-L1700) |

## 对 jai-mono 的映射

### 已有设计与四项目一致的部分

1. 当前 permission middleware 已把初始判定、canonical path 判定、审批、审批后的 recheck 和 tool execution 分开；在 canonical path 或 workspace root 发生变化时会拒绝继续执行。[middleware.ts#L90-L129](../../../packages/coding-agent/src/permissions/middleware.ts#L90-L129) · [middleware.ts#L197-L221](../../../packages/coding-agent/src/permissions/middleware.ts#L197-L221)
2. 当前配置已经区分 `permission` 规则树、`defaultMode`、额外目录和不可关闭的 bypass 限制，并让 `plan` 与 destructive danger layer 高于普通 allow 规则。[evaluate.ts#L55-L101](../../../packages/coding-agent/src/permissions/evaluate.ts#L55-L101) · [definition.ts#L37-L86](../../../packages/coding-agent/src/permissions/definition.ts#L37-L86)
3. 当前 Runtime Host 已将 approval 作为 session/operation/toolCall 关联的内存 pending registry，并拒绝重复、跨 session 和不可 remember 的响应；这与四项目的跨进程关联方向一致。[host.ts#L855-L896](../../../app/server/src/runtime/host.ts#L855-L896) · [runtime.ts#L119-L154](../../../app/server/src/operations/runtime.ts#L119-L154)
4. 当前 SDK 和 Server 已明确将 permission request 投影为安全 DTO，并把 approval telemetry 与 permission telemetry 分开；这比把内部错误或原始 args 直接穿过 RPC 更接近 Codex/Grok 的边界设计。[coding-agent.ts#L94-L122](../../../app/server/src/agents/coding-agent.ts#L94-L122) · [contracts.ts#L100-L121](../../../packages/telemetry/src/core/contracts.ts#L100-L121)

### 建议补强的设计

#### 1. 把“权限”正式拆成六类事实

建议在 `@jai/coding-agent`/Runtime 设计层明确区分：

| 建议概念 | 所有者 | 是否 durable | 说明 |
|---|---|---:|---|
| `WorkspaceTrust` | Host / workspace | 是 | 是否加载 project config、skills、extensions、hooks；不能当 action allow |
| `CapabilityProfile` | Runtime / environment | 是或 operation snapshot | 文件、网络、进程、工具能力；在 Operation 打开时冻结 |
| `PermissionRule` | Coding Agent / config | 是 | `tool + normalized resource -> allow/ask/deny`，含来源和优先级 |
| `PendingApproval` | Runtime approval registry | 否，除非另建 durable fact | requestId、sessionId、operationId、toolCallId、resource summary、signal |
| `ApprovalDecision` | Runtime / UI boundary | 通常否 | `deny/allowOnce/allowSession/allowProject/denyAndCancel` 等显式作用域 |
| `ExecutionSandbox` | Runtime adapter | 运行时资源 | OS/container/network enforcement；approval 不能扩大它 |

这里的“六类”是设计分解，不是建议新增六个目录；事实 owner 仍应遵守当前 [AGENTS.md](../../../AGENTS.md) 的领域归属和 SQLite-only durable journal 约束。

#### 2. 保留当前 `allowOnce` / `alwaysAllow` API，但内部不要继续用二元语义

现有公开 decision 只有 `deny | allowOnce | alwaysAllow`。[permissions.mdx#L22-L50](../../../app/docs/content/docs/guides/permissions.mdx#L22-L50) 但四个项目表明 `alwaysAllow` 至少需要携带：

- grant scope：session / project-local / policy amendment；
- resource kind：bash prefix、path glob、domain、MCP server/tool、extension action；
- canonical resource：规范化路径、command AST/prefix、host；
- constraints：workspace root、sandbox profile、data sensitivity、danger layer；
- provenance：built-in、user rule、project rule、hook、reviewer、extension。

对外如果暂时保持三种 decision，Runtime 可以把 `alwaysAllow` 解释为“接受 SDK 提供的 `rememberScope` 和 suggested rule”，但不应在没有 scope 的 request 上自行持久化。

#### 3. approval request 需要加入安全上下文，而不只显示标题和风险

当前 `RuntimeApprovalRequest` 只投影 `requestId/sessionId/operationId/toolCallId/toolName/title/description/risk/canAlwaysAllow/rememberScope`。[runtime.ts#L119-L139](../../../app/server/src/operations/runtime.ts#L119-L139) Codex 的 approval action 还携带 command、cwd、environment、network context、additional permissions 和 proposed policy amendment；Grok 则按 command/domain/MCP 类型选择可 replay 的 grant。

建议追加一个白名单 `resource` DTO，而不是把原始 args 直接越过进程边界：

```ts
type RuntimeApprovalResource =
  | { kind: "command"; argv: readonly string[]; cwd: string; segments: readonly string[]; suggestedRule?: string }
  | { kind: "path"; path: string; canonicalPath?: string; operation: "read" | "write" | "delete" }
  | { kind: "network"; host: string; method?: string; suggestedRule?: string }
  | { kind: "extension"; extensionId: string; sideEffect: "read" | "write" | "destructive" };
```

这仍需按现有 RPC 白名单 DTO 规则进一步收窄；示意不是立即实施的 API。

#### 4. 将 shell 授权分成 parse、evaluate、enforce 三段

当前 `evaluate.ts` 已拆 compound Bash，并把未知/不可解析命令回落为 ask。[evaluate.ts#L104-L125](../../../packages/coding-agent/src/permissions/evaluate.ts#L104-L125) 这已经接近 OpenCode/Grok。下一步应明确三段的接口和测试：

1. `parse`：命令节点、wrapper、redirect、cwd 变化、symlink 目标；无法安全解析返回结构化 `opaque`。
2. `evaluate`：每个节点得到 `allow/ask/deny`，聚合规则为 deny > ask > allow；记录 matched rule/source。
3. `enforce`：把批准动作交给 capability/sandbox adapter；不因为 `allow` 就跳过 OS boundary。

不能只扩大 Bash pattern matcher 来替代 sandbox。OpenCode 的 shell 仍是 host child process；Grok/Codex 的经验说明 command policy 和 execution sandbox 必须各自测试。

#### 5. 明确 headless 模式和恢复语义

当前 Host 的 pending approval 是内存 Map，关闭/abort 会 reject pending。[host.ts#L1392-L1447](../../../app/server/src/runtime/host.ts#L1392-L1447) 建议固定以下契约：

- headless 默认 `dontAsk`/`Never`，未预授权调用返回结构化 `permission.denied`，不挂起等待 UI；
- auto 模式只自动回应 `ask`，不能覆盖 deny，也不能改变 durable rule；
- pending approval 不跨进程/重启恢复，除非另建 durable request fact；
- resume 重新解析当前 trust、profile、rules、sandbox backend；旧 session grant 不因 transcript 恢复而复活；
- profile、workspace root 或 canonical target 改变时，必须 recheck 并拒绝旧 approval。

这与当前 `Permission context changed while awaiting approval` 的 recheck 逻辑相容。[middleware.ts#L197-L221](../../../packages/coding-agent/src/permissions/middleware.ts#L197-L221)

#### 6. 把 extension authorization 与 core permission 的 bypass 关系写成不可绕过的 contract

当前 `extensionAuthorizedToolNames` 可以直接 `return next()`，而普通 extension tools 走 core permission evaluation。[middleware.ts#L70-L88](../../../packages/coding-agent/src/permissions/middleware.ts#L70-L88) 这与“Extension-owned authorization”设计一致，但需要明确：

- extension-owned auth 只替代 action approval，不得替代 capability/sandbox；
- extension 若声明 `destructive` 或 `secret`，仍由 Runtime 负责白名单投影和生命周期取消；
- 未注册 permission policy 的外部工具 fail closed；
- 子 agent/child session 只能得到 parent capability 的子集，不应自动复制 parent 的 project-local grant。

### 暂不建议做的事情

1. 不要把 Pi 的 project trust 当成完整权限系统；它只适合做 project-local configuration/resources 的加载 gate。
2. 不要照搬 OpenCode 的 V1 last-match 规则而不提供 matched-rule 诊断；历史 PR 已证明规则来源顺序会产生实际回归。[OpenCode #46871](https://github.com/anomalyco/opencode/pull/46871)
3. 不要把 `bypassPermissions` 解释为脱离 sandbox 的 unrestricted mode；Codex 的 deny-read 规则说明 escalation 也可能必须保留 sandbox。
4. 不要把 standalone process/terminal 入口和受权限编排的 Agent tool 入口混为一谈；Codex 的 `process/spawn` 明确不带 Codex sandbox。
5. 不要把 approval telemetry 当成 durable audit journal。当前 telemetry 只描述 observation；若未来需要审计，另建白名单、不可变的 permission decision fact，并遵守 `@jai/agent` journal owner 规则。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定并查阅四个官方/官方组织仓库的 permission、approval、sandbox、trust、protocol、resume 和 tests；每个项目的详细摘录在同目录的 [`pi-agent.md`](./pi-agent.md)、[`opencode.md`](./opencode.md)、[`grok-cli.md`](./grok-cli.md)、[`codex.md`](./codex.md)。 |
| 作者或维护者本人的说法 | Pi 官方 security/README 明确解释“不提供内置权限与 sandbox”；Grok README 说明公开仓库是 monorepo 同步镜像；Codex 使用官方 security 文档；OpenCode 未找到独立作者长文，使用官方 docs 与项目源码作为一手说明。 |
| 同类方案 | 来源面补查 Claude Code 的多层 settings/standing approval/folder trust、Gemini CLI 的 policy engine 与 sandbox、NIST least privilege；它们验证了规则优先级、作用域和 execution boundary 应分开。详见 [`source-map.md`](./source-map.md)。 |
| issue / PR / 社区实践 | 查阅 Pi #5332、OpenCode #46871/#48411、Codex #46252/#32395；区分维护者确认、用户 feature request、真实复现和推断。Grok 未获得可用的公开 issue/PR 证据，因此不把搜索空结果当成“没有问题”。 |
| 历史演变 | Pi 0.79.0 project trust、OpenCode V1/V2 与 legacy tools precedence、Grok changelog 的 always-allow/hooks/sandbox/headless 演进、Codex profile short-circuit 争议；这些历史说明权限系统是在补齐作用域和执行边界，而不是单纯增加按钮。 |

## 待验证项

- Grok `SOURCE_REV` 对应的内部 monorepo 版本不能从公开镜像完全复核；如果用户指的是 `superagent-ai/grok-cli`，需要另做一份调研。
- OpenCode V1/V2 在具体发行版中各覆盖哪些普通 session/UI 路径，需要结合实际启动入口再核对；本次只确认代码同时存在两条模型。
- Codex Guardian/auto-review 的全量配置、network proxy 的 host matching 和所有 approval error DTO 尚未展开；不影响本文关于层次分离的结论。
- 四个项目都没有给出统一的“审批决定是审计事实、是否跨设备同步”的标准；本文不把 UI transcript 或 session-local cache 推断成审计日志。
- `research` skill 要求执行 `scripts/check_note.py`，但当前工作区和已安装 skill 路径都不存在该脚本，因此无法运行自动检查；本笔记已人工对照骨架、五行来源覆盖、结论到摘录的链接和限制项完成检查。

## 对本项目的影响

当前 `jai-mono` 已经具备较好的 action policy 基础：规则树、mode、danger layer、canonical path recheck、session/project-local allow、白名单审批 DTO、pending registry 和 permission/approval telemetry 都已存在。短期不需要推翻现有 middleware。

优先级最高的结构性补强是：

1. 在 Runtime/Environment 层补出独立的 capability/sandbox/network profile，确保 `allow` 只表示应用层 action policy 通过。
2. 把 `alwaysAllow` 内部细化为带 scope、resource 和 provenance 的 grant；保留当前公开 API 作为兼容外壳，但不要继续让它承担所有持久化语义。
3. 为 shell 建立 parse/evaluate/enforce 三段 contract test，至少覆盖 chained command、wrapper、redirect、symlink、cwd 变化、opaque parse、deny-read 与 sandbox escalation。
4. 固定 headless 与 resume 契约：默认 fail closed；auto 只处理 ask；pending approval 不从 transcript 复活；resume 重新解析 profile/trust/rules/backend。
5. 将子 agent 的 capability 继承限制为 parent 的子集，并禁止自动复制 parent 的 project-local grant。
6. 继续坚持 RPC/事件白名单 DTO；审批 UI 只接收安全 summary/resource，不接收未筛选的 SDK args、stack、cause 或 provider 对象。

这些建议与现有 AGENTS.md 的 durable-fact owner、SQLite-only journal、projection 单向读取和跨进程 DTO 规则一致；它们是基于四个项目证据的设计建议，不是对产品需求的自动变更。
