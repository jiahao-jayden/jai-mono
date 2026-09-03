# Pi coding-agent 图片附件处理调研

调研对象：本仓库 `study/pi` 的源码，核对版本 `f08f58f5f9525d3f532eda1df9082f1831241e2f`（2026-07-27）。

## 结论

Pi 不在附件层根据当前模型能力决定“是否生成图片内容”。它先把图片处理成内部 `ImageContent`，保留在消息/工具结果中；发送到 provider 前，再由 AI 层根据 `model.input.includes("image")` 做降级。

不支持图片的模型收到的是文本占位符，而不是错误、文件路径或自动 OCR：

```text
(image omitted: model does not support images)
(tool image omitted: model does not support images)
```

## 关键源码

- `packages/coding-agent/src/cli/file-processor.ts:24-86`：通过 magic bytes 识别 JPEG/PNG/GIF/WebP/BMP；读取并处理图片，必要时转 PNG、缩放，再生成 `ImageContent`。普通文件读取为 UTF-8 文本。
- `packages/coding-agent/src/core/tools/read.ts:87-92,243-263`：Read 工具读取图片时始终返回说明文本和 `ImageContent`；当前模型不支持 image 时，只附带“图片会在请求中省略”的提示。
- `packages/ai/src/api/transform-messages.ts:12-57`：provider 前检查模型输入模态；不支持图片时，将 user/toolResult 中的图片 block 替换成文本占位符。
- `packages/coding-agent/src/core/sdk.ts:255-288`：`blockImages` 是独立的用户设置，可把图片替换为 `Image reading is disabled.`，不等同于模型能力判断。

## 对 Jai 当前设计的影响

`CodingAttachmentRun.project()` 不应在附件层按 `model.input` 决定是否读取图片 bytes。更接近 Pi 的方案是：

1. 附件/Coding 层生成本轮图片 `ImageContent`（仍然 lazy、只在运行时存在，不持久化到 session）；
2. Coding Agent 的消息投影保留图片 block 和文件说明；
3. provider request 前增加通用的 image-capability projection：不支持 image 时将图片替换成明确的文本占位符；
4. 不做自动 OCR、不改成绝对路径、不把 provider error 当作正常降级。

这样模型切换、历史重放和工具返回图片都遵循同一规则：内部内容完整，provider 适配层按能力投影。
