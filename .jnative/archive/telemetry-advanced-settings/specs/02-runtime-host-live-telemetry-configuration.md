# 02: Runtime Host live telemetry 配置

要先完成:01 · 状态:✅

## 交付什么

Runtime Host 启动时从 user policy 与 Server credential 装配 telemetry；Desktop 保存有效设置后，后续 Operation 立即使用新 exporter 或 no-op，而不会杀掉 Host、打断 Agent 或改变 Journal 行为。

## 范围

做:

- 建立 Server-owned telemetry configuration service，读取 01 的 policy 与 credentials，统一校验 Langfuse endpoint/key pair 和环境完整 override。
- 提供稳定、可委托的 `TelemetryContext` 给 Coding Agent driver；以 generation 管理 sink 切换和旧 exporter 关闭。
- 配置写入先完整验证，再原子替换 live context；失败保持上一份有效 context。
- 扩展 private Desktop configuration control/client，提供 telemetry snapshot 与 save command；DTO 只含 endpoint、enabled、override 状态与 key 的配置/掩码状态。
- 环境 telemetry override 存在时，将 Desktop snapshot 标为只读，不读取/拼接文件 credentials。
- 为 Host 启动、enable/disable、无效配置、active generation close、environment override 和 failure isolation 加定向测试。

不做:

- 不改变 `@jai/telemetry` contract、OTLP mapping、Langfuse transport 或内容治理。
- 不新增 CLI 子命令、重启 endpoint 或通过强制停止 Host 让设置生效。
- 不做 Desktop form 或文档。

## 需要遵守的整体选择

- Settings mutation 只影响后续 Operation；Agent/Journal 与用户结果不因 exporter 错误改变。见 [计划方案](../plan.md#方案)。
- 环境变量是完整覆盖，不能字段级混合。见 [计划已确认的关键选择](../plan.md#已确认的关键选择)。
- configuration error 不得回显 key，且不能替换正在工作的 context。见 [计划风险](../plan.md#风险)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

读取并更新 01 定义的 user policy 与 Server credential。controller 的 current context、generation、active span 计数、queue 与丢弃计数都是可丢弃的内存状态，不写新的 journal 或 trace store。

## 必须遵守的项目规则

- 「composition root 只负责装配与生命周期；不得承载领域规则、SQL、UI 投影或协议实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「adapter 依赖 contract 但不携带宿主业务规则。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Panic 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 Err。」（`AGENTS.md`，错误处理规则）
- 「Projection 是单向读取模型。」（`AGENTS.md`，事实归属）

## 风险

- 若切换时直接 shutdown 当前 exporter，未结束 span 可能丢失或触发观测内部错误；generation 生命周期必须隔离。
- save 的两个 durable owner 发生局部失败时，不能让不完整 policy 成为 live 配置。
- private RPC 的 parser 若过宽，会让 renderer 注入未白名单的存储字段。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 未配置 policy/credential 时 Host 维持 no-op；有效 Langfuse 配置为后续 Operation 装配 OTLP。
- [ ] enable、disable 与替换 endpoint/key pair 的配置切换不改变正在运行 Agent 的结果；旧 exporter 收尾后关闭。
- [ ] 无效输入、导出失败和环境 override 不泄漏 key，且不替换有效 context。
- [ ] telemetry get/save 私有 control 只接受白名单 DTO，响应没有 key 原文。
- [ ] `cd app/server && bun run typecheck && bun test test/telemetry/local.test.ts test/protocol/desktop-configuration/control.test.ts && bun run build`
- [ ] `bunx biome check <实际改动路径>`

## 决策记录
<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- RuntimeTelemetryController 的稳定 delegating context 以 generation 保存 active span；保存成功才切换 generation，旧 generation 在最后一个 span 结束后关闭。
- 初始化或读取到 telemetry-only 配置错误时，controller 保留 no-op context 并通过 safe `configurationError` projection 报告；不把这类错误升级为 Runtime Host 启动失败。
- `JAI_TELEMETRY_*` 只要出现任一变量即标记完整环境覆盖。环境不完整时同样停用 telemetry 并显示错误，Desktop 不读取或合并本机 policy/credentials。

## 遗留问题
<!-- 发现但本次不做的 -->

## 交接说明
<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

已完成 Runtime Host live controller、private Desktop telemetry control/client 和 failure isolation。下一项只接 Desktop UI 与用户文档，不要让 renderer 获取 key 原文，也不要让 telemetry save 调用 `agentHost.invalidateSessions()`。

## 完成前检查结果

- ✅ 未配置时为 no-op；保存有效 Langfuse 设置会为后续 Operation 装配 exporter。
- ✅ enable/disable/replacement 使用 generation 切换；旧 exporter 等 active span 收尾后关闭。
- ✅ 无效保存不替换 active context；持久化 policy、credentials 或环境配置有错时 Host 保持可用并退回 no-op。
- ✅ private get/save 只接受白名单 DTO，snapshot 只返回 mask/status，不包含 key 原文。
- ✅ `cd app/server && bun run typecheck && bun test test/telemetry/user-policy.test.ts test/telemetry/runtime-controller.test.ts test/runtime/daemon.test.ts test/protocol/desktop-configuration/control.test.ts test/protocol/desktop-configuration/client.test.ts && bun run build`
  - 通过：21 tests / 64 assertions；typecheck 与 build 通过。
- ✅ `bunx biome check`（本项 telemetry/runtime/control 改动路径）通过。
