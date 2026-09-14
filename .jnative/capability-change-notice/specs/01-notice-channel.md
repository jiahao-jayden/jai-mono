# 01: 通知通道与 binding

要先完成:无 · 状态:✅

## 交付什么
MCP server 在会话中途发出 `tools/list_changed`（或重连）后，`SearchTools` 立即能搜到新集合；用户下一次发消息时，模型在该消息之前收到一条用户界面不显示的通知，说明新增 / 删除 / 更新了哪些工具、旧 `toolRef` 已失效需重新 `SearchTools`。正在进行的 run 不被打断。Desktop 会话记录里看不到这条通知。

## 范围
做:
- Extension catalog 契约新增 `presentation: "searchable" | "announced"`，默认 `searchable`；本项只实现 `searchable` 的完整链路，`announced` 的分支（binding 初值为空、不进 `ToolCatalog`、压缩时附在摘要后）在本项落地但由第 2 项接入首个使用者。
- Catalog 刷新协调器持有每个 catalog 的 binding（上一次告知模型的条目集合，按 name + description）和最近一次 discover 的当前集合。invalidate 时只刷新当前集合并 commit `searchable` 条目到 `ToolCatalog`，不比对、不通知。
- 比对与投递只在 run 发起：`CodingAgent.invoke` / `invokeWithAttachments` 发起前对所有 catalog 做一次 diff（新增 / 删除 / 更新），非空则合并为一条通知、更新 binding，把通知作为初始输入的第一条消息，用户 prompt 紧随，一起交给 Agent。不使用 `steer`。
- 通知文本：只含条目名字与一句描述；`searchable` 且发生替换时附"旧 toolRef 已失效，请重新 SearchTools"。
- 消息形状：`role: "user"`，`metadata: { synthetic: true }`，与 `RuntimeHost` 切换 workspace 时写入的系统生成消息一致。
- `aroundCompact` middleware：默认摘要生成成功后，把所有 `announced` catalog 的当前集合渲染为固定段落附在摘要后；压缩失败时不附加。
- 核对 ACP / Desktop 投影：journal 回放与实时事件两条路径都按 `metadata.synthetic` 过滤；缺哪条补哪条。

不做:
- Skill 迁移（第 2 项）、MCP 配置热更新（第 3 项）、Connector 订阅（第 4 项）。
- 不改 `SearchTools` / `ExecuteTool` schema、搜索排序或 `ToolCatalog.replace` 的失效语义。
- 不改 `beforeModelCall` 的请求级 system context 投递路径。

## 需要遵守的整体选择
遵循 [计划·方案](../plan.md#方案)：binding 归 core、一种通知形式、两个投递时机、两种投递方式。遵循 [外部产品或规范的约定](../plan.md#外部产品或规范的约定)：只追加 user 消息，tools 与 system 不变。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方
通知作为 user message 进入 Session journal，由 `@jai/agent` journal（SQLite）维护；使用已有 `metadata.synthetic`，不新增字段或表。binding 是每个 Operation 的内存状态，不持久化。

## 必须遵守的项目规则
摘自根 AGENTS.md：
- "一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。"
- "Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal。"
- "每个模块只暴露一个小而稳定的 interface；……不要为单一实现建立 interface / factory / strategy。"
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`。"
- "先翻项目里已有的依赖能做什么，再考虑加新包或自己写。"
- ponytail："non-trivial logic leaves ONE runnable check behind"。

## 风险
- run 发起时的注入必须走 `CodingAgent.invoke` 已有入口并与用户 prompt 同一个 run，且不能被 slash command 派发或 attachments 处理误吞。
- 通知与用户 prompt 是相邻的两条 user 消息；用真实请求核实 Anthropic 合并相邻 user 消息。
- `aroundCompact` 附加内容后不能绕过摘要长度校验与 `compactionFailure` 语义。
- 协调器串行链（`#refreshTail`）内更新当前集合；run 发起时的比对要等待链上未完成的刷新，避免读到一半的集合。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [ ] 测试：一个 `searchable` catalog 两次 discover 返回不同集合，下一次 invoke 时产出一条包含新增 / 删除 / 更新与 toolRef 失效提示的 synthetic user 消息，位于用户 prompt 之前、同一 run；集合相同不产出。
- [ ] 测试：run 进行中 invalidate 不向 transcript 追加任何消息，但 `SearchTools` 已能搜到新集合。
- [ ] 测试：run 进行中多次 invalidate，下一次 invoke 只产出一条通知。
- [ ] 测试：`announced` catalog 在 Operation 打开后首次 run 产出全量；压缩后 compaction entry 的摘要末尾含 announced 当前集合。
- [ ] 测试：`metadata.synthetic` 消息在 ACP 投影（回放与实时）中均不出现。
- [ ] 用 MCP extension 测试替身或真实 server 触发 `list_changed`，端到端出现通知。
- [ ] `packages/coding-agent`：`bun run typecheck`、`bun test`、`bun run build`、`bun run test:consumer`
- [ ] `app/server`：`bun run typecheck`、`bun test`（若改到投影）

## 决策记录
- `CapabilityNoticeProducer` 定义在 runtime 层（`create-coding-agent.ts`），coordinator 在 SDK 层实现，通过 `CapabilityNoticeSlot` 桥接——与 `ExtensionToolCatalogSlot` 同一模式。
- `announced` catalog 的工具仍留在 `extension.catalogTools` 投影里（UI 可见），只是不进 `ToolCatalog.replace`。
- `diffCatalog` 按 name + description 比对；description 变化算"更新"，在通知里给出新描述。

## 遗留问题
无。

## 交接说明
2026-09-12：第 01 项完成。`packages/coding-agent` typecheck / 120 tests / build / test:consumer 全部通过；`packages/extension` 与 `app/server` typecheck 通过。改动文件：`contract.ts`（新增 `presentation` 字段）、`extensions.ts`（coordinator 持有 binding、实现 `produceNotice`/`announcedSnapshot`、`#discoverAndCommit` 分离 searchable/announced）、`create-coding-agent.ts`（runtime 层定义 `CapabilityNoticeProducer`/`Slot`、`invoke`/`invokeWithAttachments` 注入通知、`aroundCompact` 中间件附加 announced 快照）、`sdk/create-coding-agent.ts`（创建 slot 并传递）、`runtime/index.ts`（导出新类型）、`test/extensions.test.ts`（3 个新测试）。下一项不要碰 `contract.ts` 的 `presentation` 字段和 coordinator 的 binding 逻辑。
