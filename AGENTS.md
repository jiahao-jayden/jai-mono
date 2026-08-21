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

# 编码规则
1. 不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。

2. 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。

3. 系统分层长。先跑通一个最小的端到端版本，再往上加东西。绝不为了未完成的复杂度拆掉能跑的东西。

4. 组件保持模块化，关注点分离。

5. 优先用成熟的、有人维护的库。没有明确理由别自己重写。

6. 先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。

7. 架构决策往长了做。不接受"先这样以后再换"的临时方案。

8. 先看成熟产品怎么解决同一个问题，用已验证的模式，别从零发明。

9. 一个代码文件禁止超过 700 行，否则需要进行拆分，拆分时，尽量以文件夹进行领域级拆分，而非无意义的全部放在同一个文件夹
