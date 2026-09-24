# 核心工程原则

1. 架构与领域优先：计划阶段以理想架构为目标，明确业务目标、领域边界、模块职责、依赖方向和数据流，形成符合领域规律、面向长期维护且可持续演进的设计后再进入编码。不得以短期实现便利牺牲整体设计。设计必须完整，实现应当克制：不做推测性抽象，抽象延迟到第二个真实用例出现时才引入，单一场景直接实现。
2. 追求优雅的代码模块：模块应高内聚、低耦合，通过精简且稳定的接口封装内部复杂度，使职责、命名、依赖和扩展方式清晰自然。代码按单一职责拆分，单个文件原则上不超过 800 行；接近上限时优先评估职责和模块边界，只有确实混入多个领域或角色时才拆分。
3. 保持边界与数据流清晰：协议模型、领域模型、持久化模型和视图模型不得相互泄漏。数据必须在边界处完成校验和独立转换，避免跨层共享可变状态。
4. 安全与隔离默认开启：所有功能均按多租户、多用户场景设计，明确认证、授权和数据隔离边界。遵循最小权限原则，任何外部输入均视为不可信，敏感信息不得进入代码、日志或响应。
5. 面向并发与故障设计：后端应主动考虑幂等性、竞态、事务边界、超时、取消、重试、背压和资源释放。不得通过无边界重试、吞错或隐式共享状态掩盖问题。
6. 保障完整前端体验：前端应控制渲染成本、异步状态和并发请求，保持清晰的 UI 结构。用户流程必须覆盖加载、空状态、错误、重试、反馈和可访问性。
7. 复用稳定业务语义：优先复用已有模块和能力，但不要仅因代码外形相似而过早抽象。确需重复时，必须注释说明其独立演进或暂不抽象的原因。新增依赖前先核查根 `package.json` 和 `app/*`、`packages/*` workspace 的已有依赖能否满足需求；先查阅文档和类型定义，不得臆断已有库缺少功能。确需引入时优先成熟且维护良好的库，不重复实现通用功能。
8. 为未来维护者保留上下文：代码、注释、测试和架构文档是跨越时间的协作媒介。非显然的设计决策、兼容约束、已知缺陷和临时方案，必须记录原因、影响范围、潜在风险及移除条件。技术债务应关联可追踪任务，关键架构决策应同步到 ADR，禁止留下缺少上下文的 TODO。
9. 确保变更可验证、可观测、可回滚：每项改动都应行为可测试、运行状态可观测、故障可定位，并评估对外契约的向后兼容要求和回滚路径。错误与日志必须保留诊断上下文，但不得泄露敏感信息；内部实现的删除规则见下一条。
10. 删除优于兼容：内部路径重构时直接删除过时实现，禁止新增兼容层、deprecated shim、fallback 或双写逻辑。对外契约（如 `/api/*` 等稳定接口、数据库迁移）的兼容性按协议契约单独评估，属于合同义务。

# 常用命令

- 运行时与包管理用 bun。
- 根目录：`bun run lint`（`biome check .`，含 `plugins/*.grit` 自定义规则）、`bun run lint:fix`。
- 各包目录内：`bun run typecheck`、`bun test`。E2E 需显式开启：`app/cli` 用 `CLI_E2E=1`，`packages/ai` 用 `bun run test:e2e`。
- 改动后至少跑受影响包的 typecheck 与测试，以及根目录 lint。

# 仓库地图

- `packages/ai`：Provider 无关的模型流式层。
- `packages/agent`：Agent loop、Session journal、Operation journal 与 harness 恢复语义；`SessionStore` contract 与 InMemory store。
- `packages/coding-agent`：Coding Agent 公共 SDK，持有工具、权限、配置、Artifact 与 Extension state 语义。
- `packages/extension`：官方扩展（todo、subagent、skills、MCP、web-search、connector 等）。
- `packages/telemetry`：零依赖 telemetry contract 与内存测试 adapter。
- `app/server`：Runtime Host 与 ACP v2 Agent adapter；唯一持有 `$JAI_HOME/data.sqlite`、Desktop Catalog、运行时配置与 workspace trust。
- `app/desktop`：Electron 桌面端，通过 `@jai/server` 的 client 入口连接 Runtime Host。
- `app/cli`：命令行宿主，同样是 Runtime Host 的 ACP client。
- `app/connector`、`app/oauth-gateway`：Connector adapter 与无状态 OAuth Gateway。
- `app/frontier-smoke`、`app/docs`：冒烟评测与文档站。

