---
jn_type: task
jn_stage: null
jn_state: closed
jn_closed_reason: completed
---

父需求：[Harness Playbook 问题核验与分阶段收敛](./prd.md)
草稿标识：T5

## 交付结果

完成对 `docs/harness-playbook-analysis.md` 剩余主张的当前代码核验，标出确实需要架构改动的代码区域和下一份 RFC 边界，覆盖父 PRD 的 AC10、AC11。

## 范围

做：在 T1-T4 完成后重新读取当前代码、相关测试和已有 Issue；逐条分类；记录证据、事实 owner、受影响状态或协议、风险和建议的下一份 RFC 边界；把结果追加到本任务执行记录并更新父 RFC 的审计结论。

不做：实现任何架构改动；创建兼容层；把 Playbook 的建议直接翻译成项目任务；重复已经关闭或已有 owner 的工作。

## 背景与约束

原分析文档早于多项修复。当前核验显示 queued-input reducer 已能识别 pending input，但 fresh-Host policy 仍未闭合；输出上限、环境清洗、OS sandbox 已经落地；`Read` 的 OOM 描述与当前流式实现不符；mode/model、usage branch ownership、SDK model metadata、capability notice rewind、spectator、Director/ConVar、tool surface、PTY ledger 和 compaction 等需要单独判断。

分类固定为：

- 已解决：当前代码或已完成 Issue 已覆盖，给出证据。
- 局部缺陷：可在现有 owner/interface 内修复，但不自动加入本需求。
- 需要架构改动：会改变事实 owner、状态轴、协议、durable schema、依赖方向或跨模块生命周期。
- 证据不足或不采纳：原主张与当前代码不符，或没有产品场景支撑。

必须遵守根 `AGENTS.md` 的事实归属、四条 Harness 状态轴和模块依赖方向。不能为“看起来完整”提出第五条状态轴、新 durable adapter 或无产品查询的历史模型。

## 前置交付物

- [T1 Desktop 运行中队列与 Steer 交互](./01-desktop-queue-steer.md)
- [T2 拒绝畸形 Provider 工具参数](./02-reject-malformed-tool-arguments.md)
- [T3 为 Edit 增加大文件熔断](./03-bound-edit-file-input.md)
- [T4 保证 Shell 进程组硬杀](./04-process-group-hard-kill.md)

本地 tracker 不提供原生 blocked-by API，以上链接是明确的依赖回退。T1-T4 全部通过验收前不开始本任务。

## 开始前核对

- 读取父 PRD、当前任务、相关项目规则和前置交接。
- 确认范围已获授权、前置成果在当前环境可用。
- 检查是否已有执行者及工作目录中的重叠改动；冲突时不接管或覆盖。

## 验收条件

- [x] 原分析文档的每个主要缺陷主张都归入四类之一，没有遗漏或重复计数。
- [x] 每个“需要架构改动”条目包含当前代码证据、事实 owner、受影响状态轴/协议、跨模块边界和用户可观察问题。
- [x] 每个建议 RFC 有单一主题和明确不做范围，不把所有架构方向打包成一次重构。
- [x] 已解决条目关联当前代码或现有 Issue；关闭但未验收或证据不完整的记录不会冒充完成。
- [x] 证据不足条目写明缺少的产品场景或与当前实现冲突的事实。
- [x] 审计不修改产品代码、schema、协议或架构。
- [x] 父 RFC 更新审计结论和建议顺序，负责人可以据此决定是否启动下一份 RFC。

## 检查方式

使用 CodeGraph 与当前源码定位 owner 和调用路径；读取相关测试与 GitHub Issue 元数据。对每条结论复核文件/符号、当前行为和测试证据。若 GitHub 仍不可用，明确标记无法复核的 Issue 状态，不用旧聊天结论替代 tracker。

不要求运行全仓测试，因为本任务不改产品代码。若为验证行为编写临时实验，记录命令和结果，不把实验产物提交到仓库。

检查未通过或缺少证据时保持任务打开。完成后执行记录写入分类清单、证据、限制和交接，才能以 completed 关闭。

