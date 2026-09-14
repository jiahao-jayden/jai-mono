# Pi Agent 有没有做成共享 `getErrorMessage` / `ErrorEnvelope` / `JsonValue` 包？

核验日期：2026-09-03。钉 `earendil-works/pi` 默认分支 `main` HEAD [`4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057`](https://github.com/earendil-works/pi/commit/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057)（2026-09-02，`feat(ai): preserve Anthropic per-turn thinking effort`）。浅克隆核验，避免把旧笔记里的 `c77ab55` / `56700d42` / `e868230` / `f8c71c6` 混进结论。下文 permalink 一律带该 SHA。不建议 JAI 新建 `@jai/errors`。

## 结论

1. **Pi 没有 `packages/common`，也没有 `@pi/common` / `@earendil-works/pi-common`。** `packages/` 顶层是 `agent`、`ai`、`client`、`coding-agent`、`evals`、`protocol`、`server`、`session-backends`、`telemetry`、`tui`。公开包名一律 `@earendil-works/pi-*`。来源：[packages 目录](https://github.com/earendil-works/pi/tree/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages)、[`@earendil-works/pi-protocol`](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/package.json#L1-L4)。

2. **全库没有 `getErrorMessage` / `getErrorCode` / `ErrorEnvelope` / `toErrorEnvelope`。** 日常取 message 是就地写 `error instanceof Error ? error.message : String(error)`，coding-agent 生产源码里至少二十多处，`interactive-mode.ts` 一文件就 26 处。来源：本 SHA 全库 `rg`；[agent-loop 三处](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/agent-loop.ts#L668-L756)。

3. **`JsonValue` 他们也各写一份，没有抽成公共包。** 独立定义在 `pi-protocol`、`pi-ai`、`pi-agent-core` harness session 三处，形状同构；没有 `JsonPrimitive` 这个名字。`evals` 的 `JsonValue` 来自第三方 `vitest-evals/harness`，不是 Pi 自己的包。来源：[protocol](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L10-L24)、[ai](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/types.ts#L407-L418)、[agent session](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/session/types.ts#L6-L6)。

4. **跨进程安全投影只存在于 protocol / server，不是通用 helper。** 线协议错误是 `{ code, message, details? }`，schema 不含 stack/cause；`InternalServerError` 把 cause 留在进程内，对外一律 `internal_error` + `"Internal server error"`。远程 transcript **故意丢掉** `AssistantMessage.diagnostics`。来源：[ProtocolErrorSchema](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L269-L284)、[toProtocolError](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/server.ts#L351-L368)、[server 省略 diagnostics 的注释](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/protocol.ts#L32-L37)。

5. **本地 CLI 会话和 JSON/RPC stdout 会漏 stack。** `extractDiagnosticError` 把 `stack` 写进 `AssistantMessage.diagnostics`；`message_end` 把整条 assistant message `JSON.stringify` 进 v3 JSONL；`toJsonEvent` 只剥 streaming `partial`，不剥 diagnostics。Telemetry 的 `SpanStatus` / `pi.error.type` 则故意只有 name/message 或低基数 type，装不下 stack。来源：[diagnostics.ts](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/utils/diagnostics.ts#L1-L37)、[appendMessage](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/session-manager.ts#L1058-L1068)、[SpanStatus](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/telemetry/src/index.ts#L12-L12)。

6. **对照 JAI：Pi 遇到了同样的「这几行到处要」的问题，但没做成共享包。** 他们就地复制三元表达式，把 `JsonValue` 写在各自 owner 旁边，只在真正的跨进程协议上才有 envelope。这不是「做成 `@xxx/common`」的先例，也不能用来论证 JAI 该新建错误包。

## packages 清单（当前 SHA）

| 目录 | npm 名 | 角色 |
|---|---|---|
| `packages/agent` | `@earendil-works/pi-agent-core` | agent loop、harness |
| `packages/ai` | `@earendil-works/pi-ai` | provider、消息类型、diagnostics |
| `packages/client` | `@earendil-works/pi-client` | 远程 session 客户端 |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | CLI / TUI / RPC / JSON |
| `packages/evals` | `@earendil-works/pi-evals`（private） | eval harness |
| `packages/protocol` | `@earendil-works/pi-protocol` | CBOR 线协议 schema |
| `packages/server` | `@earendil-works/pi-server` | experimental 远程 server |
| `packages/session-backends/sqlite-node` | `@earendil-works/pi-session-backend-sqlite-node` | SQLite session adapter |
| `packages/telemetry` | `@earendil-works/pi-telemetry` | span contract |
| `packages/tui` | `@earendil-works/pi-tui` | TUI 渲染 |

`coding-agent/install-lock` 和若干 `examples/extensions/*` 也有自己的 `package.json`，都不是 shared utils。仓库内 `rg` `@pi/common`、`packages/common`、`pi-common` 无命中。

旧笔记里的 `packages/coding-agent/src/experimental` 已不存在；当前实验入口是 [`packages/coding-agent/src/cli/experimental/`](https://github.com/earendil-works/pi/tree/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/cli/experimental)，远程协议本体在 `packages/protocol` + `packages/server` + `packages/client`。

## 符号表

| 符号 | 定义 | 谁用 | 跨包？ |
|---|---|---|---|
| `getErrorMessage` | 无 | — | — |
| `getErrorCode` | 无 | — | — |
| `ErrorEnvelope` | 无 | — | — |
| `toErrorEnvelope` | 无 | — | — |
| `JsonPrimitive` | 无此名 | — | — |
| `JsonValue`（protocol） | [schemas.ts:10](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L10) | server、client、coding-agent client transcript | 是：`@earendil-works/pi-protocol` |
| `JsonValue`（ai） | [types.ts:407](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/types.ts#L407) | `DeferredHandle.data`、openai-completions reasoning details；经 `export * from "./types.ts"` 公开 | 调用方 import `pi-ai`，不复用 protocol 那份 |
| `JsonValue`（agent harness） | [session/types.ts:6](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/session/types.ts#L6) | harness facts / custom entry / `recordUsage` details | 包内；不 import 另两份 |
| `JsonValue`（evals） | 从 `vitest-evals/harness` import | eval 输出约束 | 第三方，不是 Pi 包 |
| `isJsonValue` | [coding-agent client/transcript.ts:10](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/client/transcript.ts#L10-L16) | 解析 streaming 半截 tool input | 本地函数，类型来自 protocol |
| `toProtocolJsonValue` / `sanitizeProtocolDetails` | [server/protocol.ts:143-187](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/protocol.ts#L143-L187) | 执行边界 → 协议 JSON | server 包内 |
| `formatThrownValue` | [ai/diagnostics.ts:15](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/utils/diagnostics.ts#L15-L19) | provider 失败文案 | `pi-ai` 内；经 index 导出 |
| `extractDiagnosticError` | [ai/diagnostics.ts:21](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/utils/diagnostics.ts#L21-L29) | 写 `AssistantMessage.diagnostics` | `pi-ai` 内；**含 stack** |
| `toError`（client） | [client/errors.ts:49](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/client/src/errors.ts#L49-L51) | 把 unknown 收成 `Error` | client 包内 |
| `toError`（harness） | [agent/harness/types.ts:30](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/types.ts#L30-L38) | 同名另一份，会 `JSON.stringify` 非 Error | agent 包内；与 client 不共享 |
| `boundedErrorMessage` | [protocol/codec.ts:55](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/codec.ts#L55-L58) | codec 失败文案截到 500 字 | protocol 包内 |
| `toProtocolError` | [server.ts:351](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/server.ts#L351-L368) | server 异常 → `ProtocolError` | server 包内 |
| `ProtocolError` | [schemas.ts:278](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L278-L284) | hello_error / response error | 跨 client/server |
| `OperationError` | [agent-harness.ts:84](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/agent-harness.ts#L84-L87) | harness 失败 outcome：`{ code, message }` | 代码无 `details`；[docs 草稿](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/docs/harness.md#L1029) 多写了 `details?: JsonValue`，以代码为准 |
| `PiServerError` | server 与 client 各定义一份 | server 可抛、client 从 `ProtocolError` 还原 | **两包同名，不是共享类** |

源码已经回答「有没有抽共享函数 / 有没有 common 包」。按调研约定，不再去翻 issue/PR。

## 就地复制，不是共享函数

生产路径里最常见的写法就是三元表达式，没有抽到任何包。

agent-loop 把 throw 收成 tool result 文本，三次同一句：

```668:772:https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/agent-loop.ts
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
	// ... executePreparedToolCall / afterToolCall 同样
function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}
```

[permalink](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/agent-loop.ts#L668-L772)

`createErrorToolResult` 只放 message 文本。原始 thrown object、`cause`、`stack` 都不进 tool result，因此也不进下一轮模型上下文。

本 SHA 在 `packages/*/src` 里，`error instanceof Error ? error.message` 的命中（测试和 fixtures 除外）大致是：coding-agent 约 60+、ai 约 14、agent 5。`interactive-mode.ts` 单独 26 处。少数局部函数只服务自己的文件：llama 扩展的 `errorMessage()`、oauth 的 `formatErrorDetails()`。没有跨包的 `getErrorMessage`。

`toError` 出现两次，语义都是「收成 `Error` 实例」而不是「抽 message 字符串」，而且 client 与 harness 各写一份，没有互相 import。

## `JsonValue`：三份同构别名

和 JAI 在 agent / coding-agent / connector 各写一份是同一类做法。

| Owner | 定义 | 用途 |
|---|---|---|
| `@earendil-works/pi-protocol` | `null \| boolean \| number \| string \| JsonValue[] \| { [key: string]: JsonValue }` + TypeBox `JsonValueSchema` | 线协议 `details` / tool `input` |
| `@earendil-works/pi-ai` | 字段顺序不同：`string \| number \| boolean \| null \| ...` | `DeferredHandle.data` |
| `@earendil-works/pi-agent-core` harness session | 与 protocol 同序 | custom fact / metadata / usage details |

三份都不互相 import。protocol 那份是唯一带运行时 schema 的；另外两份只是类型别名。coding-agent 的 [`isJsonValue`](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/client/transcript.ts#L10-L16) 是 transcript 解析用的本地守卫，类型从 protocol import。

`packages/coding-agent/src/utils/json.ts` 只有 `stripJsonComments`，不是 JSON 类型模块。

## 跨进程 / RPC / worker / JSON event 怎么投影错误

### 远程 CBOR 协议：白名单，不带 stack

`ProtocolError` 是 `{ code, message, details? }`，`code` 是固定字面量 union（`version` / `busy` / `session_locked` / `not_found` / `invalid_request` / `not_implemented` / `internal_error`），`details` 必须过 `JsonValueSchema`。[schema](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L269-L284)

server 投影：

```351:368:https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/server.ts
	private toProtocolError(error: unknown): ProtocolError {
		if (error instanceof InternalServerError) {
			this.reportError(error.cause);
			return { code: "internal_error", message: INTERNAL_SERVER_ERROR_MESSAGE };
		}
		if (error instanceof PiServerError) { /* code + message + optional details */ }
		if (error instanceof ProtocolValidationError) {
			return { code: "invalid_request", message: error.message };
		}
		this.reportError(error);
		return { code: "internal_error", message: INTERNAL_SERVER_ERROR_MESSAGE };
	}
```

[permalink](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/server.ts#L351-L368)

[`InternalServerError`](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/errors.ts#L52-L58) 注释写明：「unsafe failure whose cause is retained for reporting but never serialized」。未知异常同样压成这句固定文案。这是 JAI `ErrorEnvelope` 的对等物，但住在 server 包，不在 common。

远程 transcript 再剥一层：assistant item 只有 `errorMessage?: string`，没有 diagnostics 字段。[AssistantTranscriptItem](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/protocol/src/schemas.ts#L144-L149)

server 用编译期 `ExactKeys` 把 `diagnostics` 列成「故意省略」：

> Provider replay metadata, **diagnostics**, cache-write retention splits, … remain intentionally server-side.

[protocol.ts:32-37](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/protocol.ts#L32-L37)。`toProtocolAssistantMessage` 只转发 `errorMessage`。[实现](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/server/src/protocol.ts#L284-L337)

### CLI JSON / RPC stdout：不剥 diagnostics

[`toJsonEvent`](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/modes/json-event.ts#L40-L61) 只从 `message_update` 去掉累积 `partial`。`message_end` 原样通过。注释写：`message_end` 提供最终权威消息。因此带 `diagnostics.stack` 的 assistant message 会进 JSON 模式 stdout。

RPC 命令失败是 `{ success: false, error: string }`，只有字符串。[rpc-types.ts](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/modes/rpc/rpc-types.ts#L238-L239)

RPC 的 `extension_error` 只转发 `err.error`（message），丢掉 runner 里收集的 `stack`。[rpc-mode.ts:349](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L349)

### Worker：只回 message

image-resize worker 的 postMessage 是 `{ error?: string }`。[image-resize-worker.ts:35-39](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/utils/image-resize-worker.ts#L35-L39)

### agent-loop：throw → 文本 tool result

见上节。模型下一轮只看见失败文本。`cause` / `stack` 不进 tool result。

### 本地 JSONL：整条 message 落盘，diagnostics 跟着走

```673:689:https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/agent-session.ts
		if (event.type === "message_end") {
			// ...
				this.sessionManager.appendMessage(event.message);
```

[permalink](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/agent-session.ts#L673-L689)

`appendMessage` 把 `message` 原样放进 entry，再 `JSON.stringify`。[session-manager.ts:1058-1068](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/session-manager.ts#L1058-L1068) 与 [985 / 1022](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/session-manager.ts#L985-L1022)

## `AssistantMessage.diagnostics`：本地诊断快照，含 stack

```1:37:https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/utils/diagnostics.ts
export interface DiagnosticErrorInfo {
	name?: string;
	message: string;
	stack?: string;
	code?: string | number;
}
export function extractDiagnosticError(error: unknown): DiagnosticErrorInfo {
	if (!(error instanceof Error)) return { name: "ThrownValue", message: formatThrownValue(error) };
	const code = (error as Error & { code?: unknown }).code;
	return {
		name: error.name || undefined,
		message: error.message || error.name,
		stack: error.stack,
		code: typeof code === "string" || typeof code === "number" ? code : undefined,
	};
}
```

[permalink](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/utils/diagnostics.ts#L1-L37)

`AssistantMessage` 注释写「Redacted provider/runtime diagnostics」，但 `extractDiagnosticError` 不剥 stack，也不碰 `cause`。[types.ts:427-437](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/types.ts#L427-L437)

写入点包括 Codex transport 失败（`provider_transport_failure`）、`pi_messages_response_failure`、Bedrock / Anthropic 部分失败路径。[openai-codex-responses.ts:348-357](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/ai/src/api/openai-codex-responses.ts#L348-L357)

这和 JAI「`TaggedError.toJSON()` 不能当 RPC DTO」相反：Pi 把带 stack 的 diagnostics 当本地 session 字段持久化，只在 **远程 protocol** 边界丢掉。

扩展错误也显式带 `stack?: string`。[ExtensionError](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/core/extensions/types.ts#L1792-L1797) TUI 会打印 stack；RPC 如上所述丢掉。

harness 里另有一份本地 [`TaggedError`](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/result.ts#L18-L51)。`toJSON()` 拷 enumerable own keys + `message`，不显式写 `stack`。它不是跨进程 DTO，也不在独立 common 包。

## Telemetry：`error.type` / SpanStatus 装不下 stack

`SpanStatus` 的错误侧只有可选 `{ name, message }`：

```12:12:https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/telemetry/src/index.ts
export type SpanStatus = { status: "ok" } | { status: "error"; error?: { name: string; message: string } };
```

[permalink](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/telemetry/src/index.ts#L12)

`InMemoryTelemetryContext` 自动失败状态同样只拷 name/message；检查 `error instanceof Error` 时若抛，退回无 details 的 `{ status: "error" }`。[memory.ts:71-86](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/telemetry/src/memory.ts#L71-L86)

schema 端属性是低基数 class，不是 stack：

| 属性 | 类型 | 说明 |
|---|---|---|
| `pi.ai.error.type` | string, low cardinality | Provider or transport error class |
| `pi.error.code` | string, low cardinality | Stable operation error code |
| `pi.error.type` | string, low cardinality | Low-cardinality operation error class |

来源：[telemetry.ts:109-113](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/telemetry.ts#L109-L113)、[219-229](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/src/harness/telemetry.ts#L219-L229)、[生成文档](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/agent/docs/telemetry-schema.md#L47-L83)

README 写：attribute 只允许 primitive scalars/arrays；「avoid … free-form error details unless its schema and data policy explicitly allow them」。Telemetry 是 process-local diagnostics，不要把 span 对象写进 records/messages。[README](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/telemetry/README.md#L387-L389)

旧笔记「telemetry 故意装不下 stack」在当前 SHA 仍成立。

## 和 JAI `@jai/common` 对照

| | JAI `@jai/common` | Pi `4e69b0c` |
|---|---|---|
| 有没有 shared utils 包 | 有，只装这几样 | 无 |
| `JsonValue` | 一份在 common；agent/coding-agent/connector 仍各有一份 | protocol / ai / agent session 各一份，互不 import |
| message helper | `getErrorMessage` | 就地三元；`formatThrownValue` 只服务 diagnostics |
| code helper | `getErrorCode`（`code` 或 `_tag`） | 无；protocol `code` 是字面量 union；harness `OperationError.code` 是 string |
| 跨进程 envelope | `ErrorEnvelope` + `toErrorEnvelope`，禁 stack/cause | `ProtocolError` + `toProtocolError`，只在 server 边界 |
| diagnostics | `TaggedError.toJSON()` 禁止当 DTO | `AssistantMessage.diagnostics` **含 stack**，进本地 JSONL / JSON stdout；远程 protocol 丢掉 |
| telemetry | （JAI 自己的投影） | `SpanStatus` / `error.type` 无 stack |

Pi 没有「遇到同样问题并做成 `packages/common`」。他们把协议 DTO 放进 `@earendil-works/pi-protocol`，把 provider 诊断快照放进 `@earendil-works/pi-ai`，把日常 `error.message` 复制粘贴。`JsonValue` 重复定义这件事，他们也没收。

## 对本项目的影响

- **不用改 JAI 业务代码，也不要新建 `@jai/errors`。** Pi 没有提供「这些 helper 该独立成包」的对照。
- **「别人也做成了 shared common」被证伪。** Pi 的 protocol 包是线协议 owner，不是 utils 袋。JAI 若问 `@jai/common` 能不能拆：Pi 的做法是把 `JsonValue` 留在各自 owner 旁边、message 抽取就地写；这支持「别为几行 helper 再开一个包」，不支持「必须有 `@jai/common`」，也不支持「必须拆掉」。
- **跨进程安全投影要对齐的是 `ProtocolError`，不是 `diagnostics.ts`。** 后者默认带 stack，和 `AGENTS.md` 相反。JAI 继续禁止 `TaggedError.toJSON()` 当 RPC DTO 是对的。
- **Pi 的本地 JSONL 会持久化 diagnostics.stack。** 不能拿 Pi session 文件当「持久化也不漏 stack」的样板。JAI journal / RPC 走 `ErrorEnvelope` 更严。
- **不确定：** harness docs 里 `OperationError.details` 与代码不一致，以代码 `{ code, message }` 为准。`better-result` 风格的 harness `TaggedError.toJSON()` 是否会被谁 `JSON.stringify` 到磁盘，本稿未逐条追踪所有 harness 写入路径；当前 CLI composition 仍走 v3 `SessionManager`，不是那份 harness TaggedError。
