# 计划: 多 Provider 网络搜索 Extension

来源:需求说明 · 日期:2026-09-03 · 状态:✅ 已完成 · 确认日期:2026-09-03 · 完成日期:2026-09-03

请确认这些文件: `intent.md`、`plan.md`、`todo.md` 和全部 `specs/`。
开始条件:计划已确认，按 todo 顺序连续实施；每项完成后回写对应 spec 和 todo。

## 背景

项目已有本地文件搜索 Extension，但没有统一的联网搜索能力。目标是用一个静态 Extension 接入 Exa、Parallel、AnySearch，提供搜索和网页抓取工具，并把 Provider 失败切换、凭据保护、结果投影和 Web Fetch 的网络安全边界集中在可审查的模块中。

AnySearch 的官方文档页面在本轮环境中未能直接展开 API 内容，已通过官方仓库与官方客户端固定它的 endpoint、认证方式、请求字段、响应字段和限制，再进入三家 Provider 的实现。Exa、Parallel 和 Pi/OpenCode 的行为调研已经归档在 [研究笔记](../research/tools/opencode-web-search.md)、[Pi 研究笔记](../research/tools/pi-agent-web-search.md) 和 [AnySearch 研究笔记](../research/tools/anysearch-web-search.md)。

## 方案

1. 在 `packages/extension` 增加独立的网络搜索领域 Extension，静态声明 `web_search` 和 `web_fetch`。它不使用动态 `ToolCatalog`，不复用本地 FFF 文件搜索实现。
2. Provider adapter 只负责各家的 HTTP 请求和响应解码；Extension 内部将三家结果统一为白名单 DTO，并隐藏原始 SDK/MCP 响应。
3. `web_search` 每次请求生成候选 Provider 顺序：有 `order` 的 Provider 按升序排列，未配置 `order` 的 Provider 随机排列并追加；完全没有 `order` 时随机打乱全部候选。只对 timeout、网络错误、429、5xx 和无效 Provider 响应继续尝试；无结果、输入错误、用户拒绝和 401/403 直接结束。
4. `web_fetch` 与搜索 Provider 解耦。搜索结果中的正文直接作为搜索结果返回；需要获取 URL 时，Extension 先请求 Jina Reader，失败后使用带协议、重定向、内网地址、MIME、超时和响应大小限制的通用 HTTP 抓取器，HTML 由 Turndown 转成 Markdown。搜索期间的正文可在当前 Operation 内存中短暂复用，`refresh` 请求可强制重新抓取；不写 durable store。
5. Server 在现有 `RuntimeAgentSettings` SQLite 配置事实中增加 Web Search Provider 的非秘密设置、搜索 API key 和可选 Jina Reader API key 读取/写入能力。Extension 只接收当前 Operation 的运行时凭据；Desktop 只收到启用状态、顺序和 key mask。
6. Desktop 增加三家 Provider 的配置、顺序和 API key 管理，并增加 Jina Reader 的可选 API key；搜索权限继续通过现有 Extension tool authorization 与 Runtime Host approval seam 处理。

## 外部产品或规范的约定

- Exa、Parallel: 参考 OpenCode 的 Provider 选择、HTTP/MCP 调用和网络权限时机，但不复制其 opaque text 输出；Jai 使用自己的结构化结果 DTO。
- Pi Agent: 参考通用 Extension tool contract，不把 Ollama 的可选包当成 Pi 内置协议。
- AnySearch: 以用户指定的官方文档为准；在 Spec 01 中固定实际 API 契约。若文档与搜索结果中的推测不一致，以官方 API 文档为准。
- 跟随程度是“参考行为”，不是兼容承诺。Jai 允许不同的 failover、错误 tag、citation 投影和 Web Fetch SSRF 防护。

## 需要先想清的事

| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 已确认选择：继续使用现有 `data.sqlite` 中的 `runtime_agent_settings`，不新增 JSONL、第二个数据库或独立搜索缓存；缺少 `webSearch` 配置表示未配置 Provider。 | `app/server/src/config/runtime-agent-settings.ts` 已拥有 Server Provider credentials、secret preservation、optimistic write 和 safe projection；AGENTS.md 要求 durable journal 只有 SQLite。 |
| 外部产品或规范的约定 | 已确认选择：三家只作为 Provider 参考，不复制 OpenCode 的 `websearch` opaque text 协议；AnySearch 具体契约仍由 Spec 01 固定。 | 研究笔记与用户指定的 AnySearch 官方文档。 |
| 用户和调用方看到的行为 | 已确认选择：静态 `web_search`、静态 `web_fetch`；Provider 顺序由 `order` 决定，无 `order` 时随机；可恢复错误自动 failover。 | 用户确认了 Q1–Q4；现有 Extension contract 支持静态工具、presentation 和 authorization。 |
| 权限与安全 | 已确认选择：出站搜索和 URL 抓取都走 read/sensitive 权限；请求前完成 Host approval；Web Fetch 默认只允许安全的 HTTP(S) 目标并逐跳检查重定向。 | AGENTS.md 的进程边界、错误 DTO 和权限规则；现有 Runtime Host approval seam。 |
| 运行环境和依赖 | 已确认选择：优先使用现有 Node `fetch` 和仓库已有解析/文本处理依赖；不为三家各建 MCP client。AnySearch 若官方只提供 MCP，单独在 adapter 内封装其协议。 | `packages/extension` 当前已使用 Node runtime、TypeBox、better-result；OpenCode 的实现说明 MCP 风格请求不等于必须接入通用 MCP catalog。 |
| 同时操作和失败重试 | 已确认选择：每次工具调用独立生成候选顺序；同一调用中每个 Provider 至多尝试一次；用户取消不触发 failover；不做跨请求持久化熔断状态。 | 避免并发 Operation 共享可变健康状态；Extension runtime 和 tool call 本身是 Operation 级生命周期。 |

