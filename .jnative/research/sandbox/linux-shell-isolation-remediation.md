# Linux Shell 执行隔离：Ubuntu ARM64 的可维护修复方案

核验日期：2026-09-21。目标依赖固定为 `@anthropic-ai/sandbox-runtime@0.0.77`，上游 tag `v0.0.77` 固定到 commit [`6fa731368807419ee157f9a3fac955fefe1019c6`](https://github.com/anthropics/sandbox-runtime/commit/6fa731368807419ee157f9a3fac955fefe1019c6)；Bubblewrap 固定到 [`v0.11.0 / 9ca3b05ec787acfb4b17bed37db5719fa777834f`](https://github.com/containers/bubblewrap/tree/9ca3b05ec787acfb4b17bed37db5719fa777834f)。固定版本避免后续上游改动混入判断。目标 Ubuntu 26 ARM64 VM 不在本次执行环境中，所有该平台结论均标明为待实测。

## 结论

1. **推荐方案是对 SRT 做一个有边界的 Bun patch：把 `apply-seccomp` 从“在 bwrap 内再建 user/PID/mount namespace”的 helper，改为“复用外层 bwrap 的唯一 user namespace 的 bootstrap/supervisor”。** bootstrap 在受限 workload 前建立 bridge、固定自身为不可 ptrace、安装 AF_UNIX seccomp 过滤（以及需要时的 user-notify listener），再 exec Shell；不再调用第二次 `CLONE_NEWUSER`。这保留 bwrap filesystem/network 与 Unix socket 三项验收，且不需要特权运行。现有 helper 明确把 nested userns 失败设为退出条件，故必须是 native helper + ARM64 发布物的受控 patch，不能是假装的 TypeScript 开关。[`apply-seccomp.c#L684-L755`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L684-L755)
2. **库的既有配置/CLI 路径没有合规修复。** `enableWeakerNestedSandbox` 只替换 `/proc` mount；`allowUnixSockets` 在 Linux 被忽略；唯一能避开 helper 的 `allowAllUnixSockets` 会关闭 Unix socket 拦截。当前 Jai 也只经临时 settings 启动 CLI，未暴露 `seccomp.applyPath`，因此不能靠配置恢复完整隔离。[`sandbox-config.ts#L757-L767`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L757-L767)
3. **Landlock 是可选的第二层，不是 Unix socket 拦截的替代品。** ABI 9 可以限制到域外 pathname UDS 的 `connect()` / 带目标 `sendmsg()`，ABI 6 可以限制 abstract UDS；它不覆盖已连接、继承或经 `SCM_RIGHTS` 获得的 FD。因此它只能和保留的 seccomp 组合，不能单独替换 SRT helper。[`landlock.h#L326-L342`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/include/uapi/linux/landlock.h#L326-L342)
4. **若外层 bwrap 的第一次 user namespace 也被目标 VM 拒绝，则用户限定条件下没有可靠的纯用户态修复，应 fail closed。** Ubuntu 的 AppArmor 限制需要为特定启动器配置最小 `userns` 权限；这是一项 VM 部署前置，不是让 Shell 以特权运行，也不能用 Docker-only fallback 掩盖。[Ubuntu Security Features](https://wiki.ubuntu.com/Security/Features/)

## 失败根因与不能用的“开关”

SRT 的外层 bwrap 已负责 filesystem mount table、`--unshare-net` 与首层 user namespace；网络 bridge 在 payload 被 seccomp 前建立。`apply-seccomp` 额外建立 user/PID/mount namespace，是为了使 payload 看不见、不能 ptrace 外层未过滤的 shell/socat。

主张：helper 先尝试带 `CAP_SYS_ADMIN` 的 PID/mount unshare；在普通 SRT sandbox 中没有该 capability 时，改建 nested userns 并写 map。其源码将 Ubuntu AppArmor capability restriction 列为会 abort 的条件。

来源：[`apply-seccomp.c#L684-L755 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L684-L755)

```c
 * (a) We already hold CAP_SYS_ADMIN in this user namespace. Just
 *     unshare directly. Under the sandbox we never do — bwrap is
 *     given --cap-drop ALL and at most --cap-add CAP_SETFCAP —
 * (b) We don't have the cap. Create a nested user namespace to get it,
 *     map uid/gid, then unshare.
…
if (unshare(CLONE_NEWUSER) < 0) {
    die("apply-seccomp: unshare(CLONE_NEWUSER)");
}
if (write_file("/proc/self/setgroups", "deny") < 0) {
    die("apply-seccomp: write /proc/self/setgroups …");
}
```

主张：`enableWeakerNestedSandbox` 仍保留 `--unshare-user` 和 capability drop；它只是在 `/proc` fresh mount 与 bind mount 间切换，不能影响上述 helper 内的第二次 `CLONE_NEWUSER`。

来源：[`linux-sandbox-utils.ts#L3270-L3292 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3270-L3292)

```ts
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

主张：在 Linux，精确 Unix socket path allowlist 不存在；`allowAllUnixSockets` 的公开语义是禁用 seccomp blocking。因此它不符合本题的 Unix socket 验收。

来源：[`sandbox-config.ts#L757-L767 @ 6fa7313`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/sandbox-config.ts#L757-L767)

```ts
allowUnixSockets: z
  .array(z.string())
  .optional()
  .describe('macOS only: Unix socket paths to allow. Ignored on Linux …'),
allowAllUnixSockets: z
  .boolean()
  .optional()
  .describe('If true, allow all Unix sockets (disables blocking on both platforms).'),
```

## 方案矩阵

| 方案 | 安全属性 | 普通用户可跑 | 维护成本 | filesystem / network / Unix socket 验收 | 反方条件 |
|---|---|---|---|---|---|
| A. 推荐：Bun patch 为单层 bootstrap | 保留 outer bwrap mount、`--unshare-net` 和 payload 前 AF_UNIX seccomp；bootstrap/supervisor 必须不可 ptrace，避免未过滤 bridge 被 payload 篡改 | 是，前提是外层 bwrap 首层 userns 成功、seccomp 可用 | 中高：C 源码、x64/arm64 预编译物、上游升级 rebase 与 hash/测试 | 全部保留 | 若外层 userns、seccomp、bootstrap 或任一 bridge 失败，拒绝 spawn；不得退回裸 Shell |
| B. 现有 SRT 配置 / CLI | 外层 filesystem/network 仍在；`allowAllUnixSockets` 会失去 UDS 边界 | 技术上可跑，但不合规 | 低 | filesystem ✓ / network ✓ / Unix socket ✗ | 仅在产品明确允许“全部 Unix socket”时成立；本题明确排除 |
| C. Landlock ABI ≥9 + 保留 seccomp | pathname / abstract UDS 多一层内核裁决；不能处理 inherited、connected 或 `SCM_RIGHTS` FD | 条件成立：ABI 运行时探测通过，且仍有 A 的 seccomp | 中高：ABI 分支、FD 生命周期与测试 | filesystem/network 继续由 bwrap；Unix socket 仅在与 seccomp 组合后 ✓ | 不能把 Landlock 单独当替代；ABI <9、Landlock disabled 或 FD 逃逸测试失败则拒绝 |
| D. bwrap `--seccomp` 静态 BPF | 可装静态 BPF，但没有 `NEW_LISTENER`，也会过早约束用于 proxy bridge 的进程 | 取决于重构 bridge | 高 | 现有 SRT 拓扑下 network bridge 与 Unix socket 过滤冲突 | 不是当前 wiring 的最小修复；不推荐作为热修 |

主张：bwrap 的 `--seccomp` 只以 `PR_SET_SECCOMP` 装载静态 BPF；它不是 user-notify listener 集成点。若直接套到当前目标 shell，会同时约束启动 sandbox-side `socat` bridge 的过程。

来源：[`bubblewrap.c#L283-L300 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L283-L300)

```c
for (program = seccomp_programs; program != NULL; program = program->next)
  {
    if (prctl (PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program->program) != 0)
      {
        if (errno == EINVAL)
          die ("Unable to set up system call filtering as requested …");
```

主张：Landlock ABI 9 的 pathname 规则只限制连接到 Landlock domain 外创建的 Unix server socket；不是“一切 Unix socket/FD”的覆盖。

来源：[`landlock.h#L326-L342 @ 93f5157`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/include/uapi/linux/landlock.h#L326-L342)

```c
 * LANDLOCK_ACCESS_FS_RESOLVE_UNIX: Look up pathname UNIX domain sockets.
 * On UNIX domain sockets, this restricts both calls to connect(2) as well
 * as calls to sendmsg(2) with an explicit recipient address.
 *
 * This access right applies only to connections to UNIX server sockets which
 * were created outside of the newly created Landlock domain.
```

## 推荐方案：单层 bootstrap Bun patch

推荐 A，不建议把 B 当成修复，也不建议将 C 独立上线。

最小的实现边界是只改 `@anthropic-ai/sandbox-runtime` 的 Linux vendor helper 与 wrapper 组装，而不改 Jai 的权限语义：

1. 外层 bwrap 仍是唯一创建 `user`、`pid`、`mount`、`net` namespace 的启动器；保留当前文件 mount 与 domain proxy bridge。
2. 新 helper bootstrap 在同一 sandbox 内先启动必要的 `socat` bridge，并在启动前令 supervisor 及其 bridge 后代不可 dump/ptrace；不要在 workload 路径中再次调用 `unshare(CLONE_NEWUSER)`。
3. bootstrap 在 exec payload 前以 `PR_SET_NO_NEW_PRIVS` 安装现有 AF_UNIX BPF。若继续保留 SRT 的 user-notify 观测，listener 必须由受约束 workload 的 exec 前启动器安装，并经一个预建、继承的 control socket 交给最小 supervisor；不能把 listener FD “补装”到已经运行的 Shell。
4. 保留 Jai 当前将 `seccomp|unix socket` warning 视为 `sandbox_unavailable` 的 fail-closed 行为；新增 helper 只要缺 ARM64 二进制、BPF、bridge 或 self-check，均不得启动 command。

主张：listener FD 属于一个特定 filter；它可以经 `SCM_RIGHTS` 传递，但传 FD 不会让既有、未受 filter 的 task 开始被拦截。

来源：[`seccomp_filter.rst#L194-L211 @ 93f5157`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/seccomp_filter.rst#L194-L211)

```rst
To acquire a notification FD, use the
SECCOMP_FILTER_FLAG_NEW_LISTENER argument to the seccomp() syscall.
…
which can then be passed around via SCM_RIGHTS or similar. Note that filter
fds correspond to a particular filter, and not a particular task.
```

这不是“删掉 nested namespace 的一行 patch”：原 helper 使用该 namespace 隔开 unfiltered outer shell/socat，故删掉它却不加入 bootstrap/supervisor 保护会降低抗篡改性。Bun patch 需要同时包含 C 源、Linux ARM64 与 x64 helper 产物，以及固定的构建 hash；不能依赖目标 VM 在安装时临时编译。

同类实现支持这一分层方向：Codex 在 managed-proxy 模式中先建立 bridge，再对用户命令拒绝可外连的 `socket(AF_UNIX)`，并保留匿名 `socketpair(AF_UNIX)` 作为进程内 IPC。Jai 可先继续拒绝全部 AF_UNIX；是否窄放 `socketpair` 必须由产品兼容测试决定，而不是打开总开关。

来源：[`managed_proxy.rs#L665-L707 @ a866315`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/tests/suite/managed_proxy.rs#L665-L707)

```rust
async fn managed_proxy_mode_denies_af_unix_socket_but_allows_socketpair() {
    …
    "import socket,sys\ntry:\n    socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
except PermissionError:\n    pass
…
left,right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
left.sendall(b'ok')
```

## 最小验证步骤与失败条件

先在目标 Ubuntu 26 ARM64 普通用户 VM 做一次只读 capability probe；不要修改 AppArmor/sysctl：

```bash
set -euxo pipefail
uname -srmo
id
command -v bwrap socat
cat /proc/sys/user/max_user_namespaces
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>&1 || true
cat /proc/self/attr/current 2>&1 || true
cat /sys/kernel/security/lsm 2>&1 || true
cat /proc/sys/kernel/seccomp/actions_avail 2>&1 || true
bwrap --unshare-user --dev-bind / / true
```

若该命令成功，构建并校验 patch 的 `apply-seccomp` ARM64 ELF 后运行：

```bash
file node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/arm64/apply-seccomp
sha256sum node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/arm64/apply-seccomp
bun test packages/agent/test/harness/node/sandbox-environment.test.ts
```

在同一 VM 增补四个 E2E 断言：payload 不能读/写 deny path；不能直连 IPv4、IPv6、UDP；不能创建 pathname 与 abstract `AF_UNIX` socket；不能 ptrace 或写入 bootstrap/bridge 的 `/proc/<pid>/mem`。如产品需要匿名子进程 IPC，另测 `socketpair(AF_UNIX)` 并把它作为单独 policy 决策。

以下任一情况是 **失败条件**，必须返回 `shell.sandbox_unavailable` 并停止，不得降级：

- 第一次 `bwrap --unshare-user` 失败，或 AppArmor/namespace limit 阻止唯一外层 namespace；
- helper 仍尝试第二次 `CLONE_NEWUSER`，或 bootstrap、BPF、user-notify/bridge 任一步失败；
- ARM64 helper 不是预期架构、hash 不匹配，或 runtime dependency check 报出 seccomp/Unix socket warning；
- 任一 filesystem、network、pathname/abstract UDS、ptrace/proc-memory E2E 断言失败；
- Landlock 被启用但 ABI <9 时仍被当作 pathname UDS 的完整控制。

主张：Ubuntu 24.04 起默认启用 AppArmor 的非特权 user namespace 限制；需要 user namespace 的应用应由 profile 显式授予 `userns`，而不是由普通用户关闭全局开关。Ubuntu 26 image 是否沿用该默认值仍须通过上面的 probe 实测。

来源：[Ubuntu Security Features](https://wiki.ubuntu.com/Security/Features/)（访问于 2026-09-21）与 [AppArmor userns restriction](https://gitlab.com/apparmor/apparmor/-/wikis/unprivileged_userns_restriction?version_id=b8c4521cbcdae1dcc97834773f699943957e3e98)

> Starting with Ubuntu 24.04 this is enabled by default.
>
> When restrictions on unprivileged user namespaces are enabled unconfined
> unprivileged processes are not allowed to create user namespaces.
>
> To enable them to create user namespaces the following rule should be add
> to the applications profile: `allow userns create,`

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 SRT `v0.0.77` 的 C helper、Linux wrapper/config/README；Bubblewrap `v0.11.0` seccomp/userns 源码；Linux seccomp 与 Landlock 官方文档。 |
| 作者或维护者本人的说法 | SRT README 明确记录 Ubuntu 24.04+ AppArmor 限制和 helper 所需 capability；Ubuntu 与 AppArmor 官方页面说明 userns 限制及 profile 授权。未找到 SRT #429 的可确认维护者修复承诺。 |
| 同类方案 | OpenAI Codex 的 managed-proxy integration test；Flatpak/xdg-dbus-proxy 的 bwrap + protocol broker 实现均被核查。它们均未以放开全部 UDS 作为 bridge 解法。 |
| issue / PR / 社区实践 | 查阅 SRT #429/#498、Codex #26625、Flatpak #5084；#429 仅作为受限 Ubuntu 的用户案例，未当成普遍性或维护者承诺。 |
| 历史演变 | SRT v0.0.77 已含 root/CAP_SETFCAP 检查但未见合入普通用户 AppArmor nested-userns 修复；Landlock ABI 6/9 分别增加 abstract/pathname UDS 语义。 |

## 对本项目的影响

- 维持 Jai 当前 fail-closed 行为；不要暴露 `allowAllUnixSockets` 作为隐式兼容开关。
- 首先在真实 Ubuntu 26 ARM64 上完成上述 probe 和 E2E；本机 macOS 成功不能替代 Linux 结论。
- probe 证明外层 userns 可用时，实施并评审单层 bootstrap Bun patch；若证明外层 userns 不可用，则将 VM AppArmor profile 的最小 `userns` 授权作为部署要求，仍以普通用户启动 Shell。
- Landlock 仅作为 ABI≥9 时的增强防线；它不改变本推荐对 seccomp Unix socket 强制的要求。
