# 需求说明: 能力变化通知（Capability Change Notice）

日期:2026-09-11

## 问题
Agent 运行期间，可用能力会变：MCP server 增删或其工具列表变化、Connector 完成授权或被启用/禁用、Skill 文件被增删改。现在这些变化要么到不了正在跑的会话，要么到了也没人告诉模型：

- MCP / Connector 的工具已经藏在固定的 `SearchTools` + `ExecuteTool` 前门后面，catalog 刷新不会改动模型可见的 tools，不破坏 prompt cache；但刷新后没有任何消息，模型只有再主动搜索才会发现，而且之前拿到的 `toolRef` 已全部失效，继续用会报错。
- Skill 是三者里唯一会破坏 cache 的：`Skill` 工具的 description 是一个 getter，每次请求重新读 catalog 拼 `<available_skills>`。Skill 文件一变，下一次请求的 tools payload 就变了，Anthropic 从 tools 开始的整个前缀全部失效。文件监听只更新 slash command 表，模型不知道；运行中调用已改动的 skill 只会得到一个 tool error。
- 用户在 Desktop 设置页保存 MCP 配置、或直接手改 `.jai/settings.json`，正在跑的 Operation 里的 MCP runtime 不会增删 server，要等下次新开 Operation。Connector OAuth 完成只把凭据写进 server 的 SQLite，正在跑的 Operation 里的 connector service 不知道，调用仍因未连接失败。

受影响的是所有在会话中途改动能力的用户，以及依赖 prompt cache 控制成本和延迟的每一次模型调用。

## 期望结果
- 三种来源在会话中途发生的增删改，都会以一条**写进会话记录、只给模型看、用户界面不显示**的 synthetic user 消息告知模型：新增了什么、删除了什么、更新了什么，以及旧引用是否失效。通知只在用户发出下一条消息、新 run 发起时投递，作为初始输入的第一条、用户 prompt 紧随；不打断正在进行的 run，不使用 `steer`。消息只追加在末尾，不改历史，不动 tools 与 system prompt，cache 前缀保持稳定。
- 模型可见的 tools 数组在整个 Operation 内不再变化。`Skill` 工具的 description 改为固定文案，可用 skill 清单改为：首次 run 发起时注入一条全量清单，之后变化走增量通知，压缩时把当前全量清单作为固定段落附在压缩摘要后，压缩后的同一 run 内没有缺口。
- "模型当前被告知的能力集合"（binding）由 coding-agent core 统一持有和比对；extension 只负责回答"现在有什么"和"可能变了"，不记旧状态、不生成通知、不感知压缩。
- Desktop 保存 MCP 设置、手改 JSON、Connector OAuth 完成，都会传到正在跑的 Operation：MCP runtime 按新旧配置增删 server，connector service 重读凭据，随后走同一条通知链。
- 设置页的"测试连接"探测保持独立，不与运行中的连接合并。

## 图解

### 分工：谁拥有什么

```mermaid
flowchart LR
    subgraph sources[变化来源 · Extension 只回答两个问题]
        MCP["MCP Extension<br/>discover: server 工具<br/>subscribe: list_changed / 配置变化"]
        CONN["Connector Extension<br/>discover: actions<br/>subscribe: 设置变更（新增）"]
        SKILL["Skills Extension<br/>discover: skill name+描述<br/>subscribe: fs watch<br/>presentation: announced"]
    end

    subgraph core[coding-agent core · 拥有 binding]
        COORD["Catalog 刷新协调器<br/>串行 discover → diff → commit"]
        BIND[("binding<br/>上次告知模型的集合<br/>内存 · 每个 Operation 一份")]
        CAT["ToolCatalog<br/>SearchTools / ExecuteTool 用的表"]
        NOTICE["通知生成<br/>名字 + 一句话<br/>toolRef 已失效提示"]
    end

    subgraph agent[Agent / Journal]
    J[("Session journal<br/>synthetic user message")]
        MODEL["模型上下文<br/>tools 与 system 不变<br/>消息只追加在末尾"]
    end

    UI["Desktop / ACP 投影<br/>按 metadata.synthetic 过滤"]

    MCP -->|invalidate| COORD
    CONN -->|invalidate| COORD
    SKILL -->|invalidate| COORD
    COORD <-->|比对 / 更新| BIND
    COORD -->|searchable 条目| CAT
    COORD -->|diff 非空| NOTICE
    NOTICE -->|run 初始输入第一条| J
    COORD -->|aroundCompact: announced 快照附在摘要后| J
    J --> MODEL
    J -.->|synthetic 不显示| UI
```

### 生命周期：一次变化从到达到被模型看到

