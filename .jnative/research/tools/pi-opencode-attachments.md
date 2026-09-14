# Pi 与 OpenCode 的文件 / 附件实现调研

> 调研日期：2026-08-09（Asia/Singapore）  
> 范围：仅官方仓库源码；未使用第三方解读。  
> 版本：Pi `936aff00918de1187f085f123c2812d8f2d67745`（2026-08-09），OpenCode `38e10eb1408feb700021b8e8766fb0ab41bf84e2`（2026-08-08）。下面所有 GitHub 链接都固定到该 commit，避免 `main` / `dev` 演进改变结论。

## 结论先行

两者都**没有**在通用 Composer 层实现“任意文件 → 统一 Provider Files API 上传 → `file_id`”的方案。

- **Pi** 的一等附件类型只有 `ImageContent`：`base64 data + MIME`。启动命令中的非图片 `@file` 会被以 UTF-8 读入并内联为 `<file>` 文本；图片则成为原生 image content。也就是说，它的通用“文件支持”实质上是“文本内联 + 图片附件”，而不是文档上传。
- **OpenCode** 的一等模型边界是 `{ mime, filename, url }` 的 `FilePart`。Composer 可接收图片、PDF 和文本/代码文件：文本走本地 Read tool / 文本上下文；图片和 PDF 转成 `data:<mime>;base64,...` 并交给 AI SDK。它按当前模型声明的 `image` / `pdf` 能力拦截不支持的媒体，而不是静默假装附件已经生效。

因此，若 PandaWork 要借鉴成熟模式，最可复用的不是某一家 SDK 的上传 API，而是：

```text
统一 Attachment / FilePart
├─ text/code      → 本地读取，明确作为文本上下文
├─ image          → base64 data URL，按 image 能力发送
├─ PDF            → base64 data URL，按 pdf 能力发送
└─ 其他二进制     → 显式拒绝，或独立接入解析 / Provider 原生文件适配器
```

这里的 `data URL` 仍会随模型请求发送到云端 Provider；它只表示**应用不先调用 Provider 的 Files API**，并不表示文件不会离开本机。

## Pi coding agent / `pi-agent-core`

### 输入模型与文件处理

