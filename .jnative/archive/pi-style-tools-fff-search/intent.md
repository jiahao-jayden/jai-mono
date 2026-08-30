# Intent: Pi 式最小工具面与 FFF 搜索

日期:2026-08-27

## 问题

Coding Agent 目前默认向模型暴露全部八个内置工具：`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`UpdateTodos`、`SpawnAgent`。文件搜索直接依赖每次调用时启动的 ripgrep，`Grep` 默认可一次返回大量平铺命中；`Glob` 与 `Grep` 也没有 FFF 的后台索引、frecency、Git 改动加权和 cursor 分页能力。

用户希望采用 Pi 的产品形态：核心工具面保持最精简，不为搜索另造 JAI 概念或 Desktop 设置；Server 直接把 FFF 搜索能力装配进本地 Operation，模型可立即使用 FFF 搜索工具。

## 期望结果

每个本地 Runtime Operation 默认拥有 Pi 风格的工具面：四个核心工具 `read`、`bash`、`edit`、`write`，以及由 Server 默认装配的 `fffind`、`ffgrep`。搜索工具沿用 Pi FFF 的既有命名与输入形态，不暴露 JAI 专有的“workspace-search”分组、开关或工具别名；`fff-multi-grep` 本轮不进入模型工具面。

FFF 作为 Node 原生搜索后端运行：文件在后台索引，文件查找按模糊匹配与 frecency/Git 状态排序，内容搜索分页返回。原有 `Glob` 与 ripgrep 驱动的 `Grep` 从 Agent 工具面和实现中移除，不保留兼容层或运行时 fallback。

Desktop 只投影已有的工具调用事件；不增加搜索设置、首次启用流程、下载/安装操作或新的 UI 状态。

## 影响范围

模块:

- `packages/agent` 的文件搜索 contract、Node FFF adapter、搜索工具输出和测试；
- `packages/coding-agent` 的内置工具 roster、默认工具选择、capability assembly、权限映射和 public SDK tests；
- `app/server` 的 Desktop Local Runtime Capability Source：每个 Operation 装配并关闭 FFF runtime；
- `app/desktop` 仅在已有工具展示/测试需适配工具名时更新，不新增设置界面；
- Desktop 的 Electron 打包配置：保证 FFF 原生 binding 在 asar 打包后的目标平台可加载。

Durable fact 与 owner:

- 不新增 Session、配置、插件或 Desktop metadata 的 durable fact；不新建 JSONL、SQLite 表、双写或 JAI 侧搜索配置。
- FFF 的索引、frecency 与查询历史如需跨 Operation 留存，只作为 FFF adapter 拥有的本地实现数据；其路径、清理和跨平台打包方式在计划阶段按 FFF 一手实现确定，不能写入 journal 或通过 RPC 传递。

## 边界

- 不添加 Desktop 搜索开关、`workspace-search` 配置、用户安装步骤、第三方 Agent Plugin 或动态下载机制。
- 不同时保留 `Glob`/`Grep` 与 FFF 同类工具；旧 ripgrep/fd 搜索后端及其配置直接删除，不留 fallback。
- 不改变 `Read`、`Bash`、`Edit`、`Write` 的工具行为，也不在本特性重做 Todo、Subagent、权限审批、Session journal 或 UI transcript 架构。
- 不把 FFF 内部错误、LMDB 句柄、索引状态或 SDK 对象越过 Server/Desktop RPC 边界；跨进程仍只传既有安全 DTO。

## 规模

大。它同时改变 Agent 的公开工具面、原生搜索 adapter 与生命周期、Server Operation 装配、Electron 跨平台原生模块打包，并需要替换现有搜索与工具选择测试。

## 既定前提

- `RuntimeCapabilitySource` 已是 Host 为单个 Operation 选择并返回 disposable capabilities 的装配 seam；Desktop Local source 目前在 `app/server/src/runtime-capabilities/desktop-local.ts` 装配 Skills 与 Agent Plugins。
- `CodingAgentCreateOptions.tools` 是内置工具 allowlist；当前 `resolveCodingToolSelection()` 在没有显式输入时返回整个 `codingToolNames` roster（`packages/coding-agent/src/sdk/tool-selection.ts`），与目标的 Pi 式默认工具面相反。
- 当前内置 roster 是 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`UpdateTodos`、`SpawnAgent`（`packages/coding-agent/src/tools/names.ts`）；当前 `Glob/Grep` 都由 `NodeExecutionEnvironment` 的 ripgrep 路径提供。
- 现有 `FileSearch` 已是 `Glob`/`Grep` 后端的窄 contract（`packages/agent/src/harness/environment/types.ts`）；权限路径 capability 位于 Coding Agent middleware 外层，FFF 不重做该边界。
- Electron packager 启用了 asar（`app/desktop/forge.config.ts`），FFF 的 Node 原生 binding 必须按 Electron Forge 的原生模块策略验证和打包。
- Pi 与 `@ff-labs/pi-fff` 的工具名、参数、默认 mode 与本地状态行为见[调研](../../research/pi-fff-tool-contract.md)；native package 分发与 ABI 仍需在 Spec 01 的真实 smoke test 中钉死，避免以转述决定公共 API。
