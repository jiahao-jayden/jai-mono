# Codex 靠什么让 Agent loop 收敛，而不是靠 max turns

核验日期：2026-09-13（UTC+8）。Codex 源码固定在 `openai/codex` main commit `ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8`（提交于 2026-09-12）；官方文档按 2026-09-13 访问日期引用。钉版本是因为 Codex 每周都在改 core，尤其 Goal runtime 与权限指令部分。本笔记回答一个问题：Codex 没有 `max_turns`，它用什么机制阻止 Agent 在工具调用里无意义打转，其中哪些能映射到 jai-mono 这次“重复搜索 we0 项目”的问题。

## 结论

1. **Codex 没有通用的 `max_turns` / `max_steps`，维护者明确说不太可能加。** 普通 turn 的结束条件只有 `needs_follow_up == false`；`TurnAbortReason` 只有 `Interrupted`、`Replaced`、`ReviewEnded`、`BudgetLimited`。[`turn.rs#L553-L565`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/session/turn.rs#L553-L565) [openai/codex#12336](https://github.com/openai/codex/issues/12336)

2. **Codex 的第一道收敛是把运行环境做成模型可见事实：cwd、workspace roots、filesystem permission profile、shell、网络状态，以 `<environment_context>` 与 `<permissions instructions>` 两个 developer 片段注入。** 它同时在执行侧用同一份 cwd/roots 重新解析路径，形成“模型可见范围 + 执行强制范围”两层。[`environment.rs#L317-L341`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/context/world_state/environment.rs#L317-L341) [`permissions_instructions.rs#L346-L365`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/prompts/src/permissions_instructions.rs#L346-L365)

3. **Codex 把“拒绝一次工具”和“中止整个 turn”拆成两个协议语义。** `ReviewDecision::Denied` 表示继续会话、换别的办法；`Abort` 才表示停到用户下一条命令。普通工具失败以 `FunctionCallOutput` 回给模型并继续，只有 `Fatal` 才结束 turn。[`protocol.rs#L4087-L4125`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/protocol/src/protocol.rs#L4087-L4125) [`stream_events_utils.rs#L382-L411`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/stream_events_utils.rs#L382-L411)

4. **Codex 的失败收敛是“连续失败轮次阈值”，不是执行前去重。** Goal runtime 连续 3 个 turn 执行失败且没有成功工具、或自动续跑连续 3 次空响应，就把 Goal 置为 `Blocked`；这个机制只作用于自动续跑的 Goal，不作用于普通 turn。[`accounting.rs#L147-L160`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/ext/goal/src/accounting.rs#L147-L160) [`accounting.rs#L216-L229`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/ext/goal/src/accounting.rs#L216-L229)

5. **Codex 当前源码没有 exact tool+args 去重、doom-loop detector、搜索 coverage ledger 或强制 no-tool final turn。** `ExecutedToolCalls` 只记录、不拦截；重复工具调用的公开 issue 仍 open。它解决的是“环境与失败语义可见”，没有解决“语义重复搜索可判定”。[`executed_tool_calls.rs#L1-L8`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/executed_tool_calls.rs#L1-L8) [openai/codex#27759](https://github.com/openai/codex/issues/27759)

## Turn 什么时候结束

### 具体 trace

给定一次用户 prompt，Codex 的 `run_turn` 走这几步：

1. 模型返回 tool call → `stream_events_utils.rs` 记录 response item、排队工具 future，并把 `needs_follow_up` 置为 `true`。
2. 工具结果写入历史；非 `Fatal` 的错误也包装成 `FunctionCallOutput`，同样 `needs_follow_up = true`。
3. 采样结束后计算 `needs_follow_up = model_needs_follow_up || has_pending_input`。
4. 为 `true` → 跳过 Stop hook，继续下一次采样；为 `false` → 执行 Stop hook，hook 可注入 continuation prompt 或 `should_stop`。
5. `RegularTask` 只在还有 pending input 时再次进入 `run_turn`；没有 turn 计数器。
6. 只有 Goal 处于 Active 且线程 idle 时，Goal runtime 才会自动开新 turn，并受连续失败/空响应阈值、token budget、context window 限制。

[`stream_events_utils.rs#L333-L345`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/stream_events_utils.rs#L333-L345)

```rust
// codex-rs/core/src/stream_events_utils.rs:333-345 @ ee6814b
let tool_future: InFlightFuture<'static> = Box::pin(
    ctx.tool_runtime
        .clone()
        .handle_tool_call(call, cancellation_token),
);

output.needs_follow_up = true;
output.tool_future = Some(tool_future);
```

[`turn.rs#L553-L565`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/session/turn.rs#L553-L565)

```rust
// codex-rs/core/src/session/turn.rs:553-565 @ ee6814b
let has_pending_input =
    sess.input_queue.has_pending_input(&sess.active_turn).await;
…
let needs_follow_up = model_needs_follow_up || has_pending_input;
```

[`regular.rs#L76-L96`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tasks/regular.rs#L76-L96)

```rust
// codex-rs/core/src/tasks/regular.rs:76-96 @ ee6814b
loop {
    let last_agent_message = run_turn(…).await?;
    if ctx.terminal_error.lock().await.is_some() {
        return Ok(last_agent_message);
    }
    if !sess.input_queue.has_pending_input(&sess.active_turn).await {
        return Ok(last_agent_message);
    }
    next_input = Vec::new();
```

维护者对 `--max-turns` 的态度（2026-02-20，issue 已关闭）：

> “I think it's unlikely that we'd expose a `--max-turns` CLI option” —— etraut-openai，[openai/codex#12336](https://github.com/openai/codex/issues/12336)

这是维护者立场；[openai/codex#33294](https://github.com/openai/codex/issues/33294) 再次请求 `--max-steps`，截至核验日仍 open，只是用户提案。官方 [Configuration Reference](https://developers.openai.com/codex/config-reference)（2026-09-13 访问）没有 `max_turns`，只有 `agents.max_concurrent_threads_per_session`、`features.rollout_budget.limit_tokens` 这类并发或 token 预算项。

## 环境如何进入模型与执行边界

Codex 把 cwd、shell、filesystem、network 渲染成模型可见的 `<environment_context>`：

[`environment.rs#L317-L341`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/context/world_state/environment.rs#L317-L341)

```rust
// codex-rs/core/src/context/world_state/environment.rs:317-341 @ ee6814b
rendered.push_str("<cwd>");
…
rendered.push_str("</cwd>\n");
rendered.push_str("<shell>");
```

filesystem 段包含 workspace roots 与 permission profile，被拒绝读取的路径以 `escalatable="false"` 呈现：

[`environment_context.rs#L59-L70`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/context/environment_context.rs#L59-L70)

```rust
// codex-rs/core/src/context/environment_context.rs:59-70 @ ee6814b
let mut rendered = "<filesystem>".to_string();
rendered.push_str("<workspace_roots>");
```

权限说明是 developer 角色的指令，并明确告诉模型“被拒绝的读取是策略，不要请求升级”：

[`permissions_instructions.rs#L346-L365`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/prompts/src/permissions_instructions.rs#L346-L365)

> “Do not request escalation or additional permissions to read them; these denials are policy restrictions.”

工具 schema 再说一次边界，执行 handler 再解析一次路径：

[`shell_spec.rs#L35-L46`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/handlers/shell_spec.rs#L35-L46)

> “Working directory for the command. Defaults to the turn cwd.”

[`exec_command.rs#L186-L243`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L186-L243)

```rust
// codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:186-243 @ ee6814b
let native_environment_cwd = turn_environment.cwd().clone();
…
native_environment_cwd.join(workdir)
```

sandbox attempt 携带同一份 cwd、workspace roots 与 permission profile：

[`sandboxing.rs#L386-L405`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/sandboxing.rs#L386-L405)

```rust
// codex-rs/core/src/tools/sandboxing.rs:386-405 @ ee6814b
pub permissions: &PermissionProfile,
pub(crate) sandbox_cwd: &'a PathUri,
pub(crate) workspace_roots: &'a [PathUri],
```

限制：环境上下文是模型可见事实，越界仍由 sandbox / exec policy 强制。环境上下文减少的是“用 `pwd`、`ls ..` 猜范围”的轮次，不定义“最新项目”这种业务排序。

## 拒绝、中止与失败的三种语义

用户对审批的回答分 `Denied` 与 `Abort`：

[`protocol.rs#L4087-L4125`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/protocol/src/protocol.rs#L4087-L4125)

> `Denied`: agent should not execute it, but it should continue the session and try something else.
> `Abort`: agent should not do anything until the user's next command.

工具错误分 `RespondToModel` 与 `Fatal`：

[`stream_events_utils.rs#L382-L411`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/stream_events_utils.rs#L382-L411)

```rust
// codex-rs/core/src/stream_events_utils.rs:382-411 @ ee6814b
Err(FunctionCallError::RespondToModel(message)) => {
    …
    output.needs_follow_up = true;
}
…
Err(FunctionCallError::Fatal(message)) => return Err(CodexErr::Fatal(message)),
```

用户中止有结构化原因：

[`protocol.rs#L4187-L4212`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/protocol/src/protocol.rs#L4187-L4212)

> `Interrupted`、`Replaced`、`ReviewEnded`、`BudgetLimited`

限制：Codex 的 sandbox denial 在模型侧仍近似普通工具输出（`exec_command.rs#L448-L481` 只把 `process_id` 置 `None`），普通 exec output schema 没有 `denied` / `error_code` 字段，`FunctionCallOutput.success` 是内部字段不进 wire。所以“拒绝”对模型的可见度靠文本。

## Goal 的失败收敛阈值

Goal runtime 在线程 idle 时自动续跑 Active goal，靠三种阈值收束：

[`accounting.rs#L147-L160`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/ext/goal/src/accounting.rs#L147-L160)

```rust
// codex-rs/ext/goal/src/accounting.rs:147-160 @ ee6814b
if turn.successful_tool {
    return None;
}
if !turn.failed_execution {
    return None;
}
…
inner.consecutive_execution_failure_turns =
    inner.consecutive_execution_failure_turns.saturating_add(1);
(inner.consecutive_execution_failure_turns >= 3).then_some(goal_id)
```

[`accounting.rs#L216-L229`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/ext/goal/src/accounting.rs#L216-L229)

```rust
// codex-rs/ext/goal/src/accounting.rs:216-229 @ ee6814b
let empty = automatic && turn.empty_final && !turn.has_activity;
…
inner.consecutive_empty_turns = inner.consecutive_empty_turns.saturating_add(1);
(inner.consecutive_empty_turns >= 3).then_some(goal_id)
```

turn error 直接把 Goal 置为 `Blocked`，注释写明是为了防止自动续跑烧 token：

[`extension.rs#L398-L407`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/ext/goal/src/extension.rs#L398-L407)

```rust
// codex-rs/ext/goal/src/extension.rs:398-407 @ ee6814b
// The turn has ended because the error was non-retryable or its
// retries were exhausted. Block the goal to prevent automatic
// continuation from looping and consuming tokens, as can happen
// with compaction errors.
_ => ActiveGoalStopReason::TurnError,
```

`blocked` / `usageLimited` 状态在 `rust-v0.132.0`（2026-05-20）随 commit [`538b7ff1`](https://github.com/openai/codex/commit/538b7ff1d6bc6993e5a75909bcd5eb8070d0d3c9) 加入，官方说明：

> “Add resumable `blocked` and `usageLimited` goal states. As with `paused`, goal continuation stops with these states.”

限制：阈值只在 Goal 自动续跑路径生效；控制面自身被拒时仍会打转，[openai/codex#36503](https://github.com/openai/codex/issues/36503) 记录了 `update_goal(status="blocked")` 也被 hook 拒绝后 2514 次重复尝试的用户案例（open）。

## Codex 没有的东西

`ExecutedToolCalls` 是记录器，明确不 dispatch、不拦截：

[`executed_tool_calls.rs#L1-L8`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/executed_tool_calls.rs#L1-L8)

```rust
// codex-rs/core/src/tools/executed_tool_calls.rs:1-8 @ ee6814b
//! Records attempted calls at existing execution boundaries. Request metadata policy
//! lives in the private request metadata module; this recorder must never dispatch or await tools.
```

`SeenIds` 只按 `call_id` / `cell_id` 去重，不比较工具名和参数（[`seen_ids.rs#L80-L87`](https://github.com/openai/codex/blob/ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8/codex-rs/core/src/tools/executed_tool_calls/seen_ids.rs#L80-L87)）。重复工具调用的用户案例：

> Codex CLI 0.137.0：provider 重放相同 tool call，1287 次 provider request，826255 次重复 tool result，进程最终 `-9`。—— [openai/codex#27759](https://github.com/openai/codex/issues/27759)（open，2026-06-12）

这是一个可复现案例，说明 Codex 没有靠去重兜住这种循环；不能据此推断发生率。

| 机制 | Codex 有 | jai-mono 现状 |
|---|---|---|
| cwd / workspace roots 进模型 | 有，`<environment_context>` + `<permissions instructions>` | 无；`AgentContext` 只有 system prompt、messages、tools，cwd 只在执行侧 |
| 执行侧路径边界 | 有，handler 与 sandbox 同用一份 roots | FFF / Read 有 workspace boundary；默认 Bash 只读子命令不检查目录 |
| Denied 与 Abort 分离 | 有，两个协议枚举 | 权限 deny 抛 `permissionDeniedError` 继续 loop；真实 run 中随后出现 `RequestAborted`，来源待核 |
| 连续失败阈值 | 有，仅 Goal 自动续跑：3 次失败 / 3 次空响应 | 无 |
| 通用 max turns | 无 | 可选 `maxIterations`，默认不设 |
| exact / 语义去重、coverage ledger | 无 | 无 |
| 强制 no-tool final turn | 无 | 无 |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `codex-rs/core/src/session/turn.rs`、`tasks/regular.rs`、`stream_events_utils.rs`、`context/world_state/environment.rs`、`context/environment_context.rs`、`prompts/src/permissions_instructions.rs`、`tools/handlers/shell_spec.rs`、`tools/handlers/unified_exec/exec_command.rs`、`tools/sandboxing.rs`、`tools/executed_tool_calls*`、`ext/goal/src/{accounting,extension}.rs`、`protocol/src/protocol.rs`，全部钉在 `ee6814bfa4889fe9b2b3dcc9cc8bdd91effa8ab8`；官方 config-reference 与 follow-goals 文档按 2026-09-13 访问。 |
| 作者或维护者本人的说法 | etraut-openai 在 #12336 明确不倾向暴露 `--max-turns`；commit `538b7ff1` 的官方说明解释 `blocked` / `usageLimited` 的目的。 |
| 同类方案 | 与 jai-mono 现状逐维对照（上表）；Gemini CLI / OpenCode / Pi 的 exact detector 与 post-turn stop 见 [agent-loop-stop-conditions-comparison](../agent-ui/agent-loop-stop-conditions-comparison-2026-09-12.md)。 |
| issue / PR / 社区实践 | #12336（关闭，维护者立场）、#33294（open，用户提案）、#27759（open，重复 tool call 可复现案例）、#36503（open，控制面被拒后 Goal 打转案例）。按维护者确认 / 可复现案例区分，不推发生率。 |
| 历史演变 | `rust-v0.132.0` 引入 Goal `blocked` / `usageLimited`；PR #36181（2026-07-30）加入 `executed_tool_call_metadata` 观测，不是去重。 |

## 待验证

- jai-mono 真实 run 中权限拒绝后紧接的 `RequestAborted` 是用户点了停止，还是 Desktop 拒绝路径本身触发了 abort；需要用一次真实 run 或 acp-host 日志核对。
- Codex 的 `<environment_context>` 增量更新（RFC 7386 merge patch）对 prompt cache 的实际影响未测；jai-mono 若把环境放在 system prompt，Operation 内不变即可，不需要增量。

## 对本项目的影响

- **要做**：把 cwd、workspace root、额外允许目录和“越界时先问用户、不向父目录扫描”的规则做成模型可见事实；这是 Codex 与 jai-mono 最大的差异，也是这次 run 前四轮 `pwd/ls/find` 的直接原因。
- **要做**：核实并固定“权限拒绝 = 这一次工具失败、Agent 继续”与“停止 = 中止 operation”两条语义分开，别让一次 deny 变成没有任何总结的 `aborted`。
- **可做**：借 Goal 的“连续 N 轮全部失败即停”思路，在 jai-mono 的普通 run 加一个 operation 内存级阈值；Codex 只在自动续跑用它，我们的场景是普通 run，需要自己定阈值和停止后的行为。
- **不必做**：exact tool+args 去重、搜索 coverage ledger、强制 no-tool final turn。Codex 没有它们也能日常工作，这次 run 的 14 次调用参数全不同，去重拦不住；等有更多真实 trace 再判断。
- **被证伪**：“成熟产品靠 max turns 兜底”不成立于 Codex；它连这个开关都没有，靠的是环境可见、拒绝语义和 Goal 级失败阈值。`maxIterations` 在 jai-mono 只该是防未知 bug 的保险丝。
