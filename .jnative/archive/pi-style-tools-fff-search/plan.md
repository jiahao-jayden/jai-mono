# Plan: Pi 式最小工具面与 FFF 搜索

来源:[intent](./intent.md) · 日期:2026-08-27 · 状态:✅ 已确认 · 可执行 · 确认日期:2026-08-27 · 修订确认日期:2026-08-27

评审对象:大需求，需 review `plan.md`、`todo.md` 与全部 specs。
执行门禁:状态改为 `✅ 已确认 · 可执行` 前，不得开始实现或修改生产代码。

## 背景

当前 Coding Agent 的内置工具 roster 默认全部启用，文件搜索由 `NodeExecutionEnvironment` 每次启动 ripgrep 完成。用户要采用 Pi 的最小工具面：四个核心工具默认存在，FFF 搜索由 Server 直接装配，不增加 Desktop 开关、JAI 专有 capability 名称或用户安装流程。

## 方案

先在 Agent/Extension 侧接入 FFF 的 Node 原生 binding，建立 Operation-scoped 的搜索 runtime 与两个 Pi FFF 工具：`fffind`、`ffgrep`。工具命名、默认 mode 与本地状态边界以[调研](../../research/tools/pi-fff-tool-contract.md)为事实输入；runtime 负责索引启动、workspace 边界、取消与销毁；工具负责参数校验、分组/分页结果和 `filesearch.*` 错误投影。FFF adapter 不执行 shell，不把索引对象或 SDK 错误跨进程传递。`fff-multi-grep` 保持未暴露，另立需求再决定。

随后移除现有 `Glob`、ripgrep `Grep` 工具及旧搜索后端，把 Coding Agent 的默认内置 roster 改为 `Read`、`Bash`、`Edit`、`Write`。FFF 工具由 Server capability source 作为内置 Extension 随每个本地 Operation 自动加入，因此不受 Desktop 侧工具开关控制，也不需要新增 `workspace-search` 配置。SDK 仍保留显式 built-in tool allowlist 能力，但默认行为与 Pi 对齐。

最后在 Server 的 Desktop Local Runtime Capability Source 中创建并关闭 FFF runtime；补齐 Server/Agent 生命周期测试和 Electron Forge 原生模块打包配置，确保开发运行与 asar 产物都能加载同一依赖。FFF 的本地索引/frecency/history 只作为其 adapter 的实现数据，不写入 journal、RPC 或 Desktop metadata。

## 已确认的技术决策

- 默认工具面 → `Read`、`Bash`、`Edit`、`Write`；理由：遵循用户指定的 Pi 式最小默认面。
- FFF 装配位置 → Server 的 `RuntimeCapabilitySource`，按 Operation 创建并销毁；理由：Desktop 不需要自定义开启，且该 seam 已拥有 Host capability 生命周期。
- 搜索工具命名与默认集合 → 采用 Pi FFF 的 `fffind`、`ffgrep`，不新增 `workspace-search` 概念；`fff-multi-grep` 本轮不暴露；理由：用户明确要求与 Pi 一致并避免自造产品抽象。
- 旧搜索路径 → 删除 `Glob`、ripgrep `Grep` 和 fallback；理由：FFF 已承担同一产品职责，项目规则禁止保留向后兼容与双轨实现。
- FFF 状态范围 → Operation-scoped runtime；索引类数据不成为 JAI durable fact；理由：Server 只装配生命周期能力，journal owner 不变。

## 没选的路

- **Desktop 增加搜索开关**：与“Server 默认装配、直接可用”的要求冲突，并把 Host capability 选择泄漏到 renderer。
- **保留 `Glob`/`Grep` 并额外添加 `fffind`/`ffgrep`**：会让模型面对重复搜索入口，且维持两套语义与错误路径。
- **默认暴露 `fff-multi-grep`**：当前 Pi FFF 版本把它作为额外开关能力；默认加入会偏离 Pi 的最小工具面。
- **在 SDK 默认工具选择中继续默认开启所有工具**：无法得到 Pi 的最小工具面，并会继续把 Todo/Subagent 等非核心工具塞进每次请求。
- **用 FFF CLI 子进程而非 Node binding**：失去无子进程与索引复用优势，也增加平台执行文件和审批边界。
- **把 frecency/history 写入 JAI SQLite journal**：混淆搜索实现状态与产品 durable fact，违反单一 owner 规则。
- **运行时 FFF 失败自动退回 ripgrep**：隐藏原生包/索引故障，恢复双轨实现；本特性按明确错误暴露失败。

## 风险

- FFF Node binding 的 Node/Bun ABI、Electron 42、macOS arm64/x64、Windows 与 Linux 产物兼容性未知；第一 spec 必须先做真实加载与销毁验证，不能只通过 TypeScript 编译。
- Electron 使用 asar，原生 `.node` 文件可能需要 unpack/rebuild；打包产物必须在目标运行时执行最小搜索 smoke test。
- 后台索引与编辑/写入之间存在短暂陈旧窗口；工具契约必须定义 rescan/等待索引行为，不能把旧结果误报为实时文件状态。
- FFF 的 fuzzy find 与现有严格 glob 不是同一语义；移除 `Glob` 前必须固定 Pi FFF 输入/输出契约，并更新工具描述与测试。
- cursor 结果属于运行时状态；必须是不透明、Operation-scoped 的值，不能写入 journal 或传递内部句柄。
- FFF 错误可能来自原生 SDK；必须在 adapter 边界转换成 `TaggedError`，跨 Server/Desktop 只投影白名单错误 DTO。

## 硬约束

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，错误处理规则）
- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`，错误处理规则）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影，禁止传递 stack、cause 或未筛选的 SDK 错误对象。”（`AGENTS.md`，错误处理规则）
- “一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。”（`AGENTS.md`，事实归属）
- “Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，事实归属）
- “投影是单向读取模型：可以把 journal / SDK state 转为 RPC DTO、CLI 输出或 UI item，但不得把 projection、UI state、Desktop metadata 写回 journal，也不得把未筛选的内部对象越过进程边界。”（`AGENTS.md`，事实归属）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，模块、入口与依赖方向）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，模块、入口与依赖方向）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，编码规则）
- “选能满足当前需求的最简单实现。不要预防性抽象，不要多此一层配置层。”（`AGENTS.md`，编码规则）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。”（`AGENTS.md`，模块、入口与依赖方向）

## 验证基线

| workspace | 命令 |
|---|---|
| `@jai/agent` | `cd packages/agent && bun run typecheck`；`bun test` |
| `@jai/coding-agent` | `cd packages/coding-agent && bun run typecheck`；`bun test`；`bun run test:consumer` |
| `@jai/extension` | `cd packages/extension && bun run typecheck`；`bun test` |
| `@jai/server` | `cd app/server && bun run typecheck`；`bun test` |
| `app/desktop` | `cd app/desktop && bun run typecheck`；当前没有 test script，验收注明这一点；另执行 Electron Forge package smoke test |

## Spec 拆分理由

先做 FFF 原生 runtime 与工具 contract 这个 prefactor，才能在不猜 ABI、索引和 cursor 行为的情况下决定后续工具 roster。第二个纵向切片把 Pi 式默认面与旧搜索删除连起来，确保模型看到的工具集合和实际搜索能力同时收敛。第三个切片将能力装配到 Server Operation 并验证 Electron 发行产物，完成用户实际可用的端到端路径。
