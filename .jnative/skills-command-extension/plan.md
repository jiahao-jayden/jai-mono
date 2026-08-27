# Plan: Skills Extension 与 Slash Command 能力

来源:[intent](./intent.md) · 日期:2026-08-27 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-28

评审对象:大需求，需 review `plan.md`、`todo.md` 与全部 specs（含新增 06）。
执行门禁:状态改为 `✅ 已确认 · 可执行` 前，不得开始实现或修改生产代码。

## 背景

Coding Agent 当前把 Skills 放在独立的 `CodingSkillsRuntime` 特殊路径中，Extension contract 没有统一的 Command 注册入口，slash 输入也没有核心 registry 和统一派发。新特性要把 Skills 迁移为内置 Extension，同时建立可被其他 Extension 注册的核心 Slash Command 能力，并保留三种不同语义：可执行的 Extension command、Markdown prompt template、`/skill:<name>` Skill command。

## 方案

先在 `@jai/coding-agent` 建立 Operation-scoped Command registry。Extension 在激活时通过窄的注册契约提供 command 名称、描述和 handler；核心负责 `/name args` 解析、唯一 invocation name、派发顺序、未知 slash 的普通输入回退以及安全的 invocation metadata。handler 获得原始参数和 command context，可以完成 Extension 自己的 session/UI 工作流，或交回一次受控的 prompt expansion；核心不把 Command 变成另一个 durable store。

随后把现有 Skills catalog、`Skill` tool、资源读取安全和生命周期迁移到内置 Skills Extension。该 Extension 只为本地 Skills 注册 `/skill:<skill-name>`，并把本地 Markdown command prompt template 注册为普通 `/name`；它可以消费其他 Extension 提供的 Skill cards，但 Agent Plugin 的 cards 不转化为 Command。File-based command 只做 Markdown 正文和参数替换，不执行 shell 或脚本。

最后由 Server/Desktop 在 Operation 装配内置 Skills Extension，并保持 Agent Plugin 仅有既有 Skill/MCP/tool 能力。Desktop 复用现有 `DesktopSlashInvocation` DTO；Command registry、handler、Extension instance 和 catalog 都停留在当前 Operation 内存中，不越过 RPC 或 journal 边界。

本地 Skills catalog 严格采用 Agent Skills specification 的 Skill frontmatter schema：仅接受 `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`，并要求 `name` 与 catalog-visible child directory name 一致。`metadata` 仍是规范允许的 string map，版本等描述信息仅在其中出现且不产生 JAI 特有行为。移除所有 JAI/Claude/Pi 自定义或借用字段及其行为：顶层 `version`、`argument-hint`、`hidden`、`disable-model-invocation`、`user-invocable` 和 `metadata.displayName` 都应作为无效 frontmatter 或不再被解释。所有合法 local Skill 统一进入 `/skill:` 发现与模型自动 Skill 列表；Desktop Skill suggestion 只投影标准 name/description。用户级 `.agents/skills` 与 `.jai/skills` 可通过显式目录符号链接引用外部 Skill，但链接名也必须满足规范的 name/目录一致性；受信任 workspace 根仍必须拒绝越界符号链接，且资源读取持续约束于已选 Skill 的 canonical directory。

## 已确认的技术决策

- Command owner → Coding Agent 核心持有 Operation-scoped registry 与 dispatcher；Extension 只通过注册 API 加入 command。理由：Pi 的 Extension command 与 OpenCode 的 registry 形态都验证了核心统一解析、Extension 提供行为的边界。
- Extension command handler → 接收原始 args 与受控 command context，可直接完成 Extension 工作流；需要模型输入时由核心统一进入 prompt pipeline。理由：保持 Extension command 与 File-based prompt expansion 的语义区别，同时不让 Extension 绕过 Runtime 生命周期。
- Skills 迁移 → Skills catalog、`Skill` tool、资源读取和 slash 入口整体迁入内置 Skills Extension；Skill command 固定使用 `/skill:<skill-name>` namespace，普通 `/name` 不匹配 Skill。理由：保留 Skill 与普通 Command 的清晰语义。
- File-based command → 由 Skills Extension 从用户与受信任 workspace 的 `.jai/commands`、`.agents/commands` 读取 Markdown prompt template；文件名映射 `/name`，支持位置参数与 `$ARGUMENTS`，不执行 shell/脚本。理由：采用调研中 Pi/OpenCode 的 prompt template 形态，但收窄副作用边界。
- Extension command 重名 → 保留所有注册项并生成 `/name:1`、`/name:2` 等唯一 invocation name；不静默覆盖。理由：采用 Pi 已验证的确定性冲突处理。
- Agent Plugin 边界 → 本特性不向 Agent Plugin contract、`plugin.json` 或 Agent Plugin runtime 开放 Command 注册。理由：Agent Plugin 是本地文件包，新的可执行 handler 权限边界另立特性确认。
- Durable owner → Command invocation metadata 复用既有消息 projection；不新增 command database、JSONL、双写或 journal adapter。理由：Command 与 Extension runtime 都是 Operation-scoped 内存能力。
- Local Skill frontmatter → 严格使用 Agent Skills specification 的六字段 schema，`name` 必须与 catalog-visible directory name 一致；`metadata` 只保存规范允许的描述信息，不解释 `displayName` 或任何 JAI 行为。理由：统一跨 Agent Skill 的可移植文件格式，不把 Claude/Pi/JAI 的可选协议混入本地 Skill。
- Symlink trust boundary → 用户根允许显式 child-directory link；workspace root 即使被信任也不得允许其 Skill 目录逃逸。理由：用户显式安装常以 link 复用本地 Skill，但项目根是 workspace trust 的边界，不能因 link 获得外部文件读取能力。

