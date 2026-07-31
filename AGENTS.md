# 错误处理规则

- Jai 主动抛出的可处理错误使用 `@jai/common` 的 `CodedError`；不要新建裸 `Error` / `TypeError` 作为业务错误。
- `CodedError` 一律使用具名对象参数：`new CodedError({ code, message, data?, cause? })`，禁止两个 string 位置参数。
- `code` 使用 `<subsystem>.<reason>` 形式；`message` 是面向人的文案，不能作为程序分支依据。
- 同一模块有多个错误原因时，用 `defineCodedError(namespace, reasons)` 声明本地受限 reason 集合，并调用 factory；不要在每个抛出点手写完整 code 字符串。
- 不建立跨 package 的全局错误码 registry。错误词表由拥有该行为的模块维护。
- `cause` 仅用于进程内诊断；跨进程、事件或 UI 边界通过 `toErrorEnvelope()` 投影为 `{ code, message, data? }`，不得传递 stack、cause 或未筛选的 SDK 错误对象。

# 组件规则
组件优先考虑https://www.fluidfunctionalism.com/docs/