## 执行信息

执行者/会话：Codex 当前会话
工作位置：/Users/jayden/code/jai-mono
更新时间：2026-09-21
阻塞原因：无

## 执行记录

2026-09-21，Codex 在 `/Users/jayden/code/jai-mono` 完成只读架构触点审计，未提交。本任务没有修改产品代码、schema 或协议。

### 已解决

1. **Desktop Steering 与可见 follow-up 队列**：T1 已接通 Enter 入队、`Ctrl/Cmd+Enter` steer、队列编辑/删除/排序/提升和自动排空。原文“桌面端转向通道被架空”不再成立。
2. **畸形工具参数静默降级**：T2 在 `packages/ai/src/adapter.ts` 与三个 Provider adapter 中改为 `ai_provider.invalid_tool_arguments` 协议失败，不再伪造 `{}`。
3. **Edit 全文件 OOM 与 Shell kill race**：T3 在 Edit owner 内增加 10 MiB `stat` 预检；T4 保留父进程退出后的进程组硬杀。原文对应两个明确缺陷已修复。
4. **Shell 输出、环境和 OS sandbox**：Issue #94 已关闭并覆盖输出上限；#100 与 #105 已关闭，当前 `SandboxedNodeExecutionEnvironment` 对 macOS/Linux 强制执行文件/网络边界且没有 unrestricted fallback。原文“没有 OS 级 sandbox、宿主环境直接泄漏给 Shell”已过时。
5. **Harness authority 与四条状态轴**：Issue #91 已关闭，根 `AGENTS.md` 已固定 Operation terminal outcome、recovery verdict、foreground state、stop reason 四轴及事实 owner。原文不能再以新状态机为前提另造第五条轴。
6. **动态工具常驻面**：`ToolCatalog.frontdoorTools` 只有 `SearchTools` 与 `ExecuteTool`；MCP、Connector 等长尾工具通过动态目录。原文把 13 个 schema 一概计为“每轮常驻”与当前实现不符。

Issue 元数据于 2026-09-21 通过 `gh` 复核：#91、#94、#100、#105 为 closed。#87 仍为 open，虽然正文有完成记录，因此没有把它计入已解决。

### 局部缺陷

1. **Usage 投影跨分支累计**：`RuntimeSession` 构造和 `snapshot()` 仍对全部 `operationRecords` 调用 `usageCost()`，而 `operationIdByEntryId`、foreground 和 recovery 已使用 `branchOperationRecords()`。这是 `app/server/src/runtime/host.ts` 现有 projection owner 内的过滤遗漏，不需要改变 durable owner、状态轴或协议；后续可用一个小修复和分支回退测试处理。
2. **本地 UDS 权限未收紧**：三个 local endpoint 位于 `os.tmpdir()`；transport 只执行 `server.listen(endpoint)`，没有 `chmod`、受控父目录或 peer credential 检查。锁文件的 `0600` 不能保护 socket。这可以先在 local transport owner 内增加 Unix socket mode/父目录约束和真实权限测试；远程身份与多租户鉴权不应混进这个局部修复。

### 需要架构改动

#### A. 分支感知的 Session 执行配置

- 当前证据：`product_session_runtime_configurations` 独立于 Session tree，读取最新 sequence；`RuntimeSession.navigate()` 只追加 branch entry，不回退 `mode/model`。
- durable fact owner：当前由 Server 的 Product Session persistence 拥有；目标 owner 必须明确为 Session journal 中的分支事实，或定义同等严格的 branch-derived configuration fact。
- 状态轴/协议：不新增 Harness 状态轴；影响 prompt admission 时冻结的 `RuntimeSessionConfiguration` 及 navigate/configuration RPC 语义。
- 跨模块边界：`@jai/agent` Session journal、`app/server` persistence/runtime、ACP configuration projection。
- 用户可见问题：回退消息后仍保留未来分支的 Plan/Automate 模式或模型选择。
- 下一 RFC：**“Branch-aware Session execution configuration”**。只解决 mode/model 的写入、折叠、导航和 operation admission；不做通用 ConVar、配置文件合并重写或 provider catalog 重构。

