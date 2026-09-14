# 计划: 高级设置中的观测配置

来源:[需求说明](./intent.md) · 日期:2026-09-01 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-01

## 背景

Telemetry 的领域契约、local sink 和 Langfuse OTLP exporter 已经完成且默认关闭。当前唯一的启用入口是 Runtime Host 启动环境；这对 Desktop 用户不可发现，也无法提供与 Provider key 相同的受控凭据输入。

JAI 已有两个正确但不同的配置边界：Coding Agent file configuration 负责 user/project 规则，Runtime Agent settings 负责 Server-side Provider 与 Connector secret。观测需要复用两者，而不是把秘密塞进共享文件或把 project configuration 当成全局 Host policy。

## 方案

1. **在同一份 settings document 中预留一个 user-only telemetry policy。** `~/.jai/settings.json` 只保存 `telemetry.enabled`、Langfuse exporter 标识和 endpoint。配置基础设施新增「禁止 project scope」规则：project shared/local 文件包含 telemetry 即报配置错误，不能以 workspace trust 为条件放宽。Coding Agent 只保留 telemetry 这个顶层字段和 scope 边界；Server telemetry owner 严格解析其内部内容，因此 telemetry 写错不会阻止 Agent 运行，且 Desktop 仍可读到 revision 后覆盖修复。

2. **Langfuse key pair 由 Server 单独持有。** 在 Server telemetry 模块建立独立的 SQLite credential adapter，保存 Public Key 与 Secret Key，提供替换、清除和掩码 projection。Desktop 可以把新值写入，但普通读取没有 reveal API，任何 DTO、error、日志与 span 都没有原始 key。

3. **Runtime Host 持有可热替换的 telemetry context。** Coding Agent operation driver 获得稳定的 delegating `TelemetryContext`；Server 成功保存高级设置后，先验证 policy 与 credential pair，再构造并原子切换 sink。已开始的 span 归属于原 generation，结束后再关闭旧 exporter；配置错误绝不替换当前 context。这样设置立即影响后续 Operation，不需要通过杀进程重启 Host，也不影响 Agent/Journal 语义。

4. **环境变量保持完整、显式的 Host override。** 任何 `JAI_TELEMETRY_*` 出现时，Host 只使用环境变量形成一份完整 telemetry 配置，既不与 settings policy 拼接，也不读取文件凭据来补全。Desktop Advanced 显示「由环境变量控制」并禁用写入，避免保存了却不生效。

5. **复用现有 Settings 对话框与 private control channel。** 增加 Advanced 分类和 Observability 区块，包含启用开关、endpoint、Public Key、Secret Key、已配置掩码、清除凭据和受控错误状态。它使用现有 `components/ui/*`、`useIcon` 与共享 DTO；不让 renderer 读文件或 SQLite，也不把 telemetry 混进 Provider 配置 API。

## 外部产品或规范的约定

- **Langfuse:** 继续使用现有 `@jai/telemetry-otlp` OTLP HTTP/protobuf adapter；endpoint 仍是 Langfuse 的 `/api/public/otel` base endpoint，key pair 走 HTTP Basic Auth，header `x-langfuse-ingestion-version: 4` 由 adapter 发送。配置 UI 不改变 span 映射、内容投影或认证协议。详见[现有调研](../../research/observability/langfuse-otlp-ingestion.md)。
- **Pi:** 只参考用户从 settings opt-in telemetry 的产品形状；JAI 不引入 Pi 的 `sensitive` 标记式治理。详见[现有调研](../../research/observability/agent-logging-observability-evidence.md)。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | user policy 留在 `~/.jai/settings.json`；key pair 留在 Server SQLite；两者有独立 owner。span/队列/导出记录不落库。现有 settings 文件可继续使用：新增字段可选，未配置保持 no-op。 | 需求边界；`AGENTS.md` 的事实归属；现有 Provider credential 模式。 |
| 外部产品或规范的约定 | Langfuse ingestion、OTLP/protobuf 与 Basic Auth 不变；Pi 仅作 settings opt-in 参考。 | 已完成的 telemetry Spec 05 与两份调研。 |
| 用户和调用方看到的行为 | Settings 增加 Advanced；默认关闭；保存生效于后续 Operation；环境 override 时 UI 只读。无新 CLI 命令、无 project telemetry 配置。 | 用户明确要求；当前 Runtime Host 是唯一 exporter 装配点。 |
| 权限与安全 | project scope 必须 fail closed；key pair 不进文件/renderer/read DTO；配置无效时保留上一个有效 exporter。 | `AGENTS.md` 的 error/DTO 规则；现有 Desktop config service。 |
| 运行环境和依赖 | 不加 Langfuse SDK、Keychain 或第二个 telemetry package；复用 `@jai/telemetry-otlp` 和现有 SQLite/TypeBox/Better Result。 | 既有依赖与已通过的 exporter 验收。 |
| 同时操作和失败重试 | optimistic revision 分别保护 user policy 文件与 credential update；controller 原子换 generation，旧 span 收尾后关闭旧 sink。保存不会中断 Agent、不会把 exporter 失败传播给业务。 | `CodingConfigStore` revision；telemetry 的 best-effort 不变量。 |

