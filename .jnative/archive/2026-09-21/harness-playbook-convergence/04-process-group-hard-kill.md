---
jn_type: task
jn_stage: null
jn_state: closed
jn_closed_reason: completed
---

父需求：[Harness Playbook 问题核验与分阶段收敛](./prd.md)
草稿标识：T4

## 交付结果

Unix Shell 中止时，即使父进程在 `SIGTERM` 后先退出，忽略信号的后代进程仍会被约定的进程组 `SIGKILL` 清理，覆盖父 PRD 的 AC8、AC9。

## 范围

做：修正 `NodeExecutionEnvironment` 的 timer 生命周期和完成判定；增加真实进程树回归测试；保持正常退出、超时和 AbortSignal 的现有结果语义。

不做：统一 Job 抽象、Windows Job Object、Sandbox 重设计、后台进程产品语义或进程监控服务。

## 背景与约束

当前 stop 先向进程组发送 `SIGTERM`，再设置 `forceKillTimer`。父 shell close 后 `finally` 清除 timer，可能让忽略 `SIGTERM` 的后代存活。

修复需要避免另一类竞态：进程组已经结束后延迟信号命中复用的 PID/PGID。实施者应基于当前 Node/Unix 能力验证进程组是否仍存在，或采用能证明不会误杀的等价局部方案。本任务不引入新的生命周期层。

Panic 和原生异常只表示 invariant 或未知基础设施故障；可预期的终止结果沿用当前 `Result`/`TaggedError` 语义。

## 前置交付物

无。该任务可与 T1-T3 并行。

## 开始前核对

- 读取父 PRD、当前任务、相关项目规则和前置交接。
- 确认范围已获授权、前置成果在当前环境可用。
- 检查是否已有执行者及工作目录中的重叠改动；冲突时不接管或覆盖。

## 验收条件

- [x] 中止运行中的 shell 后立即发送现有 `SIGTERM`。
- [x] 父 shell 在 `SIGTERM` 后先退出时，不会仅因 close/finally 清除仍需要的硬杀。
- [x] 忽略 `SIGTERM` 的后代进程在宽限期后不再存活。
- [x] 正常完成的命令不会等待额外一秒，也不会收到延迟 `SIGKILL`。
- [x] Abort、timeout 和显式 stop 路径共享一致的清理保证。
- [x] 回归测试在 Unix 环境稳定复现旧竞态，并在 Windows 上按现有测试约定跳过或验证不适用。

## 检查方式

在仓库根目录运行：

```bash
bun run --cwd packages/agent typecheck
bun test packages/agent
```

测试需记录用于确认后代 PID 已退出的断言方式，避免只检查父进程 close。

检查未通过或缺少证据时保持任务打开。完成后执行记录写入实际输出、代码位置、局部决定、限制和交接，才能以 completed 关闭。

## 执行记录

2026-09-21，Codex 在 `/Users/jayden/code/jai-mono` 完成，未提交。

- `stop()` 仍立即向 Unix 进程组发送 `SIGTERM`，并保留 1 秒后的进程组 `SIGKILL`。
- 硬杀 timer 使用捕获的 PGID 且 `unref()`；父 shell close 后，仅当该进程组仍存在时保留 timer，避免正常完成等待和已结束进程组的延迟信号。
- Abort、timeout、输出超限和输出回调失败继续共享同一 `stop()` 清理路径；Windows 保持现有 child kill 行为。
- 新增真实 Unix 回归：后台 Node 后代忽略 `SIGTERM`、关闭标准流，父 shell 先退出；断言执行返回 `shell.aborted` 后，记录的后代 PID 在宽限期后不再存在。Windows 跳过。
- `bun run --cwd packages/agent typecheck`：通过。
- `bun test packages/agent`：245 pass，0 fail。
- `git diff --check`：通过。

改动位置：`packages/agent/src/harness/node/environment.ts`、`packages/agent/test/harness/node/environment.test.ts`。
