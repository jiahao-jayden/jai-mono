# Coding agent 如何发现邻近项目并避免重复搜索

核验日期：2026-09-12。

源码固定到以下 commit，避免后续主分支改动混入结论：

- OpenAI Codex：`d807d44ae7fb69e8e05fc6e6fddea65f7e9421f5`（项目文档发现）与 `85034b189e6cb6f90489b65150a903117b194a94`（专用搜索工具）。
- Pi coding agent：`71dca871bc80b6bc97be37f0ca3189399d651fff`。
- Gemini CLI（补充的 loop-detection 对照）：`9c1b0a610534d6f8120964cf2672c07807d8fc90`。
- Claude Code 与 Cursor 闭源，官方文档按 2026-09-12 访问版本固定；文中另记可识别的最低版本或 changelog 日期。

问题限定为：用户只说出一个项目名称，该项目不在当前 workspace root 内、但可能在相邻目录时，成熟 coding agent 如何确定可搜索范围、执行候选发现，并避免反复运行近似的 `find` / `ls` / `rg`。本文不检查 Jai 实现，不读取目标 session，也不提出代码 patch。

## 结论

1. **成熟实现首先把“可搜索范围”建模成显式 working roots，而不是允许模型从 `cwd` 向整个用户目录盲扫。** Claude Code 通过 [`--add-dir` / `/add-dir`](https://code.claude.com/docs/en/permissions#working-directories)，Cursor 通过 [multi-root workspace 与 `--add-dir`](https://cursor.com/docs/cli/changelog)，Pi 通过 [`cwd` 绑定工具实例](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/sdk.md)，都把“范围扩大”设为显式状态转换。对 Jai 最直接的映射是：先形成一组已授权 roots，再搜索；项目名称本身不能成为无限上溯或全盘扫描的授权。
2. **“用户提到名称”应触发一次有界的候选发现，不应直接触发内容级 `rg`。** Cursor 的 [Instant Grep 与 Explore subagent](https://cursor.com/docs/agent/tools/search)负责已知 root 内的符号搜索和隔离汇总；Codex 的 [`grep_files` 默认最多返回 100 个路径](https://github.com/openai/codex/blob/85034b189e6cb6f90489b65150a903117b194a94/codex-rs/core/src/tools/spec.rs#L843-L892)；Pi 的 [`find` 默认 1,000 个结果、50 KiB](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/find.ts#L24-L75)，`grep` 默认 100 个匹配。可映射到 Jai 的关键不是新增另一种 shell 包装，而是区分“按名称找候选目录”和“在已选项目中查内容”两阶段，并让前者返回结构化、有限的候选集。
3. **cwd / project instructions 的向上发现不能解决 sibling project discovery。** Codex 的 [`AGENTS.md` 发现只从 cwd 向项目根走`](https://github.com/openai/codex/blob/d807d44ae7fb69e8e05fc6e6fddea65f7e9421f5/codex-rs/core/src/project_doc.rs#L1-L16)，Claude Code 的 [`CLAUDE.md` 也只加载 cwd 与祖先目录，子目录按需加载](https://code.claude.com/docs/en/claude-md#how-claude-md-files-load)。这些机制能注入边界、布局和别名提示，却不会枚举与当前 repo 同级的另一个 repo；若没有 host 提供额外 root 或候选目录索引，模型仍只能猜路径或调用搜索工具。
4. **输出截断与 compaction 只控制上下文成本，不能防止重复搜索。** Cursor shell mode [30 秒超时并自动截断大输出](https://cursor.com/docs/cli/shell-mode)、Pi 工具统一为 [2,000 行或 50 KiB](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/truncate.ts#L1-L15)，Pi compaction 在序列化时把每个 tool result 截到 [2,000 字符](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md#tool-result-handling)。它们能阻止一次宽搜撑爆上下文，但相同或稍改参数的调用仍可继续发生。
5. **真正阻止本例重复 `find` / `ls` / `rg` 的是 runtime 级调用记忆与 no-progress circuit breaker。** Gemini CLI 的已落地实现对 `tool name + JSON(args)` 做 [SHA-256 key，并检测 1–5 长度模式连续重复 5 次](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L174-L177)；30 turns 后还会调用 LLM 检测复杂无进展循环。相反，Codex CLI 0.137.0 的公开可复现 issue 记录了 [1,287 次 provider request 和 826,255 个重复 tool result](https://github.com/openai/codex/issues/27759)，说明“模型会自己停”不是可靠边界。Jai 可直接映射的是规范化调用指纹、结果摘要、已覆盖搜索域和有限状态的停止判定，而不是再加 prompt。
6. **安全边界和发现能力必须分开。** Claude Code v2.1.257+ 的 [`blockReadsOutsideWorkingDirectories`](https://code.claude.com/docs/en/settings-reference#permissionsblockreadsoutsideworkingdirectories)连 `Read`、`Grep`、`Glob`、LSP 以及可识别的 shell 读命令都能围住；Cursor 让每个 workspace folder 的 context 可用，但 Cloud Agent 不支持 multi-root。对 Jai 的映射应保留“候选可见”与“内容可读/可写”两个阶段：可以展示邻近项目名，不等于把其文件内容自动交给模型。

## 统一维度对比

| 维度 | Claude Code | Cursor Agent / CLI | OpenAI Codex CLI | Pi coding agent | Gemini CLI（补充） |
|---|---|---|---|---|---|
| 初始范围 | 启动目录是 primary working directory | `--workspace`，否则 cwd | `config.cwd` | `createAgentSession({ cwd })` | workspace roots / target dir（本文仅核 loop） |
| 扩大范围 | `--add-dir`、`/add-dir`、持久 `additionalDirectories` | repeatable `--add-dir`、`/add-dir`、named multi-directory workspace | 本次核验未找到等价的一手公开契约 | 重建 cwd-bound session/tool；没有同 session multi-root 契约 | 不作为本文项目发现证据 |
| 名称候选发现 | 可由 Glob / Bash；官方未公开候选缓存 | 多 root context；Instant Grep；Explore 隔离搜索 | `list_dir` + `grep_files`，后者默认 100 paths | `find` 1,000 paths / 50 KiB；`grep` 100 matches / 50 KiB | 不作为本文项目发现证据 |
| 项目规则注入 | cwd 到 root 的 `CLAUDE.md` 全量；子目录按读文件触发 | project root 的 Rules、`AGENTS.md`、`CLAUDE.md` | project root 到 cwd 的 `AGENTS.md` | `ResourceLoader` 基于 cwd 发现 context files | 不作为本文项目发现证据 |
| 工具输出控制 | UI 摘要可切 verbose；本次未找到 Glob/Grep 精确公开 cap | shell 自动截断，30 秒；`Ctrl+O` 展开 | `grep_files` 返回路径默认 100；全局 tool output 另有截断机制 | read/bash 2,000 行或 50 KiB；grep 100 matches；find 1,000 paths；摘要 tool result 2,000 chars | loop detector 只记 key，不靠保留完整输出 |
| 重复调用检测 | 无可核验的内建通用 detector；可由 PreToolUse 自定义 | 官方文档未公开 detector | 0.137.0 有未设界的可复现报告 | 提供 `beforeToolCall` / `afterToolCall` / `shouldStopAfterTurn` seam，但没有默认重复指纹策略 | 1–5 长度模式 × 5 次；30 turns 后 LLM check |
| 停止 / 总结 | compaction；print mode 可设预算；hooks 可 veto | `/summarize`；Explore 只回相关 findings | 本次未找到能证明候选已足够后自动停止的公开实现 | `terminate: true` 与 `shouldStopAfterTurn`；compaction 保留最近 20k tokens | detector 标记 loop，由 client 发 `LoopDetected` 并终止 stream |
| 安全边界 | working dirs、trust、permission、sandbox；v2.1.257+ 可硬挡越界读 | sandbox、approval、workspace trust；Cloud Agent 无 multi-root | sandbox / approvals；本文未扩展核验 | cwd 是路径解析基准，但 library seam 本身不等于 OS sandbox | 不作为本文项目边界证据 |
| 本例能否直接防重复 | 范围机制能减少盲搜；没有自定义 hook 时不能硬停近似调用 | 多 root + Explore 能减少主循环反复搜；未证明能硬停 | cap 能限制单次输出，不能阻止重复；已有反例 | host 若用 stop seam + 指纹可阻止；默认工具本身不能 | 能拦完全相同和长度 1–5 的周期，但第 5 轮前仍会执行 |

## 机制证据

### 1. 显式 working roots，而不是隐式全盘发现

**主张：Claude Code 把启动目录视为 primary working directory，扩大范围必须使用显式目录；额外目录服从相同权限规则。** 官方文档，访问于 2026-09-12；`blockReadsOutsideWorkingDirectories` 要求 Claude Code v2.1.257+。[Working directories](https://code.claude.com/docs/en/permissions#working-directories)

> By default, Claude has access to files in the directory where you launched it. That directory is the session's primary working directory until you move the session with `/cd`. You can extend this access:
>
> - During startup: use `--add-dir <path>` CLI argument
> - During session: use `/add-dir` command
> - Persistent configuration: add to `additionalDirectories` in settings files
>
> Files in additional directories follow the same permission rules as the original working directory.

**主张：扩大“文件访问范围”不自动把额外目录变成完整配置根，因此发现 scope 与配置 trust 是分开的。** 同一官方文档，访问于 2026-09-12。[Additional directories grant file access, not configuration](https://code.claude.com/docs/en/permissions#additional-directories-grant-file-access-not-configuration)

> Adding a directory extends where Claude can read and edit files. It doesn't make that directory a full configuration root: most `.claude/` configuration is not discovered from additional directories, though a few types are loaded as exceptions.

**不成立条件（Claude Code）：** 如果 host 不知道 sibling 路径、用户也没有 `--add-dir` / `/add-dir`，working-directory 机制不会凭项目名发现相邻 repo；若未开启 v2.1.257+ 的越界读阻断，read-only `find` / `grep` 仍可能访问 working roots 之外并触发确认，而不是从根源消失。

**主张：Cursor CLI 已支持 named multi-directory workspace；多个 repo 是显式加入并可保存的集合。** 官方 CLI changelog，访问于 2026-09-12。[CLI Changelog: Workspaces and commands](https://cursor.com/docs/cli/changelog)

> Start multi-root sessions from the command line. Repeat `--add-dir <path>` to add directories at launch, including with `--workspace`. `/add-dir` refreshes slash skills and custom commands immediately.
>
> Named multi-directory workspaces. Run the agent across several repositories at once: add directories mid-session with `/add-dir`, save the set with `/save-workspace`, reload it later with `/load-workspace`, or start scoped with `--workspace`.

**主张：Cursor Agent 的搜索上下文覆盖每个 workspace folder，但 Cloud Agent 明确不支持 multi-root。** 官方 Search 文档，访问于 2026-09-12。[Search FAQ](https://cursor.com/docs/agent/tools/search#faq)

> Yes. Cursor supports multi-root workspaces. Each workspace folder's context is available to Agent. Some features that rely on a single git root, like worktrees, are disabled for multi-root workspaces. Cloud Agents do not support multi-root workspaces.

**不成立条件（Cursor）：** 当项目没有先加入 multi-root workspace，名称不会自动变成可搜索 root；Cloud Agent 场景下该机制不可用。官方文档也没有给出“项目名 → 邻近目录候选”的缓存或 deterministic resolver。

**主张：Pi 的 SDK 把 cwd 作为项目本地发现和内置工具构造输入；工具集合也可显式 allowlist。** 固定源码 `71dca871…`。[SDK: Tools with Custom cwd](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/sdk.md)

> When you pass a custom `cwd`, `createAgentSession()` builds selected built-in tools for that cwd.
>
> ```typescript
> const { session } = await createAgentSession({
>   cwd,
>   tools: ["read", "bash", "grep"],
>   sessionManager: SessionManager.inMemory(cwd),
> });
> ```

**不成立条件（Pi）：** cwd-bound 单 root 不能表达“当前项目 + 邻近项目”同时可见；host 必须切换/rebuild runtime 或自建多 root 工具。`cwd` 只是解析基准，不自动提供 OS sandbox，也不发现 sibling。

### 2. 项目上下文注入不能代替 sibling discovery

**主张：Claude Code 启动时只加载 cwd 和祖先层级的 `CLAUDE.md`；子目录规则在读取对应文件时才加入。** 官方文档，访问于 2026-09-12。[How Claude.md files load](https://code.claude.com/docs/en/claude-md#how-claude-md-files-load)

> `CLAUDE.md` and `CLAUDE.local.md` files in the directory hierarchy above the working directory are loaded in full at launch. Files in subdirectories load on demand when Claude reads files in those directories.
>
> Claude Code reads `CLAUDE.md` files by walking up the directory tree from your current working directory, checking each directory along the way.

**主张：Codex 的项目文档发现同样被 project root 截断；默认 marker 是 `.git`，没有 marker 时只考虑 cwd。** 固定源码 `d807d44ae7fb69e8e05fc6e6fddea65f7e9421f5`。[`project_doc.rs#L1-L16`](https://github.com/openai/codex/blob/d807d44ae7fb69e8e05fc6e6fddea65f7e9421f5/codex-rs/core/src/project_doc.rs#L1-L16)

```rust
//! 1. Determine the project root by walking upwards from the current working
//! directory until a configured `project_root_markers` entry is found.
//!
//! When `project_root_markers` is unset, the default marker list is used
//! (`.git`). If no marker is found, only the current working directory is
//! considered. An empty marker list disables parent traversal.
//!
//! 2. Collect every `AGENTS.md` found from the project root down to the
//! current working directory (inclusive) and concatenate their contents in
//! that order.
```

**共同不成立条件：** 两者都只沿“祖先链”传播规则，sibling 不在该链上。即使某个根级规则写了“相邻项目通常放在 `../`”，它也只提供线索，不能证明目标存在、不能授权读取，也不能记住某次搜索已经穷尽。

### 3. 专用候选搜索优于 shell 宽搜，但必须有上限

**主张：Cursor 将精确符号/字符串搜索交给 Instant Grep，把广泛探索隔离到独立 context 的 Explore subagent，主会话只接收相关 findings。** 官方 Search 文档，访问于 2026-09-12。[Search](https://cursor.com/docs/agent/tools/search)

> The fastest way to find code is an exact match: a function name, variable, error string, or regex pattern. Agent uses grep automatically when you reference specific symbols.
>
> Agent can spawn an Explore subagent that runs in its own context window with a faster model. It executes many parallel searches without bloating the main conversation, returning only the relevant findings.

这能减少主 agent 因大量 raw search output 而失去“已经查过哪里”的上下文，但它**不能证明** Explore 内部不会重复搜索；官方没有公开其去重或停止阈值。

**主张：Codex 的 `grep_files` 是结构化、cwd-default、有限返回的专用工具；默认最多 100 个文件路径。** 固定源码 `85034b189e6cb6f90489b65150a903117b194a94`。[`spec.rs#L843-L892`](https://github.com/openai/codex/blob/85034b189e6cb6f90489b65150a903117b194a94/codex-rs/core/src/tools/spec.rs#L843-L892)

```rust
(
    "path".to_string(),
    JsonSchema::String {
        description: Some(
            "Directory or file path to search. Defaults to the session's working directory."
                .to_string(),
        ),
    },
),
(
    "limit".to_string(),
    JsonSchema::Number {
        description: Some(
            "Maximum number of file paths to return (defaults to 100).".to_string(),
        ),
    },
),
```

**不成立条件（Codex 搜索工具）：** `grep_files` 查的是文件内容，不是项目目录名称；对“邻近项目名”仍需已知 parent root 下的 `list_dir` 或目录候选工具。100-path cap 限制一次输出，不会阻止下一次换一个 regex 或 path 重搜。

**主张：Pi 把文件名搜索和内容搜索拆成两个工具，并给出不同的硬上限。** 固定源码 `71dca871…`。[`find.ts`](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/find.ts)；[`grep.ts`](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/grep.ts)

```typescript
const DEFAULT_LIMIT = 1000;

description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```

```typescript
const DEFAULT_LIMIT = 100;

description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```

Pi 还在 `find` 到达结果上限时返回可操作提示：

```typescript
`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`
```

**不成立条件（Pi 搜索工具）：** “把 limit 翻倍”可能诱导 agent 用 1,000 → 2,000 → 4,000 的方式继续宽搜；若 runtime 不记录已覆盖 scope 和结果摘要，这个反馈只解决截断后的 continuation，不解决 no-progress。

### 4. 截断与 compaction 是成本边界，不是循环边界

**主张：Cursor shell mode 的命令各自独立，固定 30 秒超时，长输出自动截断。** 官方文档，访问于 2026-09-12。[Shell Mode](https://cursor.com/docs/cli/shell-mode)

> Large outputs are truncated automatically and long-running processes timeout to maintain performance.
>
> - Commands timeout after 30 seconds
> - Long-running processes, servers, and interactive prompts are not supported
>
> Each command runs independently - use `cd && ...` to run commands in other directories.

该机制能停住单个挂起的 `find /`，不能阻止 agent 连续发起多个 30 秒命令。

**主张：Pi 的 tool output 有共享的 2,000 行 / 50 KiB 上限，grep 单行另限 500 字符。** 固定源码 `71dca871…`。[`truncate.ts#L1-L15`](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/core/tools/truncate.ts#L1-L15)

```typescript
/**
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB)
 */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const GREP_MAX_LINE_LENGTH = 500;
```

**主张：Pi compaction 在下一次 assistant response 前检查阈值，默认保留最近 20k tokens；给 summarizer 的每个 tool result 再截到 2,000 字符。** 固定源码 `71dca871…`。[`compaction.md`](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/compaction.md)

> During a multi-turn agent run, Pi checks this threshold after tools finish and their results are appended, before starting the next assistant response.
>
> **Find cut point**: Walk backwards from newest message, accumulating token estimates until `keepRecentTokens` (default 20k …) is reached.
>
> Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated.

**共同不成立条件：** 如果 compaction 摘掉了“已经查过哪些目录”而没有把 coverage 作为结构化状态保留，agent 反而可能重做搜索。上下文变短不等于进度变多。

### 5. Runtime repetition / no-progress 检测才会硬停

**主张：Gemini CLI 把工具名与 JSON 参数串做 SHA-256 指纹，并检测长度 1–5 的调用周期；同一模式重复 5 次即报告 loop。** 固定源码 `9c1b0a610534d6f8120964cf2672c07807d8fc90`。[`loopDetectionService.ts#L29-L65`](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L29-L65)，[`#L174-L177`](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L174-L177)，[`#L313-L346`](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L313-L346)

```typescript
const TOOL_CALL_LOOP_THRESHOLD = 5;
const LLM_CHECK_AFTER_TURNS = 30;
const DEFAULT_LLM_CHECK_INTERVAL = 10;
const MIN_LLM_CHECK_INTERVAL = 5;
const MAX_LLM_CHECK_INTERVAL = 15;
const LLM_CONFIDENCE_THRESHOLD = 0.9;
```

```typescript
private getToolCallKey(toolCall: { name: string; args: object }): string {
  const argsString = JSON.stringify(toolCall.args);
  const keyString = `${toolCall.name}:${argsString}`;
  return createHash('sha256').update(keyString).digest('hex');
}
```

```typescript
const R = TOOL_CALL_LOOP_THRESHOLD; // 5
// Check for repeating patterns of cycle length k from 1 to 5
for (let k = 1; k <= 5; k++) {
  const requiredLength = k * R;
  // compare the last k-call cycle over requiredLength entries
  …
}
```

**主张：它还在第 30 turn 起用最近 20 turns 做 LLM no-progress 判断，后续间隔按置信度在 5–15 turns 调整。** 同一固定源码。[`loopDetectionService.ts#L34-L65`](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L34-L65)，[`#L250-L310`](https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/services/loopDetectionService.ts#L250-L310)

```typescript
this.turnsInCurrentPrompt++;
if (
  this.turnsInCurrentPrompt >= LLM_CHECK_AFTER_TURNS &&
  this.turnsInCurrentPrompt - this.lastCheckTurn >= this.llmCheckInterval
) {
  const { isLoop, analysis, confirmedByModel } =
    await this.checkForLoopWithLLM(signal);
  …
}
```

**不成立条件（Gemini detector）：**

- 它在同模式第 5 次才触发，前 4 次仍会执行。
- `JSON.stringify(args)` 对参数顺序、`./x` vs `x`、等价 glob、`find` vs `rg --files` 不做语义归一化；近似但不完全相同的调用可能绕过。
- 只检查最长 5-call 周期；更长周期在前 30 turns 只能依赖 LLM detector。
- detector 可按 session/config 禁用，LLM 判定也有成本和误判。

**主张：Pi 暴露了 host 可用的停止 seam，但没有默认的重复调用策略。** 固定源码 `71dca871…`。[Agent README: Tool execution and `shouldStopAfterTurn`](https://github.com/badlogic/pi-mono/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/agent/README.md)

> Tools, blocked `beforeToolCall` results, and `afterToolCall` overrides can return `terminate: true` to hint that the automatic follow-up LLM call should be skipped.
>
> `shouldStopAfterTurn` runs after `turn_end` is emitted and after the assistant response and any tool executions have completed normally. If it returns `true`, the loop emits `agent_end` and exits … before starting another LLM call.

**不成立条件（Pi stop seam）：** seam 不等于 policy；host 若不实现 fingerprint / progress 判定，默认 agent 仍可重复。`shouldStopAfterTurn` 在一轮工具都结束后运行，不能撤销本轮已经执行的并行重复调用。

**反方证据：Codex CLI 0.137.0 的 issue 有完整 mock-provider reproduction，证明至少该版本没有为重复相同调用设置可靠上限。** 这是用户报告并带 `bug` / `CLI` / `tool-calls` 标签，不是维护者确认的架构承诺；结论只限定到可复现版本。[Issue #27759](https://github.com/openai/codex/issues/27759)

> A deterministic provider stream repeats an identical tool call. Codex executes the repeated call instead of bounding the loop.
>
> ```text
> process_exit=-9
> provider_requests=1287
> tool_result_counts={'repeat_loop_followup': 826255, 'repeat_loop_initial': 1286}
> side_effect_file_occurrences … observed=1314 expected>=2
> REPRODUCED
> ```

**不成立条件（用该 issue 推断 Codex 当前行为）：** issue 尚未有维护者根因确认，且只复现 0.137.0；不能据此断言 2026-09-12 所有 Codex 产品面或更新版本都无保护。它足以证伪“成熟 agent 天然会自行停止”这一通用假设。

### 6. 安全：候选可见不等于内容可读

**主张：Claude Code v2.1.257+ 可让文件工具在所有 permission mode（包括 bypass）拒绝 working roots 外的读取；可识别的 shell 文件读取也会询问。** 官方 settings reference，访问于 2026-09-12。[`permissions.blockReadsOutsideWorkingDirectories`](https://code.claude.com/docs/en/settings-reference#permissionsblockreadsoutsideworkingdirectories)

> Stop Claude from reading paths outside the session's working directories with the Read, Grep, Glob, and LSP tools, in every permission mode including `bypassPermissions`. A Bash command that reads a matching path through a file command Claude Code recognizes, such as `cat`, prompts you even in auto mode and `bypassPermissions` mode. Requires Claude Code v2.1.257 or later.

**不成立条件：** 这是 read fence，不是完整的 candidate discovery API；它会阻止或询问越界访问，但不能告诉 agent 哪个邻近项目与名称匹配。对无法识别、混淆或自定义的 shell 读取仍应由 OS sandbox 兜底，不能只靠命令文本分类。

## 一次具体走查：用户只说“去 sibling 项目 Atlas 看一下”

下面是从上述成熟机制抽出的最小 trace；这是机制映射，不是 Jai 当前实现描述。

1. **注入稳定范围事实。** Turn 开始时上下文含 `cwd=/work/jai`、workspace roots=`[/work/jai]`、候选 discovery root（若 host policy 允许）=`/work`。Claude、Cursor、Pi 都证明 cwd/root 应是显式 runtime 输入，而不是模型从 `pwd` 反复恢复。
2. **分类为目录候选查询。** “Atlas”是项目名，不是代码符号；只对允许的 discovery root 发一次等价于 `list_dir(/work, depth=1, filter≈atlas)` 的结构化调用，不先跑内容 `rg Atlas /work/**`。Codex 的 `list_dir` / `grep_files` 分工和 Pi 的 `find` / `grep` 分工支持这一层次。
3. **记录 coverage，而非只保留文本。** 保存 `{root:/work, kind:directory-name, normalizedQuery:atlas, depth:1, candidates:[/work/atlas], complete:true}`。输出本身受 100 / 1,000 results 与 50 KiB 一类上限约束。
4. **做授权状态转换。** 若 `/work/atlas` 不在 roots，展示候选并走 add-dir / trust / permission；没有授权时只能报告“候选存在”，不能读取内容。Claude `--add-dir` 与 Cursor multi-root 是直接先例。
5. **在新 root 内做内容搜索。** 只有项目 root 被加入后，才用专用 grep/glob，结果带 path、limit、truncated/complete 元数据。
6. **执行前检查重复。** 对工具名、canonical root、规范化 query、depth、filter 生成 fingerprint；完全重复且上次 `complete=true` 时直接复用结果。若参数略变但搜索域被已有 coverage 包含，要求新信息增量，否则计为 no-progress。
7. **停止并总结。** 找到唯一候选、被用户拒绝授权、候选为空且 discovery root 已完整覆盖，三种都形成 terminal state。Pi 的 `shouldStopAfterTurn` 是停止 seam；Gemini 的 pattern detector 是兜底 circuit breaker；Cursor Explore 的“只回 relevant findings”是总结边界。

这个 trace 中，**步骤 1–5 减少重复概率，步骤 6–7 才真正防止重复执行**。输出截断和 compaction 不参与“是否已经查过”的判定。

## 哪些做法能防本例，哪些不能

### 能直接防止或硬停

- **显式 roots + 一次候选目录查询 + coverage state**：相同 root / query / depth 已完整覆盖时不再执行。
- **canonical fingerprint cache**：完全相同调用直接复用 tool result；对 read-only 搜索安全，对 side effect 工具还需要 call-id fan-out 与幂等语义。
- **no-progress circuit breaker**：连续调用没有新增候选、没有扩大合法 scope、没有改变假设时停止并总结/询问。
- **固定 pattern detector**：Gemini CLI 的 1–5-call cycle × 5 次能兜底硬停明确循环。
- **权限状态机**：未授权 sibling 时进入 `needs_root_authorization`，不让 agent 用别的 shell 语法绕着找。

### 只能降低成本或概率，不能防止

- **只注入 cwd / project rules**：不知道 sibling 路径时仍要发现。
- **专用 Glob/Grep/Find**：比 shell 结构化，但如果没有调用记忆仍会重复。
- **结果数量、字节、行数上限**：限制单次损失，不能限制调用次数。
- **30 秒 command timeout**：限制一次命令，不能限制连续命令。
- **compaction / `/summarize`**：回收 token；若覆盖状态没独立保存，可能促成重搜。
- **Explore subagent**：隔离噪声，官方证据未证明内部具备去重。
- **只比较 exact JSON args**：抓不到参数顺序、相对路径、glob 改写和跨工具的语义等价调用。

## 可直接映射到 Jai 的机制

以下只描述机制和边界，不是具体 patch：

1. **Workspace scope 作为 runtime fact**：每轮直接注入 `primaryRoot`、`additionalRoots`、`candidateDiscoveryRoots` 及各自 read/write/trust 状态。与消息文本分离，compaction 后仍保留。
2. **Project-candidate discovery 是独立的 read-only operation**：输入至少是 `root + normalizedName + maxDepth + limit`；输出至少有 canonical path、project marker、匹配理由、`complete/truncated`。它不读取候选项目源码。
3. **Search ledger**：记录 canonical query fingerprint、覆盖域、结果摘要和 completion。exact duplicate 复用；被已完成 coverage 包含的近似调用不执行，除非调用方说明增量。
4. **两级 loop guard**：低成本 deterministic detector 先抓 exact / short cycle；再用基于 coverage 增量的 no-progress 判定抓 `find → ls → rg --files` 这种语义近似循环。LLM detector 只作为后备，不做第一道边界。
5. **Terminal-state summary**：`found_unique`、`ambiguous_candidates`、`not_found_in_authorized_roots`、`needs_authorization`、`search_truncated`、`loop_blocked` 都应能结束当前探索并返回简短依据，避免 agent 把“没权限”误当“再换命令”。
6. **工具结果 envelope**：保留 limit、原始 count、returned count、truncated reason、coverage 和 continuation token/offset；不要只给一段容易在 compaction 中丢语义的文本。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Claude Code 官方 permissions、settings、CLAUDE.md 文档（访问 2026-09-12，关键 fence 要求 v2.1.257+）；Cursor Search、Shell Mode、CLI Using、CLI Changelog（访问 2026-09-12）；Codex `project_doc.rs` 固定 `d807d44…`、`tools/spec.rs` 固定 `85034b1…`；Pi find/grep/truncate/compaction/agent loop 固定 `71dca87…`；Gemini loop detector 固定 `9c1b0a6…`。 |
| 作者或维护者本人的说法 | Pi issue #279 中维护者 `badlogic` 解释 custom cwd 工具必须用 cwd-bound factories，随后由当前 SDK 文档/源码确认；Codex PR #4820 的作者说明 `grep_files` 用于并行 action，但本笔记只用合并源码支撑当前工具契约。Claude/Cursor 未找到公开维护者对“近似搜索去重”的明确设计说明。 |
| 同类方案 | 核心对照 4 个：Claude Code、Cursor Agent/CLI、OpenAI Codex CLI、Pi coding agent；另用 Gemini CLI 提供一个有公开源码、已落地 loop detector 的反方基线。 |
| issue / PR / 社区实践 | Codex #27759 提供 0.137.0 的 deterministic mock-provider reproduction，量化未设界重复；Pi #279 记录 cwd 绑定历史缺陷及维护者修复说明；Gemini PR #4337 记录 LLM-based loop check 的引入动机。社区 issue 只用于已限定版本的反例，不替代当前源码契约。 |
| 历史演变 | Cursor CLI changelog 显示从单 `--workspace` 扩展到 named multi-directory workspace、repeatable `--add-dir`；Claude docs 标出 `/cd`、workspace fence 等最低版本；Codex PR #4820（merge commit `f52320be863caf422ea7afd3247dc7f1ef8610e8`）说明 `grep_files` 后加为可并行专用工具；Gemini PR #4337 说明从 deterministic repetition 扩展到 30-turn 后的 LLM no-progress 检测。 |

## 来源覆盖盲区与待验证

- Cursor Agent 的客户端/服务端实现闭源：没有可核验的 search-result 精确 cap、candidate cache、重复调用 detector 或 no-progress 阈值；只能确认官方公开的 multi-root、Instant Grep、Explore、shell timeout / truncation。
- Claude Code 没有公开 core loop 源码：官方文档能确认 hooks、budget、working-dir fence，但本次没有找到一手证据证明存在通用 built-in exact/near-duplicate detector；因此未把“没有 detector”写成绝对当前事实。
- Codex #27759 是带完整复现的用户 issue，尚无维护者根因确认；只用于限定 0.137.0 的反例。没有用它外推当前所有 Codex 产品面。
- Pi 提供 stop hook seam，但没有找到官方默认重复搜索策略；“可由 host 实现”与“产品已默认实现”必须区分。
- 本次未实跑各 CLI，也没有读取私有 telemetry；关于实际误报率、延迟、token 节省和不同模型行为没有可量化一手数据。

## 对本项目的影响

外部证据支持一个最小结论：Jai 不需要把“更聪明地跑 shell”作为项目发现的核心。应优先拥有显式 workspace roots、一次性有界候选发现、跨 compaction 的 search ledger、权限状态和 runtime circuit breaker。专用搜索、结果截断和总结是必要的成本控制，但它们都不能代替“这个搜索域已经完整查过”的 durable-in-run fact。

反过来，没有证据支持默认扫描 cwd 的父目录、home 或磁盘来猜项目；这既扩大安全面，也无法解决重复调用。若 host 没有可授权的 candidate discovery root，正确 terminal state 是向用户索要路径或 root 授权，而不是继续换写法执行近似 `find` / `ls` / `rg`。
