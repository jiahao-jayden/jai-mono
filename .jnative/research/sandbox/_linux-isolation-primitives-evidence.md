# Ubuntu 非特权 Shell 隔离：bwrap、seccomp user-notify 与 Landlock 的证据笔记

核验日期：2026-09-21。本笔记将 Bubblewrap 固定在 `v0.11.0` 的提交 [`9ca3b05ec787acfb4b17bed37db5719fa777834f`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c)，将 Linux 上游当前源码固定在 [`93f51579e7df248780214094418f205253383cc5`](https://github.com/torvalds/linux/tree/93f51579e7df248780214094418f205253383cc5)；这样后续源码变化不会混入结论。Ubuntu 与 AppArmor 页面是网页资料，均注明访问日期。本笔记没有声称已经在 Ubuntu 26 ARM64 VM 上实际运行。

## 结论

1. **推荐的立即可落地修复是“只建一次 bwrap user namespace + 在该 sandbox 启动器内安装 user-notify filter”，而不是让 `apply-seccomp` 再创建嵌套 user namespace。** 非 setuid、非 root 的 bwrap 仅在没有传入 `--userns` FD 时自动设置 `CLONE_NEWUSER`；其 `--userns` 路径是先 `setns()` 再 clone，因此可避免 bwrap 自己再建一层。[源码](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L2942-L2975)；详见[发现 1](#发现-1bwrap-可复用既有-user-namespace但只适合从祖先进入子-ns)。不成立条件：若 helper 已经位于目标 user namespace 中，不能用同一个 FD `setns()` 回自己；Linux 返回 `EINVAL`，必须改成单一启动器架构，不能把 `--userns` 当成“原地不创建”的开关。
2. **不能把一个已存在的 seccomp listener “安装到”另一个已有 Shell；可以传递 listener FD，但 filter 仍必须由被约束任务（或其 exec 前启动器）用 `SECCOMP_FILTER_FLAG_NEW_LISTENER` 安装。** listener 是“某个 filter”的 FD，fork 的后代共享它，可经 `SCM_RIGHTS` 交给 supervisor。[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/seccomp_filter.rst#L194-L211)；详见[发现 3](#发现-3user-notify-listener-可传递但安装位置不能后移)。不成立条件：现有 Shell 已经运行且没有受该 filter 约束时，只传 FD 不会让它开始通知；需要重新从 bootstrap exec Shell。
3. **bwrap 的 `--seccomp` 不是 user-notify 集成点。** 固定版本源码把所有给定 BPF 程序用 `prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ...)` 安装，未调用 `seccomp(... NEW_LISTENER ...)`。[源码](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L283-L300)；详见[发现 2](#发现-2bwrap---seccomp-只装静态过滤器)。因此保留 Unix socket 拦截时，应让 `apply-seccomp` 变为同一 sandbox 内的 bootstrap（安装 notify filter、把 listener 交给 supervisor、再 exec Shell），而不是 bwrap 的嵌套 helper。
4. **Landlock 不是这个 Unix-socket 验收的单独替代品，但在 ABI ≥9 时可作为无需新 user namespace 的第二道强制层。** ABI 6 覆盖“连向 sandbox 外创建的 abstract AF_UNIX”；ABI 9 的 `LANDLOCK_ACCESS_FS_RESOLVE_UNIX` 覆盖 pathname AF_UNIX 的 `connect()` 和带显式目的地址的 `sendmsg()`。[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/include/uapi/linux/landlock.h#L326-L342)；详见[发现 5](#发现-5landlock-可覆盖两类-uds但存在明确缺口)。不成立条件：ABI <9 时不能用 Landlock 覆盖 pathname socket；已连接 socket 的后续发送、继承 FD、同一 Landlock domain 新建的服务端 socket 都不是完整的“禁止所有 UDS 能力”保证。
5. **`Landlock + 保留 seccomp user-notify` 可以满足“拦截到 host UDS”的分层验收，前提是运行时探测 ABI、对 ABI <9 fail closed 或保持 seccomp 路径，并清理/审计继承 FD。** Landlock 负责内核级的 abstract/pathname 跨域连接裁决，seccomp 负责完整 syscall 策略、FD 建立/传递边界与在 ABI 不足时的回退。[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L433-L445)；详见[发现 6](#发现-6landlock--seccomp-的覆盖矩阵)。不成立条件：如果验收定义为“不允许任何 AF_UNIX，包括同域 socketpair 与预连接 FD”，现有 Landlock 语义不够，仍需 seccomp policy 明确禁止相关 syscall/FD 生命周期。
6. **普通 Ubuntu 26 ARM64 非特权 VM 不能被假定允许创建 user namespace。** Ubuntu 官方材料确认 Ubuntu 24.04 起默认启用 AppArmor 的非特权 userns 限制；AppArmor 官方 wiki 指出只有含 `userns` permission 的 profile 才能创建，配置文件默认设为 `1`。[官方资料](https://wiki.ubuntu.com/Security/Features/)；详见[发现 7](#发现-7ubuntu-默认限制是初始-userns-创建的硬前置条件)。不成立条件：该资料证明的是 24.04 起的默认策略，不能替代对特定 Ubuntu 26 image 的 `/proc/sys/kernel/apparmor_restrict_unprivileged_userns`、AppArmor profile 和审计日志检查。
7. **若目标 VM 连“第一层” bwrap user namespace 都不允许，用户限定条件下不存在通用的纯用户态修复。** `CLONE_NEWUSER` 失败的原因可为 AppArmor policy、UID/GID map、namespace limit 或 nesting limit；Landlock/seccomp 不能创建 mount/network namespace。[文档](https://man7.org/linux/man-pages/man2/unshare.2.html)；详见[发现 4](#发现-4user-namespace-失败要按错误码区分而非猜测)。此时唯一合规动作是由 VM 管理员为启动器授予最小 AppArmor `userns` 规则，或使用已存在的一层 sandbox；这不是特权运行、关闭拦截或 Docker-only 方案。

## 推荐的单层执行形态

这不是已实现的产品方案，而是由下列内核语义推导出的最小改造形态：

1. 在受支持的宿主上仅由入口 bwrap 创建一次 user/mount/network namespace，维持现有文件系统与网络策略。
2. bwrap exec 一个小 bootstrap；bootstrap **不调用 `unshare(CLONE_NEWUSER)`**。
3. bootstrap 先建立仅供控制面使用的继承 socketpair，再在将要 exec Shell 的任务上以 `SECCOMP_FILTER_FLAG_NEW_LISTENER` 装载 `SECCOMP_RET_USER_NOTIF` filter。
4. bootstrap 用 `SCM_RIGHTS` 把 listener FD 给同一启动树中、受最小权限约束的 supervisor；随后 exec Shell。Shell 的 fork/exec 后代继承 filter，listener 仍归同一 filter。
5. 若 `landlock_create_ruleset(... VERSION)` 返回 ABI ≥9，bootstrap 在 exec 前叠加 abstract scope 与 `RESOLVE_UNIX`；若低于 9，则保留 user-notify 的 pathname UDS 拦截而不是声称 Landlock 覆盖。

这里的控制 socketpair 是启动器预先创建并继承的能力，不是给 Shell 开放任意 `AF_UNIX connect()` 的例外。应在 exec 前关闭无关端点，并对 `socketpair`、`sendmsg(SCM_RIGHTS)`、`connect`、`sendto`/显式目的地址 `sendmsg` 制定一致的 seccomp 策略。

## 发现 1：bwrap 可复用既有 user namespace，但只适合从祖先进入子 NS

**主张。** bwrap `--userns FD` 与 `--unshare-user` 互斥；当传入 FD 时，非特权 bwrap 不会自动请求 `CLONE_NEWUSER`，而是在 clone 前 `setns(FD, CLONE_NEWUSER)`。因此，从拥有目标子 user namespace FD 的祖先进程启动 helper 时，可消除 *bwrap 造成的* 嵌套 user namespace。

源码证据：[`bubblewrap.c#L2942-L2975 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L2942-L2975)。

```c
if (opt_userns_fd != -1 && opt_unshare_user)
  die ("--userns not compatible --unshare-user");

if (opt_userns_fd != -1 && opt_unshare_user_try)
  die ("--userns not compatible --unshare-user-try");

/* We have to do this if we weren't installed setuid (and we're not
 * root), so let's just DWIM */
if (!is_privileged && getuid () != 0 && opt_userns_fd == -1)
  opt_unshare_user = true;
```

源码证据：[`bubblewrap.c#L3107-L3139 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L3107-L3139)。

```c
/* Switch to the custom user ns before the clone, gets us privs in that ns
 * (assuming its a child of the current and thus allowed) */
if (opt_userns_fd > 0 && setns (opt_userns_fd, CLONE_NEWUSER) != 0)
  {
    if (errno == EINVAL)
      die ("Joining the specified user namespace failed, it might not be a
            descendant of the current user namespace.");
    die_with_error ("Joining specified user namespace failed");
  }

pid = raw_clone (clone_flags, NULL);
```

反方条件：[`setns(2)` 的用户命名空间规则（man-pages 6.15，网页访问于 2026-09-21）](https://man7.org/linux/man-pages/man2/setns.2.html) 指出不得重新进入 caller 当前 namespace，且目标必须是 descendant；所以“在 sandbox 内向自身 `/proc/self/ns/user` 传 FD”不是可行规避。

> A process reassociating itself with a user namespace must
> have the CAP_SYS_ADMIN capability in the target user namespace.
> (This necessarily implies that it is only possible to join a descendant
> user namespace.)
>
> It is not permitted to use setns() to reenter the caller's current
> user namespace. This prevents a caller that has dropped capabilities
> from regaining those capabilities via a call to setns().

## 发现 2：bwrap `--seccomp` 只装静态过滤器

**主张。** bwrap 接受 `--seccomp FD`，但固定版本把程序以 `prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ...)` 装入；它没有建立 `NEW_LISTENER`，所以不能把它当成 apply-seccomp 的 user-notify listener 主管理器。

源码证据：[`bubblewrap.c#L283-L300 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L283-L300)。

```c
seccomp_programs_apply (void)
{
  SeccompProgram *program;

  for (program = seccomp_programs; program != NULL; program = program->next)
    {
      if (prctl (PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program->program) != 0)
        {
          if (errno == EINVAL)
            die ("Unable to set up system call filtering as requested: "
                 "prctl(PR_SET_SECCOMP) reported EINVAL. ");
```

源码证据：[`bubblewrap.c#L358-L365 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L358-L365)。

```c
"    --file FD DEST               Copy from FD to destination DEST\n"
"    --bind-data FD DEST          Copy from FD to file which is bind-mounted on DEST\n"
"    --ro-bind-data FD DEST       Copy from FD to file which is readonly bind-mounted on DEST\n"
"    --symlink SRC DEST           Create symlink at DEST with target SRC\n"
"    --seccomp FD                 Load and use seccomp rules from FD (not repeatable)\n"
"    --add-seccomp-fd FD          Load and use seccomp rules from FD (repeatable)\n"
"    --block-fd FD                Block on FD until some data to read is available\n"
```

反方条件：若需求只需 deny-list，bwrap 的静态 BPF 足够；但若必须对 Unix socket 参数作动态 allow/deny 决策，必须用下一节的 user notification，而不能把静态 `--seccomp` 误当为 listener。

## 发现 3：user-notify listener 可传递，但安装位置不能后移

**主张。** Linux 明确允许 listener FD 用 `SCM_RIGHTS` 传递，且同一 filter 的 fork 后代共用；这支持 bootstrap → supervisor 的传递。文档同时定义 listener 为 “particular filter” 的 FD，而非某个 task 的可迁移 policy，因此没有“把既有 listener 安装到已运行目标 Shell”的接口。

源码证据：[`Documentation/userspace-api/seccomp_filter.rst#L194-L211 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/seccomp_filter.rst#L194-L211)。

```rst
The ``SECCOMP_RET_USER_NOTIF`` return code lets seccomp filters pass a
particular syscall to userspace to be handled. This may be useful for
applications like container managers, which wish to intercept particular
syscalls (``mount()``, ``finit_module()``, etc.) and change their behavior.

To acquire a notification FD, use the ``SECCOMP_FILTER_FLAG_NEW_LISTENER``
argument to the ``seccomp()`` syscall:

    fd = seccomp(SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);

which (on success) will return a listener fd for the filter, which can then be
passed around via ``SCM_RIGHTS`` or similar. Note that filter fds correspond to
a particular filter, and not a particular task.
```

源码证据：[`Documentation/userspace-api/seccomp_filter.rst#L206-L211 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/seccomp_filter.rst#L206-L211)。

```rst
which (on success) will return a listener fd for the filter, which can then be
passed around via ``SCM_RIGHTS`` or similar. Note that filter fds correspond to
a particular filter, and not a particular task. So if this task then forks,
notifications from both tasks will appear on the same filter fd. Reads and
writes to/from a filter fd are also synchronized, so a filter fd can safely
have many readers.
```

**Unix socket 参数读取的条件。** `seccomp_data` 只有寄存器数值、没有指针指向的 `sockaddr_un` 内容；supervisor 若依赖路径/abstract 名称作决定，必须有读取 tracee 内存的权限，并在决定前拷贝以避免 TOCTOU。

源码证据：[`Documentation/userspace-api/seccomp_filter.rst#L284-L290 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/seccomp_filter.rst#L284-L290)。

```rst
It is worth noting that ``struct seccomp_data`` contains the values of register
arguments to the syscall, but does not contain pointers to memory. The task's
memory is accessible to suitably privileged traces via ``ptrace()`` or
``/proc/pid/mem``. However, care should be taken to avoid the TOCTOU mentioned
above in this document: all arguments being read from the tracee's memory
should be read into the tracer's memory before any policy decisions are made.
This allows for an atomic decision on syscall arguments.
```

反方条件：supervisor 若没有 ptrace/`/proc/<pid>/mem` 访问权，不能仅凭 user notification 安全识别 `sockaddr_un` 字节；此时应 fail closed，或将可识别的 socket policy 移至 Landlock（若 ABI 足够），不可放行未知请求。

## 发现 4：user namespace 失败要按错误码区分，而非猜测

**主张。** Linux 的 32 层 user namespace 嵌套是一个上限；但 Linux 4.9+ 达到该上限报 `ENOSPC`，不是泛化的 `EPERM`。`EPERM` 可来自没有父 NS UID/GID map 等条件。bwrap 也将 `ENOSPC` 解释为 nesting depth 或 `/proc/sys/user/max_*_namespaces`。因此当前 helper 报错必须收集 errno、AppArmor audit 和 sysctl，而不是只猜“嵌套失败”。

文档证据：[`user_namespaces(7)`（man-pages 6.15，网页访问于 2026-09-21）](https://man7.org/linux/man-pages/man7/user_namespaces.7.html) “Nested namespaces, namespace membership”。

> User namespaces can be nested; that is, each user namespace
> —except the initial ("root") namespace— has a parent user
> namespace, and can have zero or more child user namespaces.
>
> The kernel imposes (since Linux 3.11) a limit of 32 nested levels
> of user namespaces. Calls to unshare(2) or clone(2) that would
> cause this limit to be exceeded fail with the error EUSERS.

文档证据：[`unshare(2)`（man-pages 6.15，网页访问于 2026-09-21）](https://man7.org/linux/man-pages/man2/unshare.2.html) Errors。

> ENOSPC (since Linux 4.9; beforehand EUSERS)
>     CLONE_NEWUSER was specified in flags, and the call would
>     cause the limit on the number of nested user namespaces to
>     be exceeded.
>
> EPERM  CLONE_NEWUSER was specified in flags, but either the
>     effective user ID or the effective group ID of the caller
>     does not have a mapping in the parent namespace.

源码证据：[`bubblewrap.c#L3123-L3139 @ 9ca3b05`](https://github.com/containers/bubblewrap/blob/9ca3b05ec787acfb4b17bed37db5719fa777834f/bubblewrap.c#L3123-L3139)。

```c
pid = raw_clone (clone_flags, NULL);
if (pid == -1)
  {
    if (opt_unshare_user)
      {
        if (errno == EINVAL)
          die ("Creating new namespace failed, likely because the kernel
                does not support user namespaces.");
        else if (errno == EPERM && !is_privileged)
          die ("No permissions to creating new namespace, likely because
                the kernel does not allow non-privileged user namespaces.");
      }

    if (errno == ENOSPC)
      die ("Creating new namespace failed: nesting depth or
            /proc/sys/user/max_*_namespaces exceeded (ENOSPC)");
```

反方条件：man-page 引文未包含 Ubuntu 的 AppArmor LSM 拒绝路径；所以 `EPERM` 不能仅根据标准 errno 判定。下一节的 AppArmor audit 是 Ubuntu 必查项。

## 发现 5：Landlock 可覆盖两类 UDS，但存在明确缺口

**主张。** 当前上游 Landlock ABI 9 的 `LANDLOCK_ACCESS_FS_RESOLVE_UNIX` 覆盖 pathname UDS 的 `connect` 和带显式目的地 `sendmsg`，但只约束在 Landlock domain 外创建的 server；ABI 6 的 scope 覆盖 abstract UDS 出域连接。两者都不等于“阻断所有已获得 socket FD 的通信”。

源码证据：[`include/uapi/linux/landlock.h#L326-L342 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/include/uapi/linux/landlock.h#L326-L342)。

```c
 * - %LANDLOCK_ACCESS_FS_RESOLVE_UNIX: Look up pathname UNIX domain sockets
 *   (:manpage:`unix(7)`).  On UNIX domain sockets, this restricts both calls to
 *   :manpage:`connect(2)` as well as calls to :manpage:`sendmsg(2)` with an
 *   explicit recipient address.
 *
 *   This access right applies only to connections to UNIX server sockets which
 *   were created outside of the newly created Landlock domain (e.g. from within
 *   a parent domain or from an unrestricted process).  Newly created UNIX
 *   servers within the same Landlock domain continue to be accessible.
 *
 *   This access right is available since the ninth version of the Landlock ABI.
```

源码证据：[`Documentation/userspace-api/landlock.rst#L433-L445 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L433-L445)。

```rst
``LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET``
    This limits the set of abstract :manpage:`unix(7)` sockets to which we can
    :manpage:`connect(2)` to socket addresses which were created by a process in
    the same or a nested Landlock domain.

    A :manpage:`sendto(2)` on a non-connected datagram socket is treated as if
    it were doing an implicit :manpage:`connect(2)` and will be blocked if the
    remote end does not stem from the same or a nested Landlock domain.

    A :manpage:`sendto(2)` on a socket which was previously connected will not
    be restricted.
```

源码证据：[`Documentation/userspace-api/landlock.rst#L790-L795 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L790-L795)。

```rst
Pathname UNIX sockets (ABI < 9)
-------------------------------

Starting with the Landlock ABI version 9, it is possible to restrict
connections to pathname UNIX domain sockets (:manpage:`unix(7)`) using
the new ``LANDLOCK_ACCESS_FS_RESOLVE_UNIX`` right.
```

反方条件：ABI 9 是运行时能力，不可由发行版名称推断。ABI <9 只能获得 abstract socket scope（若 ABI ≥6），pathname UDS 必须继续靠 seccomp user-notify 或 fail-closed 静态策略。

## 发现 6：Landlock + seccomp 的覆盖矩阵

| 验收维度 | Landlock | seccomp user-notify | 组合结论 |
|---|---|---|---|
| abstract UDS `connect` / 未连接 datagram `sendto` | ABI ≥6，跨 Landlock domain 阻断；[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L433-L445) | 可通知相应 syscall，但需安全读取参数 | ABI ≥6 时有内核强制兜底 |
| pathname UDS `connect` / explicit `sendmsg` | ABI ≥9；[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/include/uapi/linux/landlock.h#L326-L342) | 可作细粒度 allow-list | ABI ≥9 时可覆盖 host socket 连接 |
| 已连接、继承或 `SCM_RIGHTS` 获得的 socket FD | 文档明确有已连接 socket 例外；[源码](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L438-L445) | 必须对 FD 建立、传递和数据路径另行设计 | 不能宣称仅 Landlock 已满足 |
| bwrap 文件系统与 network namespace | 不创建 namespace | 不创建 namespace | 继续由入口 bwrap 负责，且只建一次 |

**主张。** Landlock enforcement 不需要 root：非特权任务设置 `no_new_privs` 即可，并会随 clone 后代继承；这使它可放在单层 bwrap bootstrap 内，但不能替 bwrap 提供 filesystem/network namespace。

源码证据：[`Documentation/userspace-api/landlock.rst#L279-L304 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L279-L304)。

```rst
The next step is to restrict the current thread from gaining more privileges
(e.g. through a SUID binary).  For unprivileged processes, setting the
no_new_privs attribute is required by Landlock.

Processes with ``CAP_SYS_ADMIN`` in their namespace can enforce a ruleset
without setting no_new_privs, but leaving no_new_privs unset is risky even
when Landlock does not require this attribute: sandboxed processes could
still execute set-user-ID, set-group-ID or file-capability binaries.

if (!(restrict_flags & LANDLOCK_RESTRICT_SELF_NO_NEW_PRIVS) &&
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) {
```

源码证据：[`Documentation/userspace-api/landlock.rst#L395-L400 @ 93f51579`](https://github.com/torvalds/linux/blob/93f51579e7df248780214094418f205253383cc5/Documentation/userspace-api/landlock.rst#L395-L400)。

```rst
Every new thread resulting from a :manpage:`clone(2)` inherits Landlock domain
restrictions from its parent.  This is similar to seccomp inheritance (cf.
Documentation/userspace-api/seccomp_filter.rst) or any other LSM dealing with
task's :manpage:`credentials(7)`. For instance, one process's thread may apply
Landlock rules to itself, but they will not be automatically applied to other
sibling threads.
```

反方条件：Landlock 若没有启用会返回 `EOPNOTSUPP`，且 ABI 检测可能小于 9；不能为了“兼容”静默取消 Unix socket 拦截。应让 bootstrap 报出能力不足并落回仍启用的 seccomp user-notify 路径。

## 发现 7：Ubuntu 默认限制是初始 userns 创建的硬前置条件

**主张。** Ubuntu 官方 Security Features 页面说明 24.04 起 AppArmor 默认启用“unprivileged user namespace restrictions”；AppArmor 官方资料说明 Ubuntu 的 sysctl 文件默认为 `1`，无 profile 的进程会被拒绝。因此应将“给唯一入口启动器授权 `userns create`”视作管理员维护的部署前置条件，不能在普通用户运行时自行关闭 sysctl。

网页证据：[`Ubuntu Security Features — AppArmor unprivileged user namespace restrictions`](https://wiki.ubuntu.com/Security/Features/)（访问于 2026-09-21；页面无稳定行号，章节标题如链接）。

> Starting with Ubuntu 23.10, AppArmor provides support for denying
> unprivileged applications the use of user namespaces. This prevents an
> unprivileged application from making use of a user namespace to gain access
> to additional capabilities and various kernel subsystems which present an
> additional attack surface. Applications which do require legitimate
> unprivileged access to user namespaces are designated by an appropriate
> AppArmor profile. Starting with Ubuntu 24.04 this is enabled by default.

网页证据：[`AppArmor wiki: unprivileged_userns_restriction`](https://gitlab.com/apparmor/apparmor/-/wikis/unprivileged_userns_restriction?version_id=b8c4521cbcdae1dcc97834773f699943957e3e98)（版本 `b8c4521c`，访问于 2026-09-21；网页章节 “Controlling … via sysctl”）。

```plaintext
# Allows to restrict the use of unprivileged user namespaces to applications
# which have an AppArmor profile loaded which specifies the userns
# permission. All other applications (whether confined by AppArmor or not) will
# be denied the use of unprivileged user namespaces.
#
# If it is desired to disable this restriction, it is preferable to create an
# additional file named /etc/sysctl.d/20-apparmor.conf which will override this
# current file and sets this value to 0 rather than editing this current file
kernel.apparmor_restrict_unprivileged_userns = 1
kernel.apparmor_restrict_unprivileged_unconfined = 1
```

网页证据：同一 [`AppArmor wiki`](https://gitlab.com/apparmor/apparmor/-/wikis/unprivileged_userns_restriction?version_id=b8c4521cbcdae1dcc97834773f699943957e3e98) 的 “Allowing user namespaces creation in policy”（版本 `b8c4521c`，访问于 2026-09-21）。

> When restrictions on unprivileged user namespaces are enabled unconfined
> unprivileged processes are not allowed to create user namespaces.
> Specifically unconfined processes that do not have CAP_SYS_ADMIN must be
> confined by a profile to be able to create user namespaces when restrictions
> on unprivileged user namespaces are enabled.
>
> Confined processes whether privileged or unprivileged are by default also not
> allowed to create user namespaces. To enable them to create user namespaces
> the following rule should be add to the applications profile.
>
>     allow userns create,

反方条件：官方 Ubuntu Security Features 页只明确到“24.04 起默认”，不是每个 26.04 image 的实测证明；自定义 cloud image 可改变 kernel、AppArmor userspace 或 profile。部署脚本必须读下节检查项，而不是按发行版名做布尔判断。

## Ubuntu VM 部署前检查与本机无副作用诊断

**建议在目标 Ubuntu 26 ARM64 VM 以普通用户执行（均只读）：**

```sh
uname -srmo
id
cat /proc/sys/user/max_user_namespaces
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>&1
cat /proc/self/attr/current 2>&1
cat /sys/kernel/security/lsm 2>&1
cat /proc/sys/kernel/seccomp/actions_avail 2>&1
```

若允许一个无副作用、会失败即返回错误的 capability probe，可由产品自身 bootstrap 使用 `landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION)` 查询 ABI，使用 `seccomp(SECCOMP_GET_ACTION_AVAIL, ..., SECCOMP_RET_USER_NOTIF)` 查询通知动作；不要以 `unshare -U` 作为“无副作用”探针，因为它会真的创建 namespace。

**本机实际运行的诊断（2026-09-21，原始命令与输出）：**

```sh
$ uname -a; uname -m; (sw_vers 2>/dev/null || true); command -v bwrap || true; (sysctl -n kern.osproductversion 2>/dev/null || true)
Darwin jayden-server.local 25.0.0 Darwin Kernel Version 25.0.0: Wed Sep 17 21:42:08 PDT 2025; root:xnu-12377.1.9~141/RELEASE_ARM64_T8132 arm64
arm64
ProductName:	 macOS
ProductVersion:	 26.0.1
BuildVersion:	 25A362
26.0.1

$ if [ "$(uname -s)" = Linux ]; then printf 'kernel='; uname -r; printf 'userns='; cat /proc/sys/user/max_user_namespaces; printf 'seccomp-actions='; cat /proc/sys/kernel/seccomp/actions_avail; printf 'landlock='; cat /sys/kernel/security/lsm 2>&1; else printf 'SKIPPED: host is not Linux; Ubuntu VM-specific /proc and Landlock probes unavailable\n'; fi
SKIPPED: host is not Linux; Ubuntu VM-specific /proc and Landlock probes unavailable
```

未实测原因：当前执行机是 macOS 26.0.1 ARM64，不是 Ubuntu 26 ARM64 VM；没有伪造 bwrap、AppArmor、Landlock 或 seccomp 的运行结果。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Bubblewrap `v0.11.0` 源码、Linux seccomp/Landlock 上游源码、man-pages、Ubuntu Security Features、AppArmor 官方 wiki；均在各发现中钉 SHA、版本或访问日期。 |
| 作者或维护者本人的说法 | 未找到独立的 maintainer 博文；源码、官方 kernel 文档和 Canonical/AppArmor 官方页面已直接定义所需行为。 |
| 同类方案 | Flatpak 是 bwrap 的主要上游使用者；Landlock samples 是内核文档给出的自限制范式；AppArmor `unprivileged_userns` profile 是 Ubuntu 的分发策略。三者均显示 user namespace、LSM 和 seccomp 是可组合层，不是 Docker 专属能力。 |
| issue / PR / 社区实践 | 查阅了 Bubblewrap namespace reuse PR/issue 与 Landlock pathname socket issue，作为来源发现线索；关键结论只采用上游源码和官方文档，避免 issue 的时效性。 |
| 历史演变 | Landlock ABI 6 引入 abstract socket scope、ABI 9 引入 pathname UDS（上游 `landlock.rst`）；Ubuntu 23.10 引入、24.04 默认启用 AppArmor userns 限制（Ubuntu 官方页面）。 |

## 对本项目的影响

- 不应采用“关闭 `kernel.apparmor_restrict_unprivileged_userns`”、setuid/特权容器、或仅 Docker 的绕过；这些要么违反约束，要么掩盖了最初 userns 创建的部署要求。
- 若现有最外层 bwrap 已能成功启动，优先删除 helper 的第二次 `CLONE_NEWUSER`：把 apply-seccomp 改造成 bootstrap，在相同 sandbox 内装 listener、交给最小 supervisor、再 exec Shell。此方案不要求额外 user namespace。
- `bwrap --userns FD` 可用于由祖先进程进入一个已有**子** user namespace 的特殊拓扑，但不能从目标 namespace 内“重入自身”；它不是单层 bootstrap 的替代品。
- 引入 Landlock 前，运行时必须查询 ABI。ABI ≥9 才能把 pathname UDS 作为内核额外强制层；ABI 6–8 只可覆盖 abstract UDS；ABI <6 或 Landlock disabled 时保留 seccomp user-notify，不能降级成允许 UDS。
- 需要新增的验收包括：pathname socket、abstract socket、`sendto`/`sendmsg`、预连接/继承 FD、`SCM_RIGHTS`、以及 listener 传递的 bootstrap control socket。最后两项是 Landlock 已知边界，不能只测 `connect()` 成功/失败。
