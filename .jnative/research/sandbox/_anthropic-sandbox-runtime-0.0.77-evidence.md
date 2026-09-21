# `@anthropic-ai/sandbox-runtime@0.0.77`：Linux `apply-seccomp`、bwrap/userns 与 Ubuntu ARM64 可行性证据

核验日期：2026-09-21（Asia/Shanghai）。上游 npm 版本固定为 `@anthropic-ai/sandbox-runtime@0.0.77`，上游 tag `v0.0.77` 固定到 commit [`6fa731368807419ee157f9a3fac955fefe1019c6`](https://github.com/anthropics/sandbox-runtime/commit/6fa731368807419ee157f9a3fac955fefe1019c6)。所有上游源码链接均钉住该 SHA，防止后续 `main` 混入结论。本仓库的集成改动尚未提交；因此只能以当前工作树行号作为本地证据，不能伪造 GitHub SHA permalink。

研究问题：`apply-seccomp` 如何拦截 Unix socket、如何被 bwrap/user namespace 启动；Jai 已有哪些实际配置/执行路径；以及 Ubuntu 26 ARM64 普通用户 VM 若 helper 嵌套 user namespace 失败，哪一层有最小、可维护的修复空间。

## 结论

1. **Linux 的 Unix socket “默认拒绝”依赖 `apply-seccomp`，不是 bwrap 本身。** helper 给工作负载安装 BPF，拒绝 `socket(AF_UNIX, …)`，还拒绝 `io_uring_*` 绕开该 syscall；`allowUnixSockets` 在 Linux 被明确忽略，唯一公开开关 `allowAllUnixSockets: true` 会跳过 helper、放开所有 Unix socket。它不是路径级 allowlist。[固定配置语义](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L757-L767)。
2. **普通 Ubuntu VM 的失败点是 helper 的“第二层 userns”而非外层 bwrap。** 外层 bwrap 总是 `--unshare-user --cap-drop ALL`；helper 先尝试带 `CAP_SYS_ADMIN` 的 PID/mount unshare，失败后创建嵌套 userns、写 `{setgroups,uid_map,gid_map}`，任一步失败即退出。源码直接列出 Ubuntu 24.04 AppArmor capability-restriction 为此路径的失败例，并要求调用方提供 `CAP_SYS_ADMIN`。Ubuntu 26 的同一策略是否仍启用必须在目标 VM 验证，不能仅由 24.04 文档推定。[固定 helper 代码](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L684-L755)。
3. **`enableWeakerNestedSandbox: true` 不是该故障的修复。** 它只把外层 `/proc` 的 fresh mount 改为 bind mount，以照顾容器里的只读 `/proc`；它仍保留 `--unshare-user` 与 `--cap-drop ALL`，不会跳过 helper 的 nested-userns 或放开 Ubuntu AppArmor。对“普通用户 + LSM 拒绝 capability-bearing userns”的症状，此开关没有因果路径。[固定 wrapper 代码](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3270-L3292)。
4. **当前 Jai 执行路径实际没有暴露该 runtime 的 Linux 逃生开关。** 每个 Shell 由独立 Node CLI 进程读取临时 `settings.json`；Jai 只写 network domain allowlist 与 filesystem deny/write policy，未写 `allowAllUnixSockets`、`enableWeakerNestedSandbox`、`seccomp.applyPath`、`bwrapPath` 或 `socatPath`。更重要的是，Jai 把 runtime 的 “seccomp 不可用、Unix socket 不受限” warning 升级为 `shell.sandbox_unavailable`，即 fail-closed；其 CLI initialization/config-update 边界见[固定 CLI 代码](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/cli.ts#L412-L450)，本地工作树细节见第 5 节。
5. **在 Ubuntu 26 ARM64 普通用户 VM 上，不能把 `--cap-add CAP_SYS_ADMIN` 当作最小修复。** 对没有 LSM 干预、仅因 outer capability bounding set 出错的环境，它可能恢复 helper 的第一条路径；但 #429 的具体 Ubuntu AppArmor 报告说明 bwrap child 的能力被 profile 剥夺，新增 capability 仍不成立。对题设 VM，最小“能运行”的已有选项是 `allowAllUnixSockets: true`，但这等于移除 Unix-socket 强制；若该能力是不可放弃的安全要求，应 fail closed，或升级到隔离 host socket 的 VM/sidecar 边界。[固定 capability 代码](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L549-L579)。
6. **已做的 macOS 测试不能证明 Linux 可运行。** Jai 的现有 adapter 测试在本机通过 5/5，包括默认 Unix socket 拦截；上游 Linux dependency unit tests 通过 32/32，但 helper PID/bwrap 集成测试因 Darwin 被跳过 21 项。本机是 macOS 26 ARM64、无 `bwrap`/`socat`；没有 Ubuntu kernel、AppArmor 或 ARM64 ELF helper 可执行条件，所以 Linux 行为明确标为未实测。[固定 Linux-only 测试 gate](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/pid-namespace-isolation.test.ts#L40-L60)。

## 1. Unix socket 语义与 seccomp 边界

主张：Linux 不支持 Unix socket 的路径 allowlist；`allowAllUnixSockets` 是全放开，不是仅允许 SRT 自己的 proxy socket。

来源：[`src/sandbox/sandbox-config.ts#L757-L767 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L757-L767)

```ts
allowUnixSockets: z
  .array(z.string())
  .optional()
  .describe(
    'macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path).',
  ),
allowAllUnixSockets: z
  .boolean()
  .optional()
  .describe(
    'If true, allow all Unix sockets (disables blocking on both platforms).',
  ),
```

主张：官方 README 把两平台差异写成公开产品语义：Linux 仅在 x64/ARM64 以 seccomp 拦截；helper 缺失时只是 warning，socket 会不受限。

来源：[`README.md#L389-L398 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L389-L398)

```md
| `allowUnixSockets: string[]`   | Allowlist of socket paths | _Ignored_ (seccomp can't filter by path) |
| `allowAllUnixSockets: boolean` | Allow all sockets         | Disable seccomp blocking                 |

Unix sockets are **blocked by default** on both platforms.

- **macOS**: Use `allowUnixSockets` to allow specific paths (e.g., `["/var/run/docker.sock"]`), or `allowAllUnixSockets: true` to allow all.
- **Linux**: Blocking uses seccomp filters (x64/arm64 only). If seccomp isn't available, sockets are unrestricted and a warning is shown. Use `allowAllUnixSockets: true` to explicitly disable blocking.
```

主张：ARM64 是设计支持架构；runtime 依次查找 caller 指定路径、本地包 vendor 路径、全局 npm 路径，找不到只返回 `null`，由上层决定是否 fail closed。

来源：[`src/sandbox/generate-seccomp-filter.ts#L130-L169 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/generate-seccomp-filter.ts#L130-L169)

```ts
function getVendorArchitecture(): string | null {
  const arch = process.arch as string
  switch (arch) {
    case 'x64':
    case 'x86_64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    case 'ia32':
    case 'x86':
      // TODO: Add support for 32-bit x86 (ia32)
```

来源：[`src/sandbox/generate-seccomp-filter.ts#L190-L219 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/generate-seccomp-filter.ts#L190-L219)

```ts
 * Pre-built apply-seccomp binaries are organized by architecture:
 * - vendor/seccomp/{x64,arm64}/apply-seccomp
 *
 * Tries multiple paths for resilience:
 * 0. Explicit path provided via parameter (checked first if provided)
 * 1. vendor/seccomp/{arch}/apply-seccomp (bundled - when bundled into consuming packages)
 * 2. ../../vendor/seccomp/{arch}/apply-seccomp (package root - standard npm installs)
 * 3. ../vendor/seccomp/{arch}/apply-seccomp (dist/vendor - for bundlers)
 * 4. Global npm install (if seccompBinaryPath not provided) - for native builds
```

## 2. 从 bwrap 到 helper 的实际启动 trace

给定输入：`filesystem.allowWrite` 已设、`network.allowedDomains: []`、且没有 `allowAllUnixSockets`。路径如下：

1. `SandboxManager.wrapWithSandbox()` 识别 network config，Linux 下把 proxy Unix socket 路径与 config 传给 `wrapCommandWithSandboxLinux()`。
2. Linux wrapper 解析 `apply-seccomp`；有 binary 时保存 prefix，无 binary 时只记 warning。若有 network restriction，则 outer bwrap `--unshare-net`，把 host `socat` bridge 的 Unix socket bind 进 namespace；in-sandbox `socat` 先启动。
3. wrapper 总是 `--unshare-pid --unshare-user --cap-drop ALL`，默认 fresh `--proc /proc`；最后执行 `shell -c '<socat setup>; apply-seccomp shell -c <user command>'`。
4. `apply-seccomp` 的 outer stub 未上 filter，以便 helper/proxy 观测；它创建 nested PID+mount（必要时先 nested userns），inner PID 1 reaper fork worker；worker 设置 `NO_NEW_PRIVS` 后安装 BPF，再 `execvp` 用户命令。

主张：网络 bridge 必须在 seccomp 前创建 Unix socket；这解释了“用户 payload 不能新建 AF_UNIX socket”并不等于 SRT 自己的 proxy bridge 无法工作。

来源：[`src/sandbox/linux-sandbox-utils.ts#L1368-L1391 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1368-L1391)

```ts
if (applySeccompPrefix) {
  const applySeccompCmd =
    applySeccompPrefix + quote([shellPath, '-c', userCommand])
  const innerScript = [...socatCommands, applySeccompCmd].join('\n')
  return `sh -c ${quote([innerScript])}`
}

// No seccomp needed, just run socat processes and command
const innerScript = [...socatCommands, userCommand].join('\n')
return `sh -c ${quote([innerScript])}`
```

主张：outer wrapper 的 actual branch 是“helper 存在则 package 用户命令”；`allowAllUnixSockets` 时根本不解析 helper。

来源：[`src/sandbox/linux-sandbox-utils.ts#L3066-L3092 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3066-L3092)

```ts
// ========== SECCOMP FILTER (Unix Socket Blocking) ==========
// apply-seccomp wraps the workload and applies the baked-in BPF filter
// that blocks socket(AF_UNIX, ...). Skipped when allowAllUnixSockets is true.
if (!allowAllUnixSockets) {
  applySeccompPrefix = resolveApplySeccompPrefix(
    seccompConfig?.applyPath,
    seccompConfig?.argv0,
  )

  if (!applySeccompPrefix) {
    logForDebugging(
      '[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled. ' +
        'Install @anthropic-ai/sandbox-runtime globally for full protection.',
```

主张：network isolation 是 outer `--unshare-net` + socket bridge；域名规则由 host proxy 实现，不是 bwrap 直接按域名判断。

来源：[`src/sandbox/linux-sandbox-utils.ts#L1157-L1180 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1157-L1180)

```ts
 * Linux network sandboxing uses bwrap --unshare-net which creates a completely isolated
 * network namespace with NO network access. To enable network access, we:
 *
 * 1. Host side: Run socat bridges that listen on Unix sockets and forward to host proxy servers
 *    - HTTP bridge: Unix socket -> host HTTP proxy (for HTTP/HTTPS traffic)
 *    - SOCKS bridge: Unix socket -> host SOCKS5 proxy (for SSH/git traffic)
 *
 * 2. Sandbox side: Bind the Unix sockets into the isolated namespace and run socat listeners
 *    - HTTP listener on port 3128 -> HTTP Unix socket -> host HTTP proxy
 *    - SOCKS listener on port 1080 -> SOCKS Unix socket -> host SOCKS5 proxy
```

主张：bwrap 参数的顺序明确先网络、filesystem，再 PID/user namespace；无论 secure/weaker branch 都会 `--unshare-user`。

来源：[`src/sandbox/linux-sandbox-utils.ts#L3142-L3178 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3142-L3178)

```ts
// ========== NETWORK RESTRICTIONS ==========
if (needsNetworkRestriction) {
  // Always unshare network namespace to isolate network access
  // This removes all network interfaces, effectively blocking all network
  bwrapArgs.push('--unshare-net')

  // If proxy sockets are provided, bind them into the sandbox to allow
  // filtered network access through the proxy. If not provided, network
  // is completely blocked (empty allowedDomains = block all)
  if (httpSocketPath && socksSocketPath) {
    // Verify socket files still exist before trying to bind them
```

来源：[`src/sandbox/linux-sandbox-utils.ts#L3248-L3322 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3248-L3322)

```ts
bwrapArgs.push('--unshare-pid')
// --unshare-user in both modes: bwrap only auto-creates a userns when
// EUID != 0. A root parent in an unprivileged container (Docker's
// default: EUID=0 without CAP_SYS_ADMIN) would otherwise try a direct
// clone and EPERM.
const euid = process.geteuid?.()
const hasSetfcap = processHasBoundingCapability(CAP_SETFCAP)
…
bwrapArgs.push(
  '--unshare-user',
  ...capabilityArgs({ euid, hasSetfcap, usesSeccompHelper: applySeccompPrefix !== undefined }),
)
if (!enableWeakerNestedSandbox) {
  bwrapArgs.push('--proc', '/proc')
} else {
  bwrapArgs.push('--bind', '/proc', '/proc')
}
```

主张：BPF 的 worker 安装点在 `NO_NEW_PRIVS` 之后，且只包住即将 exec 的 workload。

来源：[`vendor/seccomp-src/apply-seccomp.c#L870-L890 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L870-L890)

```c
/* ---- Worker (inner PID 2): apply seccomp and exec. ---- */
unsetenv("SRT_OBSERVE_SOCK");
unsetenv("SRT_ENCODED_CMD");
if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
    die("apply-seccomp: prctl(PR_SET_NO_NEW_PRIVS)");
}
/* Best-effort: install the USER_NOTIF observation filter and hand its
 * listener fd to the outer stub over the pre-fork socketpair. Runs after
 * NO_NEW_PRIVS (required) and before the unix-block filter / exec so only
 * the workload is observed. */
install_observe_filter(sp[1]);
if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) < 0) {
    die("apply-seccomp: prctl(PR_SET_SECCOMP)");
}
```

## 3. Ubuntu userns 失败为何使 helper 整体退出

主张：helper 不是“seccomp filter 加载失败后宽松继续”。它先尝试 PID/mount namespace；`EPERM` 时才新建 userns 并写 map，任一步失败通过 `die()` 终止。因此题设中的 nested-userns 失败会使整条 Shell execution fail。

来源：[`vendor/seccomp-src/apply-seccomp.c#L684-L755 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L684-L755)

```c
 * Two paths to get CAP_SYS_ADMIN for the unshare:
 *   (a) We already hold CAP_SYS_ADMIN in this user namespace. Just
 *       unshare directly. Under the sandbox we never do — bwrap is
 *       given --cap-drop ALL and at most --cap-add CAP_SETFCAP — so
 *       this path is for a standalone run by a privileged caller.
 *   (b) We don't have the cap. Create a nested user namespace to get it,
 *       map uid/gid, then unshare. This also works when apply-seccomp is
 *       run standalone outside bwrap.
 *
 * Path (a) is tried first. If we don't have the cap, the
 * kernel returns EPERM and we fall through to (b). Path (b) can itself
 * fail on hosts where unprivileged user namespaces are gated by an LSM
 * (Ubuntu 24.04's AppArmor restriction, for example) — the unshare
 * succeeds but the new namespace grants no capabilities, so the setgroups
 * write fails. In that case we abort: the caller must supply CAP_SYS_ADMIN.
```

来源：[`vendor/seccomp-src/apply-seccomp.c#L731-L755 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L731-L755)

```c
if (unshare(CLONE_NEWUSER) < 0) {
    die("apply-seccomp: unshare(CLONE_NEWUSER)");
}
if (write_file("/proc/self/setgroups", "deny") < 0) {
    die("apply-seccomp: write /proc/self/setgroups "
        "(nested userns is capability-restricted; "
        "caller must provide CAP_SYS_ADMIN)");
}
if (write_file("/proc/self/uid_map", "%u %u 1\n", uid, uid) < 0) {
    die("apply-seccomp: write /proc/self/uid_map");
}
if (write_file("/proc/self/gid_map", "%u %u 1\n", gid, gid) < 0) {
    die("apply-seccomp: write /proc/self/gid_map");
}
```

主张：官方发布文档只直接承诺 Ubuntu 24.04+ 的 AppArmor/sysctl 情况；它没有 Ubuntu 26 专用承诺。因此“26 ARM64 一定如此”是待验证，而“若该 LSM 行为存在则 helper 会 abort”由上面固定源码证明。

来源：[`README.md#L539-L568 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L539-L568)

```md
**Ubuntu 24.04+ note:** These releases enable `kernel.apparmor_restrict_unprivileged_userns` by default, which allows `unshare(CLONE_NEWUSER)` but strips capabilities from the resulting namespace. Both bubblewrap and the seccomp isolation layer need capability-bearing user namespaces. Disable the restriction with:

`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`

or add an AppArmor profile that grants `userns` to the relevant binaries.

**Running as root:** a caller with euid 0 needs `CAP_SETFCAP` in its capability bounding set.
```

主张：公开 issue #429 是一个**具体用户报告**，不是维护者确认或 Ubuntu 26 的总体统计；它和源码的 failure mode 一致，报告 `allowAllUnixSockets: true` 可令 command 运行。检索到的 #429 与 #498 均为 open，未发现项目维护者针对该 issue 的公开评论；不能将作者的 workaround 叙述升级为官方保证。

来源：[`anthropics/sandbox-runtime#429`](https://github.com/anthropics/sandbox-runtime/issues/429)（open，2026-07-28，作者 `dorrogeray`；非维护者身份未独立验证）

> `apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied`
>
> `Setting network.allowAllUnixSockets skips Stage 2 entirely; the capability is never requested and the rest of the sandbox arms normally`
>
> `The cost is exactly the feature that stage provides: Unix-socket filtering.`

## 4. 现有配置开关及其不能解决什么

| 开关/路径 | Linux 中实际作用 | 对 helper nested-userns 失败 | 反方条件 |
| --- | --- | --- | --- |
| `network.allowUnixSockets` | 忽略；seccomp 无路径过滤能力 | 无作用 | 只对 macOS 有路径 allowlist |
| `network.allowAllUnixSockets: true` | 完全跳过 `apply-seccomp` | 能避开 helper，command 可启动 | 放开所有 Unix socket；仅在 policy 明确允许时可用 |
| `enableWeakerNestedSandbox: true` | `/proc` 从 fresh mount 变 bind mount | 无作用；仍 `--unshare-user --cap-drop ALL` | 仅是 Docker/只读 `/proc` 兼容选项 |
| `seccomp.applyPath` / `argv0` | 选择 helper 的位置/启动方式 | 不改变 helper 内的 userns 算法 | 自定义 binary 必须有相同 ABI；缺 binary 仍不安全 |
| `bwrapPath` / `socatPath` | 选择 binary | 不改变 AppArmor 对 child 的 policy | 目标 binary/profile 仍受 host LSM 管控 |
| CLI `--control-fd` | 运行时完整 config update | 当前 Jai 没有使用 | filesystem policy 非 live；不能改已编译 wrapper |

主张：`enableWeakerNestedSandbox` 的代码证据是只切换 `/proc`，并非切掉 nested userns；官方测试也断言 weaker branch 仍有 `--unshare-user`、`--cap-drop ALL`。

来源：[`src/sandbox/linux-sandbox-utils.ts#L3270-L3292 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3270-L3292)

```ts
bwrapArgs.push(
  '--unshare-user',
  ...capabilityArgs({
    euid,
    hasSetfcap,
    usesSeccompHelper: applySeccompPrefix !== undefined,
  }),
)
if (!enableWeakerNestedSandbox) {
  // Mount fresh /proc if PID namespace is isolated (secure mode).
  bwrapArgs.push('--proc', '/proc')
} else {
  // --bind /proc /proc: apply-seccomp's nested-userns path writes
  // /proc/self/setgroups and uid_map.
  bwrapArgs.push('--bind', '/proc', '/proc')
}
```

来源：[`test/sandbox/wrap-with-sandbox.test.ts#L262-L296 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/wrap-with-sandbox.test.ts#L262-L296)

```ts
'weaker branch passes --unshare-user and drops capabilities too',
async () => {
  const result = await wrapCommandWithSandboxLinux({
    command,
    needsNetworkRestriction: false,
    readConfig: { denyOnly: [] },
    writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
    enableWeakerNestedSandbox: true,
  })

  expect(result).toContain('--unshare-user')
  expect(result).toContain('--cap-drop ALL')
  expect(result).toContain('--bind /proc /proc')
```

主张：runtime 自己对“没有 helper”只产生 warning；这就是 Jai 必须在宿主侧决定是否 fail closed 的边界。

来源：[`src/sandbox/linux-sandbox-utils.ts#L1050-L1088 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L1050-L1088)

```ts
if (
  !seccompConfig?.argv0 &&
  getApplySeccompBinaryPath(seccompConfig?.applyPath) === null
) {
  warnings.push('seccomp not available - unix socket access not restricted')
}

const uid0Error = uid0SandboxError({
  euid: process.geteuid?.(),
  hasSetfcap: processHasBoundingCapability(CAP_SETFCAP),
  bwrap: usableBwrap,
})
if (uid0Error !== null) errors.push(uid0Error)
```

主张：CLI 有 `--control-fd` 的 runtime update 通道，但 Jia 当前 invocation 不传该参数；即使传了，config update 是 updateConfig，不会重新编译已经启动的 filesystem/bwrap profile。

来源：[`src/cli.ts#L412-L450 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/cli.ts#L412-L450)

```ts
// Initialize sandbox with config
logForDebugging('Initializing sandbox...')
await SandboxManager.initialize(runtimeConfig)

// Read config updates only now. The stream has been waiting
// unread, so nothing the caller wrote meanwhile is lost, and an
// update applied before initialize() would have been overwritten
// by it.
let controlReader: readline.Interface | null = null
if (controlStream !== undefined) {
  controlReader = readline.createInterface({
    input: controlStream,
    crlfDelay: Infinity,
  })
```

## 5. Jai 当前配置与执行路径（工作树证据）

下列是**当前未提交工作树**事实，基线为 `jai-mono` `HEAD` [`bdf7d81c095db2928cfaea0c20d0cfae143e41a2`](https://github.com/jiahao-jayden/jai-mono/tree/bdf7d81c095db2928cfaea0c20d0cfae143e41a2)。`sandbox-environment.ts` 尚未纳入该 SHA，故没有可用的上游行号 permalink；不得误引用基线中不存在的文件。

主张：工作树将依赖精确钉在 `0.0.77`；本机 `node_modules/@anthropic-ai/sandbox-runtime` 不存在，但 Bun cache 有 `@anthropic-ai/sandbox-runtime@0.0.77@@@1`，其 package metadata 指向 `anthropics/sandbox-runtime`。

本地来源：[`packages/agent/package.json:14-20`](../../../packages/agent/package.json)

```json
"dependencies": {
  "@anthropic-ai/sandbox-runtime": "0.0.77",
  "@jai/ai": "workspace:*",
  "@sinclair/typebox": "catalog:",
  "better-result": "^3.0.0"
},
```

主张：每一条 Shell call 建立临时 setting、起一个新的 Node CLI；这避免复用 runtime module-global manager state，也意味着 package 的 CLI settings 路径才是实际 configuration boundary。

本地来源：[`packages/agent/src/harness/node/sandbox-environment.ts:18-80`](../../../packages/agent/src/harness/node/sandbox-environment.ts)

```ts
/**
 * Runs every Shell call in a separate sandbox-runtime CLI process. The CLI owns
 * one SandboxManager instance, so two calls can never share its module-global
 * policy, proxy, credentials, or cleanup state.
 */
…
const settingsPath = join(directory, "settings.json");
const settings = sandboxSettings(policy, settingsPath);
await writeFile(settingsPath, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
return await executeSandboxProcess(command, { ...options, signal }, settingsPath, policy.environment);
```

主张：当前 Jai 的 JSON 只投影 `allowedDomains`、strict allowlist、read/write paths；没有把 `allowAllUnixSockets` 或 `enableWeakerNestedSandbox` 放入配置，所以不会无意中降级 socket protection，也不能用既有 config 消除 Ubuntu helper 失败。

本地来源：[`packages/agent/src/harness/node/sandbox-environment.ts:66-80`](../../../packages/agent/src/harness/node/sandbox-environment.ts)

```ts
return {
  network: {
    allowedDomains: [...policy.allowedDomains],
    deniedDomains: [],
    strictAllowlist: true,
  },
  filesystem: {
    denyRead: [...policy.deniedReadPaths, settingsPath],
    allowWrite: [...policy.writableRoots],
    denyWrite: [...policy.deniedWritePaths, settingsPath],
  },
};
```

主张：Jai 显式将 seccomp/Unix socket warnings 视为不可用，而不是采用 library 的 warning-only fallback；这是正确的强制后端语义。

本地来源：[`packages/agent/src/harness/node/sandbox-environment.ts:84-94`](../../../packages/agent/src/harness/node/sandbox-environment.ts)

```ts
const dependencies = await SandboxManager.checkDependenciesAsync();
const unsafeWarnings = dependencies.warnings.filter((warning) => /seccomp|unix socket/i.test(warning));
if (dependencies.errors.length > 0 || unsafeWarnings.length > 0) {
  throw shellError("sandbox_unavailable", "Sandbox dependencies are unavailable");
}
```

主张：Jai spawn 的是 `node <runtime>/cli.js --settings <temp> -c <command>`，未使用 library `wrapWithSandbox` 直接调用，也未传 CLI `--control-fd`。

本地来源：[`packages/agent/src/harness/node/sandbox-environment.ts:99-110`](../../../packages/agent/src/harness/node/sandbox-environment.ts)

```ts
const child = spawn(process.execPath, [sandboxCliPath, "--settings", settingsPath, "-c", command], {
  cwd: options.cwd,
  detached: process.platform !== "win32",
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
});
```

主张：Coding Agent 仅在 `localFileAccess` 时构造 sandboxed environment；权限 policy compiler 固定把 `allowedDomains` 设为空，因而当前产品路径是 network deny，不是 domain-permission UI。

本地来源：[`packages/coding-agent/src/runtime/create-coding-agent.ts:375-411`](../../../packages/coding-agent/src/runtime/create-coding-agent.ts)

```ts
const toolEnvironment = options.executionContext.localFileAccess
  ? new SandboxedNodeExecutionEnvironment({
      cwd: options.executionContext.cwd,
      shellPath: options.tools?.shell,
    })
  : undefined;
…
executionPolicy: {
  scope: toolEnvironment,
  compile: () =>
    compileExecutionPolicy({
      workspaceRoot: canonicalWorkspaceRoot(permissionWorkspaceRoot) ?? permissionWorkspaceRoot,
```

本地来源：[`packages/coding-agent/src/permissions/execution-policy.ts:44-58`](../../../packages/coding-agent/src/permissions/execution-policy.ts)

```ts
return Result.ok(
  Object.freeze({
    version: input.version,
    workspaceRoot,
    readableRoots: Object.freeze(readableRoots),
    writableRoots: Object.freeze(writableRoots),
    deniedReadPaths: Object.freeze(unique([...read.value.denied, ...protectedPaths])),
    deniedWritePaths: Object.freeze(unique([...write.value.denied, ...protectedPaths])),
    // Network is a distinct capability. process.exec never grants it implicitly.
    allowedDomains: Object.freeze([]),
    environment: Object.freeze({ ...input.environment }),
  }),
);
```

## 6. 包缓存、发布物与依赖事实

主张：本机 package resolution 的可验证状态是“Bun cache 有 0.0.77，workspace `node_modules` 没有可见 package 目录”。cache 中的 `vendor/seccomp/build.ts` 与 `dist/*.d.ts` 声称预构建 binary 布局，但本机 cache 条目中没有 `vendor/seccomp/{arm64,x64}/apply-seccomp` 文件；这不是 npm 发布物在 Ubuntu 是否含 binary 的结论，只是当前 Bun cache 的事实。目标 Linux VM 必须先验证 `SandboxManager.checkDependenciesAsync()`。

原样诊断输出：

```text
$ ls -ld node_modules/@anthropic-ai/sandbox-runtime node_modules/.cache
ls: node_modules/.cache: No such file or directory
ls: node_modules/@anthropic-ai/sandbox-runtime: No such file or directory

$ Glob ~/.bun/install/cache/@anthropic-ai/sandbox-runtime@0.0.77@@@1 vendor/seccomp/**/*
vendor/seccomp/build.ts

$ Glob ~/.bun/install/cache/@anthropic-ai/sandbox-runtime@0.0.77@@@1 **/*apply*
(no files)
```

来源：[`src/sandbox/generate-seccomp-filter.ts#L280-L319 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/generate-seccomp-filter.ts#L280-L319)

```ts
for (const binaryPath of getLocalSeccompPaths('apply-seccomp')) {
  if (fs.existsSync(binaryPath)) {
    logForDebugging(
      `[SeccompFilter] Found apply-seccomp binary: ${binaryPath} (${arch})`,
    )
    return binaryPath
  }
}

return undefined
…
logForDebugging(
  `[SeccompFilter] apply-seccomp binary not found in any expected location (${arch})`,
)
return null
```

## 7. 实际运行与未实测边界

### 已运行（只读、无产品代码/依赖/lockfile 改动）

```text
$ bun test packages/agent/test/harness/node/sandbox-environment.test.ts
5 pass
0 fail
17 expect() calls
Ran 5 tests across 1 file. [2.31s]
```

该测试包含“默认阻止 IPv4、IPv6、UDP 与 Unix socket”断言，证明当前 macOS adapter 路径在本机运行。

本地来源：[`packages/agent/test/harness/node/sandbox-environment.test.ts:114-151`](../../../packages/agent/test/harness/node/sandbox-environment.test.ts)

```ts
test("blocks direct IPv4, IPv6, UDP and Unix-socket traffic by default", async () => {
  const workspace = await temporaryDirectory("jai-sandbox-network-");
  const environment = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
  const policy = createPolicy(workspace);
  …
  const socketPath = join(workspace, "network.sock");
  const unixSocket = createSocketServer((socket) => socket.end("unexpected"));
  …
  expect(
    (
      await run(
        `node -e ${shellLiteral(`require("node:net").createConnection(${JSON.stringify(socketPath)}).on("connect", () => process.exit(0)).on("error", () => process.exit(1));`)}`,
```

```text
$ bun test test/sandbox/linux-dependency-error.test.ts test/sandbox/pid-namespace-isolation.test.ts
32 pass
21 skip
0 fail
68 expect() calls
Ran 53 tests across 2 files. [18.00ms]
```

上游的 dependency/config unit tests 在 macOS 可运行；`pid-namespace-isolation` 以 `describe.if(isLinux)` 跳过，故没有声称它在 Linux 成功。

来源：[`test/sandbox/pid-namespace-isolation.test.ts#L40-L60 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/test/sandbox/pid-namespace-isolation.test.ts#L40-L60)

```ts
describe.if(isLinux)('apply-seccomp PID namespace isolation', () => {
  beforeAll(() => {
    applySeccomp = getApplySeccompBinaryPath()
    // On Linux CI with the vendor binary present this always resolves.
    // If null, every test below would silently no-op — fail here.
    expect(applySeccomp).toBeTruthy()
    expect(existsSync(applySeccomp!)).toBe(true)
  })

  it('runs the command as PID 2 under an apply-seccomp init (PID 1)', () => {
    const r = runApplySeccomp([
```

### 明确未实测

```text
$ uname -a
Darwin jayden-server.local 25.0.0 Darwin Kernel Version: ... RELEASE_ARM64_T8132 arm64
$ command -v bwrap
(no output)
$ command -v socat
(no output)
$ sw_vers
ProductName: macOS
ProductVersion: 26.0.1
```

不能在此 Darwin 主机复现：Ubuntu kernel user namespace、AppArmor profile、`bwrap`、`socat`、Linux arm64 ELF `apply-seccomp` 均不在本机可执行环境内。若直接运行 helper，路径也不存在（源码 clone 不提交生成 binary）：`(eval):1: no such file or directory: ./vendor/seccomp/arm64/apply-seccomp`。

建议在**目标 Ubuntu 26 ARM64 普通用户 VM**运行的最小验证命令（不会修改系统策略）：

```bash
set -euxo pipefail
uname -a
id
command -v bwrap socat
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true
aa-status 2>/dev/null || true
bwrap --unshare-user --dev-bind / / true
node - <<'NODE'
const { SandboxManager } = require("@anthropic-ai/sandbox-runtime")
SandboxManager.checkDependenciesAsync().then(console.log, console.error)
NODE
```

然后用当前 Jai 的现有测试做真实 end-to-end：

```bash
bun test packages/agent/test/harness/node/sandbox-environment.test.ts
```

若出现 helper 的 nested-userns 症状，收集**原样** stderr（特别是 `unshare(CLONE_NEWUSER)`、`setgroups`、`uid_map`、`gid_map`）以及上列 `aa-status`/sysctl 输出，再选择方案；不要先关闭全局 AppArmor/sysctl。

## 8. 三种方案及反方条件

| 方案 | 最小动作 | 保留的安全性质 | 反方条件 / 何时拒绝 |
| --- | --- | --- | --- |
| A. 最小 Bun package patch（保留 socket blocking） | 用 `bun patch @anthropic-ai/sandbox-runtime` 修改 `apply-seccomp.c`：在 nested userns 无法取得 capability 时，显式选择一个**命名的降级行为**，随后为 Linux ARM64 重建并随 patch 发布 helper binary。 | 可保留 BPF 的 AF_UNIX 拒绝，取决于降级实现。 | 不是一行 JS patch：产物是 native C binary；若不保留 nested PID/mount isolation，unfiltered outer shell/socat 与 payload 的隔离模型会变弱。`--cap-add CAP_SYS_ADMIN` 不是 Ubuntu AppArmor 可靠修复，且 runtime 源码说 sandbox 通常只留 `CAP_SETFCAP`。除非补 Ubuntu ARM64 E2E、安全回归及二进制供应链维护，否则不推荐。 |
| B. 已有配置/执行路径 | 在临时 runtime settings 写 `network.allowAllUnixSockets: true`，跳过 helper；仍走 outer bwrap filesystem、PID/user/network namespace。可再对 `/run` 做 read deny 的**额外**路径隐藏。 | 保留 outer bwrap 的 filesystem/network isolation；运行时不再因 helper nested userns abort。 | 公开语义是“allow all Unix sockets”，不是仅容许某路径。`/run` deny 无法覆盖 abstract socket、已继承 fd、SCM_RIGHTS、别名/遗漏路径；现有 Jai 不暴露此开关。只有 threat model 明确接受此降级且目标 VM 有验证测试时可采用。 |
| C. 替代 Unix socket 控制机制 | 将命令放进不共享 host `/run`/agent socket 的 VM 或单用途 sandbox host，仅注入必要的 HTTP/TCP sidecar capability；以 VM 边界而不是进程内 seccomp 路径筛 socket。 | 能把 host Unix socket 命名空间从 payload 可见范围移除，避免依赖 helper nested userns。 | 不是本地最小改动，需要 host 生命周期、文件传输、网络审计、性能与开发体验设计；若必须直接操作宿主 Docker/SSH agent/socket，此方案不满足需求。`--unshare-net` 本身只隔离网络 namespace，不能替代对 bind-mounted pathname Unix socket 的安全分析。 |

### A. 为什么“加 `CAP_SYS_ADMIN`”不应成为题设 VM 的默认 patch

主张：当前上游 cap argument 对 root + helper 最多主动保留 `CAP_SETFCAP`，并注释说明这是 nested userns map uid 0 的要求；它没有在 normal-user Ubuntu 情况下添加 `CAP_SYS_ADMIN`。更关键的是 #429 报告的 LSM child profile 语义会拒绝 capability，即使 capability set 表面包含该 bit。

来源：[`src/sandbox/linux-sandbox-utils.ts#L549-L579 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L549-L579)

```ts
 * The bwrap capability list. Always `--cap-drop ALL`, which for a non-root
 * caller is bwrap's default anyway. `--cap-add CAP_SETFCAP` for the whole
 * bwrap invocation — the outer shell and the two socat relays hold it too —
 * when the caller is uid 0, the seccomp helper is in use and the capability
 * survives into bwrap: the helper's nested user namespace maps uid 0, which
 * Linux 5.12 and the distribution kernels that backported it allow only from
 * a creator holding CAP_SETFCAP.
…
export function capabilityArgs({
  euid,
  hasSetfcap,
  usesSeccompHelper,
```

### B. 已有路径的最低风险补偿和上限

主张：使用 `allowAllUnixSockets` 后，filesystem deny `/run` 可以隐藏一部分 pathname socket，但这只是 community report 的 host-specific workaround，不能取代 seccomp。该 issue 作者明确列出 abstract socket、inherited descriptor 与 alias 等不覆盖项。

来源：[`anthropics/sandbox-runtime#429` 的 2026-08-09 评论](https://github.com/anthropics/sandbox-runtime/issues/429#issuecomment-5230394169)（用户测量；非维护者结论）

> `This is a host-specific path-hiding configuration, not restored Unix-socket filtering.`
>
> `That does not cover:`
>
> `- abstract-namespace sockets, if network isolation is ever absent or shared`
>
> `- already-open or inherited descriptors — pathname masking does not revoke an existing open file description`
>
> `- a descriptor received via SCM_RIGHTS over any socket that remains reachable`
>
> `- a bind-mount or hard-link alias resolving to the same socket inode from outside the denied trees`

**待验证：** 上述 comment permalink 的 ID 来自本轮 GitHub API comment 查询；如果 GitHub 重写/折叠 comment，应以 #429 完整讨论中的同日期 `snowgameschool` 原文为准。该材料只说明一个 Ubuntu 24.04 host 的路径隐藏测量，不证明 Ubuntu 26 或本项目的覆盖率。

### C. 为什么 VM/sidecar 是另一类控制，而不是“把 bwrap 参数换一个”

主张：上游 Linux 自己将 networking 设计为 outer network namespace + host proxy Unix socket bridge；这证实 proxy socket 是一条显式、被 bind 的 capability。因此若采用替代机制，最干净的分界是完全不把 host socket bind 入 payload 所在 VM/host，而不是在 guest 内尝试猜测 host socket 路径。

来源：[`README.md#L119-L130 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L119-L130)

```md
**Network Isolation** (allow-only pattern): By default, all network access is denied. You must explicitly allow domains. An empty allowedDomains list means no network access. Network traffic is routed through proxy servers running on the host:

- **Linux**: Requests are routed via the filesystem over a Unix domain socket. The network namespace of the sandboxed process is removed entirely, so all network traffic must go through the proxies running on the host (listening on Unix sockets that are bind-mounted into the sandbox)

- **macOS**: The Seatbelt profile allows communication only to a specific localhost port. The proxies listen on this port, creating a controlled channel for all network access

- **Windows**: A machine-wide WFP filter set blocks all outbound connections originating from the `srt-sandbox` account except loopback to the proxy port range.
```

## 来源覆盖

| 来源类别 | 查到了什么 |
| --- | --- |
| 官方文档 / 源码 | 固定 `v0.0.77` / `6fa7313` 的 README、Linux wrapper、config schema、CLI、C helper、tests；确认 x64/arm64、socket语义、bwrap/userns/helper 调用链。 |
| 作者或维护者本人的说法 | README 是项目公开维护文档，明确 Ubuntu 24.04+ AppArmor note；未找到 #429/#498 中可确认的维护者回复，因此没有把 issue 作者说法当作维护者承诺。 |
| 同类方案 | (1) bwrap mount/network namespace：上游 README/Linux source 已证明其 network bridge 模型；(2) “路径隐藏 `/run`”作为不等价的 community workaround，见 #429；它们都不能替代 helper 的 AF_UNIX syscall 过滤，故只作为方案 C 的边界/反例。 |
| issue / PR / 社区实践 | 查询了 #74、#214、#417、#428、#429、#498 及 PR #418、#534。#429 是 Ubuntu AppArmor 实例；#498 是 capability-bounding/nested-userns 另一故障类；#534 已合入 v0.0.77，但只处理 root 缺 CAP_SETFCAP 的 startup refusal，不修 normal-user AppArmor。 |
| 历史演变 | v0.0.77 tag 为 2026-09-18；PR #534 于 2026-09-17 merge，tag 包含其 root/CAP_SETFCAP 检查。未发现已合并 PR 宣称解决 #429 的 ordinary-user AppArmor/helper nested-userns 失败。 |

## 对本项目的影响

1. 当前 adapter 的 fail-closed 检查应保留；它比 runtime 的 warning-only 行为更符合“OS enforced Shell”语义。
2. 不要把 `enableWeakerNestedSandbox` 当作 Ubuntu 26 repair flag，也不要把 Linux 的 `allowUnixSockets` 宣传成精确 socket capability。
3. 若产品接受 Unix socket access 的降级，应把它命名为明确 policy capability（例如 `allowAllUnixSockets`），同时在 UI/DTO 层显示为**降低 Linux local-IPC isolation**；默认不能静默开启。
4. 若产品不接受降级，在 Ubuntu 26 ARM64 normal-user VM 上检测到该 helper error 时应返回 `shell.sandbox_unavailable`，并附目标 VM 所需的诊断（bwrap/socat/helper presence、AppArmor、sysctl、stderr）；不要以 unsandboxed shell fallback。
5. **建议的最小下一步不是改代码：** 在真实 Ubuntu 26 ARM64 VM 跑第 7 节命令和现有 adapter test；只在得到 exact errno/LSM evidence 后决定 B（明确降级）还是 C（执行边界迁移）。方案 A 是维护 native fork 的安全决策，不能作为临时 Bun/TypeScript 热修。

### 待验证清单

- Ubuntu 26 ARM64 是否默认启用与 Ubuntu 24.04 同等的 AppArmor userns restriction，以及 `bwrap-userns-restrict` child profile 的具体内容。
- npm/Bun 在目标 Linux ARM64 的实际 installed package 是否带 `vendor/seccomp/arm64/apply-seccomp`；本机 Bun cache 的缺失不能外推。
- 目标 VM 上 `SandboxManager.checkDependenciesAsync()` 是否会报告 warning/error；Jai 会拒绝 warning，因此该输出决定是否能 spawn。
- #429 discussion 的社区 workaround 是否在该 VM 的 `/run` topology 下仍能运行；它不是安全等价物，且不应在未测情况下发布。