## 没选的路

- **把 Command 合并成 Skill**：Claude Code 采用了这一方向，但会丢失本项目对可执行 Extension command 与 prompt template 的语义区分。
- **让 Skills 继续留在特殊 runtime**：会继续阻止其他 Extension 使用统一注册能力，并让 slash 解析分散在核心外。
- **把 File-based command 做成 shell/script runner**：会引入新的执行、审批、跨平台和输出协议，本特性只需要 prompt expansion。
- **让 Agent Plugin 直接注册 Command**：会把本地文件包提升为可执行 handler 来源，权限与信任边界尚未设计。
- **同名静默覆盖或按装配顺序取胜**：会让行为依赖 Host 接线顺序；采用显式 invocation suffix 保留全部来源。
- **兼容 Claude/Pi/JAI 的额外 frontmatter**：会让同一个 `SKILL.md` 同时依赖多套语义；采用 Agent Skills specification 的唯一白名单，额外字段作为无效文档诊断。
- **对用户根和 workspace 根采用相同的符号链接规则**：会同时误伤用户已安装的 link 与放宽项目越界；两者的 trust owner 不同，必须分别处理。

## 风险

- Skills Extension 与 Agent Plugin Extension 的激活顺序可能影响 Skill cards 的合并；实现必须让插件 cards 可供 `Skill` tool 使用，但禁止由插件间接产生 `/skill:` 或普通 Command，并用 Extension contract tests 固定这一边界。
- Command handler 既可能直接完成工作流，也可能请求 prompt expansion；核心必须在同一 Operation 生命周期内完成派发、取消与错误投影，不能让 handler 自己写 journal 或绕过 approval boundary。
- Skill namespace、普通 command 名称和 `name:ordinal` invocation 的解析规则会影响 Desktop metadata 与历史重放；必须先定义规范化和冲突测试，再接入 UI projection。
- 本地 command Markdown 与 Skill 文件属于不可信输入；路径 canonicalization、frontmatter 校验、内容 revision 和 watcher 更新必须复用现有安全读取模式，且 workspace roots 继续受 durable trust 控制。
- 删除 `CodingSkillsRuntime` 特殊装配可能影响 SDK、Server 和测试消费者；项目规则要求一次性迁移，不得保留 alias、fallback 或双轨实现。
- Command/Extension 错误会跨 SDK、Server 与 Desktop 边界传播；可恢复失败必须用 `Result<T, E>` 和 `TaggedError`，跨进程只投影白名单 DTO，不能暴露 cause/stack。
- 严格恢复 name/目录一致性会使目前目录名不同的本地 Skills 成为无效 catalog diagnostic；不做 fallback 或自动改名，安装者必须调整目录/链接名。
- 用户级符号链接允许目录目标在 catalog root 外；实现仍需验证 `SKILL.md` 和后续资源都落在该选中目录的 canonical root，不能以此打开任意路径读取。链接名也必须遵循 Skill name。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。」（`AGENTS.md`，错误处理规则）
- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「Projection 是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。」（`AGENTS.md`，事实归属）
- 「目录首先按领域事实或角色命名，而非按泛化技术命名。新目录不得命名为 `data`、`common`、`shared`、`helpers`、`utils`、`services`、`misc`。」（`AGENTS.md`，目录导航与拆分）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一层配置层。」（`AGENTS.md`，编码规则）
- 「Desktop 业务组件通过 `@/lib/icon-context` 的 `useIcon` / `useIcons` 使用图标；缺少图标时在 `IconName` 与 `defaultIcons` 中补充 Hugeicons 映射。不要在业务组件中直接引入 `lucide-react`、自绘 SVG 或用 Unicode 代替图标。」（`AGENTS.md`，组件规则）

## 验证基线

| workspace | 命令 |
|---|---|
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`bun test`；`bun run test:consumer` |
| `@jai/extension` | `cd packages/extension && bun run typecheck`；`bun test` |
| `@jai/server` | `cd app/server && bun run typecheck`；`bun test` |
| `app/desktop` | `cd app/desktop && bun run typecheck`（当前 `package.json` 没有 test script，验收注明这一点） |

## Spec 拆分理由

`01` 是必要 prefactor，但仍以可运行的 fake Extension command 端到端证明核心 registry、解析和 handler，而不是只定义类型。`02` 将现有 Skills 特殊路径迁成真正的 Extension，并通过 `/skill:` 验证 Skill 行为没有退化。`03` 在已存在的注册/派发 seam 上加入本地 Markdown prompt template 与参数替换，单独验证不执行脚本和 trust 规则。`04` 最后把内置 Skills Extension 接到 Server/Desktop Operation，验证 Agent Plugin 不间接获得 Command 且 Desktop projection 保持安全。`05` 已完成本地 Skills 的 catalog、安全边界和 Desktop discovery。`06` 取代 05 中新增的非标准 frontmatter 兼容语义，将 local catalog 与 Agent Plugin adapter 收敛到唯一的 Agent Skills schema；它依赖 05 的 catalog seam，但独立验证严格拒绝、目录名契约和已安装 Skill 的可观察影响。每刀都能独立运行对应 workspace 的类型检查与测试，依赖关系只沿真正的 runtime 接线方向推进。
