# OpenHands 的本地 / 云执行模型，与 JAI Execution Environment 的比较

核验日期: 2026-08-26。源码固定到 [`OpenHands/software-agent-sdk@90917f02ab2312ce47b710ad1c2aa8da76c918b1`](https://github.com/OpenHands/software-agent-sdk/tree/90917f02ab2312ce47b710ad1c2aa8da76c918b1)；同时核对 [`OpenHands/OpenHands@59981caf7fd92971681b0ab5354c37e9f1cab406`](https://github.com/OpenHands/OpenHands/tree/59981caf7fd92971681b0ab5354c37e9f1cab406)。前者承载当前 SDK、workspace 与 agent-server 的一手实现；后者用于确认产品仓库版本，避免把会变动的 `main` 当成事实。

## 结论

1. OpenHands 把「可执行机器 + 工作目录」抽成 `BaseWorkspace`：它规定命令执行、文件传输和 Git 查询；`LocalWorkspace` 直接操作 host filesystem 并在该目录执行 bash。这与 JAI 把所有 Tool 的文件与命令落到一个已绑定 `ExecutionEnvironment` 的出发点相同，而不是把云端理解成纯数据库/Session adapter。证据：[BaseWorkspace 的职责与抽象方法](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/workspace/base.py#L27-L230)，[LocalWorkspace 的 host filesystem 与 shell 实现](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/workspace/local.py#L17-L80)。

2. OpenHands 的 remote/cloud 不是「客户端 Agent loop 调远程文件系统」。SDK 遇到 `RemoteWorkspace` 时改建 `RemoteConversation`；创建 remote conversation 时会把 workspace 序列化成供 server 使用的 `LocalWorkspace`。随后该 server 的 `EventService` 在后台调用 `conversation.arun()` / `conversation.run()`。因此实际 Agent loop、Tool 和 workspace 都在 agent-server 所在机器，客户端只是调用 agent-server HTTP API。证据：[按 workspace 类型选择 Local/RemoteConversation](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/conversation/conversation.py#L126-L202)，[remote 创建时发送 server-side LocalWorkspace](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py#L813-L868)，[agent-server 后台执行 conversation loop](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-agent-server/openhands/agent_server/event_service.py#L1188-L1280)。

3. OpenHands Cloud 在同一 `OpenHandsCloudWorkspace` 内完成 cloud control plane 与 data/execution plane 的衔接：创建或按 `sandbox_id` 恢复 sandbox，等待其 RUNNING/health，通过暴露的 agent-server URL 建立 `RemoteWorkspace` HTTP 客户端；之后命令等操作调用那个 agent-server API。也就是说 Cloud 只是「provision/attach 一个带 agent-server 的环境」，而非另一套 Agent 模型。证据：[Cloud workspace 的语义与 local-agent-server mode](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-workspace/openhands/workspace/cloud/workspace.py#L53-L154)，[create/resume/wait/attach agent-server 的顺序](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-workspace/openhands/workspace/cloud/workspace.py#L272-L425)，[remote command 经 agent-server API 执行](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/workspace/remote/remote_workspace_mixin.py#L58-L185)。

4. OpenHands 也把依赖文件系统的 Skill 放在执行侧处理：remote workspace 通过 sandbox 内 agent-server 的 `/api/skills` 加载 public/user/project/org sources；它不是让客户端从云数据库取一段 Skill 文本后假设能执行。证据：[remote skill loading 的 server-side 语义与 source 分类](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-sdk/openhands/sdk/workspace/remote/base.py#L858-L929)。这支持 JAI 的「数据库可以决定加载什么，但运行所需字节必须物化在绑定机器」这一判断。

5. OpenHands 区分 durable conversation 与 live runtime：`ConversationService` 启动时仅加载 lightweight metadata，只有需要 live runtime 时才 hydrate `EventService` 和 event history。这说明「会话事实」并不等同于「一台还活着的执行机器」。但本次可核验源码不足以证明 OpenHands Cloud 产品如何持久化 conversation 与 `sandbox_id` 的关联，因此不能据此推断其完整的跨重启/多写者语义。证据：[ConversationService 的持久化与 live runtime 边界](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-agent-server/openhands/agent_server/conversation_service.py#L624-L668)，[Cloud workspace 对 caller-provided `sandbox_id` 的恢复路径](https://github.com/OpenHands/software-agent-sdk/blob/90917f02ab2312ce47b710ad1c2aa8da76c918b1/openhands-workspace/openhands/workspace/cloud/workspace.py#L137-L154)。

## 与 JAI 方案逐项比较

JAI 的比较基线是现有意图中已确定的方案：Desktop 使用本地 adapter；Cloud 直接用 E2B environment API；`ExecutionEnvironment` 是 Tool-facing 薄 contract；`EnvironmentProvider`/Host 负责 provision、attach 与 durable environment reference，Agent loop 暂留 Host 进程。

| 维度 | OpenHands 已验证实现 | JAI 拟议方案 | 判断 |
|---|---|---|---|
| 机器与 workspace 的统一抽象 | `BaseWorkspace` 统一本地、remote 与 cloud 的命令/文件传输/Git 能力；远程实际连 agent-server。 | Local/E2B adapter 统一 Tool 需要的读、写、搜索、命令；环境必须先绑定。 | **可比**。两者都拒绝「无机器的 coding agent」。JAI 应用同一批 contract test 才能把设计优势变成事实。 |
| 云端生命周期与运行时操作的分界 | `OpenHandsCloudWorkspace` 同时负责 create/resume/health/cleanup 和继承来的 remote workspace 操作。 | `EnvironmentProvider` 拿到/恢复 E2B sandbox；`ExecutionEnvironment` 只操作已经绑定的机器。 | **JAI 的设计更完整**：provider/control-plane 与 tool-facing data plane 明确分开，本地端不必伪造 pause、sandbox ID 等云概念。OpenHands 的单类做法更直接，但会让本地/远程生命周期能力同属一个基类。 |
| Agent loop 与 Extension 进程隔离 | Agent loop 在 sandbox 内 agent-server 上运行；remote client 只提交 spec/事件。 | 当前决定是 Agent loop 留在 Host，E2B adapter 把 Tool 的 fs/command 远程化。 | **JAI 较不完整**（若目标包含不受信任的 Agent Plugin/Extension）：Host 内仍会执行 Agent/Extension 代码，不能仅凭 E2B 隔离它们。若只执行受信任、随服务部署的 Extension，则是有意的取舍，不是缺陷。 |
| Skill / Plugin / config 的文件归属 | Skill 在执行侧 agent-server 加载；source 可含 user/project 等 filesystem source。 | 明确分成「谁决定加载」「字节在哪台机器」「效果在哪发生」；DB 只回答第一项，必须物化文件。 | **JAI 的设计更完整**，但目前是模型层完整：它明确覆盖 Skill、Plugin、file-backed config 与 MCP stdio 的不同位置；必须实现物化和发现路径后才能宣称产品能力领先。 |
| Session 与 sandbox 恢复 | 支持 caller 传 `sandbox_id` 并 resume；conversation service 有 durable catalog 与按需 hydrate live runtime。 | Session Journal/Operation Journal 与 Environment reference 分属不同事实 owner；Session 级 E2B attach、单写者由 Host 保证。 | **可比，尚未足以判定领先**。OpenHands 已有恢复入口；公开源码本次未证明 Cloud 的 sandbox 绑定持久化和并发协调细节。JAI 的单写者约束若落实，会是更明确的正确性边界。 |

## 这对 JAI 的实际决策意味着什么

OpenHands 证明了核心判断已被成熟系统采用：云化不是把配置/Session 换成远端 store，而是把 Agent 所依赖的工作区和执行进程放到一台真实机器，再在上层 provision/attach。JAI 在「环境操作」「文件字节归属」「会话持久化」三者分开建模上，比 OpenHands 的公开 `Workspace` API 更明确。

但不能据此说 JAI 整体已经“领先”。OpenHands 的 production remote path 还把完整 agent-server/Agent loop 迁入 sandbox；这使 Tool、Skill、Plugin 与 Agent 代码天然共址并被同一隔离边界包住。JAI 当前的 Host-loop + E2B-tool-adapter 只统一了 workspace I/O，尚未统一 Extension 代码的执行位置。

因此下一项不是扩大 `ExecutionEnvironment`，而是定清产品安全边界：

- 若 Web 只加载 JAI 随服务发布、受信任的 Extension，保留 Host Agent loop 是合理的；E2B 只承担 workspace 与命令环境。
- 若 Web 将来要让第三方/租户 Plugin 的任意代码参与 Agent loop，则要像 OpenHands 一样让 Agent Host/Extension worker 进入 sandbox，或单独引入有同等级隔离的 extension runtime；不能把它们留在 Web server 进程，再声称由 E2B 隔离。

## 对本项目的影响

这份对比支持现有 `runtime-source-adapter` intent 的四项前提：Operation 先绑定环境；环境与 Session Journal 分开；云端用 E2B 做 provision/attach 与文件/命令操作；file-backed Skill/Plugin/config 必须存在于实际读取或执行它的机器。

它同时补充一个未解决约束：**“Agent loop 留在 Host”与“Web 允许任意 Plugin”不能同时成立。** 现阶段意图已禁止 Web 动态执行数据库 Plugin，因而可以按 Host-loop 方案实施；若该产品边界改变，应先另开「extension execution isolation」设计，而不是向 `ExecutionEnvironment` 继续塞能力。
