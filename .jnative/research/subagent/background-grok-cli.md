# 后台/异步 Agent 机制调研：Grok Build（`grok` CLI）

核验日期：2026-09-28（UTC+8）。源码引证统一钉死 commit `f0e3be1100ef5252488e3be8bb0e91cf68d8c305`（`main` 分支 2026-09-23 同步提交）；文档引证为 `docs.x.ai` 2026-09-28 线上版本（文档站无版本号，按访问日期引用）。钉住的原因：monorepo 同步提交会浮动行号，且 `background`→`run_in_background` 正在改名期，不钉 commit 会混进新旧两种字段名。

> 结论前置：**无需替换为 Gemini CLI**。“grok cli”指 xAI 官方产品 **Grok Build**（`grok` 命令），有官网、官方文档站与公开源码仓库。本笔记只记录 Grok Build 的后台机制，不涉及 Claude Code / Codex，不评价优劣。

---

## 结论

1. 后台 subagent 字段名为 `run_in_background`（默认 `true`），旧名 `background` 为同一语义曾用名；命令侧用 `run_terminal_command(background: true)`。见[官方 subagents 指南 @ f0e3be1]([16-subagents.md @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md))。
2. 取结果统一入口 `get_command_or_subagent_output`：省略/`0` 为非阻塞快照，正值等待并钳制 1 小时；多任务等待另有 `wait_commands_or_subagents`（默认 30s）。见[官方 background-tasks 指南 @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md)。
3. 完成经三通道回到对话：对话内通知 + “Task completed” chip + 顶部常驻状态行；等待返回而任务未完时不得杀，完成会自动唤醒父 agent。见[官方 background-tasks 指南 @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md)。
4. 后台归属 session：每 session 一个 `BackgroundTaskRegistry`，session 清理连带清理，ID 只需 session 内唯一；subagent 树扁平、最大深度 1。见[源码 background_task.rs @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/terminal/background_task.rs)。
5. 量化限制：每 session 后台 ≤10（满先清已完成）、单次取回 task ID ≤20、kill 对 shell 先 SIGTERM 再 SIGKILL、对 subagent 发 Cancel+Shutdown。见[源码 background_task.rs @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/terminal/background_task.rs)。

---

## 1. 产品确认（仓库 / 官网 / 版本）

### F1. 官方产品是 Grok Build，命令为 `grok`，源码仓库为 `xai-org/grok-build`（Rust，Apache-2.0）

- 链接（仓库 README，`main` 分支）：https://github.com/xai-org/grok-build
- 链接（官网产品页）：https://x.ai/cli
- 链接（官方文档总览）：https://docs.x.ai/build/overview
- 链接（发布公告）：https://x.ai/news/grok-build-cli

> Grok Build is SpaceXAI's terminal-based AI coding agent. It runs as a full-screen TUI that understands your codebase, edits files, executes shell commands, searches the web, and manages long-running tasks — interactively, headlessly for scripting/CI, or embedded in editors via the Agent Client Protocol (ACP).

> This repository contains the Rust source for the `grok` CLI/TUI and its agent runtime. It is synced periodically from the SpaceXAI monorepo.

> The binary artifact is named `xai-grok-pager`; official installs ship it as `grok`.

- 安装方式（文档原句）：

> `curl -fsSL https://x.ai/cli/install.sh | bash`

- 排除项：社区另有一个同名但无隶属关系的 TypeScript 项目 `superagent-ai/grok-cli`，且两者都会安装名为 `grok` 的二进制，会互相覆盖。本笔记所有机制结论均不适用于它。

### F2. 版本钉死：源码侧以 commit SHA 为准；发布侧无 GitHub Releases，版本靠 `grok version` / `grok update` 自查

- 源码钉死 commit：`f0e3be1100ef5252488e3be8bb0e91cf68d8c305`（2026-09-23T16:52:41Z，`grokkybara[bot]` 的 monorepo 同步提交）。
  - 链接：https://github.com/xai-org/grok-build/commit/f0e3be1100ef5252488e3be8bb0e91cf68d8c305
