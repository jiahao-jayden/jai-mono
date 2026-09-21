# Linux coding/shell sandbox 同类实现：UDS、seccomp 与非特权 bwrap 证据

核验日期：2026-09-21。源码固定为 OpenAI Codex [`a86631502d49274cb47208925c7d3dcece032029`](https://github.com/openai/codex/tree/a86631502d49274cb47208925c7d3dcece032029)、Anthropic Experimental Sandbox Runtime（下称 SRT）[`2613895baed7169918889f75219b8e6c3b8355dd`](https://github.com/anthropic-experimental/sandbox-runtime/tree/2613895baed7169918889f75219b8e6c3b8355dd)、Flatpak [`a1bcecfc6cd2e33477e8d186acac631119780d06`](https://github.com/flatpak/flatpak/tree/a1bcecfc6cd2e33477e8d186acac631119780d06)、xdg-dbus-proxy [`f0fe358bb3a864a722f348cb942f30a29aafb9b2`](https://github.com/flatpak/xdg-dbus-proxy/tree/f0fe358bb3a864a722f348cb942f30a29aafb9b2)。固定 SHA 避免 `main` 后续变动混入结论；本任务只读第一方仓库、其 GitHub PR/API 和源码测试，未改产品或依赖，未在 Linux 主机实跑。

## 结论

1. **Codex 的 managed-proxy Linux 路径证明“不要关闭 UDS 拦截”可以兼容必要 IPC：在独立网络 namespace 中仅给代理桥保留 IP socket；默认拒绝新的 `socket(AF_UNIX)`，同时允许无名、不可对外连接的 `socketpair(AF_UNIX)`。** [`landlock.rs#L232-L268`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/src/landlock.rs#L232-L268) 与 [`managed_proxy.rs#L665-L707`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/tests/suite/managed_proxy.rs#L665-L707)。
2. **Codex 把 namespace 可用性当作部署前提而非 Docker 前提：默认 bwrap 会显式 `--unshare-user`/`--unshare-pid`，受限网络再 `--unshare-net`；不能建 user namespace 的 WSL1 会拒绝要进 bwrap 的 shell。** 这不是“任何非特权 Linux 都可用”的承诺。 [`README.md#L10-L40`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/README.md#L10-L40)、[`README.md#L80-L90`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/README.md#L80-L90)。
3. **SRT 采用同一基本形状：`bwrap --unshare-net` 先完全断网，host 端以固定 filesystem UDS 把流量桥到受控 HTTP/SOCKS proxy；然后在用户命令前加 seccomp，阻止新建 `AF_UNIX` socket。** 代理桥在 seccomp 前启动，因此不需要把 UDS 拦截总开关关闭。 [`linux-sandbox-utils.ts#L1160-L1180`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L1160-L1180)、[`linux-sandbox-utils.ts#L3026-L3069`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L3026-L3069)。
4. **SRT 的 seccomp user notification 不是权限判定器，而是 best-effort 写意图观测：监听者以 `CONTINUE` 放行 syscall；其读到的路径是攻击者可控且有竞争的诊断 hint，真正强制边界仍是 bwrap mount table。** 因而不能把 USER_NOTIF 事件作为放行/拒绝网络或文件操作的依据。 [`apply-seccomp.c#L92-L110`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/vendor/seccomp-src/apply-seccomp.c#L92-L110)、[`linux-violation-monitor.ts#L61-L80`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-violation-monitor.ts#L61-L80)。
5. **SRT 当前源码不能直接作为严格 fail-closed 的 UDS 后端：缺 `apply-seccomp` 时它只记录 warning 并继续执行，明确留下“Unix socket blocking disabled”。** 若采用同类设计，上层必须把这类 capability 缺失提升为 spawn 前失败。 [`linux-sandbox-utils.ts#L1050-L1088`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L1050-L1088)、[`linux-sandbox-utils.ts#L3026-L3052`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L3026-L3052)。
6. **Flatpak/xdg-dbus-proxy 的成熟做法是分层而不是“允许所有本地 socket”：bwrap/namespace 和 seccomp 负责内核边界；仅暴露的 D-Bus UDS 被带入 filtering proxy，代理按 well-known name 的 `SEE`/`TALK`/`OWN` 过滤消息。** 这可作为“特定 UDS capability 应改成专用 broker”的证据，但不是任意 Unix socket 的路径级通用解。 [`flatpak-run.c#L400-L410`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/common/flatpak-run.c#L400-L410)、[`flatpak-proxy.c#L44-L94`](https://github.com/flatpak/xdg-dbus-proxy/blob/f0fe358bb3a864a722f348cb942f30a29aafb9b2/flatpak-proxy.c#L44-L94)。
7. **Flatpak 说明非特权 bwrap 的准确部署条件：首选 unprivileged user namespaces；内核/发行版关闭它时需要 setuid bwrap。当前代码在非特权 bwrap 时再加 `--disable-userns`，避免 sandbox 递归获得可重构 filesystem 的能力。** 因此“非特权、非 Docker”仍必须以 user namespace 可创建为必要条件，而不是尝试静默回退。 [`CONTRIBUTING.md#L80-L96`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/CONTRIBUTING.md#L80-L96)、[`flatpak-run.c#L2390-L2417`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/common/flatpak-run.c#L2390-L2417)。

## 同一维度对照

| 维度 | Codex | Anthropic SRT | Flatpak / xdg-dbus-proxy |
|---|---|---|---|
| Linux shell/coding 场景 | 一等的 CLI Linux sandbox。 | 一等的 agent command sandbox。 | 成熟 desktop-app sandbox；作为 UDS broker/namespace 的邻近实现。 |
| 受限网络 | `--unshare-net` + 内部 TCP→UDS→TCP bridge。 | `--unshare-net` + host UDS→proxy、sandbox `socat`。 | 未授予 shared network 时 `--unshare-net`。 |
| UDS 默认策略 | Proxy-routed 时拒绝 externally addressable `socket(AF_UNIX)`；保留 `socketpair`。 | `apply-seccomp` 拦新建 `socket(AF_UNIX)`；桥先启动。 | 不把所有 socket 放开；D-Bus 经过专用 filtering proxy。 |
| seccomp USER_NOTIF | 本次未找到使用 USER_NOTIF 的一手证据。 | 只作写意图观测，`CONTINUE`，不执行 policy。 | 本次未找到使用 USER_NOTIF 的一手证据；使用导出的 BPF filter。 |
| 非特权部署 | 使用 user namespace；不能创建时 WSL1 直接拒绝。 | 总是请求 `--unshare-user`；LSM 禁掉 nested userns 时 helper 可能中止。 | 首选 unprivileged userns；无此能力则官方明确需要 setuid bwrap。 |

## OpenAI Codex：精确保留匿名 IPC，拒绝外部 UDS

主张：Codex proxy-routed 模式并未用“允许全部 UDS”修复代理；它让网络 namespace 内的 IP socket 到本地 bridge 可用，另外只允许 `AF_UNIX socketpair`，而 `socket(AF_UNIX)` 只有显式危险 grant 才会进入允许集合。[`landlock.rs#L232-L268`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/src/landlock.rs#L232-L268)

```rust
// codex-rs/linux-sandbox/src/landlock.rs:232-268 @ a866315
NetworkSeccompMode::ProxyRouted => {
    // In proxy-routed mode we allow IP sockets in the isolated
    // namespace (used to reach the local TCP bridge). Standalone Unix
    // sockets require an explicit managed-policy grant; all other
    // socket families remain denied.
    …
    let deny_non_ip_socket = SeccompRule::new(denied_socket_conditions)?;
    let deny_non_unix_socketpair = SeccompRule::new(vec![SeccompCondition::new(
        0,
        SeccompCmpArgLen::Dword,
        SeccompCmpOp::Ne,
        libc::AF_UNIX as u64,
    )?])?;
    rules.insert(libc::SYS_socket, vec![deny_non_ip_socket]);
    rules.insert(libc::SYS_socketpair, vec![deny_non_unix_socketpair]);
}
```

主张：同仓库 integration test 断言 `socket(AF_UNIX)` 得到 `PermissionError`，但 `socketpair(AF_UNIX)` 可以双向传递 `ok`。这是项目测试，不是用户案例。[`managed_proxy.rs#L665-L707`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/tests/suite/managed_proxy.rs#L665-L707)

```rust
// codex-rs/linux-sandbox/tests/suite/managed_proxy.rs:665-707 @ a866315
#[tokio::test]
async fn managed_proxy_mode_denies_af_unix_socket_but_allows_socketpair() {
    …
    let output = run_linux_sandbox_direct(
        &[
            "python3",
            "-c",
            "import socket,sys\ntry:\n    socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)\nexcept PermissionError:\n    pass\nexcept OSError:\n    sys.exit(2)\nelse:\n    sys.exit(1)\nleft,right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)\nleft.sendall(b'ok')\nif right.recv(2) != b'ok':\n    sys.exit(3)\n",
        ],
        …
    )
    .await;
    assert_eq!(
        output.status.code(),
        Some(0),
        "expected AF_UNIX socket creation to be denied and socketpair to work; ..."
    );
}
```

主张：Codex 的 bwrap 模式显式隔离 user、PID，限制网络时再隔离 network；managed proxy 以 TCP→UDS→TCP bridge 到配置的 endpoint。它不是 Docker 依赖，但需要 kernel 允许 user namespace。[`README.md#L80-L90`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/README.md#L80-L90)

> - When bubblewrap is active, the helper explicitly isolates the user namespace via
>   `--unshare-user` and the PID namespace via `--unshare-pid`.
> - When bubblewrap is active and network is restricted without proxy routing, the helper also
>   isolates the network namespace via `--unshare-net`.
> - In managed proxy mode, the helper uses `--unshare-net` plus an internal
>   TCP->UDS->TCP routing bridge so tool traffic reaches only configured proxy
>   endpoints.
> - In managed proxy mode, after the bridge is live, seccomp blocks new
>   AF_UNIX/socketpair creation for the user command.

反方条件：README 明确说 WSL1 无法创建所需 user namespace 时，Codex 会拒绝走 bwrap 的 sandboxed shell；这不是可忽略的 warning。[`README.md#L10-L22`](https://github.com/openai/codex/blob/a86631502d49274cb47208925c7d3dcece032029/codex-rs/linux-sandbox/README.md#L10-L22)

> Codex also surfaces the same startup warning path when bubblewrap cannot create user namespaces.
> WSL2 follows the normal Linux bubblewrap path. WSL1 is not supported for
> bubblewrap sandboxing because it cannot create the required user namespaces,
> so Codex rejects sandboxed shell commands that would enter the bubblewrap path.

## Anthropic SRT：预先建立桥，USER_NOTIF 只做观测

主张：SRT 通过 host 上的 filesystem UDS bridge 将流量交给 host proxy，再把 socket bind-mount 到已经 `--unshare-net` 的 sandbox；这保留了 Unix socket 拦截的必要性，而非取消它。[`linux-sandbox-utils.ts#L1160-L1180`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L1160-L1180)

```ts
// src/sandbox/linux-sandbox-utils.ts:1160-1180 @ 2613895
* Linux network sandboxing uses bwrap --unshare-net which creates a completely isolated
* network namespace with NO network access. To enable network access, we:
*
* 1. Host side: Run socat bridges that listen on Unix sockets and forward to host proxy servers
*    - HTTP bridge: Unix socket -> host HTTP proxy
*    - SOCKS bridge: Unix socket -> host SOCKS5 proxy
*
* 2. Sandbox side: Bind the Unix sockets into the isolated namespace and run socat listeners
*    - HTTP listener on port 3128 -> HTTP Unix socket -> host HTTP proxy
*    - SOCKS listener on port 1080 -> SOCKS Unix socket -> host SOCKS5 proxy
*
* LIMITATION: ... domain filtering happens at the host proxy level, not the sandbox boundary.
```

主张：用户命令由 `apply-seccomp` 包装并阻止 `socket(AF_UNIX)`；监听用 socket 仅在 helper 已存在时 bind-mount。说明“受信 bridge 先创建、非信任 workload 后受限”是其执行顺序。[`linux-sandbox-utils.ts#L3026-L3069`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L3026-L3069)

```ts
// src/sandbox/linux-sandbox-utils.ts:3026-3069 @ 2613895
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
      { level: 'warn' },
    )
  }
}
if (observeSocketPath && applySeccompPrefix) {
  bwrapArgs.push('--bind', observeSocketPath, observeSocketPath)
  bwrapArgs.push('--setenv', 'SRT_OBSERVE_SOCK', observeSocketPath)
}
```

主张：SRT 的 USER_NOTIF 监听永远回 `SECCOMP_USER_NOTIF_FLAG_CONTINUE`；源码明确警告路径是 attacker-controlled/racy，bwrap mount 才是唯一 enforcement boundary。[`apply-seccomp.c#L92-L110`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/vendor/seccomp-src/apply-seccomp.c#L92-L110)

```c
/* vendor/seccomp-src/apply-seccomp.c:92-110 @ 2613895 */
 * traps write-intent filesystem syscalls to SECCOMP_RET_USER_NOTIF,
 * then ships the listener fd to the OUTER STUB over a pre-fork socketpair.
 * The outer stub is never under either filter, so it services every
 * notification with SECCOMP_USER_NOTIF_FLAG_CONTINUE — the workload's
 * behaviour is unchanged — and writes one JSON line per observed call.
 *
 * Paths are read from the workload's address space with process_vm_readv.
 * That memory is ATTACKER-CONTROLLED and racy.
 * bwrap's mount table is the only enforcement boundary; the path reported
 * here is a HINT for diagnostics and must never gate a policy decision.
 *
 * Every failure path is fail-open.
```

反方条件：SRT 将缺 seccomp helper 归为 warning，而非错误；所以它满足“继续运行”但不满足“UDS 强制控制不可降级”。另外它自己注释：无 `CAP_SYS_ADMIN` 时会尝试 nested user namespace；被 LSM 禁止时会 abort，要求调用方提供该 capability。[`linux-sandbox-utils.ts#L1050-L1088`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/src/sandbox/linux-sandbox-utils.ts#L1050-L1088)、[`apply-seccomp.c#L688-L701`](https://github.com/anthropic-experimental/sandbox-runtime/blob/2613895baed7169918889f75219b8e6c3b8355dd/vendor/seccomp-src/apply-seccomp.c#L688-L701)

> if (!seccompConfig?.argv0 &&
>     getApplySeccompBinaryPath(seccompConfig?.applyPath) === null) {
>   warnings.push('seccomp not available - unix socket access not restricted')
> }
> ...
> return { warnings, errors }

> Path (b) can itself fail on hosts where unprivileged user namespaces are gated by an LSM
> (Ubuntu 24.04's AppArmor restriction, for example) — the unshare
> succeeds but the new namespace grants no capabilities, so the setgroups
> write fails. In that case we abort: the caller must supply CAP_SYS_ADMIN.

## Flatpak / xdg-dbus-proxy：将一种 UDS 协议变成专用能力

主张：Flatpak 在未共享 network 时加 `--unshare-net`，而 xdg-dbus-proxy 在认证后可改为 filtering mode；默认只允许对 bus 本身和自身 unique id 的 TALK，其余 client 不可见。这不是“任意 UDS path allow”，而是 D-Bus 协议级 capability。[`flatpak-run.c#L400-L410`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/common/flatpak-run.c#L400-L410)、[`flatpak-proxy.c#L44-L58`](https://github.com/flatpak/xdg-dbus-proxy/blob/f0fe358bb3a864a722f348cb942f30a29aafb9b2/flatpak-proxy.c#L44-L58)

```c
/* common/flatpak-run.c:400-410 @ a1bcecf */
if ((shares & FLATPAK_CONTEXT_SHARED_NETWORK) == 0)
  {
    g_info ("Disallowing network access");
    flatpak_bwrap_add_args (bwrap, "--unshare-net", NULL);
  }
```

```c
/* flatpak-proxy.c:44-58 @ f0fe358 */
 * Once the connection is authenticated there are two modes, filtered
 * and unfiltered. In the unfiltered mode we just send all messages on
 * as we receive, but in the filtering mode we apply a policy.
 *
 * The policy for the filtering consists of a mapping from well-known
 * names to a policy that is either SEE, TALK or OWN. The default
 * initial policy is that the the user is only allowed to TALK to the
 * bus itself (org.freedesktop.DBus, or no destination specified), and
 * TALK to its own unique id. All other clients are invisible.
```

主张：Flatpak 以 seccomp BPF 给 bwrap 传 `--seccomp` fd，并在非特权 bwrap 模式额外 `--unshare-user --disable-userns`，阻止 sandbox 递归获得可重构 mount/file view 的 user namespace。[`flatpak-run.c#L2258-L2292`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/common/flatpak-run.c#L2258-L2292)、[`flatpak-run.c#L2390-L2417`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/common/flatpak-run.c#L2390-L2417)

```c
/* common/flatpak-run.c:2390-2417 @ a1bcecf */
/* Disable recursive userns for all flatpak processes, as we need this
 * to guarantee that the sandbox can't restructure the filesystem.
 * Allowing to change e.g. /.flatpak-info would allow sandbox escape
 * via portals.
 *
 * This is also done via seccomp, but here we do it using userns
 * unsharing in combination with max_user_namespaces.
 */
if (bwrap_unprivileged)
  {
    /* This is a new sandbox, so we need to disable creation of
     * nested user namespaces. */
    flatpak_bwrap_add_arg (bwrap, "--unshare-user");
    flatpak_bwrap_add_arg (bwrap, "--disable-userns");
  }
```

反方条件：Flatpak 的官方构建文档并不承诺所有 Linux 均可无特权部署；若 kernel/发行版禁用 unprivileged userns，它要求 setuid root bwrap。这与“非特权前提”不兼容，应被检测并拒绝或单独声明部署需求。[`CONTRIBUTING.md#L80-L96`](https://github.com/flatpak/flatpak/blob/a1bcecfc6cd2e33477e8d186acac631119780d06/CONTRIBUTING.md#L80-L96)

> Bubblewrap can run in two modes, either using unprivileged user
> namespaces or setuid mode. This requires that the kernel supports this,
> which some distributions disable.
>
> If unprivileged user namespaces are not available, then Bubblewrap must
> be built as setuid root.

## 维护者变更史与用户案例的界线

主张：Codex 于 2026-06-05 合并的 [`openai/codex#26625`](https://github.com/openai/codex/pull/26625)（merge commit [`d40454522e2c6216eeeca5d97d39e991791ec664`](https://github.com/openai/codex/commit/d40454522e2c6216eeeca5d97d39e991791ec664)）专门把 proxy-routed 模式由“同时拒绝 `socket` 和 `socketpair`”改为“继续拒绝外部可寻址 UDS、允许匿名 socketpair”。GitHub API 将作者标为 `CONTRIBUTOR`、无评论，且 PR 在 OpenAI 仓库内合并；它是已合入实现变更，不是外部用户受影响率的证据。

> - allow `socketpair(AF_UNIX, ...)` in the proxy-routed Linux seccomp mode
> - continue denying `socket(AF_UNIX, ...)` so user commands cannot create pathname or abstract Unix sockets
> - extend the managed-proxy integration test to verify both behaviors
>
> `NetworkSeccompMode::ProxyRouted` treated anonymous Unix socket pairs like externally
> addressable Unix sockets and returned `EPERM`. This breaks tools that use socket pairs
> for local child-process IPC even though a socket pair cannot connect outside the sandbox.

主张：Flatpak 的 [`flatpak/flatpak#5084`](https://github.com/flatpak/flatpak/pull/5084) 于 2023-03-24 合并，主提交 [`81a2ef87fb4374b051a7b1363f32374ff6b62826`](https://github.com/flatpak/flatpak/commit/81a2ef87fb4374b051a7b1363f32374ff6b62826) 明确将 `--disable-userns` 作为比既有 seccomp 限制更强的 recursive-userns 防护，并由提交者 `smcv` 说明放到共同 setup 路径。它是维护项目的设计演变，不是用户案例。

> This feature ... allows us to improve the guarantees of disallowing the sandbox to use
> recursive user namespaces (which is a security risk) compared to the
> existing limits that use seccomp.
>
> [smcv: Move this to flatpak_run_setup_base_argv() so it will apply
> equally in apply_extra_data() and `flatpak build`; make the compile-time
> check for a setuid bwrap into a runtime check]

用户案例：本轮没有将任何未验证的 issue 评论或第三方复现作为结论证据；Codex #26625 是在官方仓库合并的实现 PR，Flatpak #5084 是已合入的项目 PR。它们说明的是项目维护的设计和测试，不可外推出故障发生率或所有用户环境。

## 待验证

- Codex README 在当前 SHA 写“after the bridge is live, seccomp blocks new `AF_UNIX/socketpair` creation”，但当前 `landlock.rs` 和测试允许 `socketpair(AF_UNIX)`。更细的结论应以实现与 integration test 为准；README 这句可能已滞后，需由 Codex 维护者确认。
- 以上都是源码/测试证据，未在目标发行版以普通用户实测 `unshare(CLONE_NEWUSER)`、bwrap、seccomp 架构支持、AppArmor/SELinux、`user.max_user_namespaces` 和 socket bridge cleanup；这些是实施前 capability probe 的必测项。
- Flatpak 的 xdg-dbus-proxy 能精确过滤 D-Bus 协议，但本轮未找到其为 Docker socket、SSH agent 或任意 AF_UNIX endpoint 提供路径级策略的一手实现；不能把它泛化为一般 UDS allowlist。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 固定 SHA 的 Codex Linux sandbox README、seccomp 实现与 integration test；SRT bwrap bridge、seccomp helper、USER_NOTIF monitor；Flatpak bwrap/seccomp 与 xdg-dbus-proxy 源码。 |
| 作者或维护者本人的说法 | Flatpak PR #5084 的提交说明含 `alexlarsson` 与 `smcv` 的设计理由；Codex #26625 是合入官方仓库的实现 PR，但 GitHub API 仅标其作者为 `CONTRIBUTOR`，未擅称其为维护者。 |
| 同类方案 | Codex 与 SRT 是 Linux coding/agent shell sandbox；Flatpak/xdg-dbus-proxy 是成熟 Linux namespace + protocol-proxy 邻近实现。三者均不以“关闭全部 UDS 拦截”作为 bridge 的解法。 |
| issue / PR / 社区实践 | 查阅已合入 Codex #26625 和 Flatpak #5084；未将用户评论、表情或第三方博客作为事实。未找到足够一手的外部用户复现，故没有把社区案例写成结论。 |
| 历史演变 | Codex #26625（2026-06-05）为 socketpair 回归兼容；Flatpak #5084（2023-03-24）加入/收敛 `--disable-userns`。当前代码均另钉 2026-09-21 SHA。 |

## 对本项目的影响

1. 要在非特权本地 Linux 保持 UDS 控制，最小可证实设计是：bwrap 的 user/PID/mount/net namespaces；受信代理或专用 broker 在 sandbox 外创建；仅把必要 endpoint/bridge 显式带入；在 user workload 前安装 seccomp。不要把“设置 `HTTP_PROXY`”当作隔离边界。
2. 对 workspace shell，可采用 Codex 的窄例外：拒绝 pathname/abstract `AF_UNIX` 创建，但保留 `socketpair(AF_UNIX)` 的进程内 IPC；是否需要此兼容例外应由测试决定。它不应通过全局 `allowAllUnixSockets` 实现。
3. USER_NOTIF 可以记录审计信息或驱动 UI 提示，但不能替代 bwrap/内核强制，也不能将来自受限进程内存的 pathname 用作授权输入。
4. 强制语义必须 fail closed：bwrap、user namespace、seccomp helper 或 required bridge 任一不可用时不 spawn。SRT 当前 warn-and-continue 是反例，不可直接继承。
5. 部署契约要明确要求 unprivileged user namespaces；若发行版禁用，不能悄悄降级为裸 shell。Flatpak 的 setuid fallback 是另一种产品部署模式，不符合本任务的非特权前提。