# 架构与目录规则

## 事实归属

- 一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo 的业务语义属于 `@jai/extension/todo`；Artifact 与通用 Extension state 的业务语义属于 `@jai/coding-agent`；项目、会话标题与项目归属属于 `app/server` 的 Desktop Catalog；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。
- Durable 存储只有一个 SQLite：`app/server` 打开 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`），数据目录只由 `resolveJaiDataDirectory` 决定。Desktop、CLI 不得自行打开该数据库或推导第二个 durable 路径；不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。
- Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state 或 catalog metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。
- Operation journal 由 `@jai/agent` operations 持有，是 durable execution fact；动态工具 capability 与 opaque `toolRef` 属于 Coding Agent 的 operation 级 ephemeral state，恢复时不得从废弃分支复活；Desktop transcript 只是 renderer projection，可丢弃并从当前 Session projection 重建。
- Harness 的四条状态轴必须保持分离：`OperationTerminalOutcome` 是 durable 终态，`OperationRecoveryVerdict.status` 是 reducer 输出，`RuntimeForegroundState` 是当前 Session 前台状态，`RuntimeStopReason` 是对外停止原因。新增状态必须归入现有轴，不能再造第五条轴。

## 模块、入口与依赖方向

- 目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`；已有泛化目录在触及其领域时优先收敛为明确模块。
- 模块角色只使用：`core`（纯领域/执行语义）、`runtime`（生命周期与编排）、`adapters`（SQLite、Node、RPC、Electron、MCP 等外部实现）、`projection`（只读 DTO/UI 投影）或明确的产品领域目录（如 `sessions`、`projects`、`permissions`）。
- `main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。它们不得承载领域规则、SQL、UI 投影或协议实现。
- 每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。`SessionStore` 保留是因为存在真实的多个 adapter（`app/server` 的 SQLite store 与 `@jai/agent` 的 InMemory store）。
- `@jai/agent` 只导出 `.`、`./core`、`./node/environment`；SQLite 不进入 SDK 包。不得以聚合 `node` 入口把宿主依赖静态带入 SDK bundle。
- 依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron、`@jai/server` 或 Agent 内部实现。
- Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配，只通过 `@jai/server` 的 `acp-client`、`desktop-catalog-client`、`desktop-configuration-client` 等 client 入口访问 Runtime Host；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。

### Desktop Electron 目录地图

- `main.ts`、`preload.ts`、`runtime.ts` 是入口与 composition root；`logger.ts`、`theme.ts`、`windows.ts`、`locale.ts`、`context-menu.ts` 是进程级系统能力。不要把新的产品领域文件继续平铺在 `electron/` 根目录。
- `runtime-host/`：启动、监管与停止 Runtime Host 子进程。
- `agent/`：ACP host 连接、Artifact 读取与 agent 侧错误映射。
- `session-catalog/`：通过 Desktop Catalog client 访问 Project/Session metadata。
- `config/`：通过 Desktop Configuration client 读写 Provider、Connector、web-search、telemetry 配置。
- `commands/`：slash command catalog；`terminal/`：内嵌终端（node-pty）；`oauth/`：Connector OAuth 管理与回调 server；`workspace/`：git 状态、open-with 等操作系统 workspace 集成。
- `rpc/`：IPC router、验证、错误 DTO、renderer 事件广播与 RPC 生命周期内的 attachment registry。

## 目录导航与拆分

- 每个领域目录的 `index.ts` 应让读者先知道：模块拥有的事实、对外动作、错误语义和生命周期；实现细节留在同目录的私有文件。
- `types.ts`、`errors.ts`、`sqlite.ts`、`projection.ts` 等文件必须放在其所属领域目录下；跨目录移动前先问“它拥有哪类事实或协议”。没有明确 owner 的代码不准落到根目录。
- 测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。
- 单文件原则上不超过 800 行；接近上限时评估是否混入多个领域或角色。只有职责混杂、接口不清或拆分能显著改善定位时，才按领域文件夹拆分；不要把几行函数拆到同级文件来降低行数。
- 命名表达角色：`open*` 获取有生命周期资源；`create*` 构造新对象；`resolve*` 纯计算/选择；`project*` 内部事实到安全读取模型；`run*` 编排完整用例；`*Registry` 只索引运行中对象，不持久化领域事实。

# 错误处理

- 可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。
- 领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。
- `Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。
- `cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。

# 编码约定

- 内部重构与对外契约兼容按核心工程原则第 10 条处理；数据库迁移不得引入第二个 durable owner、双写或备用存储路径。
- 在完整设计明确后，先跑通最小端到端版本，再按真实需求扩展；抽象与依赖选型按核心工程原则第 1、7 条处理。
- 架构决策往长了做，不接受“先这样以后再换”的临时方案；已有临时方案与技术债务按核心工程原则第 8 条补齐上下文和追踪任务。
- 不用 `...(cond ? { key } : {})` 省略可选字段（biome 插件 `no-conditional-spread` 会报错）。直接写 `key: value`，需要保留前面 spread 的同名字段时写 `key: value ?? base.key`；不要在内部代码里模拟 `exactOptionalPropertyTypes`。只有 `URLSearchParams`、`Headers` 和进程 `env` 会把 `undefined` 变成字符串 `"undefined"`，只在这几个构造点丢掉 `undefined`。
- `unknown` 进入本仓库类型时用 `@sinclair/typebox`：RPC/IPC 请求与响应、SQLite 读回、协议参数、插件 manifest、第三方 catalog。类型从 schema 推导（`Static<typeof schema>`），边界上用 `Value.Check`；白名单 DTO 设 `additionalProperties: false`，请求和响应两端共用同一份 schema。值已经有类型时直接赋值；对方 SDK 已有 schema 就用对方的。凭据保留、清单匹配这类领域规则留在领域函数里。

## 函数抽取

- 同时满足以下条件时直接内联：只有一个调用点；只是原样转发、别名或固定参数构造；没有分支、领域约束或资源生命周期；没有独立测试价值；函数名没有增加调用处无法表达的业务语义。
- 不按行数机械内联。类型守卫、事件处理器、递归、协议边界、错误 DTO 投影、领域校验及多处复用函数可以保持短小。
- 评审新增短函数时先问“删掉并内联后，是否损失复用、约束或可读性”；答案是否定的就不要提取。

# Desktop UI 约定

- 选型顺序：AI 对话类组件先查 [assistant-ui](https://www.assistant-ui.com/llms-full.txt)；其他组件先查 [Fluid Functionalism](https://www.fluidfunctionalism.com/docs/)，没有合适的再用 shadcn skill。
- 产品界面优先复用 `app/desktop/src/components/ui/*`；已有等价组件时，不直接写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。`components/ui/*` 内部实现和操作系统原生控件（如 macOS traffic lights）除外，不要为了消灭原生标签而硬套通用组件。
- 通用组件能力不足时，优先补强共享组件或明确保留专用语义控件，不在多个业务组件中复制近似实现。
- 图标统一用 Hugeicons，业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 获取；缺少图标时在 `IconName` 与 `defaultIcons` 中补映射。不要直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标；操作系统原生图形除外。
- JSX 属性（尤其 `className`）禁止模板字符串、字符串拼接和 JSX 内条件表达式（`className` 的模板字符串与 `+` 拼接由 biome 插件 `no-classname-concat` 拦截，其余靠自觉）。Tailwind class 用 `cn` 组合，条件 class 用 `cn` 的对象或参数形式；非样式的条件值先在 `return` 前命名，JSX 只引用变量。
- 改完 Desktop UI 后，检查 `app/desktop/src/components/shell/**` 是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 `app/desktop` 的 typecheck 与相关测试。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
