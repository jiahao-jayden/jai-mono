# 计划: 能力变化通知（Capability Change Notice）

来源:[需求说明](intent.md) · 日期:2026-09-11 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-12

请确认这些文件:intent.md + plan.md + todo.md + 全部 specs
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景
上一轮已把 MCP / Connector 工具收进固定前门（`SearchTools` + `ExecuteTool`），模型可见 tools 不再随 catalog 变动。但 catalog 变了没人告诉模型；Skill 仍把清单塞在工具 description 里，每变一次就打掉整个 cache 前缀；用户在设置页或 JSON 里改的 MCP 配置、完成的 Connector 授权都到不了正在跑的 Operation。详见 [需求说明](intent.md)。

## 方案
按生命周期看，三种来源只在"变化信号从哪来"上不同，之后每个节点的处理是同一套：

- **binding 归 core。** coding-agent 的 catalog 刷新协调器持有每个 catalog "上一次 commit 的快照"，即模型当前被告知的集合。每次 `discover` 结果 commit 前先和快照比对（按条目 name + description），得到新增 / 删除 / 更新三类差异。extension 只提供 `discover` 与 `subscribe(invalidate)`，不记旧状态、不生成通知。
- **一种通知形式。** 差异非空时生成一条 user 消息：`metadata.synthetic: true`，内容只含名字和一句描述，并在有工具被替换时说明旧 `toolRef` 已失效、需重新 `SearchTools`。消息写入 journal、追加在末尾、不改任何历史消息。沿用 `RuntimeHost` 切换 workspace 时已用的系统生成消息形式，ACP / Desktop 投影已按 `synthetic` 过滤。
- **一个投递时机：run 发起。** run 进行中 catalog 照常刷新并 commit（`SearchTools` 立即可搜到新工具，旧 `toolRef` 失效是现状），但不打断当前 run、不使用 `steer`。用户下一条消息进来时做一次比对，非空则把通知作为初始输入的第一条消息、用户 prompt 紧随其后一起交给 Agent。多次变化被这一次比对自然折叠，不需要缓冲队列，也不与用户自己的 steer 消息混在一个队列里。
- **两种投递方式。** catalog 在契约里声明 `presentation`：`searchable`（默认，条目进 `SearchTools`，binding 在 Operation 打开时直接等于当前集合，不发首条通知）或 `announced`（条目不进搜索；binding 在打开时为空，首次 run 发起自然产出一条全量清单）。Skill 是目前唯一的 `announced` catalog。
- **压缩时重建 announced 清单。** coding-agent 在 `aroundCompact` middleware 里把所有 `announced` catalog 的当前快照作为固定段落附在压缩摘要之后；摘要是 durable 的 compaction entry，清单随之进入新前缀，压缩后的同一 run 内没有缺口。core 只知道 announced catalog，不知道 skill。
- **Skill 止血。** Skills extension 把 `snapshot.skills` 以 catalog `discover` 的形式暴露，`catalog.watch` 映射为 `subscribe`；`Skill` 工具的 description 改为固定文案，指向由通知维护的清单。`/skill:` 命令表与 `Skill` 工具执行逻辑不变。
- **MCP 配置热更新。** extension host adapter 的 layered configuration 从一次快照改为可订阅，数据源是已有的 `configStore.watch`（同时覆盖 Desktop 保存、手改 user JSON、手改 project JSON）。MCP runtime 收到新配置后按 server 名比对：新增的启动，删除的关闭，配置变化的重启；连上后走已有的 `invalidate` 路径。
- **Connector 设置送达。** server 的 `RuntimeAgentSettings` 每次成功写入后发布变更；活跃 Operation 的 connector service 订阅并重读 connections / credentials / policy；Connector catalog 补 `subscribe`，配置变化时 `invalidate`。
- **探测保持独立。** `mcp-settings.ts` 的 `probeMcpServers` 不动，不与运行中连接合并。

