# Claude Code 文件上传与文件上下文支持调研

> 调研日期：2026-08-09（Asia/Singapore）  
> 范围：Claude Code CLI、Claude Desktop 的 Code tab、Claude Code on the web，以及 Anthropic 对 Claude 文件上传能力的官方说明。  
> 资料只采用 Anthropic/Claude 官方文档；Claude Code 文档页面未显示单独的发布日期，以下标注访问日期。

## 结论先行

如果要让 jai-mono 的 `+ → Add files or photos` 首版贴近 **Claude Code Desktop**，最稳妥的产品边界是：

1. **直接附件：先支持图片和 PDF。** Claude Code Desktop 的功能对比表把 Desktop 的 `File attachments` 明确列为 `Images, PDFs`；提示框文档同时写明可以用附件按钮或拖拽加入 prompt。[Claude Code Desktop：文件上下文](https://code.claude.com/docs/en/desktop#add-files-and-context-to-prompts)（访问于 2026-08-09）；[CLI/Desktop 功能对比](https://code.claude.com/docs/en/desktop#feature-comparison)（访问于 2026-08-09）
2. **代码、文本和项目内文件：不要走“上传附件”语义，使用工作区文件引用。** Desktop/CLI 用 `@filename`（Desktop 本地/SSH 有自动补全；云/WSL 不可用）把项目文件带入上下文；CLI 文档也说明单文件引用会把完整内容放入对话，目录引用只提供文件列表。[Claude Code Desktop](https://code.claude.com/docs/en/desktop#add-files-and-context-to-prompts)（访问于 2026-08-09）；[Common workflows：Reference files and directories](https://code.claude.com/docs/en/common-workflows#reference-files-and-directories)（访问于 2026-08-09）
3. **CLI 没有通用文件附件选择器。** 官方对比表标注 CLI `File attachments: Not available`。CLI 仍有“图片专用”输入：拖拽图片、Ctrl+V 粘贴图片或给出图片路径；这不是一个可把任意文件当附件发送的通用菜单。[CLI/Desktop 功能对比](https://code.claude.com/docs/en/desktop#feature-comparison)（访问于 2026-08-09）；[Common workflows：Work with images](https://code.claude.com/docs/en/common-workflows#work-with-images)（访问于 2026-08-09）
4. **Office、压缩包不能按 Claude Code 的官方附件 allowlist 推断为已支持。** Anthropic 对一般 Claude 聊天的上传说明列出 DOCX、CSV、TXT、HTML、ODT、RTF、EPUB、JSON、XLSX，以及 JPEG/PNG/GIF/WebP；但这不是 Claude Code Desktop 的附件枚举，而且 `PPTX`、`ZIP`/`TAR` 等不在该上传列表中。[Upload files to Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude)（2026-04-22 发布，访问于 2026-08-09）

因此，**实现上不要把原生文件选择器设成“任意文件且发送成功”**。建议先做图片/PDF的真实附件闭环；文本/代码走工作区引用；DOCX/CSV 等后续若要支持，应单独定义解析/上传协议并以能力探测或明确的 MIME allowlist 为准；ZIP/TAR 默认作为项目文件由 Agent 通过 Bash 解包后再读，而不是直接作为模型附件。

## 按产品表面区分

| 表面 | 直接作为 prompt 附件 | 通过工作区/路径带上下文 | 官方交互方式 |
| --- | --- | --- | --- |
| Claude Code Desktop（Code tab） | 官方对比表明确：图片、PDF；提示框段落另称“images, PDFs, and other files”，但未给出“other files”清单 | `@mention` 文件；本地/SSH 会话可用，云/WSL 不可用；项目文件也可让 Claude 读取 | `+` 附件按钮、拖拽到 prompt；`@filename` |
| Claude Code CLI | 通用文件附件：不可用 | `@path` 引用项目文件/目录；图片可直接给路径；也可让 Claude 用 Bash/Read 读取工作区文件 | 图片拖拽、Ctrl+V（iTerm2 的 macOS 可 Cmd+V）、图片路径；`@` 文件引用 |
| Claude Code on the web / cloud | 官方 web 文档描述的是 GitHub 仓库 clone/本地 bundle；本次未找到 Code web 的独立附件 allowlist | 仓库内容在云 VM 中可读；本机未提交文件不会自动出现，需提交/推送或用 bundle | 从浏览器提交任务；以仓库/云环境为上下文 |
| Claude 一般聊天（Web/Desktop/Mobile） | PDF、DOCX、CSV、TXT、HTML、ODT、RTF、EPUB、JSON、XLSX*；图片 JPEG、PNG、GIF、WebP | 项目 Files 可持久引用；项目文件“仅文本提取”，多模态 PDF 例外 | `+ → Add files or photos`、打开文件、拖拽、复制图片后粘贴 |

“Claude 一般聊天”这一行是 Anthropic 的通用上传能力，不能直接当作 Claude Code Desktop 的附件契约；它的作用是提供 Anthropic 产品层面的文件类型参考。

## Claude Code 的两种上下文语义

### A. 直接附件（prompt attachment）

附件随这一条 prompt 一起提交，适合用户从当前设备临时提供的截图、设计稿、参考 PDF。Desktop 文档把附件按钮和拖拽都定义为把文件加入 prompt；这应在 jai-mono 中表现为“本次消息的附件”，发送前可预览/移除，发送后与消息一起持久化。

Claude Code 文档没有为 Desktop 的“other files”列出扩展名或 MIME 表；与功能对比表的 `Images, PDFs` 发生信息不对称。因此不能把“other files”解释为“任意文件都能被模型解析”。

### B. 工作区文件引用（workspace/path context）

工作区文件是 Agent 通过项目环境、`@` 引用或工具读取获得的上下文，不是从用户设备上传到消息的附件：

- `@file`：把单个文件的完整内容加入对话；可相对或绝对路径，可一次引用多个文件。
- `@directory`：只提供目录列表和文件信息，不自动注入所有文件内容。
- 图片：CLI 官方工作流支持直接给图片路径；多张图片可在同一对话中使用。
- PDF：VS Code 官方集成文档建议大 PDF 按页或页范围读取，说明 PDF 更适合作为路径/工作区文件按需读取，而不是盲目整份注入。[VS Code 集成：PDF 页范围](https://code.claude.com/docs/en/ide-integrations#send-a-prompt)（访问于 2026-08-09）

对于 Office、压缩包和其他二进制文件，官方只证明 Agent 可以在项目环境中运行命令和读取文件；没有证明“原始二进制字节会直接进入模型上下文”。产品上应提示用户先转换/提取（例如 DOCX → 文本、ZIP → 解压目录），或由 Agent 使用 Bash 工具处理。

## 官方通用 Claude 上传能力（仅作参考）

Anthropic Help Center 的《Upload files to Claude》（2026-04-22）给出了通用 Claude 聊天的明确列表：

### 文档

`PDF`、`DOCX`、`CSV`、`TXT`、`HTML`、`ODT`、`RTF`、`EPUB`、`JSON`、`XLSX*`。上传 XLSX 要求账户启用代码执行和文件创建。

### 图片

`JPEG`、`PNG`、`GIF`、`WebP`。

### 上传方式与限制

- 方式：`+` → Add files or photos、设备文件选择、拖拽到聊天窗口、复制图片后从剪贴板粘贴。
- 单个聊天上传：每个文件最大 500 MB、每个聊天最多 20 个文件、图片最大 8000×8000 像素。
- 项目 Files：单文件 30 MB、文件数量不限但受上下文窗口约束；内容类型为文本提取，多模态 PDF 除外。
- PDF：小于 100 页时可分析文本和视觉元素；超过 1000 页时仅处理文本。100–1000 页的具体处理边界官方文章未说明。
- 非 PDF 文档只提取文本，嵌入图片不会被读取或解释。

## 对 jai-mono 文件菜单的建议

### 首版 allowlist（推荐）

```text
image/jpeg
image/png
image/gif
image/webp
application/pdf
```

首版可允许多选；UI 展示图片缩略图、PDF 文件卡片，并在发送前允许移除。限制可先采用不超过 20 个文件/消息、单文件不超过 500 MB、图片不超过 8000×8000 像素；若本地产品需要更保守的桌面 UX，可先设置更低的工程上限，但不要声称那是 Claude Code 的官方上限。

### 第二阶段候选

如果产品明确要“上传文档”，可参考通用 Claude 的 `DOCX/CSV/TXT/HTML/ODT/RTF/EPUB/JSON/XLSX` 列表，但必须先定义：

1. 上传后是直接转成 Anthropic document content，还是复制到 workspace 后让 Agent 读取；
2. 非 PDF 只做文本提取还是保留版式/表格；
3. XLSX 是否依赖代码执行/文件创建能力；
4. 文件解析失败、超限和模型不支持时如何以白名单 DTO 返回错误。

### 默认不作为直接附件

`PPTX`、`ZIP`、`TAR/GZ`、磁盘镜像、数据库文件和其他未知二进制格式不应在首版被假装支持。可以让用户把它们放入项目目录，再由 Agent 使用 Bash/专用解析器处理；UI 文案应称“添加到工作区/引用文件”，不要称“发送给模型”。

## 来源

1. [Claude Code Desktop — Add files and context to prompts](https://code.claude.com/docs/en/desktop#add-files-and-context-to-prompts)（Anthropic，访问于 2026-08-09）
2. [Claude Code Desktop — Feature comparison](https://code.claude.com/docs/en/desktop#feature-comparison)（Anthropic，访问于 2026-08-09）
3. [Claude Code Common workflows — Work with images](https://code.claude.com/docs/en/common-workflows#work-with-images)（Anthropic，访问于 2026-08-09）
4. [Claude Code Common workflows — Reference files and directories](https://code.claude.com/docs/en/common-workflows#reference-files-and-directories)（Anthropic，访问于 2026-08-09）
5. [Claude Code in VS Code — PDF page ranges and attachments](https://code.claude.com/docs/en/ide-integrations#send-a-prompt)（Anthropic，访问于 2026-08-09）
6. [Upload files to Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude)（Anthropic Help Center，发布于 2026-04-22，访问于 2026-08-09）
7. [Claude Code Changelog](https://code.claude.com/docs/en/changelog)（Anthropic，相关版本：0.2.59/0.2.75/1.0.93/2.1.83/2.1.132；访问于 2026-08-09）