## 已确认的关键选择

- Advanced 只包含 Observability，不扩展成通用设置页。
- 第一版只支持 Langfuse，endpoint 与开关可见；吞吐调参和 local JSONL 不进 UI。
- `settings.json` 只放非秘密 policy；Public Key 与 Secret Key 都按 credential 对待，由 Server SQLite 持有。
- 配置只允许 user scope；project 文档出现 telemetry 直接报错。
- 当前 `JAI_TELEMETRY_*` 保留为完整环境覆盖；不设计文件/environment 的字段级混合优先级。
- UI 保存后通过 live context 影响后续 Operation，不以 SIGKILL 或 Desktop 重启作为配置生效手段。
- telemetry-only 配置错误、缺失 key pair 或不完整环境覆盖只能让 telemetry 退回 no-op 并显示安全错误，不能阻止 Runtime Host 启动或影响 Agent 结果。

## 没选的路

- **把 key pair 直接写进 `settings.json`:** 配置路径最短，但会让 Coding Agent 的文件读取范围包含凭据，也违背 Desktop 已建立的「秘密由 Server 投影」边界。
- **把 telemetry 全塞进 `RuntimeAgentSettings`:** 能复用现有 SQLite DTO，却不满足用户希望通过 `settings.json` 管理 policy 的要求，也会让全局 Host policy 与 Provider 选择混为一个领域。
- **让 trusted project 配置 telemetry:** 即使项目可信，也不应由代码仓库决定用户行为何时出站到远端服务。
- **保存后杀掉 Host 再重启:** 当前 launcher 通过强制终止处理 stale host，复用它会丢在途 exporter 队列并中断活动会话。
- **第一版展示 queue/batch/timeouts:** 这些不是用户完成 Langfuse 接入所需的选择，暴露它们会增加无效组合与支持成本。
- **让环境变量与文件字段逐项合并:** endpoint、key pair 与启用状态半来自文件半来自环境，诊断和安全边界都会不清楚；改为完整覆盖。

## 风险

- 共享 `settings.json` 的严格 schema 若没有同时承认 telemetry，Agent 创建会直接失败；若放宽为未知字段静默忽略，又会失去 fail-closed 行为。
- user policy 文件与 SQLite credential 是两份不同事实，保存顺序必须保证失败时不会把一个不完整的配置切入 live exporter。
- hot swap 必须避免在已开始 span 中途关闭其 exporter；即使 exporter 失败，Agent 与 Session journal 的行为仍须不变。
- Desktop read model、RPC parser、日志和 `TaggedError` 不能泄漏 key；错误只说明字段/状态，不回显输入。
- repository 现有 Server 全量测试受当前 Bun `node:sqlite` 能力限制；本项需以受影响的定向测试和类型检查为完成条件，并记录真实输出。

## 必须遵守的项目规则

- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「一类 durable fact 只能有一个 owner。」以及「Projection 是单向读取模型。」（`AGENTS.md`，事实归属）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名。」和「composition root 只负责装配与生命周期。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标。」以及「修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。」（`AGENTS.md`，组件规则）
- 「不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 要运行的检查

| workspace | 命令 |
|---|---|
| `packages/coding-agent` | `bun run typecheck`；`bun test` |
| `app/server` | `bun run typecheck`；定向 `bun test test/telemetry/local.test.ts test/config/runtime-agent-settings.test.ts test/protocol/desktop-configuration/control.test.ts`；`bun run build` |
| `app/desktop` | `bun run typecheck`；定向 `bun test test/provider-config.test.ts test/desktop-router.test.ts`；补充 Advanced 设置组件测试后运行该测试文件 |
| 本次改动路径 | `bunx biome check <实际改动路径>` |

## 为什么这样拆分

01 先让同一份 settings 文档能安全表达 user-only policy，并建立 credential 的 Server owner；否则后续 RPC 和 UI 没有可靠的数据边界。02 依赖 01，把两个长期配置事实解析成 live context 并通过私有 control 更新，验证不影响运行行为。03 最后接到 Desktop，界面只消费已完成的安全 DTO，避免 renderer 反过来定义持久化或 Host 生命周期。