## 外部产品或规范的约定
- Anthropic prompt cache：adapter 在 system、最后一个 tool 定义、最后一条 user 消息的最后一个 block 三处打断点（`packages/ai/src/providers/anthropic.ts`）。本方案约定：模型可见 tools 与 system prompt 在 Operation 内不变；所有注入只追加 user 消息。OpenAI 自动前缀缓存同样只要求 append-only。
- 通知与用户 prompt 是 run 发起时相邻的两条 user 消息。Anthropic Messages API 接受相邻同角色消息并合并为一个 turn；实施第 1 项时用真实请求日志核实一次。
- Claude Code 的"用户元数据消息 + 末尾注入 + 压缩后重建"只作行为参考（见 [需求说明·参考对象](intent.md#参考对象)）。差异：本仓库 journal 只追加，"重建"实现为把 announced 快照附在压缩摘要之后。
- 统一前门的缓存依据见 [JAI 统一工具前门](../research/tools/_jai-unified-tool-frontdoor.md)。

## 需要先想清的事
| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 通知作为 `synthetic` user 消息写 journal，不新增表、不改 schema；binding 为内存状态；旧 journal 中不存在通知，无迁移 | AGENTS.md 事实归属；`host.ts` 已有 `metadata.synthetic` 先例 |
| 外部产品或规范的约定 | append-only 与三处 cache 断点已确定；相邻 user 消息合并需在第 1 项核实 | 见上节 |
| 用户和调用方看到的行为 | 用户界面不显示通知；`Skill` 工具 description 变为固定文案；MCP / Connector 配置改动在当前会话内生效；extension 契约新增 `presentation` 字段 | 用户已确认（Q1、Q2、Q4、Q5、Q6、Q7） |
| 权限与安全 | 通知只含名字与一句描述，不含 schema、凭据或 server 地址；Connector 变更事件只传"变了"，凭据仍由 service 自己从 settings 读；MCP 新增 server 的连接与工具权限沿用现有 resolver | 现有 permission middleware 与 catalog authorization 不变 |
| 运行环境和依赖 | 不新增依赖；复用 `configStore.watch`、harness `aroundCompact` hook、`AgentInput` 数组、`metadata.synthetic` | 均已存在 |
| 同时操作和失败重试 | 协调器已串行化刷新（`#refreshTail`），commit 在同一串行链里做；比对只在 run 发起时做一次，多次变化自然折叠；run 进行中的刷新不打断 run；MCP 新增 server 连接失败时不发通知，等其连上或走已有 diagnostics | `ExtensionCatalogRefreshCoordinator` 现有实现 |

## 已确认的关键选择
来自 2026-09-11 对话：
- Skill 清单来源 → 从工具 description 移出，改为通知注入 → 它是唯一破坏 tools 前缀的地方，三种来源统一成一个模型。
- 通知是否写 journal → 写，`synthetic` user 消息 → 能力变化是会话事实，模型后续轮次和恢复后都需要知道；请求级 system context 下一轮就丢。
- 触发源是否一起打通 → 是，MCP 配置与 Connector 设置都送达正在跑的 Operation → 否则通知机制只有 `list_changed` 一个触发源。
- 通知内容 → 只给名字和一句描述 → 与前门按需加载设计一致。
- 界面 → 完全不显示 → 用户刚完成操作，已知发生了什么。
- 通知投递时机 → 只在 run 发起，不用 `steer` → 用户自己的 steer 消息会与通知混在一个队列；能力变化在用户下一条消息时生效更可预期。
- 压缩后 Skill 清单 → 在 `aroundCompact` 把 announced 快照附在摘要后 → 只投递于 run 发起后，压缩后的同一 run 内不能有缺口；core 仍只知道 announced catalog。
- Skill 与 `SearchTools` → 完全无关，不进入目录。
- binding 归属 → coding-agent core → 协调器是唯一同时持有新旧集合的位置；extension 不该记忆旧状态、不该直接对模型说话、也没有压缩 hook。
- MCP 触发源 → 文件监听而非保存 RPC → 用户可能手改 JSON，且已有 `configStore.watch`。
- 连接探测 → 与 settings 分离，本次不动 → 探测是一次性动作，与运行中的连接是不同事实。

## 没选的路
- 各 extension 自持 binding 并通过新原语对模型发话：三份重复 diff，且需要新增 extension 级 compaction hook。
- 通知走 `beforeModelCall` 请求级 system context：不写 journal，下一轮丢失；要保留就得每次重复注入或让 extension 维护"已通知"状态。
- Skill 清单放 system prompt：仍然每变一次失效一次，只是失效范围小一点。
- 设置页状态改读活跃 Operation 的连接状态：可能没有或有多个 Operation，语义模糊。
- 用 Desktop 保存 RPC 作为 MCP 触发：漏掉手改 JSON 与项目级配置。
- 把 Skill 也放进 `SearchTools`：同一信息两个来源，用户明确否决。
- run 内经 `steer` 即时投递：与用户自己的 steer 消息共用队列，顺序不可控；模型在同一 run 中途被告知工具消失更易出错。
- 压缩后追加一条独立的全量清单消息：投递只在 run 发起，压缩后到下一条用户消息之间会有缺口。

## 风险
- 最危险的是 run 发起时的注入：通知必须作为初始输入的一部分和用户 prompt 一起进入同一个 run，且不能触发 slash command 派发或 attachments 处理；实现时要走 `CodingAgent.invoke` 已有的入口，而不是在 harness 之外拼消息。
- 通知与用户 prompt 是相邻的两条 user 消息。Anthropic 合并相邻 user 消息是已知行为，但需要用真实请求核实一次；若 provider 拒绝，退路是把通知作为用户消息前置的一个 text block，不能改历史。
- `aroundCompact` 附加 announced 快照后，摘要长度校验与失败语义（`compactionFailure`）不能被绕过；压缩失败时不附加、不改 binding。
- run 进行中 catalog 已经 commit 但模型未被告知，模型用旧 `toolRef` 会收到 `reference_unavailable` 错误；这是现状行为，通知在下一条用户消息时补上。
- layered configuration 从快照改为可订阅会影响所有声明 `scope: "layered"` 的 extension；需要检查现有 extension 是否有"配置不会变"的隐含假设。
- MCP server 重启（配置变化）会短暂让其工具从 catalog 消失再出现；因为比对只在 run 发起时做，中间状态不会产生通知，但测试要覆盖"重启完成前用户就发消息"的情形，此时通知会先说删除、下一次再说新增，可接受。
- `RuntimeAgentSettings` 的变更通知是 server 进程内事件；多个活跃 Operation 都会收到并各自刷新，要保证订阅随 Operation 关闭而释放。
- `ToolCatalog.replace` 使所有 `toolRef` 失效是现状；通知里若不说明，模型会继续用旧引用。这条文案是功能的一部分，不是可选项。

## 必须遵守的项目规则
以下原文摘自根目录 AGENTS.md 与 `.cursor/rules/ponytail.mdc`：
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。"
- "领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。"
- "`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。"
- "一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。"
- "Durable journal 只有 SQLite……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。"
- "Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。"
- "每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。"
- "依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；……adapter 依赖 contract 但不携带宿主业务规则。"
- "Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。"
- "`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。"
- "命名表达角色：……`*Registry` 只索引运行中对象，不持久化领域事实。"
- "不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。"
- "先翻项目里已有的依赖能做什么，再考虑加新包或自己写。别上来就假设库里没有。"
- "不要仅为了'看起来模块化'提取两三行命名函数。"
- "测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。"
- ponytail："Bug fix = root cause, not symptom……fix the shared function once"；"non-trivial logic leaves ONE runnable check behind"。
- 若触及 Desktop UI（本计划不计划改）："修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。"

## 要运行的检查
从各 workspace `package.json` scripts 现查，在对应目录执行：
| workspace | 命令 |
|---|---|
| packages/coding-agent | `bun run typecheck`；`bun test`；改动契约后加 `bun run build` 与 `bun run test:consumer` |
| packages/extension | `bun run typecheck`；`bun test`；`bun run build` |
| app/server | `bun run typecheck`；`bun test` |
| packages/agent | 仅在改到它时：`bun run typecheck`；`bun test`（当前计划不改） |
| app/desktop | 仅在改到它时：`bun run typecheck`；`bun test`（当前计划不改） |

每项工作先跑与其直接相关的测试文件，收尾跑该 workspace 全量。构建顺序：coding-agent → extension → server。

## 为什么这样拆分
第 1 项先把 core 的 binding、diff、run 发起投递与 `synthetic` 消息做通，用 MCP 已有的 `tools/list_changed` 触发源证明端到端，其他三项都建立在它上面。第 2 项把 Skill 迁到 `announced` catalog，是唯一改变模型可见 tools payload 的项，需要单独验证 cache 前缀稳定与压缩摘要附带清单。第 3、4 项分别打通 MCP 与 Connector 的触发源，触及不同 workspace（extension host adapter + MCP runtime；server settings + connector service），互不依赖，可并行。不设收尾项：每项自带端到端检查，第 4 项完成时顺带跑全部 workspace 检查。