```mermaid
sequenceDiagram
    participant U as 用户 / 文件 / Server
    participant EXT as Extension
    participant C as 协调器 (core)
    participant B as binding
    participant A as Agent
    participant J as Journal → 模型

    Note over A: Operation 打开：装配 extension，模型可见 tools 固定
    C->>EXT: discover()
    EXT-->>C: 当前集合
    C->>B: searchable：binding = 当前集合（不通知）<br/>announced (Skill)：binding = 空

    Note over A: run 发起
    C->>EXT: 比对当前 vs binding
    alt diff 非空
        C->>A: 通知作为初始输入第一条，用户 prompt 紧随
        A->>J: 两条一起写入
    end

    Note over A: turn 进行中（每次模型调用）
    A->>J: 什么都不加，前缀稳定

    U->>EXT: 配置变了 / list_changed / skill 文件变了
    EXT->>C: invalidate()
    C->>EXT: discover()
    C->>C: searchable → ToolCatalog.replace（SearchTools 立即可见）
    Note over C,B: 不比对、不通知、不打断当前 run

    Note over A: 压缩（run 中途）
    C->>J: aroundCompact：announced 快照附在摘要后
    Note over J: 摘要 + 清单成为新前缀

    Note over A: 用户发下一条消息 → run 发起
    C->>B: diff(当前, binding) → 新增 / 删除 / 更新
    C->>B: binding = 当前
    C->>A: 通知作为初始输入第一条，用户 prompt 紧随
    A->>J: 两条一起写入
```

### reconcile：唯一的一段逻辑

```mermaid
flowchart TD
    subgraph refresh[任何时刻：invalidate]
        D["discover() 取当前集合"] --> P{"presentation?"}
        P -->|searchable| CMT["ToolCatalog.replace(当前)<br/>SearchTools 立即可见，旧 toolRef 失效"]
        P -->|announced| SKIP["不进 SearchTools，只保存当前集合"]
    end

    subgraph runstart[用户发消息：run 发起]
        DF["diff = 当前 − binding<br/>按 name + description<br/>→ 新增 / 删除 / 更新"]
        DF --> E{"diff 为空?"}
        E -->|是| END1["直接进入 run"]
        E -->|否| B2["binding = 当前"]
        B2 --> G["生成通知文本<br/>名字 + 一句话<br/>searchable 且有替换 → 提示 toolRef 失效"]
        G --> W["通知作为初始输入第一条<br/>用户 prompt 紧随"]
        W --> J[("journal: synthetic user message")]
    end

    subgraph compact[run 中途：压缩]
        AC["aroundCompact：announced 当前集合<br/>渲染为固定段落附在摘要后"] --> J2[("journal: compaction entry")]
    end

    CMT -.-> DF
    SKIP -.-> DF
    SKIP -.-> AC
```

### 触发源：三条路怎么接进来

```mermaid
flowchart LR
    subgraph mcp[MCP]
        S1["Desktop 保存设置"] --> F[".jai/settings.json<br/>user / project"]
        S2["用户手改 JSON"] --> F
        F --> CW["configStore.watch<br/>（已有）"]
        CW --> LC["layered configuration<br/>快照 → 可订阅（改）"]
        LC --> MR["McpExtensionRuntime<br/>按 server 名 diff：启动 / 关闭 / 重启"]
        MR -->|连上后| INV1["invalidate（已有）"]
        S3["MCP server 主动<br/>tools/list_changed（已有）"] --> INV1
    end

    subgraph conn[Connector]
        O["OAuth 完成 / 启用禁用"] --> RAS["RuntimeAgentSettings<br/>写 SQLite（已有）"]
        RAS --> EV["写入后发布变更（新增）"]
        EV --> CS["活跃 Operation 的<br/>connector service 重读配置"]
        CS --> INV2["catalog.subscribe → invalidate（新增）"]
    end

    subgraph skill[Skill]
        FS["skill 文件增删改"] --> WATCH["catalog.watch（已有）"]
        WATCH --> INV3["映射为 subscribe → invalidate"]
    end

    INV1 --> COORD["协调器 reconcile"]
    INV2 --> COORD
    INV3 --> COORD

    PROBE["设置页 probeMcpServers"] -.->|独立，不动| X[" "]
    style X fill:none,stroke:none
```

## 影响范围
会改到的模块:
- `packages/coding-agent`：extension 契约（catalog 的投递方式声明）、catalog 刷新协调器（binding、diff、通知投递）、run 发起与压缩后的注入点
- `packages/extension/src/skills`：`Skill` 工具 description 固定，skill 清单改为 catalog 形式对外
- `packages/extension/src/mcp`：runtime 响应配置变化增删 server
- `packages/extension/src/connector`：catalog 补 `subscribe`，响应 server 侧设置变更
- `packages/coding-agent` extension host adapter：layered configuration 从一次快照改为可订阅
- `app/server`：`RuntimeAgentSettings` 写入后的变更通知；ACP / Desktop 投影对隐藏消息的处理核对

