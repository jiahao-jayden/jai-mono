# 需求说明: 多 Provider 网络搜索 Extension

日期:2026-09-03

## 问题

当前项目没有一个统一的网络搜索 Extension。用户希望同时接入 Exa、Parallel 和 AnySearch 三家服务，并能在一次搜索失败时自动切换到其他已配置的服务商。搜索之外，还需要回答网页正文获取应该由谁负责，避免把 `web_fetch` 错误地当成搜索结果分页或某一家搜索服务的私有能力。

## 期望结果

实现一个可由 Coding Agent 使用的网络能力 Extension，第一版至少提供:

- `web_search`: 通过 Exa、Parallel、AnySearch 搜索，并把结果统一投影为稳定的标题、URL、摘要/正文和来源信息。
- `web_fetch`: 作为独立工具获取指定 URL 的正文；优先复用搜索结果中已经返回的正文，必要时再执行受控的通用 HTTP 抓取，不依赖三家服务商必须提供相同的网页提取接口。
- Provider 配置支持 `order` 字段。已配置的顺序决定首选和 failover 顺序；不配置 `order` 时随机选择已启用且凭据可用的服务商。
- 只在超时、网络错误、429、5xx 或无效响应等可恢复的 Provider 故障时切换。无结果、参数错误、用户拒绝以及 401/403 等配置或授权问题不静默切换。
- API key 由 Host 的 Runtime Agent Settings 统一管理，Extension 只在运行时接收当前调用所需的凭据，不把秘密写入 Extension 配置或跨进程 projection。

## 影响范围

会改到的模块:

- `packages/extension`: 新增网络搜索领域 Extension、Provider adapter、响应投影、failover 与 `web_fetch` 执行边界。
- `packages/coding-agent`: 仅在现有 Extension contract 不足以表达静态工具、权限或运行时凭据注入时调整；优先保持现有 contract 不变。
- `app/server`: 装配该 Extension，并在 Runtime Agent Settings 中增加搜索 Provider 的非秘密配置与秘密凭据读取/更新路径。
- `app/desktop`: 如要让用户配置三家 Provider、`order` 和 API key，增加 settings projection、RPC 和设置界面。

长期保存的数据与维护方:

- Provider 是否启用、`order`、默认 Provider 选择等非秘密配置由 Server 的 Runtime Agent Settings 维护。
- Exa、Parallel、AnySearch API key 属于 Server-owned secret，由 Runtime Agent Settings 的秘密字段维护；客户端只接收配置状态和掩码，不接收原文，Extension 不持久化凭据。
- Provider 健康状态、当前请求的 failover 游标、取消状态和搜索结果均为运行时内存状态，不写入 Session journal 或新增 durable search store。

## 边界

- 第一版只支持 Exa、Parallel、AnySearch，不引入通用 MCP 搜索目录或任意用户自定义 Provider。
- 不把 `web_fetch` 实现成 `SearchTools` 动态 catalog 工具；搜索和抓取都是静态、可审查的 Extension tools。
- 不把无结果当作 Provider 故障，不因一次 401/403 静默隐藏凭据配置问题。
- 不在项目 `.jai/settings.json` 或 `.jai/settings.local.json` 中保存这三家 API key。
- 不承诺三家 Provider 返回完全相同的原始字段；跨进程和 UI 边界只传显式白名单 DTO，不透传原始 SDK、MCP 响应、stack 或 cause。
- 不在第一版承诺供应商端 citation、排序、计费、数据保留或隐私政策；Extension 只负责客户端请求、权限和结果投影。
- `web_fetch` 必须限制协议、重定向、内网/本机地址、MIME 类型、超时和响应大小；不提供任意网络代理或下载文件能力。

## 工作量

大。至少包含 Provider 外部契约与 adapter、统一错误/结果投影、failover 策略、凭据与 Runtime Host 配置、`web_fetch` 安全边界、Extension 装配以及 Desktop 配置界面，必须拆成多个可独立验证的工作。

## 已确认的现状

- 现有 `@jai/extension/search` 是本地文件/代码搜索的 FFF Extension，不能直接扩展成网络搜索 Provider；网络搜索应拥有独立领域目录。
- Extension 工具通过 `CodingExtensionTool` 静态声明，权限、呈现和生命周期由 `@jai/coding-agent` 管理；动态 `ToolCatalog` 用于按需激活 MCP/插件工具，不适合作为网络搜索工具入口。见 `packages/extension/src/search/index.ts`、`packages/coding-agent/src/sdk/extensions/contract.ts` 和 `packages/coding-agent/src/runtime/tool-catalog.ts`。
- `RuntimeAgentSettings` 已由 Server 持有 Provider profile、API key、连接策略、秘密保留和安全 projection，并在 SQLite 的 `runtime_agent_settings` 表中保存；见 `app/server/src/config/runtime-agent-settings.ts`。
- `.jai/settings.json` 与 `.jai/settings.local.json` 是 `CodingConfigStore` 的 user/project 配置文件；见 `packages/coding-agent/src/config/store.ts`。
- 项目错误处理要求可恢复失败使用 `better-result` 的 `Result<T, E>`，领域错误使用带 subsystem.reason tag 的 `TaggedError`；进程边界只能投影白名单 DTO，见 `AGENTS.md`。

## 参考对象

- Exa 与 Parallel: OpenCode `v1.18.27` 的 `websearch` 实现和 provider adapter，作为网络搜索工具、权限和 MCP HTTP 调用的行为参考；不要求 Jai 复制其 opaque text 输出。详见 [OpenCode 网络搜索调研](../research/tools/opencode-web-search.md)。
- Pi Agent `v0.84.4`: 本体没有原生 Web Search；可选 extension 使用通用 tool contract 接入网络能力，作为 Extension 形态参考，不要求采用 Ollama 后端。详见 [Pi 网络搜索调研](../research/tools/pi-agent-web-search.md)。
- AnySearch: 用户指定的 [官方文档](https://www.anysearch.com/docs)，作为第三家 Provider 的请求和响应契约来源；需要在计划阶段固定具体 API 版本与 endpoint。
- 跟随程度: 借鉴 Exa/Parallel 的工具分层、权限时机和 Provider adapter 思路；Jai 允许在结构化结果 DTO、错误语义、failover 规则和 `web_fetch` 安全边界上做自己的实现。
