# Pi Agent 的网络搜索

核验日期：`2026-09-03`。Pi 本体固定分析官方仓库 [`earendil-works/pi`](https://github.com/earendil-works/pi) 的发行标签 [`v0.84.4`](https://github.com/earendil-works/pi/releases/tag/v0.84.4)，提交 SHA 为 [`b79e4cc834970cca69daebffab7df1da7d1e52c4`](https://github.com/earendil-works/pi/commit/b79e4cc834970cca69daebffab7df1da7d1e52c4)。冻结 SHA 是为使工具表、调用链和安全边界能被复核，不把之后 `main` 的变更混入结论。

另固定考察在该日期 npm `latest` 指向的 [`@ollama/pi-web-search@0.0.5`](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5)。包元数据声明作者为 `Ollama`、`pi.extensions: ["./index.ts"]`、发布 gitHead 为 `c5ac4915312ddd95c92dd85fd7b6a5cd65c265c0`；本文关于该包的行为以 npm 官方发布工件 [`pi-web-search-0.0.5.tgz`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz) 中的 `package/index.ts` 为准，工件 `sha1` 是 `c36fd7dabda15c15e01566f4c4b3dbdf5ef34af4`。该 gitHead 对应的公开 GitHub 仓库在核验时不可取得，故不把它当作可复核源码 permalink，也不据此推断 Pi 官方维护关系。

范围：只讨论 Pi Coding Agent 的网络/Web Search 能力、可选 package/extension 与通用 SDK 扩展链。不讨论本地文件/代码搜索、不讨论 OpenCode，且不提出本项目实现方案。

## 结论

1. Pi `v0.84.4` **没有原生 `web_search` 或 `web_fetch` 工具**。其完整 built-in 工具表只有 `read`、`bash`、`powershell`、`edit`、`write`、`grep`、`find`、`ls`；默认 active 集甚至只含 `read`、`bash`、`edit`、`write`。因此 Pi 本体没有可填写 provider、endpoint、API key 的内建 Web Search 配置。([`b79e4cc` tools/index.ts:182-192](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/tools/index.ts#L182-L192), [`b79e4cc` sdk.ts:256-263](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/sdk.ts#L256-L263))
2. Pi 官方文档所说的 `brave-search` 是一个**外部 Skill 的示例工作流**：模型先读 `SKILL.md`，再按其中指令以 `bash` 运行脚本；不是 Pi 注册的 Web Search tool、也没有 Pi 规定的输入/结果协议。官方文档仅链接外部 `badlogic/pi-skills` 作为含 web search/browser automation 的 skill 仓库。([`b79e4cc` skills.md:65-72](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/skills.md#L65-L72), [`b79e4cc` skills.md:191-232](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/skills.md#L191-L232))
3. `@ollama/pi-web-search@0.0.5` 是可安装的 **Ollama 发布的 Pi extension package**，而非 Pi `v0.84.4` 内置工具或 Pi 官方仓库随附 package。它的 manifest 将 `./index.ts` 声明为 extension；Pi 的 package 机制会按 manifest 加载 extension。([npm `@ollama/pi-web-search@0.0.5` 包页](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5), [`b79e4cc` packages.md:116-133](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/packages.md#L116-L133), [`b79e4cc` package-manager.ts:557-584](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/package-manager.ts#L557-L584))
4. 该 package 实际注册的工具名是 `web_search` 与 `web_fetch`，并分别 `POST` 到硬编码的 `http://localhost:11434/api/experimental/web_search` 和 `http://localhost:11434/api/experimental/web_fetch`。它把查询或 URL 交给本机 Ollama；Pi 本体不直接调用搜索提供方。发布包 README 所写的 `ollama_web_search` / `ollama_web_fetch` 与实际 `index.ts` 不一致，调用时应以发布源码的注册名为准。([npm 发布工件 `package/index.ts:21-50,80-101`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz), [npm `@ollama/pi-web-search@0.0.5` 包页](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5))
5. `web_search` 输入是必填 `query: string` 和可选 `max_results: number`；省略时 extension 自己取 `5`，没有最小值、最大值或总字节数钳制，并原样转发为 JSON `{ query, max_results }`。`web_fetch` 只有必填 `url: string`，发送 `{ url }`。这两个 schema 都由 extension 的 TypeBox 定义，Pi 的 agent loop 在 execute 前作 schema validation。([npm 发布工件 `package/index.ts:27-49,81-100`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz), [`b79e4cc` agent-loop.ts:598-665](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L598-L665))
6. 搜索成功结果以普通文本交给模型：每条是序号、标题、`URL: <url>` 和完整 `content`，机器可读副本放入 `details.results`。网页抓取文本包含 `Title`、完整 `Content` 和链接总数，正文只显示前 10 个链接，但 `details.links` 保留原数组。包没有 Pi-style citation object、没有结果质量/排名字段、没有输出或正文截断；是否被下游模型上下文或 Ollama 截断不在该包源码中。([npm 发布工件 `package/index.ts:60-70,111-130`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz), [`b79e4cc` agent-loop.ts:775-788](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L775-L788))
7. 该 extension 不读取 `OLLAMA_HOST`，也不接受 API key/endpoint 设置，更不添加 `Authorization` header；host 固定为 loopback HTTP。收到 HTTP `401` 时仅提示运行 `ollama signin`，其他非 2xx 抛出含 status 和响应文本的 Error；连接拒绝仅在错误消息含 `ECONNREFUSED` 时改写。发布 README 提到 `OLLAMA_HOST`，与该实现矛盾。([npm 发布工件 `package/index.ts:21-23,39-58,71-76,88-108,131-135`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz), [npm `@ollama/pi-web-search@0.0.5` 包页](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5))
8. 网络搜索 tool 的能力来自 Pi 的通用 extension/SDK contract：extension `pi.registerTool()` 注册 TypeBox schema 和 `execute()`；AgentSession 将扩展工具包装并并入 active registry；模型请求获得 `context.tools`，模型 tool call 被查找、校验、执行，成功内容或异常最后写为 `ToolResultMessage`。`execute()` 抛错会产生 `isError: true`，文本错误消息也会回给模型。([`b79e4cc` extensions/types.ts:451-500](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/types.ts#L451-L500), [`b79e4cc` extensions/loader.ts:280-296](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/loader.ts#L280-L296), [`b79e4cc` agent-session.ts:2664-2755](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts#L2664-L2755), [`b79e4cc` agent-loop.ts:668-788](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L668-L788))
9. Pi 不提供内置 sandbox、网络 egress 限制或 web-search 专属审批。extension 与 Pi 进程使用同一 OS 账户权限；Project Trust 只决定是否加载项目本地 package/extension，不限制已启动工具的网络或系统访问。`@ollama/pi-web-search` 从 Pi 到 `localhost` 只发送 query 或 URL，但本机 Ollama 收到后是否再访问外网、使用哪个搜索后端、保留何种数据，不能由 Pi 或该 package 源码确定。([`b79e4cc` security.md:3-35](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md#L3-L35), [npm 发布工件 `package/index.ts:39-49,92-100`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

## 能力归类

| 项目 | 是否 Pi 本体内置 | 是否 Pi 专属协议 | 经过的执行器/提供方 | 证据 |
|---|---:|---:|---|---|
| `web_search` / `web_fetch` | 否 | 否；是通用 extension ToolDefinition | `@ollama/pi-web-search` -> 本机 Ollama experimental HTTP API | [Pi built-in 表](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/tools/index.ts#L182-L192)，[npm 发布工件](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz) |
| `brave-search` Skill 示例 | 否 | 否；是模型读取说明后用工具/脚本 | skill 自带脚本，文档示例要求 npm install | [`skills.md:191-232`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/skills.md#L191-L232) |
| 任意第三方/自写 web tool | 否 | 是 Pi 的通用 ToolDefinition/ExtensionAPI | extension 自行决定 HTTP、MCP、shell 或 provider SDK | [`extensions/types.ts:451-500`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/types.ts#L451-L500) |
| `WebSearch` / `WebFetch` 字符串 | 否 | 否 | Anthropic OAuth “mimic Claude Code”工具名大小写映射 | [`anthropic-messages.ts:76-113`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/anthropic-messages.ts#L76-L113)，[`anthropic-messages.ts:1252-1258`](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/anthropic-messages.ts#L1252-L1258) |

最后一行容易造成误判：Pi 仅在 Anthropic OAuth 兼容路径把**已经存在的** tool name 规范化为 Claude Code 的大小写，收到调用时再匹配当前 `context.tools` 的实际名称；这里没有注册、实现或调用任何 Web Search 服务。([`b79e4cc` anthropic-messages.ts:102-113](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/anthropic-messages.ts#L102-L113), [`b79e4cc` anthropic-messages.ts:639-650](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/anthropic-messages.ts#L639-L650), [`b79e4cc` anthropic-messages.ts:1353-1361](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/ai/src/api/anthropic-messages.ts#L1353-L1361))

## 可选 Ollama package：安装、启用与配置边界

### Package 如何进入 Pi

Pi package 可经 `pi install npm:<pkg>` 写入用户 settings，`pi install -l` 则写项目 `.pi/settings.json`；也可以用 `-e` 临时下载并仅本次运行加载。npm source 带版本号时，Pi 将其视为 pin，不会被 `pi update --extensions` 或 `pi update --all` 前移。([`b79e4cc` packages.md:18-66](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/packages.md#L18-L66))

因此可复现的 package source 形态是：

```json
{
  "packages": ["npm:@ollama/pi-web-search@0.0.5"]
}
```

或用 package 自己 README 的未固定版本命令 `pi install npm:@ollama/pi-web-search`。前者是基于 Pi 的 package pin 语义写出的版本固定形式，后者是包作者列出的安装入口。([`b79e4cc` settings.md:277-318](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/settings.md#L277-L318), [`b79e4cc` packages.md:56-66](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/packages.md#L56-L66), [npm `@ollama/pi-web-search@0.0.5` 包页](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5))

若 package 放在项目 settings，Project Trust 批准前不会加载项目 packages/extensions；全局 package 不受该项目 trust gate 约束。这里的 trust 是**加载代码前**的决定，不是运行时 web 请求授权。([`b79e4cc` security.md:5-29](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md#L5-L29))

### 请求 schema、默认值和 HTTP 线协议

| Tool | TypeBox 输入 | extension 默认/限制 | HTTP 请求 | 上游成功响应假设 |
|---|---|---|---|---|
| `web_search` | `query: string`；`max_results?: number` | `max_results ?? 5`；源码未设数值边界、timeout、重试、分页或字节上限 | `POST http://localhost:11434/api/experimental/web_search`，`Content-Type: application/json`，body `{ query, max_results }`，传入取消 `signal` | `{ results: [{ title: string, url: string, content: string }] }` |
| `web_fetch` | `url: string` | 无默认参数；源码未设 URL allowlist、timeout、重试或正文大小上限 | `POST http://localhost:11434/api/experimental/web_fetch`，`Content-Type: application/json`，body `{ url }`，传入取消 `signal` | `{ title: string, content: string, links: string[] }` |

以上是 package 明确实现的 contract，不是 Ollama endpoint 的完整公共规范。由于 `getOllamaHost()` 返回常量，README 的“检查 `OLLAMA_HOST`”不能作为此版本实际可配置性的证据。([npm 发布工件 `package/index.ts:7-23,25-138`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

### 成功输出、URL 与“引用”

`web_search` 将结果格式化为：

```text
1. <title>
   URL: <url>
   <content>
```

最终是：

```ts
{
  content: [{ type: "text", text: formatted || "No results found." }],
  details: { results: data.results }
}
```

所以 URL 会直接进入模型可见文本并在 `details` 保留，但没有独立 citation/reference 类型，也没有对 URL、标题或正文做可信度/来源验证。([npm 发布工件 `package/index.ts:60-70`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

`web_fetch` 的文本包含 `Title:`、`Content:`、`Links found: N` 与最多 10 条链接；`details` 返回 `{ title, content, links }`，因此显示层的 10 条限制不等于 details 的链接数限制。包没有把原始请求 URL 回显到返回对象，也没有创建 citation object。([npm 发布工件 `package/index.ts:111-130`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

### 截断、取消与错误

- 搜索结果和抓取正文均直接插入 `content`/`details`；该 package 没有逐项、总字节、总行或 token 截断，也没有把完整输出写到临时文件。`web_fetch` 仅对**显示文本**的 `links` 做 `slice(0, 10)`。([npm 发布工件 `package/index.ts:62-70,113-130`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))
- 两个 `fetch()` 都接收 Pi 传入的 `AbortSignal`，但没有本地 timeout。网络库或 Ollama 的超时/取消语义不在此包实现内。([npm 发布工件 `package/index.ts:35-50,88-101`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))
- HTTP `401` 会抛出 `Unauthorized. Run \`ollama signin\` to authenticate.`；其他非成功 HTTP 抛出 `Search API error ...` 或 `Fetch API error ...`，并尽量读取 response text。仅当捕获的 Error message 包含 `ECONNREFUSED`，才转成“无法连接本机 Ollama”的指引；JSON parse、DNS/HTTP/abort 和其他 runtime 错误原样传播。([npm 发布工件 `package/index.ts:52-58,71-76,103-108,131-135`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))
- Pi agent-core 遇到 schema validation、找不到 active tool、hook block 或 `execute()` throw，都会创建 text content 的错误结果，且在写入 `ToolResultMessage` 时设 `isError: true`。因此 package 的 Error 文本会成为模型下一轮可见上下文的一部分。([`b79e4cc` agent-loop.ts:598-665](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L598-L665), [`b79e4cc` agent-loop.ts:668-788](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L668-L788))

## 从模型请求到本机 Ollama 的调用链

```mermaid
flowchart LR
  A[settings packages 或 pi install] --> B[Pi PackageManager]
  B --> C[package.json pi.extensions ./index.ts]
  C --> D[extension 加载并 pi.registerTool]
  D --> E[AgentSession tool registry]
  E --> F[LLM context.tools]
  F --> G[模型返回 web_search 或 web_fetch toolCall]
  G --> H[tool lookup + schema validation + beforeToolCall]
  H --> I[extension execute]
  I --> J[fetch localhost:11434/api/experimental/*]
  J --> K[content + details 或 Error]
  K --> L[ToolResultMessage isError?]
  L --> F
```

1. package manager 从 settings 解析 package，读取 `pi.extensions` manifest 路径；Pi packages 默认可含 extension/skill/prompt/theme 四种资源。([`b79e4cc` settings.md:277-318](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/settings.md#L277-L318), [`b79e4cc` package-manager.ts:557-584](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/package-manager.ts#L557-L584))
2. extension 的默认 export 收到 `ExtensionAPI` 后调用 `pi.registerTool()`；注册写入 extension tool map 并触发 `runtime.refreshTools()`。([npm 发布工件 `package/index.ts:25-138`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz), [`b79e4cc` extensions/loader.ts:280-296](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/loader.ts#L280-L296))
3. `AgentSession` 用 runner context 包装扩展 tool，并将 extension/SDK custom tools 追加到 built-in registry；同名 custom tool 后写，能够覆盖同名 built-in。工具是否最终 active 还受 `--tools` allowlist、`--exclude-tools` 与 active-tool 管理影响。([`b79e4cc` extensions/wrapper.ts:13-45](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/extensions/wrapper.ts#L13-L45), [`b79e4cc` agent-session.ts:2664-2755](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts#L2664-L2755))
4. agent loop 将当前 `context.tools` 放进模型请求。模型返回 tool call 后，Pi 按名称寻找 active tool、执行可选 `prepareArguments`、验证 schema、运行 `beforeToolCall`，再调用该 tool 的 `execute()`。此 package 的 execute 遂向本机 Ollama 发送 HTTP。([`b79e4cc` agent-loop.ts:275-310](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L275-L310), [`b79e4cc` agent-loop.ts:598-705](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L598-L705), [npm 发布工件 `package/index.ts:35-76,88-135`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))
5. `afterToolCall` 可再改写成功/失败结果；最终 `content`、`details` 和 `isError` 写入 tool-result message，成为后续模型请求的消息。Pi 的通用 contract 正是 package 能将任何 HTTP provider 接到 agent 的边界；没有 web-search 专用 Pi SDK。([`b79e4cc` agent-loop.ts:711-788](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L711-L788), [`b79e4cc` extensions.md:1911-2017](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#L1911-L2017))

## API key、权限和隐私边界

### API key / host / 启用

| 边界 | Pi `v0.84.4` 本体 | `@ollama/pi-web-search@0.0.5` |
|---|---|---|
| web-search provider 配置 | 无；没有 native web tool | 固定到本机 `http://localhost:11434` |
| web-search API key 配置 | 无 | 无环境变量读取、无参数、无 `Authorization` header |
| `OLLAMA_HOST` | Pi source 未提供 web tool 配置 | README 文字提到，但发布 `index.ts` 未读取，故对 `0.0.5` 无效 |
| 启用 | 不适用 | package install/settings load + extension active；项目级仍需 Project Trust |
| 401 | 不适用 | 只提示 `ollama signin`；认证协议由本机 Ollama 决定 |

Pi 为模型 provider 解析 API key 的逻辑（如 Anthropic/OpenAI）发生在模型流请求路径，和 extension 的 loopback HTTP request 是两套事；package 未复用那套 provider credential。([`b79e4cc` agent-loop.ts:302-310](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/agent/src/agent-loop.ts#L302-L310), [npm 发布工件 `package/index.ts:21-23,39-49,92-100`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

### Pi 侧的系统权限

Pi 以启动它的 OS 用户权限运行；extensions 也是同一进程权限，没有 built-in sandbox。Project Trust 只阻止项目的 settings/resources/package/extension 在批准前加载；它不会限制已经运行的 extension 的 HTTP、文件或进程权限。需要 egress/credential 限制须依赖 OS、container、VM 或其他外部隔离边界。([`b79e4cc` security.md:3-8](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md#L3-L8), [`b79e4cc` security.md:20-35](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md#L20-L35), [`b79e4cc` security.md:39-53](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/security.md#L39-L53))

### 数据流与隐私可证实范围

发布包能直接证实的仅是：`web_search` 将 `query`、`max_results` 以 JSON 发送给 loopback；`web_fetch` 将 `url` 以 JSON 发送给 loopback；两者只显式设置 `Content-Type`。Pi/extension 源码不能证明本机 Ollama 后续是否把这些数据发送到互联网、使用哪家搜索服务、是否记录 query/URL/页面内容、或这些数据的 retention。不能把“Pi 请求是 localhost”误读成“搜索流程没有外发”。([npm 发布工件 `package/index.ts:39-49,92-100`](https://registry.npmjs.org/@ollama/pi-web-search/-/pi-web-search-0.0.5.tgz))

## 复核方法

Pi 本体所有链接都固定为 `b79e4cc834970cca69daebffab7df1da7d1e52c4`。复核 package 工件可下载指定 npm tarball，校验 SHA-1 后读取 `package/index.ts`：

```bash
npm pack @ollama/pi-web-search@0.0.5
shasum -a 1 ollama-pi-web-search-0.0.5.tgz
tar -xzf ollama-pi-web-search-0.0.5.tgz
sed -n '1,220p' package/index.ts
```

预期 SHA-1 是 `c36fd7dabda15c15e01566f4c4b3dbdf5ef34af4`；NPM 也为该版本公布 integrity `sha512-qz6T31cccn5vg/+BeEwEylYpDU2hdrVGKhUzi4m7FZv5z9RTqF1HUQ8p4kHXhd0aYjd8TMcZvonjwnpTHPnYsQ==`。([npm `@ollama/pi-web-search@0.0.5` 包页](https://www.npmjs.com/package/@ollama/pi-web-search/v/0.0.5), [npm registry version metadata](https://registry.npmjs.org/@ollama/pi-web-search/0.0.5))

## 未确认点与版本外变量

1. Pi 官方仓库和此 package 的发布工件不足以确认 Ollama experimental web endpoints 的服务端 schema、`max_results` 的实际最大值/分页、可用搜索提供方、账号计划、地域策略、cache/retention 与外发数据处理；这些属于 Ollama 服务端/部署配置，不应从 extension 客户端代码推断。
2. 包元数据自称作者 `Ollama` 且在 `@ollama` scope 发布，但 README 所列 GitHub 安装源在核验时返回不存在，故只能确认 npm 发布者元数据与工件内容，不能进一步确认公开源码仓库、提交 `c5ac...` 的可访问 provenance，或把它归类为 `earendil-works/pi` 官方维护 package。
3. 没有对真实 Ollama 服务执行请求：HTTP `401`、`ECONNREFUSED`、abort、非 JSON body 与超大结果的运行时效果只按 extension 代码描述。特别是 `fetch` 实现对连接拒绝的 error message 是否包含 `ECONNREFUSED` 受运行时环境影响。
4. 本笔记固定的是 Pi `v0.84.4`。安装的 extension/SDK custom tool、`--tools` allowlist、`--exclude-tools`、hook 或后续 Pi/NPM 版本都能改变模型可见 tool 集、输入输出或执行前后拦截行为；应对具体运行实例审计其已加载资源和设置。([`b79e4cc` agent-session.ts:2664-2755](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/src/core/agent-session.ts#L2664-L2755), [`b79e4cc` extensions.md:1911-2017](https://github.com/earendil-works/pi/blob/b79e4cc834970cca69daebffab7df1da7d1e52c4/packages/coding-agent/docs/extensions.md#L1911-L2017))

## 对本项目的影响

本次调研只更新认知：Pi 自身没有 native web-search provider/tool；可选网络搜索来自通用 extension/skill 机制。没有修改任何产品代码、配置或既有 `pi-agent-search.md` 文件。
