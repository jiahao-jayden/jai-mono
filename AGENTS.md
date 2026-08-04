# 错误处理规则

- 可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。
- 领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。
- `Panic` 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 `Err`。
- `cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。
- 旧 `CodedError` / `defineCodedError` 仅用于尚未迁移的兼容路径；新增代码不得依赖它们。

# 组件规则

1. 组件优先考虑 https://www.fluidfunctionalism.com/docs/ ，如果没有需要的再调用 `/shadcn` 去查看用什么组件
2. 图标优先使用hugeicon
3. `app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。`components/ui/*` 的组件内部实现和操作系统原生控件（如 macOS traffic lights）除外，不要为了消灭原生标签而硬套通用组件。
4. Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。不要在业务组件中直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标；操作系统原生图形除外。
5. 通用组件能力不足时，优先补强共享组件或明确保留专用语义控件，不在多个业务组件中复制一套近似实现。
6. 修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。
7. `app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `@/lib/utils` 的 `cn`；条件 class 使用 `cn` 的对象或参数形式。非样式的条件值也先在 `return` 前命名，JSX 只引用该变量。