- `GET /repos/xai-org/grok-build/releases?per_page=5` 在调研时返回空数组（无 GitHub Release）。
  - 链接：https://api.github.com/repos/xai-org/grok-build/releases?per_page=5
- CLI 内置版本能力（文档 `CLI Reference`）：`grok version` 打印版本信息；`grok update` 检查更新或安装指定版本（`--check`、`--version <ver>`、`--alpha`、`--stable`）。
  - 链接：https://docs.x.ai/build/cli/reference

> | `grok update` | Check for updates or install a specific version (`--check`, `--version <ver>`, `--alpha`, `--stable`) |
> | `grok version` | Print version information |

- 模型版本注记：官网曾写“powered by Grok 4.6”，文档页在调研时写 `grok-4.7` 为最新模型。模型版本 ≠ CLI 版本，引用机制结论时不受影响。

---

## 2. 后台启动方式（命令 / 参数 / 字段名）

### F3. 后台命令：`run_terminal_command` 置 `background: true`，立即返回 `task_id`

- 链接（钉死 commit 的用户指南）：[20-background-tasks.md @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md)
- 链接（文档站同题页面）：https://docs.x.ai/build/features/background-tasks

> Set `background: true` on the `run_terminal_command` tool to run a command in the background. It returns a task ID immediately; retrieve output with `get_command_or_subagent_output`.

> 1. The agent calls `run_terminal_command` with `background: true`.
> 2. The command starts in the background.
> 3. The agent receives a `task_id` for later reference.
> 4. When the command completes, a notification appears in the conversation.

- 人工触发的两种等价方式（同一文档页）：TUI 中按 `Ctrl+B` 把正在运行的前台命令转后台；在 scrollback 里发新消息也会把当前命令转后台而非杀死。

> In the interactive TUI, press `Ctrl+B` to send the running foreground command to the background. It is the only backgrounding shortcut, though sending a new message mid-command also backgrounds that command instead of killing it.

### F4. 后台 subagent：`spawn_subagent` 置后台位，返回 subagent ID；当前文档中的字段名为 `run_in_background`（默认为 `true`），旧文案中的 `background` 为同一语义的曾用名

- 链接（钉死 commit）：[16-subagents.md @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md)

> The main agent calls the `spawn_subagent` tool. Its parameters:

