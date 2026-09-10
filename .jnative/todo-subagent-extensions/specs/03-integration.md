# 03: 公开入口与整体验证

要先完成:01、02 · 状态:✅

## 交付什么
调用方能从两个官方包入口安装扩展，源码与构建产物均可消费，现有产品默认行为保持。

## 范围
做:完成包 exports、JS/声明构建、示例和调用方更新；全仓检查旧名字的核心注册残留；同步事实归属规则与过时说明。

不做:增加默认安装、产品设置页面、Artifact 扩展化和无关重构。

## 需要遵守的整体选择
遵循 [计划的方案](../plan.md#方案)：独立官方扩展、显式安装、默认关闭、删除旧路径；不改变 Artifact。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
沿用前两项确定的 owner，不新增存储或恢复路径。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”
- “`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。”
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”

## 风险
源码 alias 可掩盖发布包错误；清理旧 API 会导致下游类型失败。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] 验证两项各自安装、组合安装、均不安装，且不会重复注册。
- [x] 旧 tools 选择不再接受两项名称，核心无 Todo/Subagent 专用状态/权限分支。
- [x] 运行 plan.md 中三个 workspace 的类型检查、测试和构建；运行 coding-agent consumer 检查。
- [x] 验证两个扩展构建产物的 JS 与声明入口可用；检查默认 Host 装配未意外开启能力。
- [x] 记录 git diff --check 的真实结果；更新 AGENTS.md 中 Todo owner 与过时 API 注释。

## 决策记录
- 包消费检查发现原 SDK 的 workspace:* 私有依赖与声明引用不能供 npm 消费。私有 runtime 依赖已由现有 noExternal 打包，改放 devDependencies；SDK 的私有类型通过 dts paths 合并。Extension 依赖公开 SDK 的实际版本，锁文件同步。
- consumer 脚本现同时打包 SDK、Extension，临时 npm 安装后验证两个新子路径的类型与 Node 导入。新增子路径的声明使用 .js 相对导出，支持 NodeNext。
- Server 两项旧失败在 HEAD 独立副本复现（5 pass / 2 fail）；核验源码后仅修复测试：补现有 tool_reserved 事件，使用真正不支持的记录测试过滤路径。未改相关生产逻辑。
- Server 一次并行全套运行出现 launcher 5 秒超时；单独重跑完整套件通过，不修改超时阈值或生产代码。

## 遗留问题
无。

## 交接说明
2026-09-09 完成：

| 检查 | 最终输出 |
|---|---|
| Coding Agent 全套 bun test | 114 pass / 0 fail / 1166 expect() calls，15 files |
| 官方 Extension 全套 bun test | 68 pass / 0 fail / 281 expect() calls，14 files |
| Server 全套 bun test | 140 pass / 0 fail / 709 expect() calls，31 files |
| 三个 workspace 的 bun run typecheck | exit 0；Server 最后补齐 Connector 测试的新调用参数后再次通过 |
| SDK、Extension build | consumer prepack 用最终源码重新构建 JS / DTS，exit 0 |
| Server build | 最终源码 Bundled 1320 modules，exit 0 |
| bun run --cwd packages/coding-agent test:consumer | 两个真实 tarball 的 npm install + tsc NodeNext + Node runtime 导入，exit 0 |
| bun install --lockfile-only --ignore-scripts | Saved bun.lock，仅同步本次依赖归类与公开 SDK 版本 |
| git diff --check | exit 0 |
| 核心旧注册检索 | coding-agent/src 中 UpdateTodos、SpawnAgent、CodingAgentTodo、todosFromAppState、sessionTodosFromAppState 均无匹配 |

没有修改默认 Host extensions 装配；Artifact 实现未变。Desktop 只更新旧 SDK 类型注释，未改 UI。文档示例改为显式安装及 state.extensions 读取。所有工作已在当前工作区，未提交、未发布。

本地检查日志：/private/tmp/jai-coding-agent-full-tests.log、/private/tmp/jai-extension-full-tests.log、/private/tmp/jai-server-full-tests.log、/private/tmp/jai-consumer-check.log、/private/tmp/jai-server-build.log。
