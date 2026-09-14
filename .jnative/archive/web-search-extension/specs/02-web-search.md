# 02: 实现 Web Search 与 Provider failover

要先完成:01 · 状态:✅

## 交付什么

Coding Agent 能调用静态 `web_search` 工具，通过 Exa、Parallel、AnySearch 返回统一结果；配置了 `order` 时按优先级尝试，没有任何 `order` 时随机选择；可恢复的 Provider 故障会自动尝试其他候选。

## 范围

做:
- 实现三家 Provider adapter 的运行时调用和统一结果投影。
- 实现候选顺序：有序 Provider 升序；无序 Provider 随机追加；全无序时全量随机。每个调用中每家最多尝试一次。
- 仅对 timeout、网络错误、429、5xx 和无效 Provider 响应 failover；无结果、输入错误、用户拒绝和 401/403 终止当前调用。
- 将所有 Provider 失败收敛为安全的领域错误，并在全部候选失败时保留可诊断但不敏感的尝试摘要。
- 注册 `web_search` 的 TypeBox schema、read/sensitive authorization、search presentation 和取消处理。

不做:
- 不保存 Provider 健康状态，不实现跨请求熔断或后台探测。
- 不允许模型通过参数指定 Provider。
- 不实现 Web Fetch、Desktop 设置或 Runtime Agent Settings 写入。

## 需要遵守的整体选择

- Provider 顺序和 failover 遵守 `plan.md` 的「已确认的关键选择」。
- `web_search` 是静态 Extension tool，不使用 `ToolCatalog`。
- 凭据只能由调用方运行时注入，不能从 `.jai/settings.json` 读取或写回；见 `intent.md` 的「影响范围」。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项的随机源、候选顺序、Provider 状态和结果都只存在当前 Extension runtime；API key 由后续第 04 项的 Runtime Agent Settings 维护。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。”（`AGENTS.md` 错误处理规则）
- “Panic 与原生异常只表示 invariant、程序缺陷或未知基础设施故障，不能伪装成 Err。”（`AGENTS.md` 错误处理规则）
- “RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md` 错误处理规则）
- “Host 只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md` 模块、入口与依赖方向）

## 风险

- 随机顺序会影响复现，必须允许测试提供确定性随机源，并记录安全的 Provider attempt metadata。
- 401/403 不切换可能让整个请求失败，但能让错误准确暴露为 credential/configuration 问题。
- Provider 返回正文可能包含 prompt injection；结果只做数据投影，不能被 Extension 当成指令执行。

## 完成前检查

- [x] 三家 Provider 成功结果都能被同一公共 DTO 消费。
- [x] 顺序、全无序随机、部分 Provider 失败、全部失败、无结果、401/403、取消均有测试。
- [x] Tool schema 拒绝未知字段和非法 limit，输出有明确结果/失败文本。
- [x] `bun run --cwd packages/extension typecheck`
- [x] `packages/extension/test/web-search`：18 pass。

## 决策记录

- `order` 只决定有序 Provider 的升序优先级；没有任何 `order` 时每次调用使用注入的随机源洗牌。
- 每次调用最多尝试每个已启用 Provider 一次；认证错误和用户取消不会静默 failover。

## 遗留问题

- Provider circuit breaker、配额感知和跨请求健康统计留给后续需求。

## 交接说明

已完成并交接给 Spec 03/04。静态工具和 runtime 位于 `packages/extension/src/web-search/extension.ts`、`runtime.ts`。
