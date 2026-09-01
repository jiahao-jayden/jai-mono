# 01: 用户 telemetry policy 与凭据边界

要先完成:无 · 状态:✅

## 交付什么

JAI 能在 `~/.jai/settings.json` 严格保存且读取一份非秘密 telemetry policy；project settings 试图包含该配置会明确失败。Langfuse key pair 有 Server-only 持久化 owner，任何读取模型只显示配置状态与掩码。

## 范围

做:

- 扩展共享 settings document schema，让 `telemetry` 与既有权限字段可以共存，且未配置时保持 no-op。
- 在配置字段规则中表达并执行「只允许 user scope」；project shared/local 文件出现 telemetry 时 fail closed。
- 定义 telemetry policy 的严格 shape、默认值、revision 读取/写入和环境 override 状态投影；不在 Agent runtime 中解释 policy。
- 在 Server telemetry 领域建立 key pair credential adapter，拥有校验、替换、清除、mask projection 和稳定 `TaggedError`。
- 为 policy scope、JSON schema、credentials 与秘密不出 read DTO 写定向测试。

不做:

- 不创建或装配 exporter。
- 不改 Desktop UI 或 public/private RPC method。
- 不把 key pair 引入 Coding Agent config snapshot、Extension configuration 或 project 文件。

## 需要遵守的整体选择

- 同一文件中 telemetry 只是一份由 Host 解释的 user policy；Coding Agent 仅承认字段以维持严格文档。见 [计划方案](../plan.md#方案)。
- Public Key 与 Secret Key 都是 Server-only credential。见 [计划已确认的关键选择](../plan.md#已确认的关键选择)。
- project telemetry 配置必须报错，不能静默忽略。见 [计划方案](../plan.md#方案)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

- `~/.jai/settings.json` 的 telemetry policy；Server 用户配置 adapter 维护其中的 telemetry subtree，保留同文件的权限配置。
- `$JAI_HOME/data.sqlite` 的 Langfuse key pair；Server telemetry credential adapter 维护。
- 不新增 telemetry trace/journal 表。

## 必须遵守的项目规则

- 「一类 durable fact 只能有一个 owner。」（`AGENTS.md`，事实归属）
- 「RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- 在共享文件里漏掉 schema/validation 任一端，都会导致 Agent 创建失败或允许不可信项目开启远端上传。
- 直接复用 Provider projection 容易把 telemetry credential 和 Provider 领域耦合；credential owner 必须在 telemetry 领域。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] user `settings.json` 含 telemetry 与权限配置时可被严格读取；缺省时保持 no-op policy。
- [ ] project shared/local 的 telemetry 配置被拒绝，trusted/untrusted 都不能参与。
- [ ] Langfuse key pair 可替换和清除，安全 projection 不含任一原文。
- [ ] `cd packages/coding-agent && bun run typecheck && bun test`
- [ ] `cd app/server && bun run typecheck && bun test test/telemetry/local.test.ts test/config/runtime-agent-settings.test.ts`
- [ ] `bunx biome check <实际改动路径>`

## 决策记录
<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- 配置基础设施新增 `project: "never"`，在每个 project document 的严格校验阶段报错；没有把它实现成 untrusted 时忽略的 merge 规则，避免 trusted workspace 绕过 user-only 边界。
- `UserTelemetryPolicyStore` 复用 shared document 的 `CodingConfigStore`，只读取和覆盖 user scope 的 telemetry subtree；该 store 不调用 merge 后的 Agent config，也不解释 permission settings。
- credential table 使用独立 `telemetry_langfuse_credentials` row，并将 revision 与 key pair 一起替换。read-safe snapshot 仅含 `configured`、revision 与最后四位掩码；raw pair 只由 `readForExporter` 留在 Server 内部使用。

## 遗留问题
<!-- 发现但本次不做的 -->

## 交接说明
<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

已完成 shared settings telemetry schema、project fail-closed rule、Server telemetry policy store 与 SQLite Langfuse credential owner。下一项应在 `app/server/src/telemetry/` 继续建立 live controller；不要把 exporter policy/credentials 合并进 `RuntimeAgentSettings` 或 Provider DTO。

## 完成前检查结果

- ✅ `cd packages/coding-agent && bun run typecheck && bun test`
  - 通过：121 tests / 1180 assertions。
- ✅ `cd app/server && bun test test/telemetry/local.test.ts test/telemetry/credentials.test.ts test/telemetry/user-policy.test.ts test/config/runtime-agent-settings.test.ts`
  - 通过：14 tests / 53 assertions。
- ✅ `bunx biome check`（本项 12 个实际改动路径）
  - 通过。
- ⚠️ `cd app/server && bun run typecheck`
  - 未通过，原因是现有 `@jai/extension/agent-plugins`、`connector`、`mcp`、`search`、`skills` declaration 无法解析，并连带使既有 `test/agents/agent-plugins.test.ts:46` 出现 implicit `any`。Coding Agent build 后 telemetry import 已不再报错；该 workspace build 前置问题不属于本项。
