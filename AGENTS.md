# 错误处理规则

- 可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。
- 领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。
- `Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。
- `cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。
- 旧 `CodedError` / `defineCodedError` 仅用于尚未迁移的兼容路径；新增代码不得依赖它们。

# 组件规则

1. AI类型的组件优先考虑使用https://www.assistant-ui.com/llms-full.txt
2. 其他组件优先考虑 https://www.fluidfunctionalism.com/docs/ ，如果没有需要的再调用 `/shadcn` 去查看用什么组件
3. 图标优先使用hugeicon
4. `app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。`components/ui/*` 的组件内部实现和操作系统原生控件（如 macOS traffic lights）除外，不要为了消灭原生标签而硬套通用组件。
5. Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。不要在业务组件中直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标；操作系统原生图形除外。
6. 通用组件能力不足时，优先补强共享组件或明确保留专用语义控件，不在多个业务组件中复制一套近似实现。
7. 修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。
8. `app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`；条件 class 使用 `cn` 的对象或参数形式。非样式的条件值也先在 `return` 前命名，JSX 只引用该变量。

# 函数抽取规则

- 不要仅为了“看起来模块化”提取两三行命名函数。
- 同时满足以下条件时直接内联：只有一个调用点；只是原样转发、别名或固定参数构造；没有分支、领域约束或资源生命周期；没有独立测试价值；函数名没有增加调用处无法表达的业务语义。
- 不按行数机械内联。类型守卫、事件处理器、递归、协议边界、错误 DTO 投影、领域校验及多处复用函数可以保持短小。
- 评审新增短函数时，先问“删除这个函数并内联后，是否损失复用、约束或可读性”；答案是否定的就不要提取。

# 架构与目录规则

## 事实归属

- 一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。
- Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。
- `session_project_history` 不是当前领域概念；移动 Session 只更新当前项目归属。除非先出现明确的产品查询或审计用例，不得重新引入。
- Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。

## 模块、入口与依赖方向

- 目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`；已有泛化目录在触及其领域时优先收敛为明确模块。
- 模块角色只使用：`core`（纯领域/执行语义）、`runtime`（生命周期与编排）、`adapters`（SQLite、Node、RPC、Electron、MCP 等外部实现）、`projection`（只读 DTO/UI 投影）或明确的产品领域目录（如 `sessions`、`projects`、`permissions`）。
- `main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。
- 每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。`SessionStore` 保留是因为 SQLite durable store 与 InMemory ephemeral/test store 是真实的两个 adapter；Desktop 的单一 SQLite 实现不应复制这种 seam。
- Node adapter 的导出按实际运行时依赖拆分：`@jai/agent/node/environment` 只提供 Node execution environment，`@jai/agent/node/sqlite` 才引入 SQLite durable store。调用方只能导入需要的 adapter；不得以聚合 `node` 入口把 SQLite 静态带入不需要持久化的 SDK bundle。
- 依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。
- Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。

### Desktop Electron 目录地图

- `app/desktop/electron/main.ts`、`preload.ts`、`runtime.ts` 是 Electron 入口与 composition root；`logger.ts`、`theme.ts`、`windows.ts` 是进程级系统能力。不要把新的产品领域文件继续平铺在 `electron/` 根目录。
- `agent/` 持有活跃 Coding Agent runtime、审批和 live projection；`session-catalog/` 持有 Desktop 的 Project/Session metadata 与 Journal 协调；`config/` 持有用户配置、Provider profile 与已发现模型清单。
- `connector/` 持有 Connector 的长生命周期 runtime；`model-catalog/` 持有 Models.dev cache store 与刷新生命周期；`oauth/` 持有 Connector OAuth 管理与回调 server。
- `rpc/` 持有 IPC router、验证、错误 DTO、renderer 事件广播与 RPC 生命周期内的 attachment registry；`workspace/` 持有操作系统 workspace 集成。

## 目录导航与拆分

- 每个领域目录的 `index.ts` 应让读者先知道：模块拥有的事实、对外动作、错误语义和生命周期；实现细节留在同目录的私有文件。
- `types.ts`、`errors.ts`、`sqlite.ts`、`projection.ts` 等文件必须放在其所属领域目录下；跨目录移动前先问“它拥有哪类事实或协议”。没有明确 owner 的代码不准落到根目录。
- 测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。
- 文件达到 600 行前必须评估是否同时混入多个领域或角色；800 行左右不因行数机械拆分。只有职责已混杂、接口不清或拆分能显著改善定位时，才按领域文件夹拆分；不要只把几行函数拆到同级文件来降低行数。
- 命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；`resolve*` 纯计算/选择；`project*` 内部事实到安全读取模型；`run*` 编排完整用例；`*Registry` 只索引运行中对象，不持久化领域事实。

# 编码规则
1. 不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。

2. 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。

3. 系统分层长。先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。

4. 组件保持模块化，关注点分离。

5. 优先用成熟的、有人维护的库。没有明确理由别自己重写。

6. 先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。

7. 架构决策往长了做。不接受"先这样以后再换"的临时方案。

8. 先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。

9. 单个代码文件可以达到约 800 行；是否拆分以职责边界和可导航性为准，而非行数本身。需要拆分时，尽量以文件夹进行领域级拆分，而非无意义地把内容平铺在同一个文件夹。