Pi AI 层的 `UserMessage.content` 是文本或 `TextContent | ImageContent` 数组；`ImageContent` 仅包含 `type: "image"`、base64 `data` 和 `mimeType`，没有 PDF 或泛用文件块。[`packages/ai/src/types.ts`](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/ai/src/types.ts#L354-L411)

Pi coding agent 的 CLI 把启动命令的 `@file` 参数分为两条路：

1. 先通过文件头识别 JPEG、PNG、GIF、WebP、BMP；图片读取后会处理/可选缩放，转为 `ImageContent`，并在提示文本里加入文件名引用。
2. 其余文件一律调用 `readFile(path, "utf-8")`，把结果嵌进 `<file name="…">…</file>`。源码没有针对 PDF、DOCX、XLSX 或其他二进制文档的解析或 Provider upload 分支。

[`packages/coding-agent/src/cli/file-processor.ts`](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/cli/file-processor.ts#L1-L86)；[MIME magic 检测](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/utils/mime.ts#L1-L39)；[图片格式规范化与缩放](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/utils/image-process.ts#L1-L115)。

这些 `@file` 只在**初始命令行消息**预处理：`main.ts` 生成 `initialMessage` / `initialImages`，交给 `session.prompt(..., { images })`；interactive loop 中后续消息直接调用 `session.prompt(userInput)`。所以不能把 Pi CLI 的 `@file` 当成“每一条交互消息都有完整附件选择器”的实现。[`main.ts`](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/main.ts#L218-L241)；[interactive 初始化与循环](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1052-L1100)。

交互式 Ctrl+V 图片也不是上传协议：它会将剪贴板像素写入操作系统临时目录，然后只把临时**路径文本**插入编辑器。Agent 可自行通过 Read tool 再读取它。[`handleClipboardPaste`](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2824-L2866)。

### Provider 能力与降级

Pi 的模型元数据将输入能力表示为 `input: ("text" | "image")[]`。发送前，若模型不含 `image`，它将用户/工具结果里的图片替换为 `(image omitted: model does not support images)` 文本占位符；不会尝试上传、OCR 或转文件。[`transform-messages.ts`](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/ai/src/api/transform-messages.ts#L1-L72)；[Image Input 文档与示例](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/ai/README.md#L673-L708)。

不同 Provider adapter 将同一份 base64 图片转为各自 API 的内联形式。例如 OpenAI Responses adapter 生成 `input_image` data URL；Anthropic adapter 使用其 base64 image source。这里没有查到 Pi 走 OpenAI/Anthropic Files API 并保存远端 `file_id` 的路径。 [OpenAI Responses adapter](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/ai/src/api/openai-responses-shared.ts#L78-L104)；[Anthropic adapter](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/ai/src/api/anthropic-messages.ts#L117-L157)。

### 持久化

Pi 的 session 格式直接把 image content（含 base64）放进消息内容；session manager 把每条 entry `JSON.stringify` 进 JSONL。因此已发送图片能随会话重放，但代价是会话文件包含附件字节；不是“只存文件路径 / file id”。[session format](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/docs/session-format.md#L50-L100)；[JSONL 写入](https://github.com/badlogic/pi-mono/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/session-manager.ts#L979-L1042)。

## OpenCode

### Composer 可选类型与草稿保存

OpenCode 的 app Composer allowlist 包括 PNG/JPEG/GIF/WebP、PDF、`text/*`、JSON/TOML/YAML/XML，以及一长串常见代码与配置扩展名。未知文件会再取前 4096 bytes 判断是否像纯文本；二进制则拒绝。它不是“任意 Office 文档 / 压缩包均可上传”。[allowlist](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/constants/file-picker.ts#L1-L82)；[MIME / 文本启发式](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/components/prompt-input/files.ts#L1-L85)。

前端暂存的类型虽然历史上名为 `ImageAttachmentPart`，实际携带 `filename`、MIME 与 `BlobReference`，可用于上述所有被接受类型。Blob 先以 SHA-256 ID 去重；浏览器草稿存储会把二进制 Blob 与草稿 JSON 分离存入 IndexedDB，而不是把 base64 直接塞进未发送草稿。 [prompt state](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/context/prompt-state.ts#L14-L47)；[draft Blob store](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/utils/draft-store.ts#L1-L148)。

Desktop 主进程的文件选择 API 有明确的授权 token：只允许该 renderer 在一次选择中读取选定路径，并限制所选文件**总大小**不超过 20 MiB。这既避免 renderer 获得任意路径读取权，也使“文件选择”有可控的本地权限边界。 [`attachment-picker.ts`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/desktop/src/main/attachment-picker.ts#L1-L57)；[IPC picker/read handlers](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/desktop/src/main/ipc.ts#L169-L202)。

### 统一 `FilePart`，而非 Provider file ID

发送时，Composer 将 draft Blob 转为 `data:<mime>;base64,...`，制作 `{ type: "file", mime, filename, url }` 请求 part。 [`submit.ts`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/components/prompt-input/submit.ts#L99-L188)；[request parts](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/components/prompt-input/build-request-parts.ts#L196-L209)。

服务端的 `FilePart` 领域模型就是 MIME、文件名、URL 和可选来源；URL 可为 `data:` 或 `file:`，也可来自 MCP resource。它没有把“远端 Provider 文件 ID”设为跨 Provider 通用字段。 [schema](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/schema/src/v1/session.ts#L166-L179)；[输入 schema](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/schema/src/v1/session.ts#L396-L421)。

`file:` 的实际处理也区分语义：

- `text/plain`：执行 Read tool，把文本结果作为 synthetic text context；
- 目录：执行 Read tool，提供目录信息；
- 非文本（例如 image/PDF）：本地读取后立即序列化为 base64 `data:` URL；
- 已经是 `data:text/plain`：直接解码成 synthetic text；MCP 二进制资源仅允许受支持 MIME 和大小范围。

[`SessionPrompt.resolveUserPart`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/session/prompt.ts#L699-L972)。

接着，除 `text/plain` 与目录外的 FilePart 会成为 AI SDK 的 `file` message part（即图片、PDF 等原生媒体输入），不会转换为 Markdown。 [`MessageV2.toModelMessages`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/session/message-v2.ts#L199-L235)。当前这条主线中未见 Provider Files API upload/`file_id` 的通用适配层；它采用 data URL / file reference。

### 按模型能力拒绝，而非静默降级

OpenCode 的模型能力分别记录 `text`、`audio`、`image`、`video`、`pdf` 输入；这些数据来自模型目录或用户 Provider 配置。 [`provider.ts`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/provider/provider.ts#L1437-L1478)；[配置 schema](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/core/src/v1/config/provider.ts#L1-L66)。

模型请求转换阶段将 MIME 映射到 modality（`image/* → image`、`application/pdf → pdf` 等）。如果当前模型没有该输入能力，它用一段明确的 `ERROR: Cannot read ...` 文本替代该 part，要求 Agent 告知用户；空或损坏的 data URL 图片也会得到明确错误。 [capability gate](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/provider/transform.ts#L1-L16)；[unsupported part handling](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/provider/transform.ts#L408-L468)。

只有图片会在会话保存前按配置自动缩放；默认最大边长 2000 px、最大 base64 5 MiB，超限且无法缩小会返回结构化大小错误。PDF 和文本没有被这个 image resize 流程篡改。 [`image.ts`](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/image/image.ts#L1-L136)；[只对 `image/*` 调 normalize](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/session/prompt.ts#L970-L1000)。

### 已发送附件的持久化

OpenCode 将发送后的 message 与 part 分别落在本地数据库表；`PartTable.data` 是 JSON，FilePart 的 `url` 会保留 data URL 或来源 URL。因此媒体 data URL 的 base64 会成为会话历史的一部分，可供后续请求重放；前端 IndexedDB draft Blob 仅负责**发送前**草稿。 [PartTable](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/core/src/session/sql.ts#L82-L100)；[part 投影保存](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/core/src/session/projector.ts#L85-L99)；[upsert](https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/core/src/session/projector.ts#L310-L331)。

## 对照

| 维度 | Pi | OpenCode |
| --- | --- | --- |
| 统一输入对象 | `TextContent | ImageContent` | `FilePart { mime, filename, url, source? }` + text part |
| 用户可直接处理的类型 | CLI 初始化：图片；其他仅 UTF-8 文本 | 图片、PDF、文本/代码 allowlist；未知二进制拒绝 |
| 原始媒体表示 | 图片 base64 + MIME | 图片/PDF 通常 data URL；本地文件也可先为 `file:` reference |
| 文本 / 代码 | 内联 `<file>` 文本 | 本地 Read tool → synthetic text context |
| Provider Files API / `file_id` | 本次所查路径无 | 本次所查 Composer 到 model 路径无 |
| 模型不支持图片/PDF | 图片替换为 omitted 占位文本 | 显式 `ERROR: Cannot read …` 文本 |
| 发送后持久化 | JSONL 内联保存 base64 image | 本地 DB `PartTable` 保存 data URL / URL |
| 选择文件的权限边界 | CLI 本地进程直接读取命令行路径 | Desktop 令牌化、单次授权读选中路径，20 MiB 总预算 |

## 对 PandaWork 首页上传菜单的启示

1. **先定义跨 Provider 的本地 `Attachment`，不要先把 `file_id` 放进领域模型。** 最低字段应是安全的文件元信息、来源/生命周期、MIME、传输表征（临时本地文件或 bytes），并在 Provider adapter 边界才投影为 data URL 或原生 file reference。
2. **文本与媒体不是同一条降级链。** 文本/代码可稳定地用本地 Read/提取结果作为上下文；图片/PDF 应以模型能力声明决定是否允许发送。不要把“不支持 PDF”悄悄改成乱码文本。
3. **选完文件不等于永久放行文件系统。** OpenCode 的 picker token 是值得借鉴的安全细节：renderer 只可读取该次用户选择的指定路径，并有总尺寸预算。
4. **要产品真正“支持很多文档”，必须新增第三条明确路线。** Pi 和 OpenCode 的这一主线都没有解决 DOCX/XLSX/PPTX/ZIP 的通用模型理解。可选路线是本地解析（例如 anydoc）或每个 Provider 的原生 Files API adapter；两者都应有显式能力、隐私提示、失败状态和持久化策略，不能伪装成单纯的文件选择。

## 不确定性与边界

- 这是两个仓库在上方固定 commit 的实现，不是任何云端 Provider 的永久 API 保证。
- “未见 Files API / `file_id`”限定于本文追踪的 Pi coding-agent/AI adapter 与 OpenCode Composer→session→model 主路径；未逐一否定全部插件、实验功能和第三方 Provider SDK 的专有扩展。
- OpenCode frontend 类型仍将普通附件命名为 `ImageAttachmentPart`，但 allowlist、MIME 检测和发送路径表明它实际承载 PDF 与文本/代码文件；名称不应被误读为“只能图片”。