长期保存的数据与维护方:
- 通知消息作为 user message 写入 Session journal（`@jai/agent` journal 维护，SQLite），带 `metadata.synthetic: true`。不新增表、不新增字段类型；沿用 `RuntimeHost` 切换 workspace 时已在用的系统生成消息形式。
- binding 是每个 Operation 的内存状态，可丢弃，Operation 打开时重建；不持久化。
- MCP 声明配置仍在 `.jai/settings.json`（`configStore` 维护）；Connector 配置仍在 server SQLite `runtime_agent_settings`（`RuntimeAgentSettings` 维护）。两者只读不改结构。

## 边界
- Skill 不进入 `SearchTools` 目录；它只走清单注入与增量通知。
- 不改 `SearchTools` / `ExecuteTool` 的 schema 或搜索行为。
- 不合并设置页的 `probeMcpServers` 与运行中的 MCP 连接；不改 `mcp-settings.ts` 的探测逻辑。
- 通知只给名字和一句描述，不附带完整 schema 或 skill 正文。
- 用户界面完全不显示通知，不做折叠提示。
- 不对已写入 journal 的旧通知做清理或改写。
- 不处理 Agent Plugin 目录的运行中变化（它通过 Skills / MCP 间接生效，不单独建来源）。

## 工作量
大。通知通道是三种来源共用的基础，需先单独交付并用 MCP 已有的 `tools/list_changed` 触发源验证端到端；Skill 的清单迁移、MCP 配置热更新、Connector 设置送达各自涉及不同 workspace 和不同触发源，可以并行、也需要分别检查。

## 已确认的现状
- 模型可见 tools 在 Agent 构造时固定为静态工具 + `SearchTools` + `ExecuteTool`；catalog 刷新只调 `ToolCatalog.replace`，不改模型可见列表，但使所有旧 `toolRef` 失效（`packages/coding-agent/src/runtime/tool-catalog.ts`，`packages/coding-agent/src/runtime/assemble.ts`）。
- `ExtensionCatalogRefreshCoordinator.#discoverAndCommit` 是唯一同时持有新旧两份 catalog 的位置（`packages/coding-agent/src/sdk/extensions.ts`）。
- Extension catalog 契约只有 `discover` 与 `subscribe(invalidate)`，注释明确 invalidate 不携带任何可变状态（`packages/coding-agent/src/sdk/extensions/contract.ts`）。
- `Skill` 工具的 description 为 getter，读 `catalog.snapshot.skills`；skills catalog 已有 fs watch、debounce 与 `revisionOf` 哈希（`packages/extension/src/skills/index.ts`、`catalog.ts`）。
- Anthropic adapter 在 system、最后一个 tool 定义、最后一条 user 消息的最后一个 block 三处打 cache breakpoint（`packages/ai/src/providers/anthropic.ts`）。追加在末尾的 user 消息不影响前缀。
- 系统生成的 user 消息带 `metadata.synthetic: true`；写进 journal 时可跨会话保留，`beforeModelCall` 注入的请求级 system context 不写 journal。ACP / Desktop 投影按 `metadata.synthetic` 过滤前者。本需求使用 durable synthetic user message。
- `AgentInput` 接受 `AgentMessage[]`，run 发起时可以把通知与用户 prompt 一起作为初始输入（`packages/agent/src/core/agent.ts`）。`steer` 与用户自己的 steer 消息共用队列，本需求不使用它。
- harness 提供 `aroundCompact` 洋葱式 middleware，可以在默认摘要生成后修改结果再写入 compaction entry（`packages/agent/src/harness/hooks.ts`）。
- extension 拿到的 layered configuration 在 activate 时拍一次快照，`persistent: false`，之后不再更新（`packages/coding-agent/src/sdk/extensions/host-adapters.ts`）；而 `configStore.watch` 已在监听 user 与 project 的 `.jai/settings.json`，目前只用于更新权限快照（`packages/coding-agent/src/runtime/create-coding-agent.ts`）。
- MCP runtime 的 server 表只在构造时从配置建立（`packages/extension/src/mcp/runtime.ts`）；已连接 server 的 `ToolListChangedNotification` 与重连会 `invalidate`。
- Connector catalog 没有 `subscribe`；`MemoryConnectorService.applyConfiguration` 只换 connections / credentials / policy；OAuth 完成只调 `saveConnectorOAuth` 写 SQLite（`app/server/src/connectors/oauth-runtime.ts`，`app/server/src/config/runtime-agent-settings.ts`）。
- `RuntimeMcpSettingsController` 同时持有 `save` 与基于 `probeMcpServers` 的 `status`，探测是独立于 Agent runtime 的第三条连接（`app/server/src/runtime-capabilities/mcp-settings.ts`）。

## 参考对象
- 统一前门的缓存论证见 [JAI 统一工具前门](../research/tools/_jai-unified-tool-frontdoor.md)。
- Claude Code 的做法（用户元数据消息承载 skill / MCP 清单、末尾注入热更新提示、压缩后重建）作为行为参考，不严格遵循；本仓库 journal 只能追加，因此"重建第一条消息"等价为"压缩后追加一条新快照"。
