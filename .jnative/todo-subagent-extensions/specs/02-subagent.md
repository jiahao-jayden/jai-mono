# 02: Subagent 扩展与隔离执行

要先完成:01 · 状态:✅

## 交付什么
安装 Subagent Extension 后可并行委派任务、查看活动并取得最终文本；取消后没有残留执行。

## 范围
做:先验证公开 SDK 的安全复用，必要时补最小受控执行入口；增加工具进度回调；迁移任务 schema、提示词、并发和结果规则；删除内置 SpawnAgent 注册及权限/presentation 特例。

不做:持久化子会话、worktree、多层委派、后台任务 API 与模型切换。

## 需要遵守的整体选择
遵循 [计划的方案](../plan.md#方案)：独立官方扩展、显式安装、默认关闭、删除旧路径；不改变 Artifact。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
无新增长期保存的数据；并发额度、任务与 catalog scope 是实例级内存状态。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”
- “`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。”
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”

## 风险
权限继承、共享扩展对象的会话隔离、取消清理与错误 DTO 最易回归。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 通过 SDK 验证无父历史、最终文本、活动进度、失败和无最终文本。
- [x] 验证同一实例第 5 个并发被拒绝，多个 session 的额度互不影响。
- [x] 验证子工具受原权限限制，不含 Todo/Subagent，catalog scope 独立。
- [x] 验证父取消/关闭释放子执行；事件 DTO 不带 cause/stack。
- [x] 在 coding-agent、extension 运行 bun run typecheck 和相关 bun test。

## 决策记录
公开 createCodingAgent 需要重新装配 provider/config，Extension 无法直接安全复用。增加工具调用范围的 call.runAgent，SDK 提供安全消息/错误 DTO；runtime 复用现有装配与权限。工具调用结束时取消并等待所有子执行，保存下来的能力随调用失效。扩展只在 activate 建立独立并发计数，不需要重复的 deactivate 任务清理。

子执行继续共享已装配扩展工具的调用钩子，不启动父 Extension 的会话/轮次钩子；Todo/Subagent 排除由官方扩展指定，core 无名称特例。

## 遗留问题
无。

## 交接说明
2026-09-09：coding-agent、extension 类型检查通过。迁移相关 7 个测试文件：76 pass / 0 fail / 236 assertions。覆盖 SDK 子执行、权限、并发、取消/关闭、模型失败、空输出、catalog scope、未 await 的调用清理与过期能力。
