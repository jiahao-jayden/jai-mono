# Pi Coding Agent Extension API 设计调研

> 调研日期：2026-08-20（Asia/Singapore）  
> 范围：Pi Coding Agent 的 extension API；仅使用 Pi 官方仓库的文档与源码。  
> 固定版本：[badlogic/pi-mono `b7bb00b936dbe21b8e160b3e89efdec361846699`](https://github.com/badlogic/pi-mono/tree/b7bb00b936dbe21b8e160b3e89efdec361846699)（2026-08-19）。该仓库当前使用 `@earendil-works/*` 包名，源码仍保留旧 `@mariozechner/*` import alias；本文以当前公开名为准。[S2](#sources)

## 结论先行

Pi 的 extension 是**同一 Node.js 进程中的 TypeScript 代码插件**，而不是声明式 manifest 或受限 RPC 插件。扩展的 default factory 在启动时拿到一个 `ExtensionAPI`，注册事件、模型可调用工具、命令、快捷键、CLI flag、provider 和终端 UI；它还能直接 import Node 内建模块、使用 npm 依赖和调用 `pi.exec()`。[D1](#sources) [S1](#sources)

因此，Pi 的安全边界是“是否加载这段代码”，不是“加载后这段代码能做什么”：项目级资源以 trust gate 延迟到用户信任后加载，但已加载 extension/package 具有完整系统权限。Pi 明确没有内建 permission popup；需要确认或 OS sandbox 的用户应通过 extension 自行实现或在容器中运行。[D2](#sources) [D3](#sources)

对比其他 extension 设计时，最重要的不是 API 项目数量，而是下面四个取舍：

1. Pi 将扩展视为**in-process runtime composition**，所以 hook 可以改模型 payload、tool args 和 session；代价是没有权限最小化、进程隔离或稳定的跨语言协议。
2. Pi 将**可信任的本地代码加载**和**工具执行授权**分开：前者内置 project trust，后者是可选的 extension policy。
3. Pi 的可恢复状态不依赖 extension 私有数据库：它建议把分支相关状态投影进 tool-result `details`，或显式写入不进模型上下文的 custom session entry。[D1](#sources)
4. Pi 对 extension 运行时失败一般采取“记录后继续”，但对 `tool_call` hook 采取 fail-closed：hook 抛错会变为该工具调用的 error result，阻止该工具执行。[D1](#sources) [S4](#sources) [S5](#sources)

## API 面与运行模型

| 面 | Pi API / 语义 | 架构含义 |
| --- | --- | --- |
| 初始化 | `export default (pi: ExtensionAPI) => void | Promise<void>`。async factory 在 `session_start`、`resources_discover` 和启动期 provider flush 前 await。factory 期能注册能力，但 session action 还未绑定，调用会抛“runtime not initialized”。[D1](#sources) [S2](#sources) | 初始化是注册阶段，不应在 factory 开 daemon、watcher 或 timer；官方要求把此类资源延后到 `session_start` / 实际命令或工具，并在 `session_shutdown` 清理。 |
| 声明能力 | `pi.on`、`registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`、`registerProvider`、message/entry renderer、Markdown transformer，以及共享 `pi.events` event bus。[S1](#sources) | 单一 API 同时覆盖 agent、CLI 和 TUI；没有独立 manifest-only extension ABI。 |
| Agent / session 操作 | `sendMessage`、`sendUserMessage`、`appendEntry`、session name/label、active tool set、model/thinking level、`exec`。[S1](#sources) | 扩展能主动注入下一轮输入、改工具集、运行子进程，并读取当前 session/model；权限不是按方法分级。 |
| 命令专属操作 | command context 额外提供 `waitForIdle`、new/fork/navigate/switch session、`reload`，以避免 event handler 中的 session-control deadlock。[D1](#sources) [S1](#sources) | API 明确区分普通 `ExtensionContext` 和 command context。 |
| Provider | 可注册/覆盖 legacy provider config 或完整 `pi-ai Provider`；factory 期注册会暂存，runner bind 后 flush，后续注册立即生效。[D1](#sources) [S2](#sources) | extension 可进入认证、模型目录、请求 stream 与 provider serialization 层，不只是在 tool 层扩展。 |

工具定义使用 TypeBox schema，`execute(id, params, signal, onUpdate, ctx)` 可以上报 partial update，返回可进入模型上下文的 `content` 和持久化/渲染用 `details`。工具可以随运行时注册和通过 `setActiveTools()` 激活或停用；同名 registration 可覆盖内建 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`。工具默认可并行，文档特别要求文件变更类自定义工具使用 `withFileMutationQueue()` 参与同一文件的 mutation queue。[D1](#sources)

## 生命周期与事件

### 生命周期骨架

```text
extension factory（注册）
  -> project_trust（仅 global / CLI extension；项目 extension 尚未执行）
  -> session_start
  -> resources_discover
  -> input -> before_agent_start -> agent_start
  -> 每轮: context -> provider hooks -> message/tool hooks -> turn_end
  -> agent_end -> agent_settled
  -> session_shutdown（quit / reload / new / resume / fork）
```

上图是 Pi 官方 lifecycle 的压缩版；`/new`、`/resume`、`/fork`、`/clone` 和 `/reload` 会销毁旧的 session runtime、重新绑定扩展、再发新的 `session_start`。`agent_end` 不代表工作完全结束，因为 Pi 可能自动 retry、compact 后 retry 或处理 queued follow-up；需要“真正 idle”语义时订阅 `agent_settled`。[D1](#sources)

### 事件分层与 middleware 规则

| 时点 | 可做的事 | 关键约束 |
| --- | --- | --- |
| `input` | transform / handled 原始用户输入，发生在 skill 和 prompt-template 展开之前。 | extension command 先分派；`handled` 短路，多个 transform 按加载顺序链式传递。 |
| `before_agent_start` | 注入持久 custom message，替换该 turn 的 system prompt。 | 后续 handler 看见上一个 handler 的 system prompt 修改。 |
| `context` | 改写即将送模型的 messages。 | Pi 先 `structuredClone`，handler 应返回新 message 列表。 |
| `before_provider_headers` / `before_provider_request` / `after_provider_response` | 改 HTTP header、观察或替换 provider-specific payload、读 status/header。 | 前两个已经跨过通用 agent 模型层；payload rewrite 不会反映在 `getSystemPrompt()`。 |
| `tool_call` | 改已验证的 input；返回 `{ block, reason?, terminate? }` 拦截。 | 参数改变后 Pi **不再验证**；并行工具同一 batch 的 sibling result 不保证可见。 |
| `tool_result` | patch `content`、`details`、`isError`、`usage`。 | 结果按 handler 加载顺序传递，partial patch 合并。 |
| `session_before_*` | cancel / 自定义 compact、tree summary 等。 | 这些取消型 event 的 `cancel` 会短路；session replacement 后不得复用 captured 的旧 `pi`/`ctx`。 |

上述事件与顺序由 extension 文档公开，runner 也逐个按 extension/handler 的加载顺序执行和传递可变结果。[D1](#sources) [S3](#sources)

## 发现、加载、配置与重载

1. 自动发现的位置是用户全局 `~/.pi/agent/extensions/*.ts`（或子目录 `index.ts`）与项目 `.pi/extensions/*.ts`（或子目录 `index.ts`）；配置也可以给出 local path、npm 或 git package source。[D1](#sources) [D3](#sources)
2. loader 用 `jiti` 直接 import `.ts` / `.js`；目录优先读取 `package.json` 的 `pi.extensions`，其次查 `index.ts` / `index.js`。自动扫描只深入一层，复杂包使用 `pi` manifest 声明入口。[S2](#sources)
3. Pi package 的 `package.json` 可以声明 `pi.extensions`、`skills`、`prompts`、`themes`；无 manifest 时按 convention directory 发现。npm/git 安装默认 production install，extension runtime dependency 必须在 `dependencies`，不能只放 `devDependencies`。[D3](#sources)
4. 加载一个 extension 的 import/factory 失败会作为该路径的 diagnostic 收集，loader 继续加载其他 path，不会因为一个 extension factory 失败而停止整个列表。[S2](#sources)
5. `/reload` 使旧 session runtime 先发 `session_shutdown`，再重新发现资源并创建/绑定新的 extension instance。Pi 会让旧 runtime/`pi.events` subscription 失效；旧 `pi` 或 command `ctx` 被再次使用会抛 stale-context error。reload 后仍在执行的旧 command frame 不能假定其 in-memory state 有效。[D1](#sources) [S2](#sources) [S3](#sources)

加载冲突不是一个强隔离边界。resource loader 会报告 tool/flag name conflict diagnostic，但保留所有 extension；event 与命令的可观察先后是 list/load order。命令同名时 Pi 分配 `/name:1`、`/name:2`，tool 同名可覆盖 built-in tool。因此面对多 extension，消费方必须把“命名、顺序和 override policy”作为显式产品契约，而不能假设天然无冲突。[D1](#sources) [S3](#sources) [S6](#sources)

## UI、消息与状态

Pi 的 extension UI 是终端 TUI API，不是 webview/React component API。`ctx.ui` 提供 `select`、`confirm`、`input`、`editor`、`notify`，以及 status、working indicator、header/footer、editor 内容、autocomplete、custom editor、widget 等操作；`ctx.ui.custom()` 临时替换 editor，试验性 overlay 可在现有终端内容上浮层显示。扩展还可以为 tool call/result、custom message、custom session entry 注册 TUI renderer 或 display-only Markdown transformer。[D1](#sources) [S1](#sources)

模式是 API contract 的一部分：TUI 完整可用；RPC 的 dialog/notification 走 JSON protocol 但 `custom()` 返回 `undefined`；JSON 与 print 模式没有 UI，UI 方法 no-op 或给默认结果。extension 应以 `ctx.mode` / `ctx.hasUI` 决定是否要求交互。[D1](#sources) [S3](#sources)

Pi 区分两种持久数据：

- `pi.sendMessage()` 写入 session 且参加 LLM context，适合 extension 给 agent 的可见消息。
- `pi.appendEntry(customType, data)` 写 session 但不进 LLM context，配合 entry renderer 可显示只给用户看的持久 UI 数据。

对于影响 agent 行为、并且需要随 branch 恢复的状态，官方推荐把 state snapshot 写进 tool-result `details`，`session_start` 时扫描 current branch 重建 in-memory state。它避免将 extension 私有状态与 session tree 脱节。[D1](#sources)

## 权限、信任与错误隔离

### 项目 trust 不是 capability sandbox

若项目含 `.pi/settings.json`、`.pi/extensions`、项目 package/资源或 `.agents/skills`，Pi 在加载项目资源前先处理 trust。bootstrap 阶段只加载 user/global 和 CLI `-e` extensions，以便它们参与 `project_trust`；项目 extension 与项目 settings 只在 trusted 后加入最终 runtime。非交互模式没有 trust prompt，按 global `defaultProjectTrust` 或本次 `--approve` / `--no-approve` 决定。[D2](#sources) [S6](#sources) [S4](#sources)

这道门槛阻止“不经用户决定地执行 checkout 中的 extension 代码”，但不限制已加载的代码。官方明确称 extension/package 有 full system permissions；公开 API 可 import `node:*`、加载 npm dependency，且 `pi.exec()` 可启动进程。官方把 permission gate 和 OS-level sandbox 作为可选 extension 示例，而非 host 强制策略。[D1](#sources) [D2](#sources) [S1](#sources)

### 失败语义

| 失败位置 | Pi 行为 | 对比时应保留的区别 |
| --- | --- | --- |
| module import / factory | 收集 loading diagnostic，继续加载其他 extension。 | 装载失败与运行时 handler 失败是两种错误面。 |
| 普通 event、input、context、provider hook、`tool_result` | runner 捕获、经 error listener 报告，通常继续后续 handler/agent。 | 是 observability + best-effort isolation，不是独立进程 crash containment。 |
| `tool_call` handler | runner 让异常上抛；agent-core 的 preflight 总 catch 将其变成该 tool call 的 error `ToolResult`，该工具不执行。 | policy hook fail-closed，避免“权限扩展崩溃后默认放行”。 |
| tool `execute` | extension 要以 throw 表示错误；agent loop 捕获为 `isError: true` 的 error result 并把结果放回模型 loop。 | 错误是正常 agent feedback，不会自动终止整个 session。 |
| `afterToolCall` / result hook 的异常 | agent loop 也转换为 error tool result。 | result decoration 失败不会把原始执行异常抛出进 host。 |

官方文档概括为“extension errors logged, agent continues; `tool_call` errors block; `execute` throw becomes LLM-visible error”。上述实现细节分别可见于 runner、AgentSession 的 bridge 和 agent-core tool loop。[D1](#sources) [S3](#sources) [S4](#sources) [S5](#sources)

## 用于实现对比的设计观察

1. **把 extension 分类清楚。** Pi 把 TS runtime code、prompt/skill/theme resources 和 package distribution 放进同一个 package 生态，但它们的信任/执行风险不同。若现有 extension 主要是 manifest + MCP/skills，应先决定是否真的要引入 Pi 式同进程 code extension；这会是权限模型的根本变化。
2. **把“加载可信”与“每次 action 被批准”拆开。** Pi 的 project trust 只保护本地项目资源加载；它不替代 tool-call permission policy。需要细粒度权限时，Pi 的可借鉴点是 `tool_call` 的可阻断 hook 和 fail-closed 错误路径，而不是“trust 后一律允许”。
3. **区分声明期与绑定期。** Pi 允许 factory 注册，但禁止其调用 session action；provider registration 还采用 queue-then-flush。这是避免初始化顺序隐式依赖的明确边界。
4. **让模型侧可见状态有明确载体。** Pi 用 `sendMessage` / tool result content 进入 LLM context，用 `appendEntry` 留在 session/UI；不应让“是否进模型上下文”取决于 renderer 或临时内存。
5. **为 runtime replacement 设计失效语义。** reload、new/resume/fork 会使旧 runtime context stale；Pi 显式检测并抛错。这比让旧闭包悄悄操作新 session 更可诊断。
6. **不要把 Pi 的 exception model 直接当作业务 error model。** Pi public extension contract 把 tool error 定义为 throw；若宿主有结构化 `Result` / error DTO 约束，应在宿主边界保留它们，再投影成 Pi 所需的 tool error text/result。
7. **TUI API 与 desktop UI API 不能一一照搬。** Pi 提供 terminal component / renderer 生命周期，并为 rpc/json/print 规定 no-op 行为。桌面产品更应抽取“交互能力和模式降级”的设计，而不是复用其组件接口。

## Sources

- **[D1] Pi 官方 extension 文档**：[packages/coding-agent/docs/extensions.md](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/docs/extensions.md)。覆盖 public API、lifecycle、tool、UI、state、error 和 mode contract。
- **[D2] Pi 官方 coding-agent README**：[packages/coding-agent/README.md](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/README.md)。覆盖 extension/package 安全声明、project trust、CLI resource flags。
- **[D3] Pi 官方 packages 文档**：[packages/coding-agent/docs/packages.md](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/docs/packages.md)。覆盖 package manifest、installation、dependency 和 scope 规则。
- **[S1] Public type contract**：[packages/coding-agent/src/core/extensions/types.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/extensions/types.ts)。`ExtensionAPI`、context、tool/event/provider 类型。
- **[S2] Module loader/runtime bootstrap**：[packages/coding-agent/src/core/extensions/loader.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/extensions/loader.ts)。jiti import、factory 加载、discovery、pending provider、stale runtime。
- **[S3] Event runner**：[packages/coding-agent/src/core/extensions/runner.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/extensions/runner.ts)。handler ordering、middleware result chain、error listener、stale context。
- **[S4] Coding-agent bridge**：[packages/coding-agent/src/core/agent-session.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/agent-session.ts)。`tool_call` / `tool_result` 与 agent-core 的衔接、extension error listener。
- **[S5] Agent-core tool loop**：[packages/agent/src/agent-loop.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/agent/src/agent-loop.ts)。preflight/execute/after-tool hook exception 到 error tool result 的转换。
- **[S6] Resource and trust loader**：[packages/coding-agent/src/core/resource-loader.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/resource-loader.ts)、[project-trust.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/project-trust.ts)、[trust-manager.ts](https://github.com/badlogic/pi-mono/blob/b7bb00b936dbe21b8e160b3e89efdec361846699/packages/coding-agent/src/core/trust-manager.ts)。pre-trust bootstrap、最终 extension set、trust 条件和持久化决定。
