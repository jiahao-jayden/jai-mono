# Claude.ai Artifacts 产品契约研究

- 研究票：[jiahao-jayden/jai-mono#55](https://github.com/jiahao-jayden/jai-mono/issues/55)
- 调研日期：2026-08-05
- 范围：Claude / Claude Desktop 中的 Artifacts；Claude Code 与 Cowork 的同名能力仅用于划清边界
- 目标：提炼 PandaWork 可借鉴的最小产品契约，不讨论技术实现

## 结论摘要

Claude Artifacts 的核心契约不是一种文件格式，而是一种与对话关联、具有明确内容类型和版本的独立作品。Claude 在内容足够独立、重要且可能复用时把它放入聊天右侧专用窗口；用户可以预览、查看源码、继续用自然语言迭代、切换历史版本、复制或下载。一个对话可以包含多个 Artifact。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

“保留作品”和“应用数据持久化”是两套不同契约：对话内创建的 Artifact 不会自动进入侧栏作品库，发布后才加入；应用数据持久化仅对已发布 Artifact 生效，分个人与共享空间，单个 Artifact 限 20 MB 且只接受文本，取消发布会永久删除全部存储数据。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) [Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

分享也不是“分享整个聊天”：个人套餐发布选定版本并得到公开链接；Team / Enterprise 只能在组织内分享，且项目来源 Artifact 还受项目访问权约束。不过组织内分享会同时授予查看者对原始会话附件和文件的访问权，这是产品必须显式提示的数据边界。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

代码能力至少分三层：Claude 创建作品时使用隔离计算环境；交互式作品在 Anthropic 基础设施上运行；外部服务访问走需用户授权的 MCP。官方没有公开 Artifact 前端运行时的 iframe、进程、网络策略或依赖装载细节，因此不能把这些内部实现当作产品契约。[Anthropic Help Center：Create and edit files with Claude](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude) [Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

## 证据分级

- **公开事实**：Anthropic 当前官方帮助中心、产品文档或公告明确陈述的行为。
- **产品观察**：研究者在可直接访问的产品界面中观察到、但官方文字未承诺的行为。
- **推断**：由多个公开行为推导出的最小语义，不代表 Anthropic 的内部设计。
- **无法确认**：官方未公开，或现有资料不足以支持的实现细节。

本次没有使用登录态 Claude 账户做交互测试，因此没有把任何登录态 UI 行为列为“产品观察”。下文凡未标“推断”或“无法确认”的结论均为公开事实。

## 1. 内容类型与 Artifact 身份

### 公开事实

Claude 会在内容满足以下条件时创建 Artifact：内容重要且自包含（通常超过 15 行）；用户可能编辑、迭代或在对话外复用；内容脱离额外对话上下文仍能独立存在；用户可能稍后引用或使用。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

官方列出的常见类型包括：

- Markdown 或纯文本文档；
- 代码片段；
- 单页 HTML 网站；
- SVG 图像；
- 图表与流程图；
- 交互式 React 组件。

来源：[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)。文件创建帮助页另以 HTML、React app、Markdown、Mermaid、SVG 举例，说明 Mermaid 是图表类型的明确实例。[Anthropic Help Center：Create and edit files with Claude](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)

Artifacts 与普通文件生成不是同义词。Claude 的文件创建能力还可产出 XLSX、PPTX、DOCX、PDF、PNG 等可下载文件；官方只说启用文件创建后仍可创建 Artifacts，没有把这些文件格式全部定义成 Artifact 类型。[Anthropic Help Center：Create and edit files with Claude](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)

### 推断

最稳定的 Artifact 身份应是“对话中的独立作品 + 内容类型 + 版本”，而不是“附件”或某个固定扩展名。类型决定展示能力（例如源码、渲染预览或交互），但官方没有承诺封闭的类型枚举。

## 2. 创建触发

### 公开事实

Artifact 可在普通聊天中产生，也可从侧栏 Artifacts 空间开始创建。用户只需描述想要的内容；显式说“创建这个”或“现在构建它”会触发生成。模型也会依据内容是否独立、重要、可复用等标准决定使用 Artifact，而不要求特殊命令。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) [Anthropic 官方使用指南：Use artifacts to visualize and create AI apps](https://support.anthropic.com/en/articles/11649427-use-artifacts-to-visualize-and-create-ai-apps-without-ever-writing-a-line-of-code)

当前 Artifacts 依赖开启“Code execution and file creation”能力；个人套餐在 Settings > Capabilities 控制，Team / Enterprise 由组织能力设置控制。官方已不再支持关闭该能力时使用 Artifacts。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

### 推断

创建是“模型可自动选择、用户可明确要求”的双入口。PandaWork 不应要求用户先选择精确格式，也不应让所有长回复自动变成作品；最小判定应保留独立性、可复用性和迭代价值。

## 3. 版本、迭代与分支

### 公开事实

用户可在聊天中要求 Claude 修改 Artifact，改动直接出现在 Artifact 窗口，并可通过版本选择器切换不同版本。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

Markdown 支持局部定向编辑：选中文本，点击 “Edit with Claude”，提交修改要求。多 Markdown 文件场景允许先在多个文件留下编辑请求，再合并到下一条消息一次提交。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

编辑更早的聊天消息会创建一条新的对话分支及其自己的 Artifacts，不会丢失原方向。Artifact 的修改不会改变 Claude 对原始内容的记忆。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

一个对话可以拥有多个 Artifacts；用户可切换当前查看项，并选择希望 Claude 引用、更新的目标 Artifact。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

### 无法确认

官方没有公开版本 ID 结构、快照还是增量存储、并发写入冲突规则、版本数量或保留期限，也没有说明“修改原消息”与 Artifact 版本图在数据层如何关联。

## 4. 预览与交互

### 公开事实

Artifact 出现在主聊天右侧的专用窗口。用户可查看渲染结果，也可查看任意 Artifact 的底层代码。前端 Artifact 可提供实时预览和交互；错误发生时界面可显示 “Try fixing with Claude”，把错误详情带入一条待发送的新消息，由 Claude 尝试诊断和修复。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) [Anthropic 官方公告：Collaborate with Claude on Projects](https://www.anthropic.com/news/projects)

已发布 Artifact 对未登录访客也可查看和进行基础交互；使用 AI 能力等高级功能时会要求登录。登录用户可在自身用量限制内使用 AI 功能。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

### 无法确认

官方没有承诺预览容器的 iframe 属性、DOM 隔离方式、浏览器 API 白名单、前端 CPU / 内存 / 时长配额、离线行为或无障碍语义。这些都不能纳入对标契约。

## 5. 复制、下载与导出

### 公开事实

Artifact 窗口提供：

- 复制内容到剪贴板，包括交互式 Artifact 背后的代码；
- 下载文件供对话外使用；
- 查看底层代码。

来源：[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

复制也是当前基于他人公开 Artifact 继续创作的正式路径：复制代码到新聊天并提出修改，Claude 创建独立副本，后续修改不影响原作。旧 “Remix” 按钮已取消，不能作为当前契约。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

已发布 Artifact 还可生成 embed code；发布者必须配置允许嵌入的域名。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

### 无法确认

官方没有给出每种 Artifact 类型的下载扩展名、导出包结构、资源内联规则，也没有承诺能无损导出一个可独立部署的完整工程。

## 6. 持久化与可发现性

### 公开事实

用户可从侧栏 Artifacts 区域查看、创建和管理作品，但聊天中创建的 Artifact 不会自动出现在该区域；打开并“Publish”后才会加入侧栏。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

Artifact 应用数据持久化仅在 Pro、Max、Team、Enterprise 的 Claude web / desktop 提供，并且仅对已发布 Artifact 生效；开发和测试期间的存储操作会失败。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

持久化有两种可见性：

- 个人存储：每个用户拥有彼此隔离的私有数据；
- 共享存储：所有用户看到并操作同一份数据，首次使用时必须确认其输入会对其他用户可见。

每个 Artifact 存储上限 20 MB，只接受文本；个人与共享存储隔离。取消发布会永久删除两类存储数据。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) [Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

### 推断

PandaWork 必须把“作品是否保留/可找到”和“作品运行产生的数据是否跨会话保留”分开表述。二者共用“持久化”一词会产生错误预期。

## 7. 发布、组织内分享与派生

### 公开事实

Free、Pro、Max 使用“Publish”：所选版本获得公开链接，任何拿到链接的人均可查看、交互。Team、Enterprise 使用“Share”：仅组织成员可访问，必须登录对应组织；由项目创建的 Artifact 还要求查看者拥有该项目访问权。Team / Enterprise Artifact 不能公开发布。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

发布或分享前都要求用户确认当前版本；组织分享文案明确为“make this version shareable”，因此外部可访问对象至少在产品语义上是选定版本，而不是无条件跟随编辑中的最新版本。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

公开发布可以取消，但同一个 Artifact 之后不能再次发布；如需再次发布必须创建新 Artifact。取消发布会撤销访问，并永久删除关联存储数据。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

组织内分享 Artifact 时，查看者同时获得创建该 Artifact 的会话中附件与文件的访问权；官方要求分享前考虑敏感文档。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

公开 Artifact 的派生采用复制代码到新聊天的方式，派生副本与原作完全独立，不回写原作。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

### 无法确认

官方没有说明公开 URL 是否永久稳定、发布后修改其他版本会否影响现有链接、访问统计、搜索收录、署名/许可证、派生关系追踪和删除后的缓存期限。

## 8. 代码执行、外部能力与安全边界

### 公开事实：创建阶段

Artifacts 现依赖 Code execution and file creation。Claude 在隔离、受控且用户之间不共享的计算容器中写入和运行代码来创建文件及 Artifacts；网络能力由套餐和组织的 egress 设置控制。关闭网络可阻止沙箱向外传输数据，但 MCP 连接不受该 egress 开关阻断。[Anthropic Help Center：Create and edit files with Claude](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)

官方明确提示外部文件、网站或连接数据可能包含 prompt injection，诱导 Claude 下载运行不可信代码或经网络泄露其在当前上下文可访问的数据；缓解措施包括能力开关、动作摘要与停止控制、审计、资源和任务时长限制、用户间沙箱隔离及 prompt injection 检测。[Anthropic Help Center：Create and edit files with Claude](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)

### 公开事实：作品运行阶段

AI-powered Artifact 由 Claude 生成代码并运行在 Anthropic 基础设施上。每个使用者用自己的 Claude 账户认证并与自己的 Artifact 实例交互；无需提供 API key，AI 用量计入使用者自己的订阅限制，而不是创作者。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) [Anthropic 官方公告：Build and share AI-powered apps with Claude](https://www.anthropic.com/news/claude-powered-artifacts)

Artifact 可通过 MCP 读取或写入 Asana、Google Calendar、Slack 等外部服务，也可使用用户配置的自定义 MCP server。首次调用某个 MCP 工具时必须提示用户批准；该 Artifact 的选择会在后续使用中保留。每位用户都必须独立认证 MCP，组织管理员可整体开关 Artifact MCP，但不能替用户选择具体服务器。[Anthropic Help Center：What are artifacts and how do I use them?](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

自定义 MCP 可能读取或修改用户获授权的数据。Anthropic 要求只连接可信服务器，并明确提示恶意 MCP 可能实施 prompt injection；内建防护不是绝对安全保证。[Anthropic Help Center：Get started with custom connectors using remote MCP](https://support.anthropic.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

复制他人 Artifact 代码到自己的聊天也被官方视为引入不可信代码：只应复制可信来源，风险应按未知发送者提供的文件处理。[Anthropic Help Center：Publish and share artifacts](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)

### 不能混用的证据

Anthropic API 的 Code Execution Tool 文档描述了 API 侧服务器沙箱（例如无公网、工作区限制、容器期限），但它不是 Claude.ai Artifact 前端运行时文档，不能据此声称 Artifact 预览具有相同网络与生命周期限制。[Anthropic Docs：Code execution tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool)

### 无法确认

官方没有公开以下内部实现：

- Artifact 预览是否使用 iframe、独立进程或容器；
- 交互式前端可用的 JavaScript / Web API、依赖和网络白名单；
- 创作计算沙箱与已发布 Artifact 运行实例是否复用基础设施；
- AI 调用的具体 API、模型选择、system prompt、限流与错误重试；
- 持久化存储的数据库、加密、地域、备份、并发一致性和数据保留实现；
- 恶意代码检测、内容审核和发布审核的具体规则。

## 给 PandaWork 的最小产品契约

以下仅定义用户可感知行为，不提出实现架构。

1. **独立作品**：当输出是可独立理解、值得复用或继续迭代的较大内容时，系统可创建有明确类型的作品；用户也可显式要求创建。
2. **对话关联**：作品保留其来源对话语境；一个对话可有多个作品，更新时必须能明确目标。
3. **双视图**：可执行或可渲染类型至少提供结果预览与源内容查看；纯文档可直接阅读。
4. **版本不可覆盖**：每次 AI 修改产生可回看的版本，用户可切换历史版本；修改旧消息形成独立对话分支，不悄悄覆盖另一方向。
5. **自然语言迭代**：用户通过后续消息修改作品；文档可选区定向修改。运行错误可一键带回对话请求修复，但不承诺自动修复成功。
6. **可带走**：所有作品均可复制原始内容；适合文件化的类型可下载。不要承诺“完整工程导出”或无损部署包。
7. **保留与运行数据分离**：分别表达作品是否收藏/可找到，以及作品运行数据是否跨会话保存。
8. **发布版本明确**：发布或分享前显示即将暴露的版本、受众和关联资源；公开链接与组织内链接是不同权限模型。
9. **派生不回写**：从他人作品继续创作时创建独立副本，不修改原作；引入他人代码前给出可信来源提示。
10. **执行有边界**：明确区分预览交互、后台代码执行、AI 调用、外部工具调用。每种能力分别展示权限与失败状态，不用“可运行代码”概括全部能力。
11. **外部访问逐用户授权**：连接外部服务必须由每位使用者独立认证；首次使用工具时确认权限，不能继承创作者凭据。
12. **共享数据显式确认**：首次写入所有使用者可见的数据前，说明可见范围；个人数据与共享数据在产品语义上隔离。
13. **撤销后果清楚**：取消发布立即撤销访问；若会删除运行数据，必须在确认动作中明确且不可逆。
14. **不承诺内部机制**：产品契约不写死 iframe、容器、数据库、网络实现或版本存储方式，只承诺用户可验证的隔离、授权、可见性和数据生命周期。

## 不应纳入最小契约

- Artifacts 侧栏发现广场、作品推荐、公开搜索；
- embed code 与域名 allowlist；
- Claude 订阅代付 AI 用量的商业模型；
- MCP、自定义 connector 与共享排行榜等高级能力；
- 20 MB、15 行、特定套餐等 Claude 当前产品参数；
- Claude Code / Cowork 的 live artifact 行为；
- 未经官方确认的前端沙箱实现。

这些能力能证明 Claude 的产品演进方向，但不是 PandaWork 首个端到端版本成立的必要条件。

## 原始来源

1. [What are artifacts and how do I use them? — Claude Help Center](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
2. [Publish and share artifacts — Claude Help Center](https://support.anthropic.com/en/articles/9547008-publishing-and-remixing-artifacts)
3. [Create and edit files with Claude — Claude Help Center](https://support.anthropic.com/en/articles/12111783-create-and-edit-files-with-claude)
4. [Use artifacts to visualize and create AI apps without ever writing a line of code — Claude Help Center](https://support.anthropic.com/en/articles/11649427-use-artifacts-to-visualize-and-create-ai-apps-without-ever-writing-a-line-of-code)
5. [Build and share AI-powered apps with Claude — Anthropic](https://www.anthropic.com/news/claude-powered-artifacts)
6. [Claude 3.5 Sonnet / Artifacts announcement — Anthropic](https://www.anthropic.com/news/claude-3-5-sonnet)
7. [Collaborate with Claude on Projects — Anthropic](https://www.anthropic.com/news/projects)
8. [Get started with custom connectors using remote MCP — Claude Help Center](https://support.anthropic.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
9. [Code execution tool — Anthropic Docs](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool)
