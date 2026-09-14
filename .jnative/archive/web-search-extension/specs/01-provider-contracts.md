# 01: 固定 Provider 契约与统一结果协议

要先完成:无 · 状态:✅

## 交付什么

完成后，三家 Provider 的请求和响应边界有可复核的一手依据，Extension 有一个不泄露原始响应的统一搜索结果、Provider 诊断和可恢复错误协议，后续实现不需要猜字段。

## 范围

做:
- 核验 AnySearch 官方文档以及 Exa、Parallel 的当前 API 契约，记录版本、endpoint、认证、请求字段、响应字段、结果正文、URL、限制和取消语义。
- 定义三家 Provider 的稳定内部 adapter contract、统一 `WebSearchResult`/`WebSearchResponse` DTO 和 Provider failure classification。
- 为每家 Provider 准备 fake transport/fixture，覆盖成功、无结果、非 2xx、无效 JSON、缺字段和取消。

不做:
- 不连接 Runtime Agent Settings。
- 不实现自动排序、failover 或 Web Fetch。
- 不把供应商原始响应或 SDK 错误暴露到 tool/UI/RPC 边界。

## 需要遵守的整体选择

- 参考 OpenCode 的 Provider adapter，但不复制其 opaque text 输出；见 `plan.md` 的「外部产品或规范的约定」。
- AnySearch 契约以官方文档为唯一依据；文档无法确认的字段不得进入公共 contract。
- 错误使用 `Result` 和 `TaggedError`，进程边界使用白名单 DTO；见 `plan.md` 的「必须遵守的项目规则」。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项只增加 Extension 内部 contract、fixture 和测试，不写 SQLite、Session journal 或配置文件。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。”（`AGENTS.md` 错误处理规则）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`。”（`AGENTS.md` 错误处理规则）
- “RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。”（`AGENTS.md` 错误处理规则）
- “选能满足当前需求的最简单实现。不要预防性抽象。”（`AGENTS.md` 编码规则）

## 风险

- AnySearch 文档在计划阶段未成功抓取，未核验前不能假定 endpoint、字段或认证方式。
- Provider 的“无结果”和“服务失败”必须分开，否则第 02 项的 failover 会改变搜索语义。

## 完成前检查

- [x] 每个 Provider 的契约都能指向官方文档或固定版本源码/fixture 依据。
- [x] 成功 DTO 不含原始 SDK/MCP response，失败分类不含 secret、body、stack 或 cause。
- [x] `bun run --cwd packages/extension typecheck`
- [x] `packages/extension/test/web-search`：18 pass；完整 Extension suite 的失败来自既有 Skills/MCP 端口与 watcher 测试。

## 决策记录

- AnySearch 使用官方 `/v1/search` JSON envelope（`code: 0`、`data.results`）；三家 adapter 都投影到 `WebSearchResult`，不透传原始响应。
- Provider failure 只保留 `kind`、Provider id 和可选 HTTP status；响应 body、secret、stack 不进入 DTO。

## 遗留问题

- 供应商端排序、计费、citation 和数据保留政策不由本项定义。

## 交接说明

已完成并交接给 Spec 02。公共 contract 位于 `packages/extension/src/web-search/types.ts`，adapter 位于 `providers.ts`。