| 参数（原文表头） | 原文说明 |
| --- | --- |
| `prompt` | The full task prompt for the subagent. |
| `description` | A short label for the task (3-5 words). |
| `run_in_background` | Run in the background and return a subagent ID. Defaults to `true`. |
| `isolation` | `none` (shared workspace, the default) or `worktree` (isolated git worktree). |
| `resume_from` | Continue a completed subagent's conversation. Pass its subagent ID. |
| `cwd` | Working directory for the subagent. Mutually exclusive with `isolation: worktree`; ignored when `resume_from` is set (the resumed child inherits its source's directory). |

> When you run a subagent in the background, retrieve its result later with `get_command_or_subagent_output`.

- 注意：第三方搜索摘要里常见的 `background`（默认 `false`）是该字段的旧名；以钉死 commit 的源码文档为准，字段名为 `run_in_background`，默认 `true`。跨版本引用时需注明所用 commit。
- 文件并行隔离：`isolation: worktree` 让子 agent 在独立 git worktree 拷贝中工作，结果中包含 worktree 路径；合并靠普通 git 操作或 `x.ai/git/worktree/*` 扩展方法（含 apply）。

> For tasks that modify files, run a subagent in an isolated git worktree with `isolation: worktree`. This keeps the child's edits from conflicting with the parent's.

### F5. 周期性后台：`/loop <interval> <prompt>`；实时流式后台：`monitor` 工具；底层 API：`scheduler_create`

- 链接：https://docs.x.ai/build/features/background-tasks（`/loop` 与 monitor 小节）与上面 F3 的同一指南文件（Scheduler 章节）。

> `/loop` runs a prompt on a recurring interval … The interval accepts `Ns` (minimum 60), `Nm`, `Nh`, and `Nd`. The prompt fires immediately, then repeats; each firing is a new agent turn.

> For real-time event streams rather than periodic checks, the agent can attach a monitor to a script: each line the script prints becomes a notification in the conversation.

`scheduler_create` 参数（指南原文表）：

| Parameter | Description |
| --- | --- |
| `interval` | How often to run: `"5m"`, `"2h"`, `"1d"`, `"60s"` |
| `prompt` | The prompt text to execute on each fire |
| `fire_immediately` | Fire on creation in addition to the interval (default: `false`) |
| `recurring` | Repeat (default: `true`) or fire once (`false`) |
| `durable` | Persist across sessions (default: `false`) |

> Every fire runs in a detached background subagent; there is no option to run one as a turn in the conversation.

- 选型口诀（指南原句）：one-shot 长命令用 `background`；周期检查用 `/loop`；实时事件流用 `monitor`；延迟一次性任务用 `scheduler_create` + `recurring: false`。

---

## 3. 结果如何取回

### F6. 统一取回入口：`get_command_or_subagent_output`（单查/等待）；多任务等待：`wait_commands_or_subagents`；终止：`kill_command_or_subagent`

- 链接（钉死 commit，指南“Getting Output / Killing”两节）：https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md

> Use `get_command_or_subagent_output` to check a background command or subagent. Pass `task_ids` as a list (one id is a one-element array; maximum 20):
> - Omit `timeout_ms`, or pass `0`, for a non-blocking snapshot.
> - A positive `timeout_ms` waits for completion. Several ids wait until **all** complete.

> A positive `timeout_ms` is clamped to **1 hour** (`3600000` ms). Hosts with a shorter transport deadline set `GROK_MAX_WAIT_BLOCK_MS` (plain milliseconds; unparseable values keep the default).

> If the wait returns while the child is still running, leave it alone: do not kill it or tell it to stop. Completion wakes the parent automatically. Poll again only if you need another snapshot.

> Use `kill_command_or_subagent(task_id)` to terminate a running background task or subagent. The tool sends SIGTERM, then SIGKILL, to shell processes, and sends Cancel and Shutdown to subagents. It reports success if the task was killed or had already exited.

- `wait_commands_or_subagents` 字段（同页）：

> - `task_ids` — the list of task IDs to wait for (maximum 20)
> - `mode` — `wait_any` returns when the first task completes; `wait_all` waits for every task
> - `timeout_ms` — the maximum time to wait, in milliseconds (default: 30 seconds)

- 存储语义（源码注释，`background_task.rs`，钉死 commit；行号为该 commit 下 blob 视图行号，±3 行内有效）：
  - 链接：[background_task.rs @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/terminal/background_task.rs)

```rust
// background_task.rs (pinned f0e3be1, L8-L24)
//! Background task registry for tracking long-running commands.
//!
//! This module provides a per-session registry for background tasks that allows
//! the model to query task status and output after launching commands with
//! `is_background: true`.
//!
//! ## Architecture
//! - `StreamingLocalTerminalRunner` handles process spawning and output streaming
//! - `BackgroundTaskRegistry` provides model-facing queries by task_id
//!
//! ## Output Storage
//! 1. **In memory (`output` field)**: May be truncated if > output_byte_limit
//! 2. **On disk (`output_file`)**: Full output written incrementally
```

```rust
// background_task.rs (pinned f0e3be1, L90-L105)
//! Per-session registry for background tasks.
//! Each session has its own instance via `ToolContext.background_tasks`.
//! - Task IDs only need to be unique within a session
//! - Session cleanup automatically cleans up tasks
//! - No global state pollution between agents
pub struct BackgroundTaskRegistry {
    tasks: Mutex<HashMap<TaskId, Arc<TaskEntry>>>,
    max_tasks: usize,
}
/// Default maximum number of concurrent background tasks per session
const DEFAULT_MAX_BACKGROUND_TASKS: usize = 10;
```

```rust
// background_task.rs (pinned f0e3be1, L130-L163)
//! Register: at capacity →先清已完成，仍满则报错
pub async fn register(&self, snapshot: TaskSnapshot) -> Result<(), String> {
    let mut tasks = self.tasks.lock().await;
    if tasks.len() >= self.max_tasks {
        tasks.retain(|_, entry| { /* keep if not completed */ });
        if tasks.len() >= self.max_tasks {
            return Err(format!(
                "Maximum background tasks ({}) reached. \
                 Wait for tasks to complete or kill existing tasks.",
                self.max_tasks
            ));
        }
    }
    // insert TaskEntry { snapshot, exit_notify }
}
```

```rust
// background_task.rs (pinned f0e3be1, L184-L228, 节选)
//! Mark task as completed: set end_time/exit_code/signal, notify waiters.
pub async fn mark_completed(&self, task_id: &str, exit_code: Option<i32>, signal: Option<String>) {
    // snapshot.completed = true; snapshot.end_time = Some(Utc::now());
    // entry.exit_notify.notify_waiters();
}
/// Wait for task completion with optional timeout; None = task_id 未找到
pub async fn wait_for_completion(&self, task_id: &str, timeout: Option<Duration>) -> Option<TaskSnapshot> {
    // 先订阅 exit_notify 再检查 completed，防止完成通知在检查与等待之间丢失
}
```

---

## 4. 完成通知如何回到对话

### F7. 三通道：对话内通知 + “Task completed” chip + 顶部常驻状态行；等待中的 turn 可被新消息打断但后台任务继续跑

- 链接：同 F3 指南文件（How It Works 第 4 步、Still-Running Status Line 章节）与文档站后台页。

> 4. When the command completes, a notification appears in the conversation.

> Whenever background work is still running while the agent looks idle … a persistent status line appears above the prompt: `◎ 1 command · 2 monitors · 1 loop · 1 subagent still running`

> It counts running background commands, monitors, scheduled `/loop` tasks, and background subagents, and updates live as each finishes. Any of them can wake the agent for a new turn (commands and subagents on completion, monitors on events, loops on their timer), so the cue stays up until nothing is left.

> The running counts live only on this status line: completions land in the transcript as a single "Task completed" chip, and "Worked for" markers stay plain — the transcript never repeats or restates the running counts.

> While a turn is waiting on background work (blocked in `get_command_or_subagent_output`), the status line adds a hint that typing takes over immediately: `◎ 1 command still running · send a message to interrupt`

> Sending a message interrupts the wait and runs your message right away.

- TUI 可视位置：`Ctrl+G` 切 tasks pane（子 agent / 后台命令 / monitor / `/loop` 集中列表，带 task ID 与 live 行数 badge）；`Ctrl+;` 切 prompt queue 面板；scrollback 里子 agent 有 `Subagent running …` / 后台有 `Subagent started: "…"` 生命周期块，完成后再追加 `Subagent completed/failed/cancelled in Xs` 块。
- monitor 的特殊性：脚本每输出一行即成为一条对话通知，因此要求过滤器收紧（`grep --line-buffered`），输出过大时会被自动停止。

> Keep monitor scripts selective — every output line interrupts the conversation.

> If a monitor produces too many events, Grok stops it automatically.

---

## 5. 任务与发起会话的生命周期关系

### F8. 后台命令/SCM 任务归属 session：每个 session 一个 `BackgroundTaskRegistry`（经 `ToolContext.background_tasks`），session 清理时自动清理其任务；task ID 只需 session 内唯一

- 链接（源码，钉死 commit）：https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/terminal/background_task.rs（见 F6 的 L90-L105 代码块摘录）。

> Each session has its own instance via `ToolContext.background_tasks`. … Session cleanup automatically cleans up tasks … Task IDs only need to be unique within a session.

### F9. Subagent 树是扁平的：只有顶层 session 能 spawn，最大嵌套深度为 1；`resume_from` 只能接“已完成 + 同 session + 同 agent 类型”的子 agent

- 链接（钉死 commit）：[16-subagents.md @ f0e3be1](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md)

> Only the top-level session spawns subagents. A subagent cannot spawn its own subagents: the maximum nesting depth is one. If a subagent calls `spawn_subagent`, the call fails with a depth-limit error.

> The new subagent inherits the source's transcript, tool state, and model; its system prompt and tools are re-rendered from the current agent definition. The source must be completed (not running), belong to the current session, and use the same agent type.

### F10. `/loop` 每次触发运行在 detached 后台 subagent 中，看不到发起会话的对话；worktree 比 session 活得久，session 结束不会删除 worktree

- 链接：同 F5/F9 的两个指南文件；worktree 文档站页面 https://docs.x.ai/build/features/worktrees。

> Each firing runs in a detached background subagent, not as a turn in your conversation. The fire cannot see the conversation, so the stored prompt must stand on its own; only its result comes back.

> Worktrees persist until you remove them: ending or deleting a session leaves its worktree in place, and `gc` runs only when you invoke it.

> A worktree is a real git checkout, detached at its base commit; land changes with ordinary git.

- Headless 模式的生命周期对照（非后台，但在脚本场景常被混淆）：`grok -p "<prompt>"` 为单 prompt 非交互执行，全工具访问，响应完成即进程退出；默认每次调用开新 session，跨调用保持上下文需 `-r/--resume` 或 `-c/--continue`。

> Headless mode runs Grok non-interactively from the command line. It accepts a single prompt, executes it with full tool access, and returns the result. … Grok processes the prompt, runs any necessary tools, and prints the result to stdout. The process exits when the response is complete.

---

## 6. 并发 / 数量限制（可量化）

| 对象 | 限制 | 来源 |
| --- | --- | --- |
| 每 session 后台命令注册表 | `DEFAULT_MAX_BACKGROUND_TASKS = 10`；满时先清已完成，仍满则注册报错 | 源码 `background_task.rs`（F6 代码块 L104-L105、L130-L163） |
| 单次取回/等待的 task ID 数 | `task_ids` 数组最多 **20** 个（`get_…` 与 `wait_…` 同限） | 指南 F6 摘录 |
| `wait_commands_or_subagents` 默认等待 | `timeout_ms` 默认 **30 秒**（`get_…` 的 `timeout_ms` 省略或 `0` = 非阻塞快照） | 指南 F6 摘录 |
| subagent 嵌套深度 | 最大 **1**（子 agent 再调 `spawn_subagent` 直接报 depth-limit 错误） | 指南 F9 摘录 |
| 调度任务总数 | 最多 **50** 个 active scheduled tasks | 文档站 `/loop` 小节 |
| `/loop` 间隔 | `Ns` 最小 **60 秒**；支持 `Nm`/`Nh`/`Nd` | 文档站 `/loop` 小节 |
| `/loop` 有效期 | 自动 **7 天**过期 | 文档站 `/loop` 小节 |
| `send_subagent_message` 配额 | 每 sender-target 对最多 **4** 条 in-flight；每 sender 每次尝试最多 **32** 条 outbound，超限返回 `QuotaExceeded` | `16-subagents.md`（Sending messages 小节） |
| worktree 位置与清理 | 路径 `~/.grok/worktrees/`；只在显式调用时 `gc`（`--max-age 7d` 可过期空闲项） | 文档站 Worktrees 页 |

`GROK_MAX_WAIT_BLOCK_MS`（纯毫秒数、解析失败则保持默认）允许宿主收紧传输层等待上限；正 `timeout_ms`钳制到 **1 小时**（`3600000` ms）。

---

## 7. 失败与超时的行为

### F11. 等待返回时任务仍在跑 → 不要杀、不要叫停，完成会自动唤醒父 agent；`timeout_ms` 语义为“最多等多久”，不是任务的执行 deadline

- 链接：同 F6 指南文件。

> If the wait returns while the child is still running, leave it alone: do not kill it or tell it to stop. Completion wakes the parent automatically. Poll again only if you need another snapshot.

### F12. kill 语义：shell 进程先 SIGTERM 再 SIGKILL；subagent 发 Cancel + Shutdown；已退出也报成功

- 链接：同 F6 指南文件（见 F6 摘录，不重复贴）。

### F13. 可观测的失败面：`Subagent completed/failed/cancelled in Xs` 回写 scrollback；静默唤醒失败会留 `Turn failed` 行；monitor 过载被自动停止；`spawn_subagent` 解析失败（persona 不存在/无指令/指令文件不可读）直接 spawn 失败

- 链接：`16-subagents.md`（Viewing / Persona Resolution 小节）与 `20-background-tasks.md`（Volume Control / Status Line 小节）。

> For blocking subagents the single entry updates its bullet color when the child finishes. For background ones, a follow-up `Subagent completed/failed/cancelled in Xs: "..."` block is appended.

> If a persona is requested but cannot be resolved — it is not found, has no instructions, or its `instructions_file` is unreadable — the spawn fails.

> a wake the agent answers silently leaves no trace in the transcript — unless it fails, in which case a "Turn failed" line appears even for a silent wake, so a standing instruction never stops executing invisibly.

### F14. 前台转后台不杀任务：`Ctrl+B` 或中途发新消息只改变等待方式，任务继续运行并在完成时通知

- 链接：同 F3 指南文件。

> The task keeps running, and you receive a notification when it completes.

---

## 待验证（找不到原文，不支撑结论）

1. **后台命令默认超时/上限执行时长**：只找到等待侧钳制（1 小时）与 `GROK_MAX_WAIT_BLOCK_MS`，没找到“任务本身最多跑多久会被杀”的原文。缺：源码或文档中任务执行 deadline / 默认 shell 超时的字段名与数值。
2. **`BackgroundTaskRegistry` 行号的逐行稳定性**：`background_task.rs` 在 blob 视图的精确行号随 monorepo 同步浮动，本笔记行号标注 ±3 行有效；缺：在目标 commit 下对该文件的逐行复核（当时只能抓到文件内容快照，未做二次 blob 行号对齐）。
3. **ACP 嵌入模式下的后台语义差异**：官方只说支持 ACP（`grok agent stdio`），没找到后台任务在 ACP 通道下的通知映射原文。缺：ACP 侧的事件/方法名。
4. **计费/配额（token、并发 session 数、SuperGrok 订阅限制）**：发布页只写 early beta 面向 SuperGrok / X Premium Plus 订阅者，无数字。缺：官方定价或配额页。
5. **Windows 行为差异**：源码注释提到 Windows 下 worktree 离线清理等零散差异，但后台 kill（SIGTERM/SIGKILL）在 Windows 的等价实现没找到原文。缺：Windows 分支的 kill 实现摘录。

---

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `xai-org/grok-build` 公开源码（钉死 `f0e3be1`：`16-subagents.md`、`20-background-tasks.md`、`background_task.rs`）+ `docs.x.ai` 文档站（2026-09-28 快照）+ `x.ai/cli` 官网与发布公告 |
| 作者或维护者本人的说法 | 未找到个人博客/RFC/issue 回复；官方文档站与源码注释即第一方口径，见结论 1–5 引证 |
| 同类方案 | 不适用（本笔记是三份对比中的 Grok 一方；Claude/Codex 见同目录另两份笔记） |
| issue / PR / 社区实践 | 未查（机制结论已被官方文档与源码完全覆盖；社区同名项目 `superagent-ai/grok-cli` 已排除，不适用本笔记） |
| 历史演变 | 查到了：`background`→`run_in_background` 改名期（旧名见第三方摘要，源码文档已用新名）；模型版本注记（Grok 4.6→4.7，与机制无关） |

## 对本项目的影响

- 参数命名跟随 `run_in_background`（结论 1，三家中有两家用此名），本项目 `SpawnAgent` 的 `background` 应改名。
- 取结果语义直接对标 F6：`timeoutMs` 省略/无限等待、正值有界等待、`0` 非阻塞快照——本项目 `GetAgentResult` 已是此语义，保留；“等待返回而任务未完时不要杀”写进工具描述。
- 通知三通道中本项目只取“对话内通知”（`beforeModelCall` reminder），状态行/chip 是 TUI 层的事，不做。
- 注册表语义（结论 4–5）支持 per-session Map + ID session 内唯一 + 满时报错：本项目 `background: Map` + `bg-{seq}` + 共用 4 并发上限，方向一致；暂不做“满时先清已完成”的淘汰（4 槽小，不值得）。
