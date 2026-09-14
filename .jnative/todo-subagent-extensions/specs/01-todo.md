# 01: Todo 扩展与读取链路

要先完成:无 · 状态:✅

## 交付什么
安装 Todo Extension 后可更新、恢复和清空计划；未安装时无工具或提示注入。

## 范围
做:迁移校验、schema、上下文钩子、状态持久化与投影；提供通用 Extension 状态只读访问；删除 SDK Todo 专用读取；同步 Server ACP 调用。

不做:Subagent、Artifact、Desktop UI 重设计。

## 需要遵守的整体选择
遵循 [计划的方案](../plan.md#方案)：独立官方扩展、显式安装、默认关闭、删除旧路径；不改变 Artifact。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
Todo Extension 维护业务状态，Coding Agent Extension state adapter 写入 Agent journal；不读旧顶层 todos。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”
- “`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。”
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”

## 风险
持久化失败不能发布成功；ACP 恢复与空列表更新不能丢失。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 验证未安装/已安装工具列表；重复 ID、空内容、多项进行中仍拒绝。
- [x] 通过 SDK 验证写入失败、成功后恢复、beforeModelCall 上下文与清空。
- [x] 验证 ACP 实时计划、恢复和清空，读取投影不写回状态。
- [x] 在 coding-agent、extension、server 运行 bun run typecheck 和相关 bun test。

## 决策记录
SDK state.extensions 提供 JSON 快照；Todo 扩展导出白名单投影。状态缺失与已清空区分为 undefined / items:[]，ACP 可正确发出清空通知。

## 遗留问题
无。

## 交接说明
2026-09-09：coding-agent、extension、server 类型检查通过。Todo SDK 3 tests / 20 assertions 通过；ACP 18 tests / 45 assertions 通过，包含恢复及清空；runtime/tools 原有测试通过。SDK 模拟服务测试因沙箱监听限制在批准后于沙箱外运行。
