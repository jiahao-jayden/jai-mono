# 错误处理规则

- Jai 主动抛出的可处理错误使用 `@jai/common` 的 `CodedError`；不要新建裸 `Error` / `TypeError` 作为业务错误。
- `CodedError` 一律使用具名对象参数：`new CodedError({ code, message, data?, cause? })`，禁止两个 string 位置参数。
- `code` 使用 `<subsystem>.<reason>` 形式；`message` 是面向人的文案，不能作为程序分支依据。
- 同一模块有多个错误原因时，用 `defineCodedError(namespace, reasons)` 声明本地受限 reason 集合，并调用 factory；不要在每个抛出点手写完整 code 字符串。
- 不建立跨 package 的全局错误码 registry。错误词表由拥有该行为的模块维护。
- `cause` 仅用于进程内诊断；跨进程、事件或 UI 边界通过 `toErrorEnvelope()` 投影为 `{ code, message, data? }`，不得传递 stack、cause 或未筛选的 SDK 错误对象。

# 组件规则

1. 组件优先考虑 https://www.fluidfunctionalism.com/docs/ ，如果没有需要的再调用 `/shadcn` 去查看用什么组件
2. 图标优先使用hugeicon
3. `app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。`components/ui/*` 的组件内部实现和操作系统原生控件（如 macOS traffic lights）除外，不要为了消灭原生标签而硬套通用组件。
4. Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。不要在业务组件中直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标；操作系统原生图形除外。
5. 通用组件能力不足时，优先补强共享组件或明确保留专用语义控件，不在多个业务组件中复制一套近似实现。
6. 修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。
