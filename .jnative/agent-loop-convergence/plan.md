> 已于 2026-09-14 迁移至 [GitHub Issue #60](https://github.com/jiahao-jayden/jai-mono/issues/60)。本文件仅保留历史，不再更新任务进度；当前状态以 Issue 为准。

# 计划: Agent 搜索收敛（环境可见、拒绝语义、失败阈值）

来源:[需求说明](intent.md) · 日期:2026-09-13 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-09-14

请确认这些文件:intent.md + plan.md + todo.md + 全部 specs
开始条件:状态改为 `✅ 已确认 · 可执行` 前，只完善计划文件，不开始实现或修改正式代码。

## 背景
一次“看看我最新的 we0 项目”让 Agent 跑了 8 轮模型、14 次 shell/搜索，最后被权限拒绝后以 `aborted` 收场。根因不是工具慢（13 次共 0.833 s），而是模型不知道自己在哪、Session 没绑 Project 却拿到一个偶然目录当 workspace、以及拒绝之后没有任何收束。对照 Codex 后确认：成熟产品靠的是环境可见、拒绝语义分离和连续失败阈值，不是 `max_turns`。详见 [需求说明](intent.md) 与 [Codex 调研](../research/harness/codex-agent-loop-convergence.md)。

## 方案
按“先让模型看见、再堵掉错误起点、最后加收束”三层做，每层独立可验证：

- **环境事实进 system prompt。** `createCodingAgent` 装配指令时追加一段 `<environment>`：cwd、workspace 根、额外允许读的目录、权限模式，以及一条行为规则——目标不在这些范围内时先向用户要路径或授权，不要用 `pwd`、`ls ..` 向父目录扫描；已知的 workspace 外文件仍可直接 Read。这些值在一个 Operation 内不变，所以放 system prompt 而不是每轮 synthetic 消息，cache 前缀稳定。FFF `find` / `grep` 的越界错误同时改成“workspace 根是 X，`path` 必须是 X 内的相对路径”，让第一次越界就得到可执行的纠正。
- **无 Project 的 Session 不再伪造 workspace。** 删除 Desktop `createDesktopRuntime` 里 `localFileAccess: false → process.cwd()` 的映射。Session 没绑 Project 时，发送消息前要求先选择 Project，与 RPC router 对同类 Session 抛“no accessible workspace”的现有语义一致。
- **拒绝只是一次失败，停止才是中止。** 先用真实 run 核实“拒绝后 `RequestAborted`”的来源（用户点了停止，还是 Desktop 拒绝路径触发了 cancel）。若是后者，修正 Desktop / acp-host，让 `reject` 只回 ACP 拒绝选项；若是前者，记录为现状，不改代码。
- **连续失败阈值。** Agent core 在 run 内维护一个内存计数：一个 turn 的全部工具结果都是 `isError`（含权限拒绝）则计 1，出现任一成功工具即清零；达到 3 时，只在 messages 末尾追加一条 `metadata.synthetic` 的 user 消息，要求模型本轮不再调用工具、只总结“已确认的事实、未完成的事、需要用户提供什么”。tools、system、历史消息一字不改，请求是纯 append，缓存前缀全部命中。模型若仍发出工具调用，loop 不执行，为每个调用写一条“未执行”的 `isError` 结果保证 journal 可恢复、下一次请求合法，再以与 `maxIterations` 相同的 `iterationLimit` 消息结束 run；不再发起模型调用，最坏情况等价于 Codex 的 `Blocked`：停下、没有总结、不再花钱。计数只看“实际执行过的工具批次”：纯文本回答、provider error、abort、context overflow 都沿用现有结束语义，不进计数；完整状态表见 spec 03。阈值与 Codex Goal 的 3 次一致，作为 `AgentLoopConfig` 选项由 coding-agent 设定默认值。
- **默认轮次上限。** Server 打开 operation 时若调用方未指定 `maxTurns`，给默认值 50。它只防未知 bug，不参与任何“任务是否完成”的判断；到达时的行为沿用现有 `maxIterations` 语义。

## 外部产品或规范的约定
- Codex `ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8` 是行为参考，不严格遵循。跟随：环境事实（cwd、roots、权限说明）进模型上下文；拒绝与中止分离；连续 3 轮失败即停。不同：Codex 用 developer 消息并做 RFC 7386 增量更新，我们放 system prompt 且 Operation 内不变；Codex 的阈值只用于 Goal 自动续跑，我们用于普通 run；Codex 没有轮次上限，我们保留一个默认值当保险丝。见 [Codex 调研](../research/harness/codex-agent-loop-convergence.md)。
- Gemini CLI / OpenCode 的 exact tool+args 去重、Pi 的 `shouldStopAfterTurn` 本次不采用（[对比](../research/agent-ui/agent-loop-stop-conditions-comparison-2026-09-12.md)）。
- ACP `session/request_permission` 的 `reject_once` 选项语义是“拒绝这一次”，与 `session/cancel` 分开；本计划只沿用，不改协议。

## 需要先想清的事
| 维度 | 结论 | 依据 |
|---|---|---|
| 长期保存的数据与兼容 | 无需用户决定。环境事实进请求级 system prompt，不写 journal；失败计数是 run 内内存；不新增表、字段、配置文件；旧 Session 无迁移 | AGENTS.md 事实归属：运行中状态是可丢弃内存状态 |
| 外部产品或规范的约定 | 已确定：Codex 作行为参考，差异见上节 | Codex 调研笔记 |
| 用户和调用方看到的行为 | 需要用户选择：无 Project 的 Session 如何处理（Q1）；失败阈值是否纳入本轮（Q2）。其余：system prompt 多一段、FFF 报错文案变化、默认 `maxTurns` 50 | 见「需要你在确认时选择的事」 |
| 权限与安全 | 无需用户决定。环境事实只含路径与模式，不含凭据；不放宽任何权限；Bash 目录不检查是现状，本次记录不改 | `permissions/evaluate.ts` 现有逻辑 |
| 运行环境和依赖 | 无需用户决定。不新增依赖；复用 `instructions` 拼接、`AgentLoopConfig`、`metadata.synthetic`、`maxIterations` | 均已存在 |
| 同时操作和失败重试 | 无需用户决定。失败计数按 turn 批次统计，同一批内并行工具部分成功即视为有进展；阈值触发后的最后一轮只发一次，不重试；`maxIterations` 与阈值互不依赖 | `agent-loop.ts` 现有 turn 结构 |

## 已确认的用户选择

**Q1 无 Project 的 Session 发消息时怎么办**
- 已选 A：必须先选择 Project 才能发送。这样 Agent 不会拿到偶然目录，与 Desktop 其他路径的现有语义一致。

**Q2 连续失败阈值是否纳入本轮**
- 已选 A：纳入，第 03 项实现。拒绝或连续失败后，Agent 有受控的总结与停止路径。

## 计划内已定的选择
以下由计划本身给出，不需要用户选；不同意的话在确认时提出。
- 环境事实放 system prompt，不放每轮 synthetic 消息 → Operation 内 cwd/roots 不变，system prompt 一次装配即可，prompt cache 前缀稳定。
- 不做去重 / coverage ledger / 强制 no-tool final turn 作为通用机制 → 这次 14 次调用参数全不同，去重拦不住；Codex 没有这些也能工作；等更多 trace 再判断。
- 失败阈值定 3、轮次上限定 50 → 前者与 Codex Goal 一致；后者远高于正常 run 的 turn 数，只防无限循环。
- 不给 Bash 加目录 sandbox → 独立问题，改动面大，本次只记事实。

## 没选的路
- 每轮用 `beforeModelCall` 注入环境 synthetic 消息：cwd 在 Operation 内不变，每轮重复注入白费 token；且会与 slash command 的 `promptContext` 注入混在同一位置。
- 把 cwd 写进 journal 作为 durable 事实：违反“运行中状态是可丢弃内存状态”；`RuntimeHost` 切换 workspace 已有自己的 synthetic 消息。
- 只加 `maxTurns`：到上限时模型没有机会总结，用户仍拿不到回答；Codex 连这个开关都没有。
- 阈值触发后最后一轮 `tools: []`：Anthropic 在最后一个 tool 定义处打缓存断点，置空 tools 让 system 与全部 messages 失效，是一次全价读取；阈值触发时上下文通常已很大，这是最贵的时机。已否决。
- 阈值触发后 `tool_choice: "none"`：Anthropic 改 `tool_choice` 会让 messages 段失效，大上下文里 messages 是大头；且 `packages/ai` 需新增透传。已否决。
- 只加提示、工具照常执行（OpenCode 早期做法）：模型不听话就继续转，历史证明无效；本方案的区别是 loop 拒绝执行并结束。
- exact tool+args ledger（Gemini / OpenCode 式）：对这次 trace 零命中。
- Bash 越界按 workspace 拦截：属于 sandbox 范畴，需要 cwd 解析、`cd` 语义、`-C` 参数等一整套判断，本次不做。

## 风险
- 最危险的是第 03 项的最后一轮：请求形状（tools、system、历史消息）必须一字不改，只允许 append 一条 user 消息，否则缓存前缀失效、大上下文下一次全价。可靠性靠 loop 拒绝执行这一轮的工具调用并结束 run，不靠模型听话；测试要覆盖“模型仍发工具调用时不执行且结束”。拒绝执行时不能只是 return：journal 末尾留下无结果的 `toolUse` 消息会被 `unfinishedToolTurn` 在 resume 时重新执行，必须补 `isError` 结果。
- 失败阈值的误报：一个 turn 里模型并行发多个工具，只要有一个成功就不计失败；连续 3 turn 全失败在正常 run 里极少见，但测试要覆盖“第 3 轮部分成功”不触发。
- system prompt 变长会影响所有 Operation 的 cache 前缀一次（首个请求）；之后稳定。环境段必须放在可变部分之后、不能包含时间戳之类每次不同的值。
- Desktop 删除 `process.cwd()` 兜底后，Server 侧 `session/new` 的 `cwd` 仍是必填；无 Project 的 Session 不能再打开 operation，必须在 Desktop 发送前拦住，否则会得到一个协议错误而不是提示。
- “拒绝后 `RequestAborted`”若核实为用户点了停止，第 03 项的这一部分不改代码；spec 里必须写下核实结果，避免以后再被当成 bug 追。
- FFF 报错文案含 workspace 绝对路径，会进入模型上下文；这与 `<environment>` 段一致，不是新的信息泄露，但要确认 Desktop transcript 对工具错误文本的展示不会截断关键部分。

## 必须遵守的项目规则
以下原文摘自根目录 AGENTS.md 与 `.cursor/rules/ponytail.mdc`：
- "可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。"
- "领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。"
- "一类 durable fact 只能有一个 owner：……运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。"
- "Projection 是单向读取模型：……不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。"
- "依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract。"
- "Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。"
- "`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期。"
- "`app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素。"
- "`app/desktop` 的 JSX 属性，尤其 `className`，禁止模板字符串、字符串拼接和 JSX 内的条件表达式来组合值。组合 Tailwind class 必须使用 `cn` 包的 `cn`。"
- "修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。"
- "不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。"
- "选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。"
- "不要仅为了'看起来模块化'提取两三行命名函数。"
- "测试目录镜像源码领域目录；测试通过 public interface 证明行为，除非测试的是 adapter 或协议边界本身。"
- ponytail："Bug fix = root cause, not symptom……fix the shared function once"；"non-trivial logic leaves ONE runnable check behind"。

## 要运行的检查
从各 workspace `package.json` scripts 现查，在对应目录执行：
| workspace | 命令 |
|---|---|
| packages/coding-agent | `bun run typecheck`；`bun test`；改到 SDK 对外类型时加 `bun run build` 与 `bun run test:consumer` |
| packages/extension | `bun run typecheck`；`bun test` |
| packages/agent | `bun run typecheck`；`bun test` |
| app/server | `bun run typecheck`；`bun test` |
| app/desktop | `bun run typecheck`；`bun test` |

每项先跑直接相关的测试文件，收尾跑该 workspace 全量。

## 为什么这样拆分
第 01 项只动 coding-agent 的指令装配与 extension 的报错文案，是三项里收益最直接、风险最低的，且不依赖其他项；它单独就能让模型第一轮知道范围。第 02 项只动 Desktop，删除一个兜底并加一个发送前提示，与 01 无依赖，可并行。第 03 项动 agent core 与 server，且含一次需要真实 run 核实的现状，放最后，等 01、02 落地后用同一句 prompt 重放验证整体效果。不设收尾项，第 03 项完成时顺带跑全部 workspace 检查。
