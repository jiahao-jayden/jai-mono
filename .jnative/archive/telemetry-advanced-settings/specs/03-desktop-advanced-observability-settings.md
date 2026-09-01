# 03: Desktop Advanced Observability 设置

要先完成:02 · 状态:🔄

## 交付什么

Desktop Settings 出现 Advanced 分类。用户可以在 Observability 区块启用 Langfuse telemetry、填写 endpoint 和替换 key pair，看到配置状态、掩码、环境覆盖与可理解的保存错误；保存后后续 Agent run 采用新设置。

## 范围

做:

- 在现有 Settings 对话框增加 Advanced 导航项与 Observability 内容，不新建第二个设置页面。
- 使用共享 UI 组件实现 enable toggle、URL 输入、secret inputs、状态、清除凭据和 loading/disabled/error 状态；图标全部经 `useIcon` / `useIcons`。
- 扩展 Desktop shared DTO、preload/RPC router、Desktop config adapter 和 query cache，使用 02 的 telemetry control。
- environment override 时显示只读原因，不允许提交不会生效的本地修改。
- 更新用户文档，解释 user `settings.json` policy、Desktop key pair、默认关闭、project scope 禁止和 headless environment override。
- 添加 renderer/router/config service 的测试，以及 Desktop UI 规则自查。

不做:

- 不让 UI 展示 trace、事件内容、队列统计或任何 secret reveal。
- 不把 local file/stderr、batch/queue/timeout 做成表单字段。
- 不接 Langfuse 专有 SDK，或提供第二个 exporter 后端。

## 需要遵守的整体选择

- Advanced 是既有 Settings 对话框中的一个分类，第一版只装 Observability。见 [计划已确认的关键选择](../plan.md#已确认的关键选择)。
- Settings read model 永远不带 Langfuse key 原文。见 [计划方案](../plan.md#方案)。
- 用户 policy 来自 user settings；project documents 无权控制这一区块。见 [计划方案](../plan.md#方案)。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

本项不直接读写文件或 SQLite；Renderer 只提交 02 定义的 safe command，Server 维护 policy 与 credentials。UI state、query cache 和 form draft 都是可丢弃的内存状态。

## 必须遵守的项目规则

- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标。」（`AGENTS.md`，组件规则）
- 「已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。」（`AGENTS.md`，组件规则）
- 「`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。」（`AGENTS.md`，组件规则）
- 「RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。」（`AGENTS.md`，错误处理规则）

## 风险

- secret input 很容易因 query cache、error message 或 form reset 重新泄漏；只存短暂 draft，不将输入写入 snapshot。
- 一张高级表单混入 Provider save DTO 会扩大写面并让 revision 冲突难以解释；保持 telemetry 独立 RPC。
- UI 必须说明环境 override，而不是让用户误以为本地保存已经生效。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] Settings 可导航到 Advanced，Observability 默认关闭且无 key 原文出现在初始 UI/query data。
- [ ] 有效输入可保存、替换和清除；无效 endpoint 与不完整 key pair 在提交前/Host 响应中得到可理解错误。
- [ ] environment override 时表单只读并说明原因。
- [ ] Shell 中无新增无合理例外的原生 `<button>` 或直接图标库 import。
- [ ] `cd app/desktop && bun run typecheck && bun test test/provider-config.test.ts test/desktop-router.test.ts <新增设置测试>`
- [ ] `bunx biome check <实际改动路径>`

## 决策记录
<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

- 新增独立 `telemetry.get/save` DTO、query key 与 mutation，不混入 Provider save DTO；Telemetry save 不使 Agent sessions invalid。
- renderer IPC 和 Desktop config adapter 都执行 explicit whitelist validation。key 只存在于短暂 form draft 与单次 write command，query snapshot 只保留 configured/mask 状态。
- Settings 的 Advanced 分类只呈现 Observability；检测到环境覆盖时表单只读，避免让本机保存制造“已生效”的误解。

## 遗留问题
<!-- 发现但本次不做的 -->

## 交接说明
<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->

代码、定向测试、类型检查、Biome 与用户文档均已完成。还没有完成 Electron 手工视觉检查：尝试启动 Forge 时 sandbox 拒绝 Vite 绑定 `::1:5173`；请求本地端口权限后的启动被用户中断。不要重试该启动，除非用户明确允许。

## 完成前检查结果

- ✅ Advanced sidebar、Observability form、默认关闭、key mask、清除、error/loading 与 environment override read-only 都已接入共享 DTO。
- ✅ `DesktopConfigService` 测试验证 key 只通过 write command 发送、read projection 无 raw key、非法字段不会到达 Host、environment override 不读取 key。
- ✅ router 测试验证 `telemetry.save` 委托配置服务且不调用 `agentHost.invalidateSessions()`；IPC 拒绝 DTO 外字段。
- ✅ Shell 中本项没有新增原生 `<button>` 或业务组件直接图标库 import；图标经过 `useIcon` / `useIcons`。
- ✅ `cd app/desktop && bun run typecheck && bun test test/provider-config.test.ts test/desktop-router.test.ts`
  - 通过：28 tests / 83 assertions；typecheck 通过。
- ✅ `bunx biome check`（本项 Desktop 改动路径）通过。
- ✅ `cd app/docs && bun run validate`
  - 通过：严格链接校验。
- ⬜ Electron 手工视觉检查尚未运行，原因见交接说明。
