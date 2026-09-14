# Pi Agent 的云端执行环境抽象：现状与 JAI 的启示

核验日期：2026-08-26。源码固定为 `badlogic/pi-mono` commit [`e86823096c5bad39e1ca282ec24bc5eb9bec745b`](https://github.com/badlogic/pi-mono/tree/e86823096c5bad39e1ca282ec24bc5eb9bec745b)（该 commit 日期为 2026-08-26）；`@earendil-works/pi-agent-core` 与 `@earendil-works/pi-coding-agent` 的源码包版本均为 `0.84.3`。固定 commit 是为了避免 Pi 快速演进时，把后来的接口误当作本次结论的依据。[agent package](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/package.json#L1-L21) · [coding-agent package](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/package.json#L1-L25)

## 结论

1. Pi 的新 `pi-agent-core` 已公开一个与 JAI 设想高度相似的、面向工具的 `ExecutionEnv`：它把文件系统和 Shell 合为一个契约，内置 Tool 通过 `context.env` 使用它，而不是直接依赖 Node。这证明「本地 Node adapter + 云端 sandbox adapter + 薄 Tool-facing 契约」是经过实际 Agent 框架验证的方向，而非只有 JAI 在做的抽象。[契约](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L222-L315) · [Tool context](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/tool-context.ts#L1-L6)

2. 这个 Pi 契约不只是 `bash(command)`：它定义 cwd、路径解析、文本/二进制读、写、追加、rename、metadata、目录列举、canonical path、临时文件和 Shell 的 timeout/abort/流式 stdout/stderr。E2B 可以实现其中大部分，但不是所有操作都有一对一 E2B API；因此 JAI 应保有自己的 Tool-facing 类型与错误 DTO，把 E2B 当作云端实现而非公共领域协议。[FileSystem/Shell](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L208-L315)

3. Pi 的 `pi-coding-agent` CLI 尚未全面采用上述契约：session factory 默认 `process.cwd()`，默认 resource loader 直接 import `node:fs`，内置工具工厂只接收 `cwd`。所以 Pi 既展示了目标抽象，也展示了只在「新 harness」完成迁移、旧产品层仍绑定本机 Node 时会留下的断层。[factory](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/sdk.ts#L173-L188) · [loader 的 Node FS 依赖](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/resource-loader.ts#L1-L28) · [cwd-only tool factory](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/tools/index.ts#L107-L161)

4. Pi 的官方云化建议是「把整个 Pi 进程放进隔离环境」或「用 Extension 把内置 Tools 转发到隔离环境」；后一种方案明确承认 Extension 本身仍运行在 host。也就是说，统一 Tool 协议能统一 Agent 的 read/write/bash，但不能自动约束任意 Extension 的 `node:fs`、子进程或网络行为。[containerization 文档](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L1-L24) · [Gondolin 的限制](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L28-L52)

5. Pi Client/Server 的 remote session 协议解决的是远程会话控制与传输，不是 sandbox/workspace 生命周期；`PiServer` 明说不提供 standalone coding-agent service，实际运行环境由应用实现。这与 JAI 把 `ExecutionEnvironmentProvider` 单列、由 Web 去 provision/attach E2B 的方向一致。[client](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/client/README.md#L1-L32) · [server](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/server/README.md#L1-L40)

6. JAI 的设计不该以「Pi 没有」来宣称领先：Pi Core 已有接近的 execution abstraction。JAI 的机会在于把这条边界从一开始贯穿到 Web 产品层：Operation admission 先绑定环境；Skills/config 被物化到该环境；Extension 只能经注入 capability 访问环境；Session Journal 与 environment lifecycle 分离。Pi 目前公开源码中的 coding-agent 仍未把这整条链闭合。

## Pi Core：已经存在的执行环境契约

`@earendil-works/pi-agent-core` 的 root entry 导出 harness、skills、tools 以及 `ExecutionEnv` 等类型，而 `./node` 子路径单独导出 `NodeExecutionEnv`。这表示 core 的公共接口不静态携带 Node 实现，Node 是一个可选 adapter。[root exports](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/index.ts#L43-L115) · [Node entry](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/node.ts#L1-L2)

### 契约覆盖的语义

| 能力 | Pi `ExecutionEnv` 语义 | 对 E2B adapter 的含义 |
|---|---|---|
| 工作目录与路径 | `cwd`，相对路径解析，`absolutePath` 与 `joinPath` | 必须统一 JAI 的 sandbox 路径命名空间，不能让 Server 的 `process.cwd()` 混入。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L222-L245) |
| 文件读取 | text lines、text、binary、metadata、list、exists、canonical path | E2B Filesystem API 与命令补齐；明确 symlink/canonical 不支持时如何映射为稳定错误。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L246-L261) |
| 文件变更 | create/overwrite、append、atomic rename、mkdir、remove、临时目录/文件 | 不把本地的 atomicity 或 temp-file 语义默认为 E2B 已提供；需要 contract test 和受支持子集/显式降级。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L248-L282) |
| 命令 | `exec` 可传 cwd/env/timeout/abort，并流式回调 stdout/stderr | E2B `commands.run` 是此处的实现材料；JAI 仍应决定超时、取消、输出截断和错误投影。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L285-L315) |
| 失败模型 | 文件和执行失败作为显式 `Result`，用 backend-independent error code 表示 | 符合 JAI 在进程/RPC 边界投影错误 DTO 的规则；不要把 E2B SDK 原始错误漏给 Agent/UI。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/types.ts#L128-L175) |

Pi 的本地 adapter `NodeExecutionEnv` 将 `cwd`、可选 shell 路径和环境变量封装起来，命令通过 Node `spawn` 执行、支持 abort/timeout/输出回调；文件读写则由此 adapter 直接调用 Node filesystem。这是一份很好的 local adapter 参考实现，但不是 cloud provider。[Node adapter 定义](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/env/nodejs.ts#L353-L506) · [Node file read](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/env/nodejs.ts#L508-L517)

### Tools 和 Skills 确实从环境取能力

Pi harness 的 `ExecutionToolContext` 只要求一个 `env: ExecutionEnv`。`bash` 使用 `env.cwd` 和 `executeShellWithCapture(env, ...)`；`read` 从 `env.readBinaryFile` 读取；`edit` 先经 env metadata/read，再经 env write；`write` 同样经 env write。这是 Tool 依赖与宿主实现脱钩的完整例子。[context](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/tool-context.ts#L1-L6) · [bash](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/bash.ts#L51-L121) · [read](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/read.ts#L45-L56) · [edit](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/edit.ts#L90-L137) · [write](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/tools/write.ts#L15-L38)

Skills 也不是从数据库直接读，而是 loader 接受 `ExecutionEnv`、用 `fileInfo`、`listDir`、`readTextFile` 遍历 SKILL.md 与 ignore files。它还提供 `loadSourcedSkills`，只保留调用方定义的 source provenance、不解释其含义。这与「DB 选择 Skill revision，运行前把它物化到环境文件系统，再由 loader 读取」完全兼容。[skill loader](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/skills.ts#L45-L101) · [directory traversal](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/agent/src/harness/skills.ts#L104-L175)

## Pi Coding Agent：产品层的本地绑定仍然存在

Pi `coding-agent` 的 `createAgentSession` 只接受字符串 `cwd`，并在未提供时回退到 `process.cwd()`；随后自动创建 `DefaultResourceLoader`。该 loader 直接引用同步 `node:fs`，并用 cwd/agentDir 调用本地 `loadSkills`。内置 coding tools 的 factory 也只是将同一个 `cwd` 传给各种具体 tool。因此把现有 Pi Coding Agent 部署到云端，最直接的正确方式仍然是「让整个进程在云端 workspace/sandbox 内运行」，而不是把它的 host 进程保留在 Web Server 再仅远程执行 Bash。[factory 的 cwd fallback](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/sdk.ts#L173-L187) · [资源 loader 的本地 FS](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/resource-loader.ts#L1-L28) · [Skills 载入点](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/resource-loader.ts#L672-L692) · [工具 factory](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/src/core/tools/index.ts#L118-L220)

这不是说 Pi Core 的 `ExecutionEnv` 不可用，而是截至固定版本，coding-agent 默认 runtime 和新的 harness 看起来是两条尚未完全合流的路径。上述结论限定在公开源码/API：检查了 `packages/agent` 的 public exports 和 harness，以及 `packages/coding-agent` 的 SDK、resource loader、built-in tools 与官方文档；没有在这个范围中找到 E2B adapter、sandbox provider interface 或将 coding-agent 的 resources 全部经 `ExecutionEnv` 载入的公开实现。它是「在所查 public surface 未找到」，不是对私有部署或未来 commit 的否定。

## Pi 如何上云，以及它留下的边界

Pi 的官方 containerization 文档给出三个模式：

| 模式 | 一致性做法 | 关键限制 |
|---|---|---|
| Gondolin Extension | host Pi 保留 provider auth，Extension 覆盖 read/write/edit/bash/grep/find/ls，并把 `!` 命令路由到本地 micro-VM | 官方明确写出其他 custom Extension tools 仍在 host，除非它们自行转发；故并不统一任意 Extension 的文件/进程语义。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L1-L24) · [细节](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L28-L52) |
| Docker | 整个 Pi 进程和它的内置工具置于 container，workspace mount 在 `/workspace` | 仍要决定 host volume、config/session volume 与密钥暴露范围。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L54-L89) |
| OpenShell | 整个 Pi 进程在 policy-controlled sandbox；可接 remote Kubernetes gateway | remote gateway 时项目不会从 host bind mount，须在 sandbox clone 或显式 upload/download。[证据](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L91-L142) |

Extension 文档把风险说得更直白：Extension 以 Pi 进程权限执行任意代码，支持 Node built-ins（包括 `node:fs`），发现路径本身也是本地文件路径。这支持一个重要结论：一个给 Agent Tools 的 `ExecutionEnvironment` 不能天然成为 Extension 的安全边界。若 Web 要执行 Extension，必须二选一：

1. 让受信任 Extension runtime 和 Agent 一起运行在 E2B 环境里；或
2. 像 JAI 当前意图那样，不执行 Web 动态 Plugin，并让仍需要环境的受信任 Extension 只获得 host 注入、受 scope 约束的 capability，禁止它绕过 capability 直接 import Node filesystem/process。

Pi 文档本身选择了第一条作为「全进 sandbox」的正式模式，而 Gondolin 的说明正好证明「只转发 Tools」不足以得到完整一致性。[Extension 安全声明和路径](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/extensions.md#L109-L152) · [OpenShell 全进 sandbox](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/coding-agent/docs/containerization.md#L91-L118)

## Remote Session 不等于 Remote Execution Environment

Pi Client 的 `ByteTransport` 是 WebSocket/Unix socket 等有序字节传输的可替换 client transport，示例传入的只有 session `cwd`；它没有定义 files、shell、sandbox create/attach/kill 等 workspace 协议。Pi Server 也是 session server core，要求 application 自行提供 service，并明确不提供 standalone coding-agent service。因此它适合做 Web UI 到远端 Agent host 的控制面，却不替应用决定如何创建/绑定机器环境。[Pi Client](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/client/README.md#L1-L40) · [Pi Server](https://github.com/badlogic/pi-mono/blob/e86823096c5bad39e1ca282ec24bc5eb9bec745b/packages/server/README.md#L1-L40)

## 与 JAI 的逐项对照

| 维度 | Pi 已有做法 | JAI 应取的做法 | 判断 |
|---|---|---|---|
| Agent Tool 层 | Core harness 的 `ExecutionEnv` + Node adapter | 一个 thin `ExecutionEnvironment`；Local Node/E2B 分别实现 | 同一成熟模式；JAI 不必为抽象本身造新名词。 |
| Cloud lifecycle | 文档建议 Docker/OpenShell；Client/Server 不负责 sandbox | `ExecutionEnvironmentProvider` 负责 E2B create/connect/reuse/dispose | JAI 的 provider 分层更清楚，应保留。 |
| Skills | Core harness 已经可通过 environment FS 发现 | DB 只作 revision/enablement source；Operation 前 materialize 到环境，再读取 | JAI 可直接复用这一原则。 |
| Coding-agent resources | 当前产品层 direct Node FS + cwd | 不允许 Server cwd 作为 user workspace；resources 需 env-aware 或在 sandbox 进程内加载 | 这是 JAI 必须避开的 Pi 断层。 |
| Extensions | full-permission host code；工具转发不自动转发 Extension | Web 不动态执行 Plugins；受信 Extension 必须 capability-injected 或整体进 E2B | JAI 当前边界比「只路由 built-in tools」更安全。 |
| Session | Pi remote session 只控制会话，provider 不定义机器 | Session Journal 独立 durable；environment 是可重连 lifecycle resource | 一致，且 JAI 的 Operation admission 顺序应显式化。 |

## 对 JAI 当前设计的影响

1. **确认，而非替换。** E2B 的 files/commands 是云端 adapter 的基础协议；JAI 仍应定义最小、Tool-facing `ExecutionEnvironment`，让 Local Node 和 E2B 受同一测试矩阵约束。不要把 E2B lifecycle、template、sandboxId、API key 泄漏进每个 Tool。

2. **把环境绑定放在 prompt admission 之前。** Pi 的 coding-agent `process.cwd()` fallback 是 JAI 需要明确消除的反例。任一 Coding Agent Operation 都应先由 provider open/rebind 环境、确认 workspace root、materialize 必需 runtime resources，成功后才持久化 prompt admission；失败要以可恢复领域错误结束，而不是改用 Server cwd。

3. **统一的不只是 Bash。** 最小协议应覆盖 tools 需要的 read/write/edit 支撑、directory traversal、search 所需的 command 或明确 search primitive、临时文件、取消/timeout/输出流与稳定错误。先以 JAI 实际 Tool 需求定义接口；Pi 的较大全量接口可作为 gap checklist，不应逐项照抄。

4. **把 Skill、config、Plugin 的事实来源与运行时文件分开。** Web DB 保存「什么版本、是否启用、如何配置」；E2B 文件系统保存「本次 operation 真正读取/执行的内容」。Materialization 应是可重试 preparation，而不是把 session journal 改为 sandbox 文件事实源。

5. **不要把 Extension 问题误判为 adapter 问题。** 若 Extension 能随意 import `node:fs`，即使 Agent Tools 全部走 E2B，它仍可能读到 Web Server 文件。这是代码执行隔离/能力注入问题。JAI 的「Web 不注册动态 Plugin」与 scoped injected capability 应作为硬边界，或把 extension runtime 一并放进 E2B。

6. **“领先”应这样衡量。** 只提出 `ExecutionEnvironment` 不领先，Pi Core 已先行；如果 JAI 让它成为跨 Desktop/Web、Skills/config、Tool、Extension、Operation admission、durable Session 的一致事实边界，并以 local/E2B conformance tests 防止产品层重新偷用 Node，那么它会比 Pi 当前公开 coding-agent product path 更完整、更适合云本地双端。

## 未证实点

- 本次没有找到 Pi 官方提供的 E2B adapter 或 production Web cloud-agent deployment；上述「未找到」只覆盖固定 commit 的公开仓库、README 和 coding-agent docs。
- E2B 对 `canonicalPath`、atomic rename、临时文件、symlink 的精确行为不在本笔记中重查；应继续以已有 E2B API 调研为准，并在 JAI 计划阶段逐项建立 adapter conformance cases。
- Pi harness 与 Pi coding-agent 未来是否合流不能从当前 commit 推断。