#### B. Durable queued input 的 fresh-Host 恢复策略

- 当前证据：`recoverOperation()` 会返回 `pendingInputs`，但 `RuntimeHost.finalizeRecoveredOperations()` 会把 fresh Host 的 `ready/provider_interrupted` 直接追加为 `operation_finished(interrupted)`；reserved-entry replay 只在直接 Agent 恢复测试中成立。#87 仍 open，其正文明确选择“不自动续跑”，与“用户输入永不丢失”的产品语义尚未统一。
- durable fact owner：`input_queued` 属于 `@jai/agent` operation journal；Session user message 属于 Session journal。任何补写必须定义跨两本日志的唯一提交规则。
- 状态轴/协议：涉及 recovery verdict 到 terminal outcome 的映射，以及 pending input 是否转为 Session entry；不能把 `requires_action` 或新字面量混入这两条轴。
- 跨模块边界：Agent operation reducer、Server fresh-Host finalization、Session journal append、ACP snapshot。
- 用户可见问题：已确认落盘的 steer/follow-up 在 Runtime Host 崩溃后可能只留下 interrupted 状态，文本没有进入当前分支。
- 下一 RFC：优先**修订/续接 #87，而不是新建重复任务**，主题限定为“durable queued-input crash policy”。明确 replay、物化为普通 user message或显式恢复 UI 三选一，并覆盖幂等与分支归属；不自动重放 indeterminate tool，不改变普通 interrupted policy。

#### C. ACP Session attachment roles 与 durable observation

- 当前证据：`acquireController()` 保持单 controller；`observeSession()` 只订阅 live Session，对 durable idle Session 返回 no-op。当前协议没有 spectator 角色、快照加增量游标或控制权交接。
- durable fact owner：Session/operation 仍由 Agent journal 拥有；attachment、controller lease 和 subscription cursor 是可丢弃的 Host/transport 状态。
- 状态轴/协议：影响 ACP connection/session attachment protocol 和只读 projection，不改变四条 Harness 状态轴。
- 跨模块边界：RuntimeHost、ACP-v2 agent/transport、Desktop/未来 Web 或移动客户端。
- 用户可见问题：第二客户端不能只读观察；idle Session 的 observer 也收不到 durable 初始状态或后续 materialization。
- 下一 RFC：**“ACP controller/spectator attachment contract”**。只定义角色、初始 snapshot、增量、断线和交接；不同时实现公网传输、租户系统或远程 sandbox。

#### D. Child agent 的能力与上下文继承契约

- 当前证据：`runAgent` 手工复制 model/provider、生成参数和 compaction，只为 child 安装 `aroundToolCall/onEvent`；父级 `beforeModelCall`、attachment projection、command context 与 `aroundCompact` 没有进入 child。`SpawnAgent` 文案反而要求任务自包含。
- durable fact owner：child Session journal 仍由 Agent 持有；能力、hook、attachment 和 command context 是 operation 级 ephemeral 输入。
- 状态轴/协议：不影响四轴；影响 `runAgent`/Extension host 的 child capability contract。
- 跨模块边界：Coding Agent runtime、Extension contract、Subagent extension、Server child-session assembly。
- 用户可见问题：父 agent 可用的附件、提示变换或压缩钩子在 child 中静默消失，行为依赖一份容易漏字段的复制清单。
- 下一 RFC：**“Child-agent execution context contract”**。逐项规定 inherit、recompute、drop，先用 attachment/hook 失败测试固定语义；不引入通用 ConVar 标签，不让 child 扩大父权限。

#### E. Host 选择的模型能力快照

