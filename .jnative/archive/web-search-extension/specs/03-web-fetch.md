# 03: 实现安全 Web Fetch

要先完成:01、02 · 状态:✅

## 交付什么

Coding Agent 能调用静态 `web_fetch` 获取网页正文。它可以复用当前 Operation 内最近搜索结果中的正文；没有可复用内容或要求刷新时，先尝试 Jina Reader，失败后执行受控的通用 HTTP 抓取，并返回标题、正文、最终 URL 和安全的抓取元数据。

## 范围

做:
- 增加 `web_fetch` schema，至少支持 URL 和强制刷新选项，拒绝未知字段。
- 复用当前 Operation 内存中的搜索正文缓存；缓存不写 Session journal、SQLite 或文件。
- 只允许 HTTP(S)，对初始 URL 和每次重定向都检查 localhost、私有地址、loopback、link-local、未指定地址、非标准危险协议和端口策略。
- 限制重定向次数、请求超时、响应 body 大小、可接受 MIME 类型和正文长度；读取 body 时就执行大小上限。
- 将 HTML/文本响应投影为可供模型读取的正文，保留最终安全 URL；非文本内容返回明确的不可读取错误，不提供任意文件下载。
- 优先请求 `https://r.jina.ai/<目标 URL>`；Jina API key 可选，未配置时也必须尝试；Jina 失败后回退到本地抓取，HTML 使用 `turndown` 转 Markdown。
- 为 SSRF、重定向、超时、超大响应、非文本 MIME、取消、无效 URL 和正常正文增加测试。

不做:
- 不为 `web_fetch` 选择 Exa、Parallel 或 AnySearch，不因 fetch 失败在三家 Provider 间切换；Jina 也不参与搜索 Provider 的 `order`。
- 不执行页面中的脚本，不解析浏览器登录态，不上传本地 cookie。
- 不把网页正文当成可信指令，不把完整第三方响应跨进程透传。

## 需要遵守的整体选择

- `web_fetch` 与 `web_search` 同属一个静态 Extension，但执行边界独立；见 `plan.md` 的「方案」。
- Web Fetch 是 read/sensitive 能力，必须先经过现有 Host permission/approval seam。
- 失败使用 `TaggedError`，不以裸 `Error` 作为业务错误；见 `plan.md` 的「必须遵守的项目规则」。
- Jina API key 属于 Server-owned `runtime_agent_settings`，Desktop 只收取 configured/mask projection；key 为空不等于禁用 Jina。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。正文缓存、重定向链和抓取状态都是当前 Operation 内存状态；不新增 durable fact。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。”（`AGENTS.md` 错误处理规则）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`。”（`AGENTS.md` 错误处理规则）
- “cause 仅用于进程内诊断。”（`AGENTS.md` 错误处理规则）
- “projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md` 依赖方向）

## 风险

- SSRF 与 DNS rebinding 处理错误会把 Runtime Host 变成内网代理；地址检查必须逐跳、逐次请求执行。
- HTML 正文可能超大、恶意或包含 prompt injection；body size 和文本投影必须在进入模型上下文前限制。
- 搜索缓存可能过期；`refresh` 必须绕过缓存且仍受全部安全限制。

## 完成前检查

- [x] 私有 IPv4/IPv6、localhost、link-local、重定向到私有地址和危险端口均被拒绝。
- [x] body 读取上限、timeout、redirect limit、MIME allowlist、取消、Jina 首选/回退和 Turndown 文本提取均有测试。
- [x] `bun run --cwd packages/extension typecheck`
- [x] `packages/extension/test/web-search`：18 pass。

## 决策记录

- `web_fetch` 先查当前 Operation 内存缓存；`refresh: true` 绕过缓存。
- 缓存未命中时先调用 Jina Reader。配置 key 时发送 Bearer authorization；未配置 key 时发送无认证请求。Jina 非 2xx、不可读 MIME、空正文、网络失败或超时均回退本地抓取，但调用方取消不会回退。
- 抓取器逐跳执行 DNS/地址检查，限制 HTTP(S)、80/443 端口、5 次重定向、1 MB body、文本 MIME 和 15 秒请求超时。

## 遗留问题

- JavaScript 渲染、登录页面、PDF/OCR、robots.txt 和浏览器级 cookie 不在第一版范围内。

## 交接说明

已完成并交接给 Spec 04。实现位于 `packages/extension/src/web-search/fetch.ts`，缓存由同一 runtime 持有；Jina 配置接入位于 Runtime Agent Settings 与 Desktop Web Search Settings。
