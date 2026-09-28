# Codex CLI 后台 / 异步任务机制调研笔记

核验日期：2026-09-28。源码链接一律钉死 commit SHA（`blob/<SHA>` 或 `raw/<SHA>`，见各节）；文档为 developers.openai.com 与 learn.chatgpt.com 2026-09-28 快照。行号为抓取当日 raw 快照人工计数，仅用于定位，如与最新 main 有漂移以 SHA 快照为准。钉住的原因：main 持续演进（如 wake 机制正在实验），不钉 SHA 无法区分 stock 行为与提案。

- 范围：OpenAI Codex CLI 本地进程内异步能力 + Codex cloud 后台任务。不含 Claude Code / Gemini CLI，不做优劣评价。
- 方法：只用公开网络资源（GitHub `openai/codex` 源码 permalink、developers.openai.com 官方文档、维护者参与的 issue）。第三方博客仅作线索，不支撑结论。

---

## 结论

1. 本地 CLI 没有独立的“后台任务”命令；长时间 shell 靠 `unified_exec` 会话机制：`exec_command` 启动并有界等待（`yield_time_ms`），返回 `session_id` 后靠 `write_stdin(session_id, chars="")` 空写轮询取回输出。见[`local_tool.rs @ 35aaa5d9`](https://github.com/openai/codex/blob/35aaa5d9/codex-rs/tools/src/local_tool.rs)。
2. stock CLI 中后台完成不会自动唤醒 idle 会话：完成事件只在轮询或 turn 活跃时被观察；事件驱动唤醒（`on_exit: wake` / async watcher）处于 issue 提案与实验阶段。见[issue #32188](https://github.com/openai/codex/issues/32188)。
3. 真正的 fire-and-forget 后台由 Codex cloud 承载：`codex cloud exec --env` 提交，`status` / `list --json` 轮询，`diff` / `apply` 取回；任务独立于本地会话存活。见[官方 cloud 文档](https://developers.openai.com/codex/cloud)。
4. 生命周期不对称：本地后台终端归属 session，会话关闭时 `terminate_all_processes()` 全杀；cloud 任务不受本地会话结束影响。见[`session/handlers.rs @ 27c05a52`](https://github.com/openai/codex/blob/27c05a52/codex-rs/core/src/session/handlers.rs)。
5. 硬数字只有三处：`exec_command` 初次 yield 上限 30s（等待上限非进程超时）、cloud `exec --attempts` 取值 1–4、cloud `list --limit` 取值 1–20；subagent 并发上限键存在但默认值未公开。见[`cloud-tasks cli.rs @ f1affbac`](https://raw.githubusercontent.com/openai/codex/f1affbac/codex-rs/cloud-tasks/src/cli.rs)。

---

## 2. 后台启动方式（本地 CLI：unified_exec 会话）

### 2.1 主张：启动命令是工具 `exec_command`，参数为 `cmd / workdir / shell / tty / yield_time_ms / max_output_tokens`，语义是“PTY 中运行，返回输出或可继续交互的 session ID”

- 链接：[`local_tool.rs @ 35aaa5d9`](https://github.com/openai/codex/blob/35aaa5d9/codex-rs/tools/src/local_tool.rs)（commit `35aaa5d9`）
- 摘录（源码，`create_exec_command_tool`，行号为快照内相对行）：

```rust
1  pub fn create_exec_command_tool(options: CommandToolOptions) -> ToolSpec {
2      let mut properties = BTreeMap::from([
3          ("cmd".to_string(), JsonSchema::string(Some("Shell command to execute.".to_string()))),
4          ("workdir".to_string(), JsonSchema::string(Some(
5              "Optional working directory to run the command in; defaults to the turn cwd."))),
6          ("shell".to_string(), JsonSchema::string(Some(
7              "Shell binary to launch. Defaults to the user's default shell."))),
8          ("tty".to_string(), JsonSchema::boolean(Some(
9              "Whether to allocate a TTY for the command. Defaults to false (plain pipes); ..."))),
10         ("yield_time_ms".to_string(), JsonSchema::number(Some(
11             "How long to wait (in milliseconds) for output before yielding."))),
12         ("max_output_tokens".to_string(), JsonSchema::number(Some(
13             "Maximum number of tokens to return. Excess output will be truncated."))),
14     ]);
15     // ...
16     // description:
17     "Runs a command in a PTY, returning output or a session ID for ongoing interaction."
```

- 同一工具在 v0.137.0 发布包中的 `yield_time_ms` 描述更量化（第三方镜像 fossies，仅作旁证，主张以上一条为准）：

> "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms."

### 2.2 主张：取回/驱动同一后台进程的命令是 `write_stdin`，参数为 `session_id / chars / yield_time_ms / max_output_tokens`；空 `chars` 即后台轮询

- 链接：https://raw.githubusercontent.com/openai/codex/31519549/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs（commit `31519549`）
- 摘录（源码，行号按 raw 快照计数）：

```rust
20  #[derive(Debug, Deserialize)]
21  struct WriteStdinArgs {
22      // The model is trained on `session_id`.
23      session_id: i32,
24      #[serde(default)]
25      chars: String,
26      #[serde(default = "super::default_write_stdin_yield_time_ms")]
27      yield_time_ms: u64,
28      #[serde(default)]
29      max_output_tokens: Option,
30  }
```

```rust
101     fn pre_tool_use_payload(&self, _invocation: &ToolInvocation) -> Option {
102         // `write_stdin` is transport for an existing exec session. Empty writes
103         // are background polls, and non-empty writes continue a command that
104         // already ran PreToolUse as Bash, so do not emit a second pre hook here.
105         None
106     }
```

- 同文件注释进一步确认“空 stdin = 后台轮询”（约第 83–87 行）：

```rust
83  // Empty stdin is a background poll, so emit it only while there is
84  // still a live process for the UI to wait on. Non-empty stdin is a real
85  // terminal interaction and should remain visible even if it completes
86  // the process before the response returns.
```

### 2.3 主张：用户侧管理后台终端的命令是 `/ps`（查看）和 `/stop`（alias `/clean`，停止该会话的全部后台终端）

- 链接（官方文档，访问 2026-09-28）：https://learn.chatgpt.com/docs/developer-commands
- 摘录（文档原句）：

> `/ps` | Show background terminals and their recent output. | Check long-running commands without leaving the main transcript.
> `/stop` | Stop all background terminals. | Cancel background terminal work started by the current session.

- 注意措辞“started by the current session”：后台终端归属当前会话（与 §5 生命周期结论呼应）。
- 单个终端定点 kill（`terminate_process(process_id)` / `/stop <id>`）在 issue #17821 中是提案状态，stock 是否合并见 §7 待验证。

### 2.4 主张：`codex exec` 是前台阻塞、跑完即退出的非交互入口，默认 approval 为 never；它不是后台机制

- 链接：https://github.com/openai/codex/blob/85034b18/codex-rs/exec/src/lib.rs（commit `85034b18`）
- 摘录（源码注释/配置构造，搜索摘要原文）：

```rust
// Load configuration and determine approval policy
// Default to never ask for approvals in headless mode. Feature flags can override.
approval_policy: Some(AskForApproval::Never),
```

- 官方配置文档（访问 2026-09-28）对适用策略的原句：https://developers.openai.com/codex/config-reference

> `on-failure` is deprecated; use `on-request` for interactive runs or `never` for non-interactive runs.

---

## 3. 完成通知如何回到对话（本地 CLI）

### 3.1 主张（stock 行为）：后台完成只通过 `write_stdin` 轮询被观察；若发起 turn 已结束且无人轮询，会话保持 idle，任务完成被静默忽略——没有自动 continuation turn

- 链接：[issue #32188](https://github.com/openai/codex/issues/32188) — 《Event-driven wakeup when background exec sessions complete》（需求 issue，含复现与源码级定位）
- 摘录（issue 原文）：

> Long-running commands currently require the model to poll `write_stdin`, remain inside a long-running tool call, or delegate monitoring to a subagent. Repeated polling creates additional model turns, while a monitoring subagent adds its own context and reasoning costs.
>
> Codex already waits for background processes asynchronously and emits an `ExecCommandEnd` event when they exit. It would be useful to optionally wake an idle thread when that event occurs.

> In stable 0.145.0 and current `main`, `on_command_execution_completed` records the process end and then returns when `bottom_pane.is_task_running()` is false. That idle path does not enqueue pending work or start a turn.

- 同一 issue 的对照实验摘录（证明等待期零 inference、但唤醒缺失）：

> A tracked `sleep 2` completion reached Codex when the originating model turn was still active. The background process manager and completion-event path therefore work. The missing transition is specifically from an idle completion to new model inference.

### 3.2 主张：子 agent 完成通知同样默认不唤醒 idle 父会话（`trigger_turn = false`），靠后续用户 turn 或状态读取才被消费

- 链接：https://github.com/openai/codex/issues/15723 — 《Background subprocesses/subagents do not wake the calling agent on completion》
- 摘录（issue 原文）：

> Background unified_exec completions were only surfaced through write_stdin, so if the originating turn had already ended and nobody polled, the session stayed idle forever.
> Sub-agent completion notifications used trigger_turn = false, so an idle parent never woke up.

> In Codex 0.146.1, an explicitly started parallel child batch can finish while the parent is idle. Completion watcher queues parent mailbox receipts with trigger_turn=false, so no parent continuation starts until a later user turn or status/read operation.

### 3.3 主张：期望的事件驱动语义（idle→零 token 等待→退出时恰好一次 continuation，含 exit code/duration/有界输出；turn 活跃则排队；`write_stdin` 已消费则去重；取消/关闭不唤醒）在 issue 中是“请求的行为”，stock 默认不提供

- 链接：同 §3.1（#32188）与 https://github.com/openai/codex/issues/33542（《Event-driven background task callbacks》，状态 open）
- 摘录（#32188 所列 requested behavior 原文）：

> - Let the current turn finish while the process continues without model inference.
> - Start exactly one continuation turn if the tracked process exits while the thread is idle.
> - Queue the completion if another turn is active, rather than starting concurrent inference.
> - Include bounded exit status, duration, and output.
> - Suppress a later wake if `write_stdin` already consumed the completion.
> - Preserve completions that race with the final-answer boundary.
> - Coalesce multiple near-simultaneous completions.
> - Avoid wakeups caused by cancellation, kill, interrupt, or session shutdown.

- 摘录（#33542 期望流程原句，状态 open，2026-07-16 创建）：

> Start background task → session becomes idle → zero-token waiting → task exits → original thread wakes up → Codex continues automatically

- 关于“已有可运行实现但在生产浸泡中”（`on_exit: wake` / async watcher 改动，引用 #32188 评论 `issuecomment-4998087054`）的说法来自 issue 参与者留言，非维护者合并声明，是否进入 stock 列入 §7 待验证。

---

## 4. Codex cloud 后台任务（独立于本地会话的机制）

### 4.1 主张：cloud 是官方定位的并行/后台执行面，“任务在云端容器跑，本地机器不被占用”

- 链接（官方文档，访问 2026-09-28）：[Codex cloud](https://developers.openai.com/codex/cloud)
- 摘录（文档原句）：

> With Codex cloud, Codex can work on tasks in the background (including in parallel) using its own cloud environment.

> Return to Codex, choose your environment, and describe the result you want. You can watch the task logs or let the task run in the background.

> Review the summary and diff. Ask Codex to make follow-up changes, or open a pull request when the work is ready.

### 4.2 主张：CLI 启动/查询/取回 cloud 任务的命令与参数名如下（`cloud` 标记为 EXPERIMENTAL）

- 链接：[`cloud-tasks cli.rs @ f1affbac`](https://raw.githubusercontent.com/openai/codex/f1affbac/codex-rs/cloud-tasks/src/cli.rs)（commit `f1affbac`，行号按 raw 快照计数）
- 摘录（子命令表，约第 15–27 行）：

```rust
15  #[derive(Debug, clap::Subcommand)]
16  pub enum Command {
17      /// Submit a new Codex Cloud task without launching the TUI.
18      Exec(ExecCommand),
19      /// Show the status of a Codex Cloud task.
20      Status(StatusCommand),
21      /// List Codex Cloud tasks.
22      List(ListCommand),
23      /// Apply the diff for a Codex Cloud task locally.
24      Apply(ApplyCommand),
25      /// Show the unified diff for a Codex Cloud task.
26      Diff(DiffCommand),
27  }
```

- 摘录（`exec` 参数，约第 29–52 行）：启动 = `codex cloud exec --env ENV_ID [--attempts N] [--branch BRANCH] ["QUERY"]`

```rust
29  pub struct ExecCommand {
30      /// Task prompt to run in Codex Cloud.
31      #[arg(value_name = "QUERY")]
32      pub query: Option<String>,
33      /// Target environment identifier (see `codex cloud` to browse).
34      #[arg(long = "env", value_name = "ENV_ID")]
35      pub environment: String,
36      /// Number of assistant attempts (best-of-N).
37      #[arg(long = "attempts", default_value_t = 1usize, ...)]
38      pub attempts: usize,
39      /// Git branch to run in Codex Cloud (defaults to current branch).
40      #[arg(long = "branch", value_name = "BRANCH")]
41      pub branch: Option<String>,
42  }
43  // parse_attempts: "attempts must be an integer between 1 and 4"
```

- 摘录（`list` 参数，约第 70–88 行）：`codex cloud list [--env ENV_ID] [--limit N] [--cursor CURSOR] [--json]`

```rust
70  pub struct ListCommand {
71      /// Filter tasks by environment identifier.
72      #[arg(long = "env", value_name = "ENV_ID")]
73      pub environment: Option<String>,
74      /// Maximum number of tasks to return (1-20).
75      #[arg(long = "limit", default_value_t = 20, ...)]
76      pub limit: i64,
77      /// Pagination cursor returned by a previous call.
78      #[arg(long = "cursor", value_name = "CURSOR")]
79      pub cursor: Option<String>,
80      /// Emit JSON instead of plain text.
81      #[arg(long = "json", default_value_t = false)]
82      pub json: bool,
83  }
84  // parse_limit: "limit must be an integer between 1 and 20"
```

- 摘录（`status / apply / diff` 参数，约第 84–120 行）：

```rust
84  pub struct StatusCommand {
85      /// Codex Cloud task identifier to inspect.
86      #[arg(value_name = "TASK_ID")]
87      pub task_id: String,
88  }
90  pub struct ApplyCommand {
91      /// Codex Cloud task identifier to apply.
92      #[arg(value_name = "TASK_ID")]
93      pub task_id: String,
94      /// Attempt number to apply (1-based).
95      #[arg(long = "attempt", value_parser = parse_attempts, value_name = "N")]
96      pub attempt: Option<usize>,
97  }
```

### 4.3 主张：结果取回方式 = 轮询 `status`（非 Ready 则进程 exit code 1）+ `list --json`（含 `tasks[]` 与 `cursor`）+ `diff/apply` 落盘；`apply` 经 `git apply`，冲突则非零退出

- 链接：https://github.com/openai/codex/blob/f1affbac/codex-rs/cloud-tasks/src/lib.rs（commit `f1affbac`）与官方 CLI 文档 https://developers.openai.com/codex/cli/reference.md（访问 2026-09-28）
- 摘录（`lib.rs` 中 `run_status_command`，搜索摘要原文）：

```rust
async fn run_status_command(args: crate::cli::StatusCommand) -> anyhow::Result<()> {
    // ...
    if !matches!(summary.status, TaskStatus::Ready) {
        std::process::exit(1);
    }
    Ok(())
}
```

- 摘录（官方 CLI 文档 `codex cloud list` 原句）：

> Plain-text output prints a task URL followed by status details. Use `--json` for automation. The JSON payload contains a `tasks` array plus an optional `cursor` value. Each task includes `id`, `url`, `title`, `status`, `updated_at`, `environment_id`, `environment_label`, `summary`, `is_review`, and `attempt_total`.

- 摘录（官方 CLI 文档 `codex apply` 原句）：

> Apply the most recent diff from a Codex cloud chat to your local repository. You must authenticate and have access to the chat.
> Codex prints the patched files and exits non-zero if `git apply` fails (for example, due to conflicts).

### 4.4 主张：任务状态机对外收敛为 `Pending / Ready / Applied / Error`（由云端 `turn_status` + `state` 映射得到）

- 链接：https://github.com/openai/codex/blob/f802f0a3/codex-rs/cloud-tasks-client/src/http.rs（commit `f802f0a3`，`map_status` 函数）
- 摘录（源码，搜索摘要原文）：

```rust
fn map_status(v: Option<&HashMap<String, Value>>) -> TaskStatus {
    if let Some(val) = v {
        // latest_turn_status_display.turn_status:
        return match s {
            "failed" => TaskStatus::Error,
            "completed" => TaskStatus::Ready,
            "in_progress" => TaskStatus::Pending,
            "pending" => TaskStatus::Pending,
            "cancelled" => TaskStatus::Error,
            _ => TaskStatus::Pending,
        };
        // fallback: state:
        return match state {
            "pending" => TaskStatus::Pending,
            "ready" => TaskStatus::Ready,
            "applied" => TaskStatus::Applied,
            "error" => TaskStatus::Error,
            _ => TaskStatus::Pending,
        };
    }
    TaskStatus::Pending
}
```

### 4.5 主张：通知回到对话的方式——cloud 侧靠“人工/脚本轮询 + 聊天内 diff 评审”，CLI 内无推送唤醒原语

- 同 §4.3（`status` 非 Ready 即 exit 1，天然适配脚本轮询），以及 cloud 文档“watch the task logs or let the task run in the background … Review the summary and diff”：完成消费点是任务页 diff/PR，不存在 CLI 进程内回调把结果注入原会话的机制（未在源码与文档中找到对应原语；缺席本身即结论，见边界说明）。

---

## 5. 任务与发起会话的生命周期关系

### 5.1 主张：本地后台终端归属发起它的 session；会话关闭（shutdown）时调用 `terminate_all_processes()`，全部后台进程被杀，不存活

- 链接：[`session/handlers.rs @ 27c05a52`](https://github.com/openai/codex/blob/27c05a52/codex-rs/core/src/session/handlers.rs)（commit `27c05a52`，`shutdown_session_runtime`）与 https://github.com/openai/codex/blob/f1affbac/codex-rs/core/src/tasks/mod.rs（commit `f1affbac`）
- 摘录（`handlers.rs`，`shutdown_session_runtime`，搜索摘要原文）：

```rust
pub async fn clean_background_terminals(sess: &Arc<Self>) {
    sess.close_unified_exec_processes().await;
}
// ...
async fn shutdown_session_runtime(sess: &Arc<Self>) {
    // ...
    sess.services
        .unified_exec_manager
        .terminate_all_processes()
        .await;
    // ...
}
```

- 摘录（`tasks/mod.rs`，`close_unified_exec_processes` 包装，搜索摘要原文）：

```rust
pub(crate) async fn close_unified_exec_processes(&self) {
    self.services
        .unified_exec_manager
        .terminate_all_processes()
        .await;
}
pub(crate) async fn list_background_terminals(&self) -> Vec<BackgroundTerminalInfo> {
    self.services.unified_exec_manager.list_processes().await
}
pub(crate) async fn terminate_background_terminal(&self, process_id: i32) -> bool {
    self.services
        .unified_exec_manager
        .terminate_process(process_id)
        .await
}
```

- 成立条件/限制：这是进程内 session 语义——同一个 CLI 进程的会话结束即全杀；CLI 进程本身退出更无从存活。跨设备/关机存活必须走 cloud（§4）。

### 5.2 主张：cloud 任务独立于发起会话存活——发起方可离场，之后在任务页评审 diff / 开 PR / 本地 apply

- 链接：官方文档 https://developers.openai.com/codex/cloud（访问 2026-09-28）与 https://developers.openai.com/codex/workflows（访问 2026-09-28）
- 摘录（cloud 文档原句）：

> Give longer tasks dedicated environments and let them continue while you work on something else.

- 摘录（workflows 文档“Delegate refactor to the cloud”原句）：

> Codex creates a new thread in the cloud that carries over the existing thread context (including the plan and any local source changes).
> Review the cloud diff, iterate if needed. Create a PR directly from the cloud or pull changes locally to test and finish up.

### 5.3 主张：subagent 线程归属父会话，父会话负责编排与汇总；子 agent 继承父 turn 的 sandbox/approval（不是独立后台任务）

- 链接（官方文档，访问 2026-09-28）：https://developers.openai.com/codex/subagents
- 摘录（文档原句）：

> Codex handles orchestration across agents, including spawning new subagents, routing follow-up instructions, waiting for results, and closing agent threads.
> When many agents are running, Codex waits until all requested results are available, then returns a consolidated response.

> Subagents inherit your current sandbox policy.

> In interactive CLI sessions, approval requests can surface from inactive agent threads even while you are looking at the main thread.

> Use `/agent` in the CLI to switch between active agent threads and inspect the ongoing thread.

- 限制：触发须显式——“Codex only spawns subagents when you explicitly ask it to”（文档原句）；每个子 agent 独立消耗 model/tool token。

---

## 6. 并发 / 数量限制（能量化的）

| 对象 | 键/参数 | 值 | 来源 |
|---|---|---|---|
| `exec_command` 初次等待上限 | `yield_time_ms` clamp（`clamp_yield_time`） | 有效范围上限 **30,000 ms**（与请求值无关） | issue #13733 引用的 `process_manager.rs` 常量与测量（见摘录），主源码行 `codex-rs/core/src/unified_exec/process_manager.rs` |
| `write_stdin` 非空写等待上限 | `MAX_YIELD_TIME_MS` 分支 | **30,000 ms** | 同上 issue 摘录：`time_ms.min(MAX_YIELD_TIME_MS)` |
| `write_stdin` 空轮询等待上限 | `max_write_stdin_yield_time_ms`（会话配置 `background_terminal_max_timeout` 传入） | 上限由配置定；文档提及默认 300,000ms 量级（待验证，见 §7） | 同上 issue 摘录：`time_ms.clamp(MIN_EMPTY_YIELD_TIME_MS, self.max_write_stdin_yield_time_ms)` |
| cloud `exec --attempts` | `parse_attempts` | **1–4**（best-of-N） | §4.2 `cli.rs`（`f1affbac`） |
| cloud `list --limit` | `parse_limit` | **1–20**，默认 20 | §4.2 `cli.rs`（`f1affbac`） |
| subagent 并发线程 | `agents.max_concurrent_threads_per_session`（旧别名 `agents.max_threads`） | 未设时“Codex chooses the default”（数值未公开） | 官方 subagents 文档（访问 2026-09-28）原句：`When you leave agents.max_concurrent_threads_per_session unset, Codex chooses the default. Existing configurations can keep using agents.max_threads as a legacy alias.` |

- 补充摘录（issue #13733 对 yield 语义的源码级说明，关键澄清：**30s 是单次等待上限，不是进程超时**）：

```rust
// codex-rs/core/src/unified_exec/process_manager.rs
let time_ms = request.yield_time_ms.max(MIN_YIELD_TIME_MS);
if request.input.is_empty() {
    time_ms.clamp(MIN_EMPTY_YIELD_TIME_MS, self.max_write_stdin_yield_time_ms)
} else {
    time_ms.min(MAX_YIELD_TIME_MS)
}
```

> called from `process_manager.rs::exec_command`. So the first yield of any background command is capped at 30s regardless of what is requested or configured…

---

## 7. 失败与超时的行为

### 7.1 有引证的

- **cloud `status` 非 `Ready` 即 exit 1**（脚本可据此判定未完成/失败，见 §4.3）。
- **`apply` 经 `git apply`，冲突则非零退出**（见 §4.3 官方文档原句）。
- **`write_stdin` 失败以模型可见错误返回**（`write_stdin failed: {err}`，见 §2.2 `WriteStdinHandler::handle_call` 的 `map_err`）。
- **取消/关闭不产生唤醒**是 issue 中的“要求”，stock 中对应路径直接返回（§3.1 `on_command_execution_completed` idle 路径）。

### 7.2 待验证（找不到原文支撑，单独列出）

1. **`background_terminal_max_timeout` 的默认值与精确语义**：缺——只在 issue #13733 讨论中提到“documented 300,000ms default”与“配置未传递到 process manager”的怀疑，未找到官方配置文档原文。需查 `config.toml` reference 中该键的定义行。
2. **`on_exit: wake` / async watcher 是否已合并进 stock、默认开/关、版本号**：缺——#32188 的 `issuecomment-4998087054` 称“working implementation, currently in production soak”，但这是参与者留言且无合并 commit 链接；#33542 仍为 open。需查 main 分支 `process_manager.rs` 是否存在 `on_exit` 字段。
3. **`/stop <id>` 单终端 kill 是否已合并**：缺——#17821 是提案 issue（含实现草图），`terminate_process` 在 `tasks/mod.rs`（`f1affbac`）中存在，但 TUI `/stop <id>` 与 app-server `thread/backgroundTerminals/stop` 是否接线未知。
4. **subagent `trigger_turn` 当前默认值**：缺——#15723 称 idle 父会话不被唤醒（`trigger_turn=false`），但同一 issue 内有留言称 watcher 改动将其改为 `true`；未找到对应合并 commit。需查 `MultiAgent` / mailbox 相关源码。
5. **cloud 任务的服务端超时/取消上限**：缺——只找到用户报告“约 60 分钟列表页显示 Failed 但任务仍在跑”（issue #6303，疑似瞬时状态同步问题，有维护者回复怀疑与服务 outage 有关），无官方超时数字。不可引用为机制结论。
6. **`codex exec --json` 事件流中后台相关事件的精确 schema**：缺——官方 CLI 文档只写了“Add `--json` to receive newline-delimited JSON events (one per state change)”，未列出后台/完成事件名。需抓一次真实输出或查 `exec` 输出事件定义源码。
7. **本地后台进程输出落盘位置**（`pi-unified-exec` 第三方包称“Full output logged to disk”是其自有行为；codex 原生是否有逐字节日志文件未确认）：缺——未在官方文档与已抓源码中找到对应路径，需查 `output_buffer` 落盘逻辑。

---

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `openai/codex` 源码 permalink（`local_tool.rs@35aaa5d9`、`write_stdin.rs@31519549`、`cloud-tasks/src/cli.rs@f1affbac`、`cloud-tasks/src/lib.rs@f1affbac`、`cloud-tasks-client/src/http.rs@f802f0a3`、`session/handlers.rs@27c05a52`、`tasks/mod.rs@f1affbac`、`exec/src/lib.rs@85034b18`）+ 官方文档（`developers.openai.com/codex/cloud`、`workflows`、`subagents`、`cli/reference.md`、`config-reference`、`learn.chatgpt.com/docs/developer-commands`，2026-09-28 快照） |
| 作者或维护者本人的说法 | 未找到个人博客/RFC；issue #6303 有维护者回复（怀疑服务端 outage 导致的状态同步问题，见 §7 待验证第 5 条），不支撑机制结论 |
| 同类方案 | 不适用（本笔记是三份对比中的 Codex 一方；Claude/Grok 见同目录另两份笔记） |
| issue / PR / 社区实践 | #32188（wake 提案+复现，结论 2 主证）、#15723（`trigger_turn=false` 不唤醒现状）、#33542（open 的回调需求）、#13733（yield clamp 实测）、#17821（`/stop <id>` 提案）；第三方 CLI 指南与逆向笔记仅作线索 |
| 历史演变 | 未查（wake 机制仍在提案/实验阶段，无已合并替代方案的历史可写；`on-failure` approval 策略已 deprecated 见 §2.4） |

## 对本项目的影响

- Codex 本地 CLI 的教训是反例：后台完成不唤醒 idle 会话会导致任务被静默忽略（结论 2），本项目必须保留“完成即通知”路径——`beforeModelCall` reminder 覆盖 turn 活跃期；idle 期（等用户下一句话）由 journal 里的工具结果自然呈现，不需要 continuation turn。
- 存活语义（结论 4）支持后台绑定 session、关闭全杀：本项目 detached child 绑定 parent run signal，随 abort/close 取消，方向一致；不做跨进程恢复（Claude 侧同样不恢复，只留注记）。
- 取结果保留显式轮询工具（`GetAgentResult` + `timeoutMs`），对应 `write_stdin` 空写轮询与 cloud `status` 轮询的刚需；`status` 非 Ready 即 exit 1 的做法提示：`GetAgentResult` 超时返回 running 状态文本而不是报错，行为已对齐。
