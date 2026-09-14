# 需求说明: 可部署的远程 Runtime 与云端 Sandbox

日期:2026-09-01

## 问题

JAI 当前的 Runtime Host 已能作为独立 Node 进程运行，但其对外连接仍是 Desktop/CLI 的本地 Unix socket 与 ACP 路径。产品无法以安全、可部署的方式让 Web、Desktop 与 CLI 连接同一个远程运行时，也没有一个被隔离的云端机器承载 workspace、终端与代码执行。直接把现有 `app/server` 替换为 Hono 会混淆 HTTP 入口、会话编排和执行隔离，既不能解决 sandbox，也会重写已成立的 Runtime Host 语义。

## 期望结果

形成一个可部署的运行架构：

```text
Web / Desktop / CLI
        |
共享客户端运行时: 认证、RPC、流、断线重连、只读投影
        |
HTTPS + WSS transport adapter（可选 Hono）
        |
Runtime Host / 控制面
Session journal、Operation 编排、审批、Provider 配置、环境绑定
        |
ExecutionEnvironment provider
        |
每个 workspace 或 session 的隔离 sandbox
workspace、进程、临时凭据、网络策略
```

- `app/server` 的 Runtime Host 保留为唯一的产品执行核心；它拥有 Session journal、Agent 生命周期、审批和安全 DTO 投影。
- Web、Desktop 和 CLI 只是同一远程协议的客户端。Desktop 仍保留系统集成、窗口和本地 Runtime launcher，但不拥有产品语义。
- 对外 HTTP/WSS 只是协议入口。Hono 仅在此层有可能被采用，不进入 Runtime Host 的核心编排或 sandbox 生命周期。
- 每个 cloud workspace/session 在独立、可回收的 sandbox 运行。sandbox 是机器资源，不是 Session journal 的长期事实来源；跨机器代码交付使用 Git branch/PR/diff，可恢复的对话由 Runtime Host journal 保存。
- 云端只装载显式物化的 repository、环境定义和受信任能力；不扫描或执行用户桌面上的 Plugin/任意本地文件。

## 影响范围

会改到的模块:`app/server`（远程 transport、环境绑定和 execution adapter）、`app/desktop`（共享客户端运行时与本地宿主能力）、未来 Web 客户端、部署与 sandbox provider adapter。

长期保存的数据与维护方:Session journal、Coding Agent app state 与操作记录继续由 `@jai/agent` journal 的 SQLite 维护；项目归属、标题和项目目录继续由 Runtime Host 的 Desktop catalog 维护；sandbox 的实例、文件系统和进程为可回收资源，不成为第二个 durable store。后续如引入 environment definition 或租户/认证数据，必须先为其明确单一 owner，不能写回 journal 或 sandbox filesystem。

## 边界

- 本次不以 Hono 替换 Runtime Host，也不把业务规则塞入 HTTP handler。
- 本次不让 Web 透明读取开发者电脑的 filesystem，亦不将本地和云端的 workspace 伪装成同一目录。
- 本次不把 sandbox filesystem 当成可恢复 Session 的唯一依据，不新增 JSONL、双写或第二个 durable journal。
- 本次不承诺任意第三方 Plugin/Extension 可以在云端执行。首版只允许随服务部署、经审查的受信任能力；不受信任代码隔离是单独需求。
- 本次不在未选择部署目标与租户模型前开始写 implementation plan。

## 工作量

大。远程协议、共享客户端运行时、认证与授权、sandbox provider、工作区物化、部署和前端剥离都必须按依赖拆为可独立验证的工作，且每一步都会触及跨进程/跨网络的安全边界。

## 已确认的现状

- Runtime Host 已是独立 Node 进程；`app/server/src/runtime/server.ts` 以 `$JAI_HOME/data.sqlite` 打开唯一 durable SQLite，并装配 ACP 与私有 Desktop control endpoints。
- Desktop 仅持有 volatile ACP projection 和 approval routing，Session journal、Coding Agent 与恢复仍由 Runtime Host 持有（`app/desktop/electron/agent/acp-host.ts`）。
- 当前本地 transport 是 Unix socket 的 ACP v2（`app/server/src/protocol/acp-v2/local-transport.ts`）；Desktop catalog/configuration 是隔离的私有本地协议。
- Hono 当前只用于 `app/oauth-gateway` 的无状态 OAuth gateway，而非 Runtime Host（`app/oauth-gateway/package.json`）。
- 现有运行时不提供操作系统级 sandbox；云端执行必须由独立隔离环境承载。行业对比见[云端执行环境调研](../research/sandbox/cloud-coding-agent-environments.md)与[本地/云端环境对比](../research/sandbox/cloud-local-agent-environment-comparison.md)。
- E2B 的标准 API 可以作为一台 sandbox 的 lifecycle/filesystem/process adapter，但不能单独保证 workspace 内的强路径隔离；首版权限边界应是整个 sandbox，若要 workspace-only 强制隔离需另做 sandbox-side confinement。[E2B 边界核验](../research/sandbox/e2b-realpath-workspace-boundary.md)

## 参考对象

- t3code：借鉴“独立 Server Runtime + 共享客户端运行时 + 认证的 WSS/RPC”这一分层，不要求复制其 Effect RPC 或 provider 机制。[调研](../research/platform/t3code-hono-architecture.md)
- GitHub Copilot、Claude Code、OpenAI Codex：借鉴“可重建环境 + 可回收机器 + Git/PR/diff 交接 + 可恢复会话”的产品边界。[调研](../research/sandbox/cloud-coding-agent-environments.md)

## 仍需确认

- 第一个可交付的云端目标：远程 Web、远程 sandbox 执行，还是开放 API。
- sandbox 的隔离单位与是否需要多租户。
- 首次部署是个人/单团队单 Runtime Host，还是一开始就支持多租户。
- 认证与凭据托管边界。
