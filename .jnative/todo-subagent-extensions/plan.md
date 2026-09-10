# 计划: Todo 与 Subagent 扩展化

来源:[需求说明](intent.md) · 日期:2026-09-09 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-09

已整体确认:intent.md + plan.md + todo.md + 全部 specs；实施完成情况见 todo.md。
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景
两项能力已经可用，但实现依赖内置工具名单、runtime 专用分支和 SDK 专用投影。只把工具定义换目录，无法实现独立安装和移除。

## 方案
- 新增官方 `@jai/extension/todo` 与 `@jai/extension/subagent` 入口，分别导出 createTodoExtension、createSubagentExtension；通过现有 extensions 选项安装，保留工具名称 UpdateTodos、SpawnAgent 与原参数。
- Todo 的校验、状态 schema、模型上下文与只读投影归 Todo Extension。状态写入 extensions 下的独立命名空间，成功持久化后才报告工具成功。SDK 提供通用、只读且经过 JSON 投影的 Extension 状态读取能力，删除 state.todos、CodingAgentTodo 与核心 todosFromAppState；调用方使用扩展导出的类型与读取函数。
- Subagent Extension 拥有任务参数、并发上限 4、提示词、活动进度和最终文本处理。先验证已有公开 SDK 是否能安全复用模型、工具与权限来创建子执行；若缺少安全的调用边界，再为 Coding Agent runtime 补最小通用执行能力。不要预先建立专用 Subagent 核心接口；不暴露裸 Agent、Provider、凭据或 journal 写句柄，不由 Host 重建执行与权限语义。
- 为 Extension 工具调用补上通用进度回调；子执行复用模型、执行目录、工具权限链和扩展 catalog 的独立 scope。明确选择子执行可用工具，排除 Todo 与 Subagent 工具，防止递归委派和修改父 Todo。子上下文不复制父消息，不增加子会话持久化，不启动父 Extension 的会话/轮次钩子。
- 子执行取消和清理由 runtime 负责，父调用结束、取消和关闭不得留下子任务。工具的并发计数属于每次扩展激活实例，不允许多个 session 共享计数。
- 删除内置名单、保留名称、权限放行与 presentation 中的两项专用分支，使用 Extension authorization/presentation。协调工具本身沿用现有无需额外审批的行为；子工具仍逐次走原权限与审批链，不能因委派跳过 plan/dontAsk 等限制。
- Server 使用 Todo Extension 的只读投影生成原有 ACP plan；包括实时更新、恢复和空列表清除。Host 只做装配和协议映射。更新示例与测试为显式安装；产品默认继续不安装这两个扩展。
- 同步更新 AGENTS.md 的事实归属措辞：Todo 业务语义转归官方 Todo Extension；通用 Extension state 仍由 Coding Agent 管理，Artifact 不变。

## 外部产品或规范的约定
参考 [pi-subagents 源码调研](../research/tools/pi-subagents.md)（2026-09-09，固定 SHA e955e29c51b7a6cce37e1108cd2d6c57a77e151c）：只借鉴扩展与通用 SDK 的职责分工，不遵循其默认后台、嵌套授权、恢复存储或工作流行为。该实现同进程调用 createAgentSession，且其工具限制不提供 JAI 所要求的父权限收紧保证。

不新增外部协议。保留现有 ACP plan 通知的数据格式和 Desktop 展示语义；SDK 的内置工具选择与 Todo 专用读取接口按项目规则直接移除，属于明确的破坏性变更。

## 需要先想清的事
| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 新 Todo 仅走 Extension state，旧顶层 todos 不再读取 | AGENTS.md 禁止兼容与迁移；已有 Extension state journal adapter |
| 外部产品或规范的约定 | 保留现有 ACP plan，SDK 删除旧 API；pi 只作职责划分参考 | 现有 Server 投影、项目无兼容规则与上述源码调研 |
| 用户和调用方看到的行为 | 显式 extensions 安装；默认仍关闭；已安装能力行为保持 | 现有默认工具名单与本次扩展化目标 |
| 权限与安全 | runtime 保留受控执行能力；扩展声明协调工具授权，子工具原权限不变 | 现有共享 permission middleware 与 Extension authorization |
| 运行环境和依赖 | 使用现有包与构建工具，不增运行服务和依赖 | 两个包已有 TypeBox、better-result 与测试脚本 |
| 同时操作和失败重试 | 每个扩展实例最多 4 个子任务，超限报错；不自动重试；Todo 串行更新 | 当前 SpawnAgent 与 UpdateTodos 行为 |

以上是供整套计划确认的方案选择，无需额外分轮提问。

## 已确认的关键选择
用户明确要求 Todo、Subagent 都变成 Extension。用户于 2026-09-09 回复开始实现，确认本计划及调研后的调整。

## 没选的路
- 只移动工具文件：runtime 和 SDK 仍拥有业务规则，不能独立移除。
- Extension 自己复制 Provider/配置/权限装配或交给 Host 创建子 Agent：重复执行语义，容易绕过权限或形成循环依赖。
- 同时保留 tools 选择与 extensions 安装：形成双注册路径，违反无兼容要求。
- 扩展默认自动安装：改变目前的默认能力，与迁移本身无关。
- 扩大为通用任务系统：当前只需要一次委派并等待最终结果。

## 风险
- 最危险的是子执行入口：工具继承、取消、权限或 catalog scope 缺失会造成权限绕过、递归或资源泄漏；必须用真实 SDK 流程验证。
- Todo 状态路径改变可能使 ACP 恢复或清空失效；旧 Todo 数据将不显示，这是删除旧路径的直接结果，不能偷偷回退。
- Extension 对象可能被多个 Agent 复用，并发额度和生命周期必须按 session 隔离。
- 删除 SDK Todo API 会影响下游编译；仓库调用点、类型注释和示例必须同步更新。
- 打包需同时验证 JS 与声明文件，不能只证明源码模式可导入。
- 现有子工具错误可能带入内部原因；新增边界只输出安全 DTO，未知故障不能一概包装成领域 Err。

## 必须遵守的项目规则
以下原文摘自根目录 AGENTS.md：
- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”
- “`Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。”
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”
- “Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。”
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”
- “先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。”
- “不要仅为了‘看起来模块化’提取两三行命名函数。”（引号样式不同，正文要求不变。）
- 测试须通过 public interface；新增目录按领域组织；不为单一实现新增 interface/factory/strategy。
- 事实归属原文中的“Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`”与本次迁移发生变化，实施时按上方方案同步修正文档，不能一边移动 owner 一边保留矛盾规则。

## 要运行的检查
从当前各 workspace package.json 的 scripts 确认，在对应目录执行：
| workspace | 命令 |
|---|---|
| packages/coding-agent | bun run typecheck；bun test；bun run build；bun run test:consumer |
| packages/extension | bun run typecheck；bun test；bun run build |
| app/server | bun run typecheck；bun test；bun run build |

逐项跑相关测试，收尾跑上述受影响 workspace 检查。构建先 coding-agent，再 extension，再 server。若正式修改 Desktop UI，另查其脚本运行 TypeScript、相关测试和 Shell 原生按钮/图标自查；目前不计划改 UI。

## 为什么这样拆分
第 1 项先完成 Todo 从注册到 ACP 展示的完整迁移；第 2 项完成 Subagent 执行边界与扩展迁移，避免一次混合两类状态与生命周期问题；第 3 项清理所有残留接口并验证打包消费。每项均带自己的行为测试，收尾不替代前两项验证。
