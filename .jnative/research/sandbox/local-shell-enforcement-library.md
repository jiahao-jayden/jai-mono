# @anthropic-ai/sandbox-runtime 作为 Jai 本地 Shell 强制后端的可行性核验

核验日期：2026-09-20（本机 Asia/Singapore）。核验对象：官方仓库 [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime)。本次获取的 `main` 与 release `v0.0.77` 均固定为 commit `6fa731368807419ee157f9a3fac955fefe1019c6`；本文只引用该 SHA 的源码/README/测试，未运行该仓库测试，也未改 Jai 产品代码。

## 结论

1. **适合承载 Jai 的 macOS/Linux 本地 Shell 强制执行后端，但不是一个可并发复用的无状态函数库。** macOS 使用 Seatbelt，Linux 使用 bubblewrap，约束覆盖整个 process tree；Jai 应把它接在 Node Shell adapter 的 spawn 前。来源：[README.md#L103-L130](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L103-L130)。
2. **默认网络拒绝、精确路径与 subtree 可以承载。** `allowedDomains: []` 表示无网络；`allowWrite` 是 allow-only，`denyWrite` 优先；`denyRead` 是 deny-then-allow-back。来源：[README.md#L117-L130](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L117-L130)、[sandbox-config.ts#L894-L921](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L894-L921)。
3. **Jai 的跨平台 glob 策略应默认判定为 `unsupported_policy`，除非策略被降为可证明的 subtree。** macOS 把 glob 编译成 Seatbelt regex，能覆盖之后创建的匹配路径；Linux 则用 ripgrep 在 wrap 时展开为已有路径/目录挂载，普通 `**/*.env` 不能保证之后创建的 `.env` 文件被挡住。来源：[sandbox-manager.ts#L1680-L1753](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L1680-L1753)、[read-deny-glob.ts#L59-L74](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/read-deny-glob.ts#L59-L74)。
4. **每个不同策略必须进入独立 worker；同一 Node 进程内不能把不同 operation 当作独立 manager。** `SandboxManager` 的 config、proxy、token、violation store、masked-file store 等都是模块级单例；`updateConfig()` 的 network 变更会影响已经运行的 child，filesystem 变更也不是 live 更新。来源：[sandbox-manager.ts#L127-L189](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L127-L189)、[sandbox-manager.ts#L2035-L2083](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2035-L2083)。
5. **网络约束是代理媒介，不是只改环境变量。** Linux 用 `--unshare-net` 加 Unix socket/socat bridge；macOS 只允许 Seatbelt 访问本机 proxy port；HTTP/HTTPS 走 HTTP proxy，其他 TCP 走 SOCKS5。允许直连只存在于 host-side proxy 的 route 选择中，并受 resolved-address guard；Jai 不应把 proxy 环境变量当作边界本身。来源：[linux-sandbox-utils.ts#L1157-L1180](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1157-L1180)、[macos-sandbox-utils.ts#L1142-L1230](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/macos-sandbox-utils.ts#L1142-L1230)。
6. **不可用时可以 fail closed，但 Jai 必须把库的 warning 路径升级为拒绝。** 缺 `bwrap`、`socat` 或 `rg` 会使初始化依赖检查返回 error；Linux 缺 seccomp 时只是 warning，Unix socket access 会不受限，库还会继续生成 wrapper。对 Jai 的“强制后端”语义，这必须映射为 `sandbox_unavailable`，不能自动降级执行。来源：[linux-sandbox-utils.ts#L1047-L1089](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1047-L1089)、[sandbox-manager.ts#L681-L687](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L681-L687)。
7. **取消分为“wrap/setup 取消”和“child 运行时取消”，不能混为一个 API。** `AbortSignal` 传入 Linux glob/mandatory-deny 扫描；源码没有显示它自动终止已经 spawn 的用户 child。Jai 仍需自己保留 process-group kill、超时、SIGTERM/SIGKILL 和回收语义。来源：[sandbox-manager.ts#L1639-L1645](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L1639-L1645)、[linux-sandbox-utils.ts#L1643-L1655](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1643-L1655)。
8. **`wrapWithSandboxArgv` 比字符串 wrapper 更适合作为 Jai adapter 边界，但 macOS/Linux 仍是 `<shell> -c <wrapped>`。** 它返回 argv/env，避免调用方再次做 shell quoting；其实现对 POSIX 仍把字符串 wrapper 放入 shell `-c`。Jai 应只把结构化 argv/env 投影到内部 spawn，不把 SRT 的内部错误或日志对象跨 RPC 传递。来源：[sandbox-manager.ts#L1880-L1905](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L1880-L1905)、[sandbox-manager.ts#L2008-L2024](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2008-L2024)。
9. **Windows alpha 不应纳入本 RFC 的实现范围；Jai 在非 macOS/Linux 上应先返回 unsupported_platform，不自动执行未受约束的 shell。** 官方 README 当前明确把 Windows 标为 alpha；本轮推荐只接 macOS/Linux，并在 adapter 入口做平台白名单。来源：[README.md#L539-L590](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L539-L590)、[sandbox-manager.ts#L1033-L1041](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L1033-L1041)。

## 版本与范围

- 官方仓库：`https://github.com/anthropics/sandbox-runtime`，不是早先误写的 `anthropic-ai/sandbox-runtime`。
- 固定版本：`@anthropic-ai/sandbox-runtime@0.0.77`。
- 固定 SHA：`6fa731368807419ee157f9a3fac955fefe1019c6`。
- 核验依据：远端 `main`、`v0.0.77`、GitHub latest release 均指向该 SHA；package `engines.node` 为 `>=20.11.0`。
- 官方状态：README 将项目描述为 Beta Research Preview；Windows 当前是 alpha，本 RFC 不采用 Windows backend。
- Smoke agent 已在 macOS 对相同 `0.0.77`/SHA 验证：文件 deny、workspace write、nested child、loopback 均按策略生效。公网 proxy 域名、Linux 以及 glob 后创建文件尚未实测。

主张：Windows 当前标记为 alpha；Jai 的本轮平台白名单应为 macOS/Linux。

来源：[README.md#L539-L590](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L539-L590)

> - **Windows**: Alpha — uses a bundled `srt-win.exe` helper.
>
> ## Windows (alpha)
>
> Windows support is **alpha**.

## 统一维度核验

| 维度 | 核验结论 | Jai 处理 |
|---|---|---|
| 权限主体与能力 | 权限主体是被 wrapper 启动的整个 process tree；能力包括文件读/写、网络、Unix socket、部分 macOS Mach/XPC 能力。 | operation 只接受显式 policy DTO；禁止把 host process 当作受限主体的替代。 |
| 默认策略 | 无 settings 时：无网络、默认写路径之外不可写、读不限制；有 settings 但 invalid/不可读时退出。 | 默认 network deny；配置错误与依赖缺失均返回错误。 |
| 审批触发 | domain 未命中 allow/deny 时可走 `sandboxAskCallback`；`strictAllowlist` 时直接拒绝；文件没有运行中 approval 通道。 | 交互审批只放在 host policy 层；非交互模式必须 strict deny。 |
| 一次性/持久授权 | `customConfig` 是一次 wrap 的 policy overlay；network list 可通过 `updateConfig` live swap；filesystem 需 reset + initialize。 | 每个 operation 固定 policy snapshot；不允许 operation 间共享 live update。 |
| 路径/命令约束 | read deny/allow-back，write allow-only + deny carve-out；Linux glob 需要 wrap-time 扫描；命令最终仍由 shell `-c` 执行。 | 精确路径和 subtree 可用；一般 glob unsupported；命令字符串必须保持原有 Shell 语义并单独做审计。 |
| 非交互 | CLI 的 control-fd 可在运行时替换 whole config，但 filesystem 不更新；初始 control channel 失败会让命令退出。 | Jai worker 不依赖 stdin/TTY approval；policy/approval 通过显式 DTO 和 host channel。 |
| 失败/取消/恢复 | 初始化依赖错误抛出；Linux bridge/socket 死亡时 wrap 抛出；reset 会清 proxy、bridge、mount point、credential store；AbortSignal 主要覆盖 wrap 扫描。 | 强制 backend 失败即不 spawn；child abort 由 Jai 自己保证 process group 回收。 |
| 跨进程边界 | wrapper/bwrap/sandbox-exec/proxy/socat 是多进程边界；control fd 不传给 sandboxed child。 | worker 是策略隔离边界；RPC 只传白名单结果 DTO，不传 cause/stack/SDK error object。 |
| 测试 | 官方仓库有 config validation、glob expansion/profile、update-config、client abort、Linux dependency 等测试；本轮未运行。 | 实施前复制这些行为维度做 Jai adapter contract tests，并额外增加“glob 后创建文件”实测。 |

## 证据摘录

### 1. OS 强制边界与默认策略

主张：这是 OS-level process-tree sandbox，不是约定式 Node API。

来源：[README.md#L103-L130](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L103-L130)

> The sandbox uses OS-level primitives to enforce restrictions that apply to the entire process tree:
>
> - **macOS**: Uses `sandbox-exec` with dynamically generated Seatbelt profiles
> - **Linux**: Uses bubblewrap for containerization with network namespace isolation
> - **Windows**: Runs the sandboxed process under a dedicated `srt-sandbox` local user account
>
> Both filesystem and network isolation are required for effective sandboxing.

主张：默认策略与 invalid settings 的行为是 fail closed，不是 fallback。

来源：[README.md#L177-L185](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L177-L185)

> The settings file is optional — with no file at `~/.srt-settings.json`, `srt` runs with built-in defaults: no network access, no writes outside the default write paths, and unrestricted reads.
>
> A settings file that is there but is empty, cannot be read, or does not validate is an error: `srt` says so and exits rather than falling back to those defaults.

### 2. 文件模型：精确路径、subtree、读写优先级

主张：`denyRead`/`allowRead` 与 `allowWrite`/`denyWrite` 的语义正好覆盖本 RFC 的精确路径和目录 subtree 需求。

来源：[sandbox-config.ts#L894-L921](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L894-L921)

> export const FilesystemConfigSchema = z.object({
>   disabled: z.boolean().optional().describe(
>     'Disable all filesystem policy enforcement.'
>   ),
>   denyRead: z.array(filesystemPathSchema).describe('Paths denied for reading'),
>   allowRead: z.array(filesystemPathSchema).optional().describe(
>     'Paths to re-allow reading within denied regions (takes precedence over denyRead).'
>   ),
>   allowWrite: z.array(filesystemPathSchema).describe('Paths allowed for writing'),
>   denyWrite: z.array(filesystemPathSchema).describe('Paths denied for writing (takes precedence over allowWrite)'),
> })

主张：源码能力与 smoke agent 的 macOS 实测相符：文件 deny、workspace write 与 nested child 都由 Sandbox Runtime 的 process-tree wrapper 执行；该实测不覆盖 Linux、公网代理或 glob 后创建文件。

来源：[README.md#L103-L130](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L103-L130)

> The sandbox uses OS-level primitives to enforce restrictions that apply to the entire process tree:
>
> - **macOS**: Uses `sandbox-exec` with dynamically generated Seatbelt profiles
> - **Linux**: Uses bubblewrap for containerization with network namespace isolation
>
> Both filesystem and network isolation are required for effective sandboxing.

主张：Linux 的 allowWrite 从 read-only root 重新 bind 已有目录，说明 subtree 是 mount-time capability，而不是 Node 层检查。

来源：[linux-sandbox-utils.ts#L1944-L2013](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1944-L2013)

> // Write restrictions: Start with read-only root, then allow writes to specific paths
> args.push('--ro-bind', '/', '/')
>
> // Allow writes to specific paths
> for (const pathPattern of writeConfig.allowOnly || []) {
>   const normalized = normalizePathForSandbox(pathPattern)
>   if (!fs.existsSync(normalizedPath)) {
>     continue
>   }
>   args.push('--bind', normalizedPath, normalizedPath)
>   allowedWritePaths.push(normalizedPath)
> }

### 3. glob：macOS 与 Linux 的关键差异

主张：macOS 的 glob 会进入 Seatbelt regex，regex 带 subtree tail，因此从机制上能约束 wrap 后创建的匹配路径；这是源码静态判断，未在本轮实测。

来源：[macos-glob-deny-reemit.test.ts#L99-L123](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/macos-glob-deny-reemit.test.ts#L99-L123)

> // Every glob deny is rendered with the subtree tail so `x/**` (stripped
> // upstream to `x`) still covers x's contents.
> const ENV_GLOB = '^/work/proj/(.*/)?\\\\.env(/.*)?$'
>
> it('re-emits a leaf glob deny after the allow block, uncarved', () => {
>   const filter = `(regex "${ENV_GLOB}")`
>   expect(late).toContain(HEADERS.denyRead)
>   expect(late).toContain(filter)
> })

主张：Linux 普通 file glob 不是 future-file guarantee；实现用 `walkGlobPattern` 读取当前目录项，把 matches/unlisted 转成 mount locations。只有命中目录并形成覆盖性 tmpfs 时，未来 subtree 才会被一并挡住。

来源：[read-deny-glob.ts#L59-L74](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/read-deny-glob.ts#L59-L74)、[read-deny-glob.ts#L79-L103](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/read-deny-glob.ts#L79-L103)

> Expand a read-deny glob into the paths bwrap should mount over.
> A pattern ending in `/**` also takes its directory form.
>
> const walk = walkGlobPattern(globPattern, {
>   withDirectoryForm: true,
>   followSymlinkedDirectories: true,
> })
> const candidates = new Set([...walk.matches, ...walk.unlisted])
> if (walk.directoryMatches.length > 0) {
>   // Everything beneath a directory-form match is itself a match
> }

主张：Linux 测试明确把 glob 视为“match existing”，而不是动态 glob watcher；因此 Jai 的跨平台规则若要求后创建文件也被约束，不能直接接受 `**/*.env`。

来源：[glob-expand.test.ts#L794-L818](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/glob-expand.test.ts#L794-L818)

> it('drops non-existent grant paths without throwing (single statSync)', () => {
>   ...
> })
>
> it('passes non-existent deny paths through for placeholder-create', () => {
>   ...
> })
>
> it('still drops non-matching glob deny patterns (glob = match existing)', () => {
>   ...
> })

判定：Jai 只接受 literal file、literal directory/subtree；对包含 `*`, `?`, `[` 等 glob 的 policy，跨 macOS/Linux 统一返回 `unsupported_policy`，除非 Jai 自己把它规范化为明确的 enclosing subtree 并能证明语义不扩大。

### 4. 网络：deny、allowlist、direct sockets、代理

主张：Linux 的内核边界是 `--unshare-net`；域名 allowlist 不在 network namespace 内完成，而在 host proxy 过滤，所以 proxy 是强制网络通道。

来源：[linux-sandbox-utils.ts#L1157-L1180](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1157-L1180)

> Linux network sandboxing uses bwrap `--unshare-net` which creates a completely isolated network namespace with NO network access.
>
> Host side: Run socat bridges that listen on Unix sockets and forward to host proxy servers.
>
> LIMITATION: ... domain filtering happens at the host proxy level, not the sandbox boundary.
>
> DEPENDENCIES: Requires bwrap (bubblewrap) and socat

主张：macOS 在 Seatbelt 中只开放 proxy localhost port；Unix socket 默认阻断，可按路径 allow，或显式 `allowAllUnixSockets` 放开全部。

来源：[macos-sandbox-utils.ts#L1172-L1229](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/macos-sandbox-utils.ts#L1172-L1229)

> // Unix domain sockets for local IPC
> if (allowAllUnixSockets) {
>   profile.push('(allow system-socket (socket-domain AF_UNIX))')
>   profile.push('(allow network-bind (local unix-socket (path-regex #"^/")))')
> } else if (allowUnixSockets && allowUnixSockets.length > 0) {
>   profile.push('(allow system-socket (socket-domain AF_UNIX))')
> }
> // If both ... are false/undefined/empty, Unix sockets are blocked by default

主张：`allowLocalBinding: true` 同时允许所有本地 bind/inbound 与 loopback outbound；它是宽开关，不能用来实现某一个目标的精确授权。Smoke agent 已实测该开关会直接开放 loopback。

来源：[macos-sandbox-utils.ts#L1142-L1170](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/macos-sandbox-utils.ts#L1142-L1170)

> if (allowLocalBinding) {
>   profile.push('(allow network-bind (local ip "*:*"))')
>   profile.push('(allow network-inbound (local ip "*:*"))')
>   profile.push('(allow network-outbound (remote ip "localhost:*"))')
> }

判定：Jai policy 不暴露 `allowLocalBinding`；proxy 需要的 loopback 通道由 SRT 内部端口规则建立，任何单目标本地服务授权都需另设计精确 capability，而不是打开该布尔开关。

主张：允许域名不等于允许任意解析地址；direct route 使用 resolved-address guard，拒绝 loopback/private/本机地址等解析结果；parent proxy 或 MITM route 则由下一跳承担解析策略。

来源：[resolved-address-guard.ts#L1-L23](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/resolved-address-guard.ts#L1-L23)

> Without a check on the resolved address, an allow-listed name can be pointed at the loopback interface, a link-local address, or address space the embedder considers private.
>
> The address that passed the check is the address dialed, with no second resolution in between.
>
> Connections routed through a parent proxy or a MITM socket are not resolved locally at all; that hop resolves the name and is responsible for its own address policy.

主张：parent proxy 的 `NO_PROXY` host 会 direct connect，且 loopback 总是 bypass parent proxy；因此 Jai 若要求“所有网络都必须走可审计通道”，必须禁止/审计 parent proxy bypass 配置，而不能只设置 `HTTP_PROXY`。

来源：[parent-proxy.ts#L166-L195](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/parent-proxy.ts#L166-L195)

> Returns true if the given host should bypass the parent proxy and connect directly.
>
> Always bypasses loopback — chaining localhost through an upstream proxy is never what you want.
>
> if (resolved.noProxy.all) return true
> if (addressInSet(resolved.noProxy.cidr, h)) return true

### 5. 全局状态、并发与 operation 隔离

主张：不同策略不能在同一 manager 中并发运行；模块级变量直接保存 config、proxy、token、managerContext、stores。

来源：[sandbox-manager.ts#L127-L189](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L127-L189)

> let config: SandboxRuntimeConfig | undefined
> let httpProxyServer: ReturnType<typeof createHttpProxyServer> | undefined
> let socksProxyServer: SocksProxyWrapper | undefined
> let muxProxyServer: MuxProxyServer | undefined
> let managerContext: HostNetworkManagerContext | undefined
> let initializationPromise: Promise<HostNetworkManagerContext> | undefined
> const sandboxViolationStore = new SandboxViolationStore()
> const sentinelRegistry = new SentinelRegistry()
> const maskedFileStore = new MaskedFileStore()

主张：`initialize()` 发现已有初始化时直接等待并返回，不会创建第二套 policy；这使“多个 operation 各自 initialize”不成立。

来源：[sandbox-manager.ts#L632-L645](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L632-L645)

> // Return if already initializing
> if (initializationPromise) {
>   await initializationPromise
>   return
> }
>
> // Store config for use by other functions
> config = runtimeConfig

主张：network policy 可 live swap，且已运行 child 的下一次连接会读新 allow/deny；filesystem policy 只在 wrap 时编译，必须 reset + initialize 才更新。

来源：[sandbox-manager.ts#L2035-L2050](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2035-L2050)

> Network/allowlist changes are a live swap ... take effect on the next connection.
>
> Filesystem changes (denyRead/denyWrite) are NOT applied live:
> macOS bakes them into the seatbelt profile at wrap time, and
> Linux/Windows bake them into the bwrap argv / DENY-ACE set at wrap time.
> Call reset() + initialize() to apply a new filesystem config.

建议：Jai 为每个不同 policy 建立独立 worker；worker 内只 initialize 一次，operation 结束后等待 child/process-group 完成，再 reset 并退出。若需要真正并发且策略不同，使用 one-worker-per-policy 或 one-worker-per-operation，不要共享 SRT module instance。

### 6. 取消、reset、恢复

主张：SRT 把 AbortSignal 传到 Linux filesystem generation，覆盖 glob/mandatory deny 扫描；这不等价于已经运行 child 的取消。

来源：[linux-sandbox-utils.ts#L1643-L1655](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1643-L1655)

> export async function generateFilesystemArgs(
>   readConfig: FsReadRestrictionConfig | undefined,
>   writeConfig: FsWriteRestrictionConfig | undefined,
>   ...
>   abortSignal?: AbortSignal,
> ): Promise<string[]> {

主张：reset 会关闭 proxy/bridge、清理 mount points、清空 credential stores；它是 session teardown，不是 operation-safe 的并发切换原语。

来源：[sandbox-manager.ts#L2212-L2251](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2212-L2251)、[sandbox-manager.ts#L2331-L2348](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2331-L2348)

> async function reset(): Promise<void> {
>   ...
>   cleanupBwrapMountPoints({ force: true })
>   ...
>   // Wait for all servers to close
>   await Promise.all(closePromises)
>   ...
>   initializationPromise = undefined
>   ...
>   sentinelRegistry.clear()
>   awsPairRegistry.clear()
>   commandTextsByKey.clear()
>   maskedFileStore.dispose()

主张：代理对 client abort、slow filter、burst abort 有专门测试，说明取消/断开是重要边界；但本轮只读源码和测试，没有执行测试。

来源：[client-abort.test.ts#L11-L19](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/client-abort.test.ts#L11-L19)

> A sandboxed client whose process tree is torn down mid-exchange resets its proxy connection.
>
> A burst of simultaneous teardowns ... crashes the host process.
>
> These tests drive the plain-HTTP request path with clients that vanish mid-request and assert nothing escapes to the process level.

### 7. 依赖、打包与不可用行为

主张：npm 包要求 Node `>=20.11.0`，依赖 `socks5-server`、`commander`、`node-forge`、`zod`，并把 `vendor/seccomp`、`vendor/srt-win`、`vendor/java-proxy-agent` 纳入发布文件；Linux 仍需要 host 上的 bwrap/socat/rg。

来源：[package.json#L3-L32](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/package.json#L3-L32)、[package.json#L53-L59](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/package.json#L53-L59)

> "version": "0.0.77",
> "type": "module",
> "main": "./dist/index.js",
> "engines": { "node": ">=20.11.0" },
> "dependencies": {
>   "@pondwader/socks5-server": "^1.0.10",
>   "commander": "^12.1.0",
>   "node-forge": "^1.4.0",
>   "zod": "^3.24.1"
> }

主张：Linux dependency checker 对 bwrap/socat 缺失返回 errors，但 seccomp 缺失仅 warning；wrapper 会记录“unix socket blocking disabled”并继续。

来源：[linux-sandbox-utils.ts#L1050-L1080](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1050-L1080)、[linux-sandbox-utils.ts#L3070-L3088](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3070-L3088)

对应结论：[sandbox-manager.ts#L681-L687](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L681-L687)

> if (bwrapPath) {
>   if (isExecutable(bwrapPath)) usableBwrap = bwrapPath
>   else errors.push(`bubblewrap (bwrap) not executable at ${bwrapPath}`)
> }
> ...
> warnings.push('seccomp not available - unix socket access not restricted')
>
> '[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled.'

判定：Jai 初始化前必须做依赖能力探测，并把 `warnings` 中影响强制边界的项目升格为错误；不允许 fallback 到裸 `/bin/bash`，不允许 `filesystem.disabled`，不允许 `allowAllUnixSockets` 作为“修复”。

### 8. argv adapter 边界

主张：`wrapWithSandboxArgv` 在 macOS/Linux 把 wrapper 放进 `<shell> -c`，并返回 `{ argv, env }`；Jai 应只在 worker 内使用它，并把结果投影为自身 ShellResult/错误 DTO。

来源：[sandbox-manager.ts#L2008-L2024](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-manager.ts#L2008-L2024)

> // macOS/Linux: delegate to the existing string wrapper, then put
> // the result behind `<shell> -c` so the caller's argv-spawn works.
> const wrapped = await wrapWithSandbox(
>   command,
>   binShell,
>   customConfig,
>   abortSignal,
>   options,
> )
> const shell = binShell ?? '/bin/bash'
> return { argv: [shell, '-c', wrapped], env: process.env }

### 8. 非交互、control-fd、RPC/DTO 边界

主张：control-fd 每行替换整个配置，但仅 network lists 对当前进程 live；filesystem 规则不会更新，sandboxed child 看不到 control fd。

来源：[README.md#L187-L221](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L187-L221)

> Each line replaces the whole config, but only the network lists (`allowedDomains` / `deniedDomains`) change what is already running.
>
> Filesystem rules are compiled into the sandbox at wrap time.
>
> A channel that dies before it has delivered a single update takes the command down with it.
>
> On macOS and Linux the sandboxed command does not get the descriptor.

主张：SRT 有 `commandId` 做 violation attribution，但该 key 只应用于归因，不应成为 Jai durable permission fact；Jai 跨 RPC 只投影 `operationId`, `policyId`, `status`, `reason`, `resource` 等白名单字段。

来源：[README.md#L223-L266](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L223-L266)

> Violations observed while a wrapped command runs ... are stored under an attribution key.
>
> Pass an opaque per-invocation `commandId` ... to key by that instead.
>
> an attribution key no invocation of this process registered ... is reported sanitized and cut to that same key length.

## 具体 trace

以下是 Jai 采用“一策略一 worker”后的预期控制流；其中 SRT 的真实调用点来自固定 SHA，Jai worker/DTO 是建议设计，未实现、未实测。

```text
Jai Shell.execute(command, policy, abortSignal)
  -> validate platform: darwin/linux only
  -> validate policy: literal path/subtree only; reject unsupported glob
  -> start or acquire dedicated policy worker
  -> worker: SandboxManager.initialize(config)
       -> dependency check: rg + bwrap + socat + seccomp capability
       -> start host HTTP/SOCKS mux proxy
       -> Linux: start socat Unix-socket bridge; macOS: reserve localhost proxy rules
  -> worker: SandboxManager.wrapWithSandboxArgv(command, shell, ..., abortSignal, cwd)
       -> compile filesystem policy at wrap time
       -> Linux: bwrap --unshare-net + mounts + optional apply-seccomp
       -> macOS: env + sandbox-exec -p <Seatbelt profile> shell -c command
  -> host spawn(argv, env, detached/process-group)
       -> child process tree executes
       -> network request -> proxy -> deniedDomains/allowedDomains/ask callback
       -> file read/write -> OS sandbox decision
  -> Jai abort/timeout -> kill process group -> await close -> collect bounded output
  -> worker: cleanupAfterCommand/reset()
       -> close proxy/bridge, cleanup mounts, clear per-session credential state
  -> return ShellResult or explicit sandbox_unavailable/unsupported_policy/aborted
```

## 失败与边界

- **Windows**：本 RFC 只支持 macOS/Linux。非目标平台必须在 spawn 前返回 `unsupported_platform`；不能因为 SRT 当前有 Windows alpha 就把它偷偷纳入产品能力。
- **Linux glob**：`/path/**` 这类能落到 enclosing directory 的 subtree 形状可继续评估；`**/*.env`、`*.secret` 等依赖现有目录项枚举的 pattern 不满足“后创建文件也约束”的要求，统一 `unsupported_policy`。
- **Linux unlistable directory**：源码会把无法枚举的目录记录为 `unlistableDenyDirs`，并禁止其下重新 bind；这不是动态 glob 完整证明，仍不能把所有 glob 宣称为 future-safe。
- **网络 direct route**：parent proxy 的 `NO_PROXY` 与 loopback bypass 会产生 direct route；如果 Jai 的 policy 语义是“所有网络必须经过可审计代理”，必须禁止这些配置或明确记录其例外。
- **Unix sockets**：Linux seccomp 只能阻止创建新的 AF_UNIX socket，不能按 path 过滤，也不能阻止 inherited FD 或 SCM_RIGHTS；macOS 可按 path allow。若 Jai 的只读工具依赖 Unix socket，必须显式声明能力。
- **初始化失败**：bwrap/socat/rg 缺失、bridge socket 消失、shell 不存在、非法 domain/path 配置都必须阻止 spawn。不能 fallback 为未 sandbox 的 shell。
- **取消与 reset race**：reset 会关闭共享 proxy 和清理 session state；只有 worker 内没有活动 child、bridge 请求和 pending wrap 后才可 reset。SRT 自己的 AbortSignal 不替代 child process-group kill。
- **只读工具**：只读不等于无风险；仍需要同一 network deny、`denyRead`、Unix socket 默认阻断和 process-tree sandbox。若只读工具要求访问某目录，应给 literal read grant，而不是关闭 filesystem policy。
- **已知实测与剩余空白**：smoke agent 已验证 macOS 文件 deny、workspace write、nested child、loopback；本轮未运行完整 sandbox-runtime 测试。公网 proxy 域名、Linux、以及“wrap 后创建新匹配文件”的端到端结果仍未测，后两项是实施前阻断。

## 不成立条件

以下任一条件成立时，不能声称“Jai 本地 Bash 已被强制约束”：

1. child 不是从 SRT 返回的 wrapper argv/env 启动，或中间再次由未审计 shell 拼接命令。
2. policy 使用 Linux 普通 file glob，但没有把它拒绝为 `unsupported_policy`。
3. SRT warning 表示 seccomp/Unix socket protection 缺失，但 Jai 仍继续执行。
4. 两个不同 policy 在同一个 Node worker/module instance 中交错调用 `updateConfig()`、`wrapWithSandbox()` 或 `reset()`。
5. 取消只终止 Node promise，没有终止 child process group 和其 descendants。
6. network policy 依赖 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量而没有验证 OS boundary、proxy route 和 NO_PROXY 例外。
7. 配置、依赖、平台或 bridge 失败时自动降级到裸 shell。

## 待验证项

- macOS：实际运行 `denyRead: ["**/*.env"]`，在 wrap 后新建匹配文件，确认 Seatbelt regex 的覆盖范围；同时验证 `denyRead` 与 `allowRead` 的最具体规则和 symlink 行为。
- Linux：实际运行同一 policy，在 wrap 后新建 `.env`，确认新文件是否可读；分别验证 literal parent subtree、`/dir/**`、`**/*.env`、unlistable directory。
- Linux：验证缺 seccomp 时 Jai 是否能可靠区分“文件/网络边界仍有”与“Unix socket 边界已降级”，并按 RFC 统一拒绝。
- 两平台：验证 child fork/exec、后台 daemon、shell pipeline、`setsid`/process group 的回收；确认 reset 不会影响另一个 operation worker。
- 两平台：验证 proxy deny、ask callback、strict allowlist、direct IP、DNS rebinding、parent proxy/NO_PROXY 的 DTO 和错误分类。
- Node adapter：固定 Node `>=20.11.0`、ESM/bundling、vendor seccomp 与 java agent 的打包方式；确认 pnpm/electron worker 能解析这些发布文件。
- RPC：定义 Jai 白名单 DTO；禁止跨进程传递 `TaggedError.cause`, stack 或未筛选的 SRT/Node error。
- 依赖版本：将 SRT SHA 固定到 lockfile，并建立升级时重新核验 `main/tag/package` 一致性的 CI 检查。

## 来源覆盖

| 来源类型 | 覆盖情况 |
|---|---|
| 官方文档 / 源码 | 已覆盖 README、package.json、sandbox-manager、sandbox-config、macOS Seatbelt、Linux bwrap/seccomp、proxy、resolved-address guard、glob helper。 |
| 作者或维护者本人的说法 | README 的 Beta Research Preview、Windows alpha、默认策略、control-fd 和 library usage 已核验；未额外引用作者 issue 评论。 |
| 同类方案 | 本轮按要求不重做 Codex/Grok/其他项目；结论只依赖 SRT 官方一手材料。 |
| issue / PR / 社区实践 | 源码注释引用的 proxy/Seatbelt/bwrap 约束已记录；未把社区讨论当作实现事实。 |
| 历史演变 | 已核对 `main`、`v0.0.77`、latest release 当前均为 `6fa731368807419ee157f9a3fac955fefe1019c6`；升级前仍需重新钉 SHA。 |

## 对本项目的影响

建议在权限重构 RFC 中把 SRT 定义为 **POSIX local-shell enforcement backend**，而不是权限领域本身：

1. Jai policy core 只允许 literal file、literal directory/subtree、network deny/allowlist 和显式 Unix-socket capability；glob 进入校验器后按平台能力判定，普通 Linux glob 直接 `unsupported_policy`。
2. Shell adapter 通过 dedicated worker 持有一套 SRT manager、proxy、credential state 和 violation attribution；不同 policy 不共享进程级 manager。
3. `initialize` 前执行平台/依赖/能力探测；任何影响强制边界的 warning 都投影为 `sandbox_unavailable`，且不 spawn。
4. `wrapWithSandboxArgv` 只作为 worker 内部 adapter seam；对 Jai 外部返回结构化 `ShellResult`/白名单错误 DTO，不泄漏 SRT 内部对象。
5. worker 在 child process tree 完成后才 `cleanupAfterCommand`/`reset`；abort/timeout 由 Jai 负责终止整个 process group。
6. RFC 必须明确“未实测不等于已实现”，并把上述 macOS/Linux glob 后创建文件测试列为合入前阻断项。
