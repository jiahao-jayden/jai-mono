# Sandbox Runtime 在外层 user namespace 中的 Linux seccomp 失败

核验日期：2026-09-21。固定对象：npm `@anthropic-ai/sandbox-runtime@0.0.77`、Git tag `v0.0.77`、commit [`6fa731368807419ee157f9a3fac955fefe1019c6`](https://github.com/anthropics/sandbox-runtime/tree/6fa731368807419ee157f9a3fac955fefe1019c6)。固定 SHA 是为了避免后续 `main`、tag 或 npm dist-tag 变化混入本结论；核验时 npm `latest` 仍是 `0.0.77`。范围是 Linux 的 Unix-domain-socket seccomp helper，不改变 Jai 产品代码。

## 结论

1. **在本次 Ubuntu 26 ARM64 Lima VM 的普通用户复现条件下，0.0.77 不能满足“保留 Unix-socket seccomp”的本地 shell 强制需求。** 外层 SRT `bwrap --unshare-user` 清空 capabilities 后，`apply-seccomp` 不能直接建立 PID/mount namespace，只能再建 user namespace；该嵌套路径在本机写 `/proc/self/setgroups` 被拒绝，helper fail-closed，用户命令和 Unix-socket seccomp 都不会启动。见[机制 trace](#调用链与失败位置)和[实际复现](#实际复现命令与输出)。
2. **`nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN` 不是内核返回的归因，而是 helper 对 [`setgroups` 写失败](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L736-L745)使用的固定文本。** 该失败表示嵌套 namespace 没有可用能力或 `/proc` 写入条件不成立；它不能单独证明“所有 nested user namespace 都必须有 `CAP_SYS_ADMIN`”。[Linux 正常语义](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)是：成功 `unshare(CLONE_NEWUSER)` 的进程在新 user namespace 获得完整 capability 集。
3. **0.0.77 没有已发布的上游修复。** 已发布的 [#505](https://github.com/anthropics/sandbox-runtime/pull/505) / `v0.0.76` 仅为“宿主 euid 为 0 且已有 `CAP_SETFCAP`”保留 `CAP_SETFCAP`；当前 0.0.77 对普通用户仍只传 `--cap-drop ALL`。直接相关的 [#417](https://github.com/anthropics/sandbox-runtime/issues/417)、[#428](https://github.com/anthropics/sandbox-runtime/issues/428) 和 [#498](https://github.com/anthropics/sandbox-runtime/issues/498) 仍 open，未有维护者 issue 回复；[#418](https://github.com/anthropics/sandbox-runtime/pull/418) 也仍未合并。见[上游已知讨论与版本状态](#上游已知讨论与版本状态)。
4. **不应以删掉 helper、`allowAllUnixSockets` 或自动降级为修复。** [它们会让 bwrap 的文件/网络隔离继续存在](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3068-L3083)，却移除 SRT 唯一用于阻断新建 `AF_UNIX` socket 的 seccomp filter，恰好不满足本项目的要求。
5. **应向上游提交一个“仅 helper 启动阶段临时保留 capability、helper 在 exec 前不可恢复地清除 capability”的小补丁，而不是仅加 `CAP_SETFCAP`。** 对本次 `setgroups` 失败，`CAP_SETFCAP` 只可能覆盖较晚的 UID 0 mapping 限制，不能让 LSM/内核允许 capability-bearing nested userns；应让内置 helper 使用已有的直接 `CAP_SYS_ADMIN` 路径，避开第二层 userns。为避免把 `CAP_SYS_ADMIN` 交给 workload，helper 必须在 mount/proc 配置完成后、fork/exec 工作负载前 drop bounding/permitted/effective sets；[当前 helper 明确没有完成这种清理](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L835-L854)。

## 调用链与失败位置

SRT 的 Linux wrapper 在调用用户命令前无条件使用外层 `--unshare-user`；在 helper 可用时，它调用 `capabilityArgs()`。对普通用户，函数立即返回 `--cap-drop ALL`，即不保留 `CAP_SYS_ADMIN`，也不保留 `CAP_SETFCAP`。

来源：[`linux-sandbox-utils.ts#L547-L579`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L547-L579)

```ts
 * The bwrap capability list. Always `--cap-drop ALL`, which for a non-root
 * caller is bwrap's default anyway. `--cap-add CAP_SETFCAP` for the whole
 * bwrap invocation ... when the caller is uid 0, the seccomp helper is in use
 * and the capability survives into bwrap ...
 */
export function capabilityArgs({
  euid,
  hasSetfcap,
  usesSeccompHelper,
}: {
  euid: number | undefined
  hasSetfcap: boolean
  usesSeccompHelper: boolean
}): string[] {
  const args = ['--cap-drop', 'ALL']
  if (euid !== 0) return args
  if (!hasSetfcap) return args
  if (usesSeccompHelper) args.push('--cap-add', 'CAP_SETFCAP')
  return args
}
```

来源：[`linux-sandbox-utils.ts#L3250-L3284`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3250-L3284)

```ts
bwrapArgs.push('--unshare-pid')
// --unshare-user in both modes: bwrap only auto-creates a userns when
// EUID != 0. A root parent in an unprivileged container ... would otherwise
// try a direct clone and EPERM.
const euid = process.geteuid?.()
const hasSetfcap = processHasBoundingCapability(CAP_SETFCAP)
...
bwrapArgs.push(
  '--unshare-user',
  ...capabilityArgs({
    euid,
    hasSetfcap,
    usesSeccompHelper: applySeccompPrefix !== undefined,
  }),
)
if (!enableWeakerNestedSandbox) {
  bwrapArgs.push('--proc', '/proc')
}
```

`apply-seccomp` 先尝试直接 `unshare(CLONE_NEWPID | CLONE_NEWNS)`；没有 `CAP_SYS_ADMIN` 时内核返回 `EPERM`，于是走 fallback：创建第二层 user namespace、写 `setgroups`/map，再重试 PID/mount unshare。

来源：[`apply-seccomp.c#L685-L755`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L685-L755)

```c
 * Two paths to get CAP_SYS_ADMIN for the unshare:
 * (a) We already hold CAP_SYS_ADMIN in this user namespace. Just
 * unshare directly. Under the sandbox we never do — bwrap is
 * given --cap-drop ALL and at most --cap-add CAP_SETFCAP ...
 * (b) We don't have the cap. Create a nested user namespace to get it,
 * map uid/gid, then unshare.
...
if (unshare(CLONE_NEWPID | CLONE_NEWNS) < 0) {
  if (errno != EPERM) die("apply-seccomp: unshare(CLONE_NEWPID|CLONE_NEWNS)");
...
  if (unshare(CLONE_NEWUSER) < 0) die("apply-seccomp: unshare(CLONE_NEWUSER)");
  if (write_file("/proc/self/setgroups", "deny") < 0) {
    die("apply-seccomp: write /proc/self/setgroups "
        "(nested userns is capability-restricted; "
        "caller must provide CAP_SYS_ADMIN)");
  }
  if (write_file("/proc/self/uid_map", "%u %u 1\n", uid, uid) < 0)
    die("apply-seccomp: write /proc/self/uid_map");
```

本次失败的完整路径为：

```text
普通 Linux 用户 U0
  -> SRT bwrap --unshare-user --cap-drop ALL：进入 U1，但没有 CAP_SYS_ADMIN
  -> apply-seccomp：unshare(PID|MOUNT) = EPERM
  -> apply-seccomp：unshare(USER) 尝试 U2
  -> U2 的 capability/proc 写入条件被 Lima Ubuntu 26 的 namespace/LSM 策略拒绝
  -> write(/proc/self/setgroups, "deny") = EACCES/EPERM
  -> helper exit；command 未 exec；Unix-socket seccomp 未安装
```

## 诊断文本的实际含义

Linux 的正常规则不是“嵌套 user namespace 必须有 `CAP_SYS_ADMIN`”。如果 `unshare(CLONE_NEWUSER)` 成功，调用进程在新 user namespace 内拥有完整 capability 集；它在父 user namespace 仍无能力。

来源：[Linux man-pages 6.19，`user_namespaces(7)`](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)（访问日期：2026-09-21）

> The child process created by clone(2) with the CLONE_NEWUSER flag starts out
> with a complete set of capabilities in the new user namespace. Likewise, a
> process that creates a new user namespace using unshare(2) ... gains a full
> set of capabilities in that namespace. On the other hand, that process has
> no capabilities in the parent ... user namespace.

因此，helper 的报错句是它对 `write_file()` 失败的实现级说明，不能替代 syscall-level 原因。源码也明确把这一 failure mode 归因到 LSM 对 capability-bearing unprivileged user namespace 的 gating，并用同一 `setgroups` 错误终止。

来源：[`apply-seccomp.c#L696-L702`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L696-L702)

```c
 * Path (a) is tried first. If we don't have the cap, the
 * kernel returns EPERM and we fall through to (b). Path (b) can itself
 * fail on hosts where unprivileged user namespaces are gated by an LSM
 * (Ubuntu 24.04's AppArmor restriction, for example) — the unshare
 * succeeds but the new namespace grants no capabilities, so the setgroups
 * write fails. In that case we abort: the caller must supply CAP_SYS_ADMIN.
```

`uid_map` 的 `EPERM` 是另一个、可同时存在的边界。Linux 5.12 起，若 child user namespace 要把父 namespace 的 UID 0 映到自身，创建 child namespace 的进程还必须拥有 `CAP_SETFCAP`；这说明 [#418](https://github.com/anthropics/sandbox-runtime/pull/418) 只加 `CAP_SETFCAP` 有其针对性，但不能解决本机已经先失败的 `setgroups`。

来源：[Linux man-pages 6.19，`user_namespaces(7)`](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)（访问日期：2026-09-21）

> If updating `/proc/pid/uid_map` to create a mapping that maps UID 0 in the
> parent namespace ... if the writing process is in the child user namespace,
> then the process that created the user namespace must have had the
> `CAP_SETFCAP` capability when the namespace was created. This rule has been
> in place since Linux 5.12.

## 实际复现命令与输出

以下第一组是本次 Ubuntu 26 ARM64 Lima VM 普通用户的报告结果；原始报告未保留完整 bwrap mount argv，故以 `...` 保留其真实外层 wrapper。它足以固定两个观察值，**不是**把所有 `setgroups` 失败归为同一个内核原因。

```sh
# 先进入 SRT/bwrap 的外层 user namespace，然后在其中创建一层：
bwrap --unshare-user ... -- \
  unshare --user --map-root-user /bin/true

# 实测输出：
unshare: write failed /proc/self/uid_map: Operation not permitted
```

```text
# 同一环境由 SRT 0.0.77 真实 helper 报出：
apply-seccomp: write /proc/self/setgroups
(nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN):
Permission denied
```

可在同一 VM 用以下最小化命令把“外层 user namespace”与“实际拒绝的 syscall”分开记录；应连同 `strace` 输出贴到上游现有 issue，而不是根据 helper 字符串猜测：

```sh
strace -f -e trace=unshare,openat,write \
  bwrap --unshare-user --bind / / --proc /proc --dev /dev -- \
  unshare --user --map-root-user /bin/true

# SRT 真实二进制的定位方式（把 HELPER 替换为 npm 包内 apply-seccomp 路径）：
strace -f -e trace=unshare,openat,write \
  "$HELPER" /bin/true
```

对照案例 [#428](https://github.com/anthropics/sandbox-runtime/issues/428) 是 Ubuntu 24.04 bare metal 的同一 helper 文案；它提供的是第三方可复现案例，不是维护者结论。

> `apply-seccomp: write /proc/self/setgroups (nested userns is
> capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied`
>
> `bwrap --dev-bind / / --unshare-user $HELPER /bin/echo ok # EPERM on
> setgroups`

## Unix-socket seccomp 的边界

SRT 仅在 `allowAllUnixSockets` 为 false 时解析并运行 `apply-seccomp`；找不到 helper 时它记录 warning，并明确说 Unix socket blocking 被禁用。成功时 helper 在 `PR_SET_NO_NEW_PRIVS` 之后才把 BPF filter 安装到真正的 workload。

来源：[`linux-sandbox-utils.ts#L3068-L3083`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/src/sandbox/linux-sandbox-utils.ts#L3068-L3083)

```ts
// apply-seccomp wraps the workload and applies the baked-in BPF filter
// that blocks socket(AF_UNIX, ...). Skipped when allowAllUnixSockets is true.
if (!allowAllUnixSockets) {
  applySeccompPrefix = resolveApplySeccompPrefix(...)
  if (!applySeccompPrefix) {
    logForDebugging(
      '[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled. ' +
      'Install @anthropic-ai/sandbox-runtime globally for full protection.',
      { level: 'warn' },
    )
  }
}
```

来源：[`apply-seccomp.c#L875-L891`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L875-L891)

```c
/* ---- Worker (inner PID 2): apply seccomp and exec. ---- */
if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0)
  die("apply-seccomp: prctl(PR_SET_NO_NEW_PRIVS)");
...
install_observe_filter(sp[1]);
if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) < 0) {
  die("apply-seccomp: prctl(PR_SET_SECCOMP)");
}
execvp(command_argv[0], command_argv);
```

结论：当前报错是 fail-closed，因而没有“无 seccomp 却照常执行”的隐性降级；但把 helper 关掉来让命令运行，会主动失去所需的 `AF_UNIX` 创建阻断，不能作为 Jai 的可用方案。

## 上游已知讨论与版本状态

| 讨论 | 能证明什么 | 状态与证据强度 |
| --- | --- | --- |
| [#417](https://github.com/anthropics/sandbox-runtime/issues/417) | 容器内的 `uid_map` `EPERM` 实例；发帖者假设 fork/map 时序。 | open；用户案例，不是维护者确认。 |
| [#428](https://github.com/anthropics/sandbox-runtime/issues/428) | Ubuntu bare metal 上的 `setgroups` `EPERM`，与本次症状相同。 | open、0 条回复；用户案例。 |
| [#498](https://github.com/anthropics/sandbox-runtime/issues/498) | `--cap-drop ALL` 让 helper 的 fallback 在 outer userns 中不可依赖，并建议 direct-cap 路径。 | open；用户分析，不能当作内核/维护者事实。 |
| [#418](https://github.com/anthropics/sandbox-runtime/pull/418) | 未合并的 `CAP_SETFCAP` 提案，针对 Linux ≥5.12 的 UID 0 map 条件。 | open、无 review、未发布；候选但不足以覆盖本机 `setgroups` 失败。 |
| [#505](https://github.com/anthropics/sandbox-runtime/pull/505) → [`e3ac597297f9d6db42fd12af9d6973ef16d18d8f`](https://github.com/anthropics/sandbox-runtime/commit/e3ac597297f9d6db42fd12af9d6973ef16d18d8f) | 协作者提交、`dylan-conway` 合并的 root caller `CAP_SETFCAP` 修复。 | merged，随 [`v0.0.76`](https://github.com/anthropics/sandbox-runtime/releases/tag/v0.0.76) 发布；范围不是普通用户。 |

[#505](https://github.com/anthropics/sandbox-runtime/pull/505) 的已发布范围由其 PR/当前实现限定为 root caller，不可外推到当前复现。

> `A root caller now drops everything in both modes and keeps only
> CAP_SETFCAP while the seccomp helper is in use`

当前固定版本仍保留该限制：非 root 直接返回 `['--cap-drop', 'ALL']`，见本笔记[调用链与失败位置](#调用链与失败位置)的源码摘录。`v0.0.77` 是 [`6fa731368807419ee157f9a3fac955fefe1019c6`](https://github.com/anthropics/sandbox-runtime/releases/tag/v0.0.77)；核验时 `main` 比该 tag 仅多两项无关测试/文案提交，不能算一个已发布修复。

仓库未启用 GitHub Discussions；对 issues、PR、评论、reviews、branches、releases 检索的关键词为 `bwrap`、`apply-seccomp`、`nested user namespace`、`uid_map`、`setgroups`、`CAP_SYS_ADMIN`、`EPERM`。直接相关 issues 没有可确认的维护者评论；因此“已知”应严格表述为“已有公开未解决报告 + 维护者合并过相邻 root/CAP_SETFCAP 修复”，而不是“维护者已确认本机根因”。

## 建议给上游的最小补丁

目标不是删除外层 user namespace，也不是接受不带 seccomp 的降级，而是让**受信任的内置 helper**走其已经实现的 direct path，避免依赖宿主是否允许第二层 capability-bearing user namespace：

1. 仅当解析到包内、受信任的 `apply-seccomp` 时，bwrap capability list 加 `CAP_SYS_ADMIN` 和清理它所需的 `CAP_SETPCAP`；自定义 `seccomp.applyPath` / `argv0` 不授予这两个 capability。
2. helper 成功完成 direct `unshare(CLONE_NEWPID | CLONE_NEWNS)`、mount/proc setup 后，在 fork workload 前先 `PR_CAPBSET_DROP(CAP_SYS_ADMIN)` / `PR_CAPBSET_DROP(CAP_SETPCAP)`，再 `capset()` 清空 permitted/effective/inheritable；然后保留既有 `PR_SET_NO_NEW_PRIVS`、seccomp、`execvp`。
3. 为“普通用户 + 外层 `bwrap --unshare-user` + nested userns 被 LSM 禁止”的 integration test 加一条断言：目标命令成功、创建新 `AF_UNIX` socket 被拒绝、workload 的 `CapEff` 与 `CapBnd` 均不含两个临时 capability。

第 1 步直接复用 helper 已存在的 path (a)，证据见[调用链与失败位置](#调用链与失败位置)。第 2 步是必要安全条件：现有源码明确承认仅清 ambient 和设置 `NO_NEW_PRIVS` 不会移除已持有的 capability，特别是 uid 0 workload；因此只加 `--cap-add CAP_SYS_ADMIN` 不是安全的完整修复。

来源：[`apply-seccomp.c#L835-L854`](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/vendor/seccomp-src/apply-seccomp.c#L835-L854)

```c
/* Drop whatever bwrap's --cap-add left in the ambient set ...
 *
 * What the worker ends up with depends on its euid. For a uid-0 caller the
 * kernel's root rule recomputes the permitted set from the bounding set ...
 * the ambient clear and the PR_SET_NO_NEW_PRIVS the worker sets below do not
 * change that, because the worker already holds those capabilities ...
 * Measured (Linux 6.12): capset()ing the three sets empty before that exec
 * does leave the worker with none ... Neither is done here. */
if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) < 0) {
  die("apply-seccomp: prctl(PR_CAP_AMBIENT_CLEAR_ALL)");
}
```

这比 [#418](https://github.com/anthropics/sandbox-runtime/pull/418) 的 `CAP_SETFCAP`-only patch 多一个明确的 capability 清理步骤，但仍是最小正确变更：复用既有 direct path、无需改变 bwrap 的 mount/network 策略、无需让 Jai fork 或维护 seccomp 二进制。若维护者不愿引入短暂 `CAP_SYS_ADMIN`，唯一诚实替代是把此环境报告为“不支持 Unix-socket blocking”，而不是自动执行未覆盖的 shell。

## 来源覆盖

| 来源类别 | 查到了什么 |
| --- | --- |
| 官方文档 / 源码 | 固定 `v0.0.77` / `6fa7313` 的 `linux-sandbox-utils.ts` 与 `apply-seccomp.c`；Linux `user_namespaces(7)` 解释 capability 和 UID 0 map 的规则。 |
| 作者或维护者本人的说法 | #505 由 collaborator 提交、`dylan-conway` 合并，且 release 到 v0.0.76；直接 #417/#428/#498 没有维护者 issue 回复，故未把用户分析写成维护者结论。 |
| 同类方案 | [Flatpak 1.16.0](https://github.com/flatpak/flatpak/blob/1440f4faa67ebf69c7559f31d2cab59e6ec6fe2b/common/flatpak-run.c#L2210-L2237) 明确用 `--disable-userns` 禁止 sandbox 递归 userns；[systemd](https://github.com/systemd/systemd/blob/2c635c7baa58b5501561da35f4218a13243f8b31/src/basic/namespace-util.c#L275-L309) 在无 `CAP_SYS_ADMIN` 时优先进入已提供的 child userns。两者说明嵌套 userns 是需显式设计的能力边界。 |
| issue / PR / 社区实践 | 查 #417、#418、#428、#498、#505 的状态、评论、review、merge 与 release；前四没有已发布完整修复，#505 只覆盖 root caller。 |
| 历史演变 | `v0.0.76` 发布 #505 的 root `CAP_SETFCAP` 修复；`v0.0.77` 仍为 `6fa7313`，核验时最新 npm 版本也为 0.0.77。 |

## 对本项目的影响

Jai 不应把 `@anthropic-ai/sandbox-runtime@0.0.77` 宣称为“普通 Linux 用户均可用的 Unix-socket-seccomp enforcement backend”。对当前 Lima Ubuntu 26 目标，初始化/健康检查应明确拒绝执行，不能以 `allowAllUnixSockets`、移除 helper 或裸 shell 回退。

若上游接受上述 patch，升级验收至少应在该 VM 重跑本节的 trace，并断言：SRT 启动成功、`socket(AF_UNIX, ...)` 被 seccomp 拒绝、workload 不能观察或恢复 `CAP_SYS_ADMIN`/`CAP_SETPCAP`。在这之前，Linux 上若 Unix socket 阻断是必须项，应继续判为 `sandbox_unavailable`。