- 当前证据：Server Models.dev catalog 已拥有 modalities、context window、output limit、reasoning、tool-call 等 allowlisted metadata；`packages/coding-agent/src/sdk/model.ts` 仍硬编码 image、128K、8192 和 toolCall=true，`RuntimeAgentSettings.resolveOptions()` 只传 model ref/provider options。
- durable fact owner：catalog/cache 属于 Server model-catalog；一次 Operation 使用的模型能力应由 Host 在 admission/open 时冻结为安全快照，SDK 不应反向拥有产品 catalog。
- 状态轴/协议：影响 operation construction 和 compaction/request validation contract，不新增 runtime 状态轴。
- 跨模块边界：Server model-catalog/configuration → CodingAgentOperationDriver → Coding Agent/AI Model。
- 用户可见问题：错误的压缩阈值、输出上限和附件能力会导致过早压缩、请求失败或向纯文本模型发送图片。
- 下一 RFC：**“Operation model capability snapshot”**。只传当前 operation 需要的规范化能力并定义缺失值策略；不建设 Quirks taxonomy，不重写 Provider adapter。

#### F. Terminal 的可重放逻辑历史

- 当前证据：`TerminalRegistry` 保存最多 262,144 字符的原始 `history`，使用字符串尾切并在重挂载时原样写回 xterm；历史包含旧宽度换行、ANSI/alternate-screen 状态，切片也可能截断 Unicode/CSI。
- durable fact owner：Terminal history 是 Desktop 运行态，不进入 Session journal；若产品要求跨挂载 fidelity，owner 应仍是 TerminalRegistry 的 bounded logical replay state。
- 状态轴/协议：影响 Desktop terminal snapshot/replay protocol，与 Harness 四轴无关。
- 跨模块边界：Electron terminal process、renderer xterm mount/resize、Desktop RPC event stream。
- 用户可见问题：切换会话或调整宽度后可能乱码、错行、重影；活动屏程序的控制序列会污染新终端。
- 下一 RFC：**“Terminal logical replay contract”**。只定义活动屏、已提交逻辑行、截断和 resize replay；不打包聊天 transcript 协议或统一 Job 抽象。

#### G. 受信 Extension 的进程边界（条件项）

- 当前证据：Shell 已进入 OS sandbox，但第一方/用户发现的 Extension hook 与部分文件转换仍在 Host Node 进程执行。#100 明确把“任意不受信任 Extension 代码隔离”列为范围外。
- durable fact owner：Extension state 仍分别属于 Coding Agent/具体 Extension；进程隔离只改变执行 adapter 与 capability DTO，不能创建第二状态源。
- 状态轴/协议：需要新的 extension-host RPC 生命周期，但不应改变 Operation terminal/recovery 语义。
- 跨模块边界：Coding Agent extension host、Agent plugin loader、Server capability source、sandbox worker。
- 用户可见问题：只有在允许不受信 Extension 代码时，死循环、内存破坏或直接读取 Host secrets 才构成当前产品漏洞。
- 下一 RFC：先做**“Extension trust model”**，明确哪些扩展是代码、哪些是纯数据、哪些来源受信；只有 threat model 要求隔离时再做 extension worker protocol。不把全部内置工具改成 RPC stub，也不重做已完成的 Shell sandbox。

### 证据不足或不采纳

