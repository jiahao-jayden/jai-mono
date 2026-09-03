# Pi 与 OpenCode 的附件实现模式

> 调研日期：2026-08-09（Asia/Singapore）  
> 资料范围：Pi (`badlogic/pi-mono`，commit `936aff00918de1187f085f123c2812d8f2d67745`) 与 OpenCode (`anomalyco/opencode`，commit `38e10eb1408feb700021b8e8766fb0ab41bf84e2`) 的一手源码。

## 结论先行

- **Pi 的直接消息附件只有图片。** 非图片 `@file` 会按 UTF-8 文本读取并内联为 `<file>` 文本；图片会按 MIME 检测、压缩/缩放后作为 base64 `ImageContent` 进入消息。它不建立通用文档附件模型。
- **OpenCode 建立了 Provider-neutral 的 `FilePart`。** 每个附件持久化 `mime`、`filename`、`url`，再交给 AI SDK / provider adapter；文本文件走本地 Read 工具并变为 synthetic text，图片和 PDF 等二进制以 `file` content part 交给模型。
- **OpenCode Desktop 的安全边界值得复用。** 原生进程打开文件选择器，返回一次性、按 renderer 绑定的授权 token；renderer 只能读取本次选中的路径，且总大小限制为 20 MiB。这样不把任意本地路径能力暴露给 renderer。

## Pi：图片直传，文本内联

Pi 的 `packages/coding-agent/src/cli/file-processor.ts` 处理 `@file` 参数：

1. 检测 JPG/PNG/GIF/WebP/BMP 等图片 MIME。
2. 图片经 `processImage` 调整尺寸后转 base64 `ImageContent`，随 user message 发送。
3. 非图片用 UTF-8 读取，包进 `<file name="…">…</file>` 文本。

`AgentSession` 的 `PromptOptions`、`prompt`、`steer`、`followUp` 也只暴露 `images?: ImageContent[]`；其 Read tool 同样只把图片作为附件，文本作为文本内容。

这条路径简单，但不适用于 PDF、Office、压缩包等二进制文档：这些内容不是一等附件，也没有 provider-native 文件路由。

## OpenCode：统一附件对象，按 MIME 与模型能力路由

OpenCode 的 `FilePart` 包含：

```ts
{ type: "file", mediaType: string, filename?: string, url: string }
```

`session/prompt.ts` 会将本地 `file:` URL 解析为：

- `text/plain`：通过 Read tool 读取，产出 synthetic text；
- 目录：通过 Read tool 提供目录内容；
- 其他 MIME：读取二进制并保存成 data URL；
- 图片：还会经过 `image.normalize`，默认缩到最多 2000×2000 像素与 5 MiB base64 预算。

`session/message-v2.ts` 随后把非文本 `FilePart` 发送给 Vercel AI SDK 的 `type: "file"` part，携带 `url`、`mediaType`、`filename`。Provider 能力模型明确区分：`attachment`、以及 `input.image`、`input.pdf` 等。会话压缩时，媒体可被显式剥离，并告知用户附件因请求大小而移出上下文。

## OpenCode Desktop 的文件选择安全模式

`packages/desktop/src/main/attachment-picker.ts` 和 `ipc.ts`：

1. 主进程通过原生文件选择器选择文件。
2. 选择结果受单次总量 20 MiB 限制。
3. 主进程创建随机 token，绑定 Electron renderer ID、已选路径集合与剩余字节预算。
4. renderer 用 token 请求每个文件内容；同一路径只能读取一次，跨 renderer 或非已选路径会被拒绝。
5. 读完全部文件或显式释放 token 后，授权失效。

## 对 PandaWork 的建议

借鉴 OpenCode 的结构，但不复制它的 data-URL 策略：

1. 新增一等 `MessageAttachment`（而不是在文本字段中塞文件名或 base64）。
2. 文件选择与读取都在 Electron main process；renderer 只得到安全的预览 DTO。
3. 每个附件记录 MIME、文件名、大小、受控本地路径/内容引用、处理状态与派生文本（若有）。
4. Provider adapter 负责能力路由：原生文件、图像输入、本地 `anydoc` fallback、或受控本地 Agent 读取。
5. 原始二进制不进入 transcript JSON；会话只保留安全元数据与受控的附件存储引用。

## 来源

- https://github.com/badlogic/pi-mono/tree/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/cli/file-processor.ts
- https://github.com/badlogic/pi-mono/tree/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/agent-session.ts
- https://github.com/anomalyco/opencode/tree/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/desktop/src/main/attachment-picker.ts
- https://github.com/anomalyco/opencode/tree/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/session/prompt.ts
- https://github.com/anomalyco/opencode/tree/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/session/message-v2.ts
