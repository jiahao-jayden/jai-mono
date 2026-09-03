# 05: 接入 Desktop 设置与端到端验证

要先完成:04 · 状态:✅

## 交付什么

Desktop 用户可以在 Settings 中配置 Exa、Parallel、AnySearch 的启用状态、API key 和 `order`，以及 Jina Reader 的可选 API key；看到已配置状态与脱敏 key，并通过同一 Runtime Host 配置影响后续 Operation 的搜索顺序、failover 和网页抓取。

## 范围

做:
- 扩展 Desktop shared RPC 的安全 Web Search configuration DTO、读取、保存、清除 key 和冲突处理。
- 在现有 Settings 结构中增加三家 Provider 的配置入口，明确显示 Provider 状态、顺序和 key mask；不显示 key 原文，除非复用已有受控 reveal 行为且用户明确请求。
- 为 `order` 提供数值输入/清空，展示未配置 order 时的随机策略。
- 增加 Jina Reader 的可选 API key 设置；未配置 key 也保留 Jina 首选请求，不把它当成搜索 Provider 或加入 `order`。
- 连接 Server safe projection 与保存 command；UI 不直接访问 SQLite、Provider endpoint 或 Extension internals。
- 增加 Desktop 相关类型、RPC、渲染器状态和端到端测试，并运行必要的 i18n 检查。

不做:
- 不在 Desktop renderer 执行网络搜索或持有 API key。
- 不让 Desktop 自己实现 Provider failover、Web Fetch 或权限判断。
- 不加入供应商计费、配额、隐私声明或复杂健康 dashboard。

## 需要遵守的整体选择

- Server 是配置与秘密的 owner，Desktop 只负责安全 UI 和 RPC 适配；见 `plan.md` 的「长期保存的数据与兼容」。
- UI 使用现有 shared UI components 和项目图标规则；不在业务组件中复制通用交互状态。
- RPC/renderer 只依赖白名单 DTO；见 `plan.md` 的「必须遵守的项目规则」。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

数据仍由 Server 的 `SqliteRuntimeAgentSettings` 维护在 `$JAI_HOME/data.sqlite`；Desktop 不新增本地 settings store，不保存 API key 副本。

## 必须遵守的项目规则

- “renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md` 依赖方向）
- “Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标。”（`AGENTS.md` 组件规则）
- “已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。”（`AGENTS.md` 组件规则）
- “app/desktop 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。”（`AGENTS.md` 组件规则）
- “Host 只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md` 模块、入口与依赖方向）

## 风险

- UI 保存请求必须保留 Server revision，避免多个设置窗口互相覆盖。
- key 输入、错误提示、React state 和测试 snapshot 都可能意外泄露秘密；只能使用 write-only/mask 语义。
- 未配置 order 的随机行为不适合在 UI 中伪装成固定顺序；应明确显示“自动随机选择”。

## 完成前检查

- [x] Desktop 读取只显示 configured/mask/order，保存和清除 key 可验证。
- [x] RPC 不接受未知 Provider id、非法 order 或 raw secret projection。
- [x] `bun run --cwd app/desktop typecheck`
- [x] Provider config 专项测试：13 pass。
- [x] `bun run --cwd app/desktop i18n:validate`：407 messages validated。
- [x] 新增 UI 使用 shared `Button`/`Input`/`Switch` 和 `useIcon`，未引入业务层直接图标库或 className 拼接。

## 决策记录

- UI 中空的 `order` 表示 Random；有值时通过 Runtime Host revision 保存。
- API key 输入只作为下一次 write command 的 payload；现有 key 只显示 mask，清除通过显式 `clearApiKey` 发送。

## 遗留问题

- Provider 运行时指标、用量和健康历史不在第一版 UI 中。

## 交接说明

已完成。Desktop RPC、配置适配和 Settings 入口分别位于 `app/desktop/shared/desktop-rpc.ts`、`app/desktop/electron/config/web-search.ts` 和 `web-search-settings.tsx`。