1. **同 workspace 并发必须加文件租约**：没有当前产品冲突案例、锁粒度或期望合并语义；先收集并发写失败，不按 Playbook 假设直接建锁服务。
2. **Remote driver / Factorio 现状本身是缺陷**：仓库已有 #74 负责远程 Runtime；本需求没有新的远程产品场景。Docker 拓扑评价也不是可验收缺陷，不重复规划。
3. **`turnCount` 必须 durable**：`maxIterations` 当前限制一次 Agent invocation/Operation，不是 Session 终身累计配额；重启后重新计数符合现有语义。
4. **Capability notice 必须随 rewind 回退**：`lastTold` 是 live RuntimeSession 内存，但尚无“导航到发现前节点后必须重新公告”的产品用例和失败测试。先定义公告的 Session/operation 生命周期，再决定是否进入 branch-derived state。
5. **`terminalOutcomeByAssistantEntryId` 跨分支污染**：recovery 先用 `branchOperationRecords()` 过滤 operation；当前没有能把废弃分支 outcome 映射到活跃 operation 的复现。可清理，但不能与已证实的 Usage 缺陷重复计数。
6. **Read 会整文件 OOM**：当前 `Read` 使用 chunk stream，只保持 bounded 选区和行缓冲；它为统计总行数扫描完整文件，但不全量缓冲。把目录、SQLite、归档、Notebook、PDF 加进 Read 是产品能力扩展，不是现有正确性缺陷。
7. **统一 Job 原语**：Shell、PTY、Subagent 的生命周期不同。没有先列出共同取消、后台存续、输出和恢复行为，直接抽象 Job 会扩大接口且违反“不要为单一实现造 seam”。
8. **Director 栈解决 Plan/Todo**：现有证据只有 Todo 在 `beforeModelCall` 注入状态和 Plan 在权限层拒绝写；没有“模型空转直到 maxIterations”或“必须强制继续”的回归测试。先用实际失败固定产品语义。
9. **通用 ConVar 标签**：当前已知问题可以分别由 branch-aware configuration 和 child execution context 解决；没有第二组稳定的 replication/inheritance 使用者，不接受通用标记框架。
10. **同步 compaction 导致 30–90 秒白屏**：代码确实同步 await compaction，但原文没有当前 telemetry。投机压缩会新增取消、成本、分支失效和并发 owner；先记录 p50/p95 与用户可见 loading，再决定是否立项。
11. **Quirks taxonomy / corrective inference**：T2 选择 malformed JSON fail-closed；XML/DSML 正文工具调用当前也 fail-closed。自动补 JSON、提取伪工具调用会改变信任语义，不能作为“容错”默认引入。`<think>` 只在原文出现，当前代码只解析结构化 `reasoning_content/reasoning`，没有泄漏复现。
12. **13 个常驻 schema、Skills/Todo 破坏缓存**：前门工具只有两个，内置/Extension 工具是否 announced 或 searchable 由当前 assembly 决定；原文没有实际请求 schema/token 与 Provider cache hit 数据。
13. **`dyn` CLI、AutoQA、通用资源物化器**：都扩大工具协议或产品能力，缺少用户需求、威胁模型与收益数据，不作为缺陷修复。
14. **聊天“弹性推测槽位协议”**：`#projectTrailingNarration` 确实复用 item ID 并改变 kind，但没有滚动跳动/虚拟化高度失败测试。先在现有 Desktop projection/UI owner 内复现，不能直接升级为新协议。
15. **工具长日志阻塞 renderer**：当前普通 transcript 不直接展示完整 tool result，Shell 输出已有上限；原文未给出仍可触发大 `<pre>` 每帧测高的当前路径。
16. **全面 Rust/N-API 或把所有工具变成隔离 Stub**：TypeScript 语言选择不是缺陷；Shell sandbox 已完成。只有实测 CPU hotspot 或扩展 threat model 才能支持局部边界调整。

### 建议顺序

1. 先修两个不需要架构的新缺陷：branch-aware usage projection、本地 socket 权限。
2. 架构优先级一：Branch-aware Session execution configuration。
3. 架构优先级二：修订 #87，决定 durable queued-input crash policy。
4. 架构优先级三：Operation model capability snapshot。
5. 有第二客户端需求时启动 ACP attachment roles；有 child 上下文失败案例时启动 child-agent contract。
6. Terminal logical replay 独立排期；Extension 隔离先完成 trust model，不能和前述 RFC 合并。

### 检查与限制

- 使用 CodeGraph 和当前源码核对 Runtime Host、operation recovery、ToolCatalog、Coding Agent child assembly、local transport、model catalog 与 terminal owner。
- `gh auth status` 通过；#87/#91/#94/#100/#105 元数据和正文已重新读取。#87 的 tracker state 与正文完成记录不一致，按真实 open 状态处理。
- `git diff --check`：通过。
- 本任务只写本地 tracker；没有创建新 Issue，也没有把“建议 RFC”当作已授权实施。
