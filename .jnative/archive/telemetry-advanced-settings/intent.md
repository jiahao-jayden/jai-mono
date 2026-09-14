# 需求说明: 高级设置中的观测配置

日期:2026-09-01

## 问题

JAI 已能把 Agent telemetry 导出到 Langfuse，但 Runtime Host 只在启动时读取 `JAI_TELEMETRY_*` 环境变量。Desktop 的 Settings 对话框没有观测入口，普通用户必须手工配置启动环境，且无法安全确认 endpoint 与凭据是否已配置。

用户已经要求把观测放进设置，并在 Settings 中增加一个「Advanced」分类，把它作为默认关闭的高级能力。

## 期望结果

Desktop Settings 出现「Advanced」分类，其中的 Observability 区块可以：

- 明确开启或关闭远端 telemetry，默认关闭。
- 配置 Langfuse OTLP endpoint。
- 写入或替换 Langfuse Public Key 与 Secret Key；读取时只显示已配置状态和掩码，不把原始凭据带回 renderer。
- 保存后由 Runtime Host 校验完整配置，并让后续 Operation 使用新 telemetry sink；关闭后后续 Operation 使用 no-op。
- 让用户配置持久化在 `~/.jai/settings.json`，但不让项目的 `.jai/settings.json` 或 `.jai/settings.local.json` 开启远端上报。

## 影响范围

会改到的模块:

- `packages/coding-agent` 的严格配置文件 schema 与 scope 规则。
- `app/server` 的 telemetry 配置、Runtime Host 生命周期、私有 Desktop configuration control 与安全 DTO。
- `app/desktop` 的 shared RPC、Desktop config adapter、Settings 对话框和测试。
- 用户文档中的 `settings.json` 与 Langfuse 配置说明。

长期保存的数据与维护方:

- `~/.jai/settings.json` 中的非秘密 telemetry policy（是否启用、exporter 类型、endpoint）由 Server 的用户配置 adapter 维护；它与 Coding Agent 的权限配置共用同一份严格文档，但 telemetry 只允许 user scope。
- `$JAI_HOME/data.sqlite` 中的 Langfuse key pair 由 Server telemetry 配置模块维护；它是凭据配置，不是 telemetry trace、Session journal 或任何新的观测存储。
- 不保存 span、队列、丢弃计数或导出历史；这些仍是可丢弃的运行时状态。

## 边界

- 不做通用偏好中心；本次只在现有 Settings 对话框增加 Advanced 分类和 Observability 区块。
- 不做第二个 telemetry 后端、trace 查询 UI、SQLite telemetry sink、metrics、数据集或告警。
- 不把 Langfuse key pair 写进 `settings.json`、项目配置、Desktop read DTO、日志、错误 DTO、span attribute 或 baggage。
- 不允许项目/工作区配置启用、修改或覆盖 telemetry。
- 不把 queue、batch、shutdown timeout 和本地 JSONL 路径做成第一版 UI 字段；继续使用已经验证的默认值。
- 不移除当前环境变量路径；它保留给 CLI/CI/headless 的完整覆盖配置，不能与文件配置半混合。

## 工作量

大。该功能同时改变严格配置 schema 的 scope 语义、Server 的凭据边界和 live telemetry 生命周期，并跨越 private RPC 与 Desktop Settings UI；需要拆成可独立验证的数据模型、Host 装配和界面三项工作。

## 已确认的现状

- `packages/coding-agent/src/config/store.ts` 定义 `~/.jai/settings.json`、project-shared 和 project-local 三层路径，按 schema 严格校验并支持写入 revision。
- `packages/coding-agent/src/sdk/config.ts` 的当前 schema 只允许权限字段；直接向同一文件写 `telemetry` 会让后续 Agent 创建因未知字段失败。
- `app/server/src/telemetry/local.ts` 只从 `JAI_TELEMETRY_*` 解析本地与 OTLP sink；`app/server/src/runtime/daemon.ts` 在 Host 启动时一次性装配这个 context。
- `app/server/src/config/runtime-agent-settings.ts` 已建立「原始凭据只留在 Server，Desktop 获得白名单 projection」的模式；`app/desktop/test/provider-config.test.ts` 明确禁止把 Provider secret 写入 `settings.json`。
- `app/desktop/src/components/shell/settings/provider-settings-dialog.tsx` 已有 General、Providers、Connector 三个 Settings 分类，可在不新建设置页的情况下加 Advanced。
- `.jnative/agent-telemetry/specs/05-otlp-exporter-langfuse.md` 已完成 OTLP/Langfuse exporter、零内容出境和失败隔离验收；本需求只改变配置与使用体验，不改变 telemetry 领域契约和 exporter 映射。

## 参考对象

- Pi 的 `settings.json` 用于用户显式 opt-in telemetry/analytics；JAI 借鉴「用户设置控制开关」这一点，不复用 Pi 的 exporter 实现或敏感数据治理。证据见 `.jnative/research/observability/agent-logging-observability-evidence.md`。
- Langfuse 仍是第一个 exporter 目标，使用既有 OTLP HTTP/protobuf adapter 与 Basic Auth；endpoint 与 key pair 的协议约定不变。证据见 `.jnative/research/observability/langfuse-otlp-ingestion.md`。
