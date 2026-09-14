# Plan: Server Runtime Source Compatibility

来源:[intent](./intent.md) · 日期:2026-08-26

## 背景

`openConfiguredRuntimeHost()` 把 `$JAI_HOME/agent` 同时当作 Coding Agent configuration 的用户根和 workspace 根，Desktop 的本地 JSON / Skills 因此没有跟随真实用户目录与 `cwd`。Agent Plugin 的发现虽然单独读取本地目录，但仍由 daemon 直接决定，不能成为未来 Web Host 可替换的行为。

Server 需要同时作为 Desktop 和未来 Web 的产品层。两者共享 Session / Operation Runtime，却不共享能力来源：Desktop 是用户本机目录，Web 将是数据库和受控服务资源。把它们继续写进 daemon，Server 就只能通过宿主类型分支工作。

## 方案

1. 在 `@jai/coding-agent` 把文件化 configuration 的用户根、workspace 根与 workspace trust 变成明确的 construction input；删除语义混杂的 `agentDataRoot`，不保留兼容路径。SDK 只消费已给出的路径，不知道 Desktop、Web、SQLite 或数据库。
2. 在 `app/server` 建立 `RuntimeCapabilitySource`。它以一次 Operation 的安全输入解析 file configuration 和允许进入该 Operation 的 Agent Plugin / Extension 增量；Provider、Connector 和 model 仍由现有 Server SQLite configuration assembly 负责。它是产品能力选择 contract，不是泛化 storage。
3. 提供 Desktop Local source。它以真实用户目录、Operation `cwd` 和已有 `SqliteWorkspaceTrust` 的 canonical workspace projection 选择本地 configuration、Skills 与 Agent Plugin。未信任 workspace 不进入 project Agent Plugin roots。
4. `openConfiguredRuntimeHost()` 仅装配 Desktop Local source。Server Operation driver 合并现有 Provider/Connector assembly 与 source 的结果，而非自行读用户文件。用不做任何本地文件发现的 test source 固定未来 Web 接入边界；不实现数据库 adapter。

## 已确认的技术决策

- Coding Agent file configuration / Skills / Agent Plugin → Desktop Local source 读取真实本机 JSON 与目录；Provider / API key / OAuth / model catalog / workspace trust → 继续由现有 Server SQLite owner 持有。理由：这是两类不同的事实，不能为了“本地化”混入同一来源。
- Server capability seam → `RuntimeCapabilitySource`，按 Operation 解析；不使用泛化 storage interface。理由：Local 与 Web 是真实的两个 adapter，但 Session、配置、目录与插件的 owner / 生命周期不能被抹平。
- Web 本次边界 → 定义接入 contract 与不访问本地文件的测试 source；不实现数据库、tenant、Skill content 或 resource materialization。理由：仓库没有 Web Host / schema，猜测会把来源 contract 锁死。
- Web Agent Plugin 策略 → 不动态发现或执行用户 Agent Plugin；仅能由未来 Web source 提供服务随部署发布的受信任 Extension。理由：Agent Plugin 是本机文件包，不是安全的数据库配置记录。
- Public SDK option → 删除 `agentDataRoot`，以明确的 file configuration input 取代；不做 alias、fallback 或 migration。理由：`agentDataRoot` 混淆用户配置、workspace 配置和 durable data，继续保留会重新引入错误接线。

## 没选的路

- **在 daemon 中把 `agentDataRoot` 直接改为 `cwd`**：只能修 workspace，仍不能区分用户根、workspace 根与 trust，Web 也没有接缝。
- **让 Server core 按 `desktop` / `web` 分支读文件或数据库**：每新增 Host 都会改 Runtime core，来源策略无法独立测试。
- **使用一个 `Storage` interface 管理 SQLite、JSON、Skills 和 Agent Plugin**：会违反 durable fact 单一 owner，也掩盖目录发现与配置读取的安全差异。
- **把 Provider / API key 改成 JSON**：Desktop settings RPC、OAuth 与密钥保存已经有 SQLite owner；这不是本次本地 Coding Agent configuration 的问题。
- **实现 Web Database source**：没有数据库 schema、认证或 tenant model，当前无法验证正确性。

## 风险

- `agentDataRoot` 当前同时影响 JSON config 和 Skills；拆分时必须将所有 SDK caller 一次迁移，否则其中一个来源会静默回到错误目录。Spec 01 用 public SDK tests 覆盖用户根、workspace 根、trust 和 Skills。
- workspace trust 是持久化的 Server policy，project Agent Plugin 只能使用其 canonical `workspacePath`，不能从 ACP `cwd` 推断。Local source 必须把 trust 读取失败作为可处理的 Operation open error。
- Capability source 返回的 Extension / Agent Plugin 实例与 source 输入不能进入 journal、RPC 或 UI projection。它们只在当前 Operation 内存中存活。
- 删除 public SDK option 可能影响仓库外使用者；项目约定要求不保留 compatibility path，因此本次通过 public API tests 和 consumer test 发现并一次性修复内部调用点。
- Web test source 只能证明 Server 不偷读本地目录，不能证明未来数据库语义；不得把它宣传为 Database adapter。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，编码规则）

## 验收计划

| workspace | 命令 |
|---|---|
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck && bun test && bun run test:consumer` |
| `@jai/server` | `cd app/server && bun run typecheck && bun test` |

## Spec 拆分理由

`01` 是必要 prefactor：先让 Coding Agent 能表达不同的本地文件根，否则 Server source 无法正确传递 Desktop 选择。`02` 形成独立可验证的 Server 接缝和 Local source，并用 non-local test source 证明 Runtime core 没有偷读 Desktop 文件。`03` 才把该接缝接进 Desktop daemon，用完整 Operation 验证 JSON、Skills 和 Agent Plugin 的本地识别。这三刀分别验证 SDK 输入、产品 source policy 与真实 Desktop 行为，依赖没有交叉。