## 已确认的关键选择

- `web_fetch` 是同一 Extension 的独立静态工具，优先使用 Jina Reader，失败后使用受控通用 HTTP 抓取，不依赖三家搜索 Provider 的 fetch/extract 兼容性。
- `web_fetch` 在缓存未命中时先尝试 Jina Reader；Jina key 可配可不配，失败回退本地受控 fetch，HTML 用 Turndown 转 Markdown。Jina 不进入搜索 Provider `order`。
- Provider 只在可恢复失败时 failover；无结果不是故障，401/403 不静默切换。
- `order` 是每个 Provider 的可选字段。有序项升序尝试，无序项随机追加；完全没有 `order` 时全量随机。
- API key 由 Server-owned `RuntimeAgentSettings` 维护在 SQLite；不写 `.jai/settings.json`，不向 Desktop read projection 暴露原文。
- 结构化结果和错误 DTO 由 Jai 自己定义；原始第三方响应只留在进程内 adapter 诊断。

## 没选的路

- 把网络搜索放进 `ToolCatalog`: 它是动态 MCP/插件工具目录，网络搜索本身是固定能力，放进去会让权限、schema 和模型可见性变得不稳定。
- 把 API key 写入 `.jai/settings.json` 或 Extension configuration: 这会混淆 Coding Agent file configuration 与 Server-owned Provider credentials，并扩大项目文件泄露面。
- 让模型通过参数选择 Provider: Provider 选择属于 Host policy 和 failover，不应由模型控制出站服务商。
- 对无结果、401/403 一律切换: 这会把合法的空结果或凭据错误伪装成服务故障。
- 第一版只依赖供应商 fetch/extract: 三家契约未确认一致，且会让 Web Fetch 行为随 Provider 变化。
- 第一版不做 Web Fetch: 搜索结果正文不能保证覆盖模型需要的完整页面，且用户已明确提出该能力边界。

## 风险

- AnySearch 官方 docs 页面没有直接展开，但官方 Skill/MCP/TypeScript client 已固定 `/v1/search`、Bearer key、`max_results` 与 `code: 0/data.results` envelope；后续若服务端契约变更，应新增版本化 adapter 测试。
- Provider 返回内容和 URL 可能包含恶意提示、超大正文或不可信跳转；模型文本、UI DTO 和 URL 抓取必须分别做投影与限制。
- Web Fetch 的 SSRF、防重定向和 DNS/地址检查是安全关键路径；任何失败都应使用明确的 `TaggedError`，不能静默放宽边界。
- API key 需要同时支持 Server 读取、写入、保留、mask projection、Desktop RPC 和 Operation runtime injection，容易出现原文越过边界。
- 随机 Provider 顺序会让测试和复现变难；必须把随机源隔离为可测试 seam，并在诊断中只记录 Provider 名称和安全错误分类。
- 三家服务的限流、计费、引用和数据保留政策不由本项目控制；产品不能把客户端 DTO 当成供应商的合规承诺。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md` 错误处理规则）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md` 错误处理规则）
- “RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md` 错误处理规则）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md` 事实归属）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md` 模块、入口与依赖方向）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。”（`AGENTS.md` 编码规则）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md` 编码规则）
- 新的网络搜索领域目录应按产品领域命名，例如 `web-search`；不要新建 `common`、`shared`、`helpers`、`utils` 或 `services` 泛化目录。（`AGENTS.md` 架构与目录规则）

## 要运行的检查

| workspace | 命令 |
|---|---|
| `@jai/extension` | `bun run --cwd packages/extension typecheck` |
| `@jai/extension` | `bun run --cwd packages/extension test` |
| `@jai/server` | `bun run --cwd app/server typecheck` |
| `@jai/server` | `bun run --cwd app/server test` |
| `@jayden/jai-desktop` | `bun run --cwd app/desktop typecheck` |
| `@jayden/jai-desktop` | `bun run --cwd app/desktop test` |
| `@jayden/jai-desktop` | `bun run --cwd app/desktop i18n:validate`（若本项修改文案） |

## 为什么这样拆分

Spec 01 先锁定三家外部契约和 Jai 的统一 DTO，避免在 provider 实现中猜 AnySearch。Spec 02 在契约稳定后完成搜索、排序和 failover；Spec 03 继承统一结果/错误边界，单独处理 Web Fetch 的高风险 URL 访问。Spec 04 再把秘密配置和 Extension 装配接入 Runtime Host，保证核心 Extension 可以先用 fake credentials 独立测试。Spec 05 最后接入 Desktop 配置与 safe projection，避免 UI 先绑定一个尚未稳定的 Server contract。
