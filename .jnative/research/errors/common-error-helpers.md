# `getErrorMessage` / `toErrorEnvelope` / `JsonValue`：有没有成熟库已经封装？

核验日期：2026-09-03。钉住本仓库当时安装的 `better-result@3.0.0`（commit `fe6f288ffb728e3ebe69630d737177cd3ae8f8bd`）、`@sinclair/typebox@0.34.49`；对照 npm 当时最新的 `serialize-error@13.0.1`（commit `99459b28`）、`serialize-error-cjs@0.2.0`（commit `2e10f60`）、`type-fest@5.9.0`；Node 文档取 `https://nodejs.org/docs/latest/`（当时页面标题为 Node.js v26.8.1）。避免后续 minor 把 stack/cause 行为混进结论。不建议换 Result 库，不新建 `@jai/errors`。

## 结论

1. **`better-result` v3 没有 `getMessage` / `getErrorMessage` / `JsonValue` / `ErrorEnvelope`。** 它有 `TaggedError.toJSON()` 和 `Result.codec` + `{ status, value | error }` 的 `SerializedResult`。`toJSON()` 会显式写入 `stack` 和 `cause`（cause 为 Error 时再带其 `stack`），语义与 JAI「跨进程禁止 stack/cause」相反。来源：[v3.0.0 `src/error.ts`](https://github.com/dmmulroy/better-result/blob/fe6f288ffb728e3ebe69630d737177cd3ae8f8bd/src/error.ts)、本地 `node_modules/better-result@3.0.0/dist/index.d.mts` 的 `export { ... }` 清单、[npm README「Validate transport boundaries」](https://www.npmjs.com/package/better-result)（3.0.0）。

2. **TypeScript 和 TypeBox 都没有标准 `JsonValue` 类型导出。** `JSON.parse` 在 `lib.es5.d.ts` 里返回 `any`；把返回类型收成 `JsonValue` 的提案被关掉。TypeBox 0.34.49 只提供 `Type.String` / `Number` / `Boolean` / `Null` / `Array` / `Object` / `Recursive` 等积木，要自己拼递归 JSON schema。社区里形状相同的类型在 `type-fest` 的 `JsonValue` / `JsonPrimitive`。来源：[TypeScript `lib.es5.d.ts`](https://github.com/microsoft/TypeScript/blob/8f8a579eee719bd2c95c7a0b0e27de4f0bdc14aa/lib/lib.es5.d.ts)、[microsoft/TypeScript#46749](https://github.com/microsoft/TypeScript/issues/46749)、[TypeBox 0.34.49 readme「Json Types」](https://github.com/sinclairzx81/typebox/blob/0.34.49/readme.md)、[type-fest `json-value.d.ts`](https://github.com/sindresorhus/type-fest/blob/main/source/json-value.d.ts)（npm 5.9.0）。

3. **`serialize-error` / `serialize-error-cjs` / Node `error.cause` + `util.inspect` 产出的都是诊断转储，不是跨进程安全 DTO。** 官方示例和类型都带 `stack`；两库都把 `cause` 列入要拷贝的属性。Node 文档写明 `util.inspect()` 会递归序列化 `error.cause`（含其 stack）。这正好是 JAI 禁止越过 RPC/UI 边界的东西。来源：[serialize-error@13.0.1](https://www.npmjs.com/package/serialize-error)、[index.js `errorProperties`](https://github.com/sindresorhus/serialize-error/blob/99459b28a64c50d885a037cf0dee8fab8a79afa6/index.js)、[serialize-error-cjs@0.2.0 `SerializedError`](https://github.com/finwo/serialize-error-cjs/blob/2e10f60dbdbff200e8ecf9f32fbf97cc928204fa/src/index.ts)、[Node.js Errors: `error.cause`](https://nodejs.org/docs/latest/api/errors.html#errorcause)。

4. **`getErrorMessage` / `getErrorCode` / 运行时 `isJsonValue` 是语言里几行就能写的习惯写法，不值得引进一个库。** 读 `message` 否则 `String(error)`、读 `code` 或 `_tag`、递归判断 JSON 叶子——没有独立协议、没有跨进程约束。成熟库要么不做这件事，要么做成「把整个 Error 连 stack 一起 dump」。

5. **对等的「跨进程安全投影」没有 drop-in 库。** 协议层最接近的是 JSON-RPC 2.0 Error object：`{ code, message, data? }`，规范不要求 stack/cause。`Result.codec` 是「你自己写白名单 schema」的机制，不是现成 envelope。`@jai/common` 的 `ErrorEnvelope` + `toErrorEnvelope` 就是这块空缺的本地实现。来源：[JSON-RPC 2.0 §5.1](https://www.jsonrpc.org/specification)、[better-result `Result.codec`](https://www.npmjs.com/package/better-result)、本仓库 `packages/common/src/errors.ts`。

## 本仓库现在有什么

`@jai/common` 只从 `packages/common/src/errors.ts` 导出：

| 符号 | 角色 |
|---|---|
| `JsonPrimitive` / `JsonValue` | 递归 JSON 类型别名 |
| `ErrorEnvelope` | `{ code, message, data? }`，注释写明不含 stack/cause |
| `getErrorMessage(unknown)` | 有 string `message` 则取之，否则 `String(error)` |
| `getErrorCode(unknown)` | 先读 string `code`，再读 TaggedError 的 `_tag` |
| `isErrorEnvelope` / `toErrorEnvelope` | 把 unknown / `TaggedError` 投影成 JSON-safe DTO；`data` 必须通过 `isJsonValue` |

`AGENTS.md` 已写：`cause` 仅进程内诊断；`TaggedError.toJSON()` 不可跨进程直接使用；RPC/事件/UI 必须走显式白名单 DTO。下面核验的第三方行为与这条规则一致，而不是替代它。

## better-result v3 官方导出（钉 3.0.0）

本仓库 `bun.lock` 解析到 `better-result@3.0.0`。npm 当时还有 `3.0.1`；本稿只依据已安装的 3.0.0 类型与源码。

`dist/index.d.mts` 的公开 `export` 是：

`AnyTaggedError`, `Err`, `InferErr`, `InferOk`, `Ok`, `Panic`, `Result`, `ResultCodec`, `ResultCodecConfig`, `ResultCodecIssue`, `ResultDeserializationError`, `ResultSerializationError`, `SerializedErr`, `SerializedOk`, `SerializedResult`, 一组 `StandardSchema*` 类型, `TaggedError`, `TaggedErrorClass`, `TaggedErrorInstance`, `TryContext`, `TryPromiseContext`, `UnhandledException`, `isPanic`, `isTaggedError`, `matchError`, `matchErrorPartial`, `panic`。

没有：`getMessage`、`getErrorMessage`、`getErrorCode`、`JsonValue`、`JsonPrimitive`、`ErrorEnvelope`、`toErrorEnvelope`。

### `TaggedError.toJSON()`：诊断序列化，含 stack/cause

v3.0.0 源码（commit `fe6f288`）：

```ts
const serializeCause = (cause: unknown): unknown => {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return cause;
};

toJSON(): object {
  return {
    ...this,
    _tag: this._tag,
    name: this.name,
    message: this.message,
    cause: serializeCause(this.cause),
    stack: this.stack,
  };
}
```

来源：[src/error.ts](https://github.com/dmmulroy/better-result/blob/fe6f288ffb728e3ebe69630d737177cd3ae8f8bd/src/error.ts)。本地打包产物 `dist/index.mjs` 同一逻辑：`toJSON(){return{...this,_tag,...,cause:p(this.cause),stack:this.stack}}`，且 `p` 对 Error 再拷 `name/message/stack`。

`Panic.toJSON()` 同样带 `cause` 和 `stack`。`UnhandledException` 的 payload 本身就含 `cause: unknown`。

这是进程内 / 日志用的完整 Error 快照。JAI 的 `toErrorEnvelope` 只取 `_tag`（作 `code`）、`message`、以及通过 `isJsonValue` 的 `data`。两者不是同一层。

### `Result.codec` / `SerializedResult`：Result 信封，不是错误信封

v3 删掉了未校验的 `Result.serialize` / `deserialize` / `hydrate`，换成调用方自带 Standard Schema 的 `Result.codec`。[v3.0.0 release](https://github.com/dmmulroy/better-result/releases/tag/v3.0.0)

`SerializedResult<T, E>` 的形状是 `{ status: "ok", value: T } | { status: "error", error: E }`。这包装的是整个 Result，不是 `{ code, message, data }`。Err 侧的 `E` 由调用方 schema 决定：schema 写进 stack，wire 上就有 stack；schema 只投影白名单字段，才安全。库不提供默认的安全错误投影。

对照：

| | `SerializedResult` | `@jai/common` `ErrorEnvelope` |
|---|---|---|
| 包装对象 | 整个 Result | 单条错误 |
| 判别字段 | `status: "ok" \| "error"` | `code: string` |
| 错误载荷 | 任意 `E`（schema 决定） | `message` + 可选 JSON `data` |
| stack/cause | 默认不剥；看你的 schema | 明确不含 |

## TypeScript / TypeBox 有没有标准 `JsonValue`

### TypeScript：没有

`lib.es5.d.ts` 的 `JSON.parse` 返回 `any`，`JSON.stringify` 的 `value` 也是 `any`。[源](https://github.com/microsoft/TypeScript/blob/8f8a579eee719bd2c95c7a0b0e27de4f0bdc14aa/lib/lib.es5.d.ts)

[microsoft/TypeScript#46749](https://github.com/microsoft/TypeScript/issues/46749)（2021-11 提出把 `JSON.parse` 收成 `JsonValue`，标 Duplicate 后关闭）说明团队知道这个类型、但没有把它放进标准库。本仓库 TypeScript 为 `^7.0.2`；到 2026-09-03 核验时，lib 仍是 `any`。

递归别名本身是语言能力，不是库：

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
```

`@jai/common` 的定义与此同构。

### TypeBox 0.34.49：没有现成导出，有积木

本仓库 catalog 钉 `@sinclair/typebox@^0.34.49`。`package.json` 的 `exports` 是 `.` / `compiler` / `errors` / `parser` / `syntax` / `system` / `type` / `value`。`./errors` 是 schema 校验错误，不是 `getErrorMessage`。`build/cjs/type` 下没有名为 `json` / `json-value` 的模块。

readme「Json Types」表列出的是 `Type.Any` / `Unknown` / `String` / `Number` / `Integer` / `Boolean` / `Null` / `Literal` / `Array` / `Object` / `Tuple` 等。[0.34.49 readme](https://github.com/sinclairzx81/typebox/blob/0.34.49/readme.md)

维护者在 [typebox#1356](https://github.com/sinclairzx81/typebox/issues/1356) 给的是**参考拼法**（`Type.Cyclic` + `Type.Union`），不是内置 `JsonValue` 导出。那条回复还指向 TypeBox 1.x（包名 `typebox`）；本仓库仍用 0.34 LTS，结论不变：没有标准类型可 import。

### 社区类型：`type-fest`

[type-fest 5.9.0](https://www.npmjs.com/package/type-fest) 导出 `JsonValue` / `JsonPrimitive` / `JsonObject` / `JsonArray`，形状与 `@jai/common` 一致：

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
```

来源：[source/json-value.d.ts](https://github.com/sindresorhus/type-fest/blob/main/source/json-value.d.ts)。`serialize-error@13` 依赖 `type-fest`，只把它当 `ErrorObject` 的 JSON 约束，不改变「序列化时带 stack」。

为这一行类型别名引入 `type-fest` 没有额外语义。

## 常见错误序列化：形状里有没有 stack/cause

### `serialize-error@13.0.1`

定位：`JSON.stringify()` / `process.send()` 之前把 Error 变成 plain object。[npm](https://www.npmjs.com/package/serialize-error) 示例：

```
{name: 'Error', message: '🦄', stack: 'Error: 🦄\n    at Object.<anonymous> …'}
```

类型（README / `index.d.ts`）：

```ts
export type ErrorObject = {
  name?: string;
  message?: string;
  stack?: string;
  cause?: unknown;
  code?: string;
} & JsonObject;
```

实现把 `name` / `message` / `stack` / `code` / `cause` / `errors` 列入 `errorProperties`，序列化时强制拷贝；`useToJSON` 默认 true，遇到 `TaggedError` 会走其 `toJSON()`，再次带上 stack/cause。[index.js @ 99459b28](https://github.com/sindresorhus/serialize-error/blob/99459b28a64c50d885a037cf0dee8fab8a79afa6/index.js)

`isErrorLike` 要求 `name` + `message` + `stack` 都是 string。没有「剥掉 stack」的选项。

### `serialize-error-cjs@0.2.0`

CommonJS 简化复刻，官方写「loosely based on serialize-error」。[npm 0.2.0](https://www.npmjs.com/package/serialize-error-cjs)

```ts
export type SerializedError = {
  name: string;
  message: string;
  stack: string;
  code?: string | number;
  cause?: string;
};
```

`commonProperties` 含 `message` / `stack` / `code` / `cause` / `errors`。默认输出的 `stack` 是空字符串，源 Error 有 stack 就会写进去。[src/index.ts @ 2e10f60](https://github.com/finwo/serialize-error-cjs/blob/2e10f60dbdbff200e8ecf9f32fbf97cc928204fa/src/index.ts)

### Node `error.cause` 与 `util.inspect`

[Node.js Errors — `error.cause`](https://nodejs.org/docs/latest/api/errors.html#errorcause)（docs/latest，核验时页面为 v26.8.1）：

> If present, the `error.cause` property is the underlying cause of the `Error`. … When serializing `Error` objects, `util.inspect()` recursively serializes `error.cause` if it is set.

同一页的示例打印症状 Error 的 stack，并在 `[cause]:` 下列出原因 Error 的 stack。`error.stack` 是「在何处实例化」的诊断字符串，不是 DTO 字段。

`util.inspect` 产出人类可读字符串，不是 `{ code, message }` JSON。它解决控制台/日志，不解决跨进程白名单。

### 对照表

| 机制 | 版本 | 默认含 stack | 默认含 cause | 能否当 JAI envelope |
|---|---|---|---|---|
| `TaggedError.toJSON()` | better-result 3.0.0 | 是 | 是（Error 时再带其 stack） | 否 |
| `Result.codec` | better-result 3.0.0 | 看 schema | 看 schema | 否（不同信封；安全与否取决于你写的 schema） |
| `serialize-error` | 13.0.1 | 是 | 是（列入 errorProperties） | 否 |
| `serialize-error-cjs` | 0.2.0 | 是 | 是（列入 commonProperties） | 否 |
| `util.inspect` + `error.cause` | Node docs/latest | 是（文本里） | 是（递归） | 否 |
| JSON-RPC 2.0 Error object | 规范 2013-01-04 | 规范不要求 | 规范不要求 | 形状近；`code` 是 number，不是 string `_tag` |
| `@jai/common` `toErrorEnvelope` | 本仓库 | 否 | 否 | 是 |

## 三类东西要分开

### 1. 语言里一行就能写、不值得成库

- `getErrorMessage`：duck-type `message`，否则 `String(error)`。TypeScript 把 catch 变量标成 `unknown` 之后，这是手册级写法，不是产品协议。
- `getErrorCode`：Node `SystemError.code`（string）和 `TaggedError._tag` 的本地约定。没有「读 code 或 _tag」的标准库函数。
- `JsonValue` 类型别名：递归 union，TS 3.7+ 就能写。
- `isJsonValue`：对叶子做 `typeof` / `Array.isArray` / `Object.values` 递归。没有独立测试价值之外的协议。

这些留在 `@jai/common` 是因为调用点需要同一个名字，不是因为缺一个 npm 包。

### 2. 有库，但语义相反（会泄露 stack）

- `TaggedError.toJSON()` / `Panic.toJSON()`
- `serialize-error` / `serialize-error-cjs`
- Node `util.inspect` 对 Error 的默认打印

它们的目标是「跨进程仍能还原/阅读完整 Error」，包括 stack 和 cause 链。JAI 的目标是「跨进程只给白名单 DTO」。用这些库替换 `toErrorEnvelope` 会直接违反 `AGENTS.md`。

### 3. 有对等的跨进程安全投影吗

**没有现成的 TypeScript 库**提供「从 `unknown` / `TaggedError` 投影到 `{ code, message, data? }` 且剥掉 stack/cause」。

协议层最接近的是 [JSON-RPC 2.0 §5.1 Error object](https://www.jsonrpc.org/specification)：`code`（integer）、`message`（短句）、可选 `data`（任意 JSON）。规范不把 stack 列为成员。差异：`code` 是数字预留段，JAI 用 string `_tag`（`<subsystem>.<reason>`）。这是形状参考，不是可 import 的 helper。

`Result.codec` 可以做成安全投影，条件是 Err schema 只编码 `code`/`message`/`data`。那是边界上再写一套 schema，不能删掉 `toErrorEnvelope`。

RFC 7807 Problem Details（`type`/`title`/`status`/`detail`）是另一套 HTTP 问题文档形状，与当前 envelope 不对齐，此处不展开。

## 对本项目的影响

- **不用改业务代码，也不用加依赖。** `getErrorMessage` / `getErrorCode` / `JsonValue` 没有值得替换的库；`toErrorEnvelope` 没有对等的安全替代品。
- **不要用 `serialize-error`、`serialize-error-cjs`、`TaggedError.toJSON()` 或 `util.inspect` 当 RPC/UI 错误投影。** 它们默认带 stack/cause。这坐实 `AGENTS.md` 那条，而不是过时假设。
- **不要为 `JsonValue` 引入 `type-fest` 或改用 TypeBox 拼一套递归 schema。** 类型别名已在 `@jai/common`；TypeBox 只在需要运行时校验某条 envelope 时才值得写 schema。
- **不要把 `Result.codec` 当成 `toErrorEnvelope` 的替代。** codec 校验的是 Result 信封。若将来某条 RPC 要整颗 `SerializedResult` 过线，Err schema 仍应投影到现有 `ErrorEnvelope`，而不是 `error.toJSON()`。
- **被证伪的想法：** 「这些辅助函数已经有成熟库封装，删掉 `@jai/common` 即可。」成熟库封装的是另一件事（完整 Error dump / Result 编解码 / JSON 积木），不是跨进程安全错误投影。
- **不确定：** `better-result@3.0.1` 未逐行核对；从 3.0.0 release 说明看，toJSON / codec 语义没有改成「默认剥 stack」。若升级，只需再确认 `toJSON` 是否仍写 `stack`/`cause`。
