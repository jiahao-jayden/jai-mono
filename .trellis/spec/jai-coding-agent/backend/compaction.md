# Compaction

> Cross-layer contract for the two-tier context compaction mechanism inside `@jayden/jai-coding-agent`.

## 1. Scope / Trigger

Compaction keeps long sessions within the model's context window. Two tiers:

- **Microcompact** (non-destructive, in-memory): before each `runAgentLoop` API call, old `tool_result` bodies for whitelisted tools are swapped for a `[Tool result cleared to save context]` placeholder. Original session log is untouched.
- **Full Compact** (persistent, LLM-generated summary): when `inputTokens` crosses the threshold, an LLM is asked to produce a structured summary of older messages. A `CompactionEntry` is appended to the session log and all subsequent context rebuilds start from the summary + kept tail.

Trigger points in `AgentSession.chat()`:

1. **Pre-loop** — after persisting the user message, before `runAgentLoop`. Catches the "first turn already over-limit" case.
2. **Post-loop** — after `runAgentLoop` returns. Proactively compacts so the next `chat()` starts clean.

Microcompact lives inside the `contextTransform` hook of `runAgentLoop`, so it runs once per iteration with the latest `lastInputTokens` (tracked via `step_finish` events, not stale message usage).

Emitted events (`AgentEvent`):

- `{ type: "compaction_start" }` — fired when the LLM summary request is about to start.
- `{ type: "compaction_end", summary: string }` — fired after a successful compaction with the formatted summary.

These translate to AG-UI `COMPACTION_START` / `COMPACTION_END` via `gateway/events/adapter.ts`.

## 2. Signatures

```ts
// packages/coding-agent/src/core/compaction.ts

export const RESERVED_OUTPUT_TOKENS: 20_000;
export const COMPACT_BUFFER_TOKENS: 13_000;

export function getEffectiveContextWindow(contextLimit: number): number;
export function getCompactThreshold(contextLimit: number): number;
export function shouldCompact(inputTokens: number, contextLimit: number): boolean;

export function stripMediaFromMessages(messages: Message[]): Message[];

export function microcompact(opts: {
  messages: Message[];
  lastInputTokens: number;
  contextLimit: number;
  keepRecentTurns?: number; // default 4
}): Message[];

export function compactMessages(opts: {
  messages: Message[];
  model: ModelInfo | string;
  baseURL?: string;
  signal?: AbortSignal;
}): Promise<string>; // raw LLM output, pre-formatting

export function formatCompactSummary(raw: string): string;

export function collectRecentFileReadPaths(
  messages: Message[],
  limit?: number, // default 8
): string[];
```

## 3. Contracts

### CompactionEntry (`packages/session/src/types.ts`)

```ts
type CompactionEntry = {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;           // formatted, ready to feed back into the model
  firstKeptEntryId: string;  // MUST point to a MessageEntry whose message.role === "user"
};
```

Invariant: `firstKeptEntryId` always aligns to a `user`-role boundary. This prevents the rebuilt context from starting with an orphan `tool_result` and prevents the summarized prefix from ending with an `assistant` that has an unmatched `tool_call`.

### Summary content shape

Written into `CompactionEntry.summary`:

```
Summary:
1. Primary Request and Intent:
   ...
2. Key Technical Concepts:
   ...
... (9 sections total) ...
9. Optional Next Step:
   ...

[Recently viewed files before compaction]
- path/to/a.ts
- path/to/b.ts
(Their contents are not re-attached — re-read if needed.)
```

The `<analysis>` scratchpad from the LLM is stripped. The file-hint block is appended only when `collectRecentFileReadPaths` returns a non-empty list.

### Effective window math

```
effectiveWindow  = contextLimit - RESERVED_OUTPUT_TOKENS      // 20_000
compactThreshold = effectiveWindow - COMPACT_BUFFER_TOKENS    // 13_000
shouldCompact = inputTokens > compactThreshold
```

Example for `contextLimit = 200_000`: `effective = 180_000`, `threshold = 167_000`.

### Context rebuild (`buildSessionContext`)

When the most recent non-message entry is a `CompactionEntry`, the rebuilt `Message[]` is:

```
[
  UserMessage{ content: wrap(compaction.summary) },
  ...messages from firstKeptEntryId onward
]
```

Where `wrap(...)` prefixes the summary with a resume instruction ("Continue from where you left off without acknowledging this summary, without recapping, and without asking what to do next. Resume the last task directly.").

### Tool-result whitelist for microcompact

`COMPACTABLE_TOOLS = {"FileRead", "FileWrite", "FileEdit", "Bash", "Glob", "Grep"}`. Non-whitelisted tools (e.g. any custom domain tool) are **never** cleared because we can't assume their outputs are re-derivable.

## 4. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| `inputTokens <= 0` | Skip compact (no usage data yet). |
| `inputTokens` below threshold | Skip compact. |
| `messageEntries.length < 4` | Skip compact (nothing to gain). |
| `toSummarize.length < 2` after boundary alignment | Skip compact. |
| LLM returns empty string | Throw `"Compaction produced empty summary"`, increments `compactFailCount`. |
| `streamMessage` errors (network, PTL, etc.) | Caught, increments `compactFailCount`. Session continues. |
| `compactFailCount >= MAX_COMPACT_FAILURES (3)` | Circuit breaker trips — no further auto-compact attempts this session. |
| Abort signal fires mid-compact | `streamMessage` throws `AbortError`, counts as failure but session also aborts. |

**Not handled (out of scope, P4):**
- Prompt-too-long fallback for the compact request itself (stripping front 20% + retry).
- Manual `/compact` command.
- Prompt-cache sharing with the main loop.

## 5. Good / Base / Bad Cases

### Good — normal auto-compact

```
turn 1..20 (~170k tokens) → shouldCompact triggers before turn 21
  → maybeCompact splits at user-boundary (keep last ~4 turns)
  → compactMessages(messages with media stripped) → raw LLM output with <analysis>/<summary>
  → formatCompactSummary strips scratchpad → "Summary:\n..."
  → collectRecentFileReadPaths → ["src/a.ts", "src/b.ts"]
  → CompactionEntry appended, lastEntryId updated
  → next chat(): buildSessionContext returns [wrappedSummary, ...tail]
  → agent resumes without recap
```

### Base — microcompact only

```
turn 1..10 (~105k tokens, >50% of 200k)
  → shouldCompact false (still below 167k)
  → microcompact: clear tool_results from turns 1..6 → ~30k tokens saved
  → no persistent state change, session log intact
  → next turn proceeds normally
```

### Bad — circuit-breaker tripped

```
compactMessages throws 3 times in a row (bad key, network, PTL)
  → compactFailCount = 3
  → maybeCompact early-returns forever this session
  → context keeps growing → provider returns prompt_too_long → surfaced to user
  → user restarts session, compactFailCount resets to 0
```

## 6. Tests Required

See `packages/coding-agent/test/compaction.test.ts`.

| Suite | Cases |
|-------|-------|
| `shouldCompact / threshold math` | Effective window subtracts reserved; threshold subtracts buffer; false at/below threshold; true above. |
| `stripMediaFromMessages` | UserMessage Image→`[image]`; UserMessage File→`[file: name]` / `[file]`; ToolResult nested Image; assistant passthrough; no-op returns same ref. |
| `microcompact` | Below-threshold no-op (ref equality); above-threshold clears first N turns' whitelisted results; non-whitelisted tools preserved; idempotent on re-run. |
| `formatCompactSummary` | Strips `<analysis>`; extracts `<summary>` with `Summary:\n` prefix; works with only one tag; collapses 3+ newlines; returns trimmed input with no tags. |
| `collectRecentFileReadPaths` | Dedup with last-occurrence-wins; non-FileRead ignored; respects limit; empty when absent; skips missing/non-string `path`. |

Circuit-breaker behavior (`compactFailCount >= 3` skip) is verified by code inspection + manual session run; integration test would require `mock.module` of `streamMessage` and a live `AgentSession` harness — tracked as future work if compaction logic gains complexity.

## 7. Wrong vs Correct

### Wrong — flatten conversation to a string

```ts
// DON'T
const transcript = messages
  .map((m) => {
    if (m.role === "user") return `User: ${textOnly(m.content)}`;
    if (m.role === "assistant") return `Assistant: ${textOnly(m.content)}`;
    if (m.role === "tool_result") return `Tool: ${truncate(textOnly(m.content), 500)}`;
  })
  .filter(Boolean).join("\n\n");

await streamMessage({ systemPrompt: COMPACT_PROMPT, messages: [{ role: "user", content: [{type:"text", text: transcript}] }] });
```

Problems:
- Loses role structure / `tool_call` ↔ `tool_result` pairing (LLMs summarize conversations better when they see native turns).
- 500-byte tool_result truncation silently drops stack traces and error details.
- Blocks future prompt-cache reuse (cache keys depend on the raw `Message[]` prefix).

### Correct — native `Message[]` + `summaryRequest`

```ts
const stripped = stripMediaFromMessages(messages);
const summaryRequest: UserMessage = {
  role: "user",
  content: [{ type: "text", text: COMPACT_USER_PROMPT }],
  timestamp: Date.now(),
};
await streamMessage({
  model, baseURL, signal,
  systemPrompt: "You are a helpful AI assistant tasked with summarizing conversations.",
  messages: [...stripped, summaryRequest],
  maxRetries: 0,
});
```

Why it wins:
- Role and tool pairings preserved — model natively handles multi-turn conversation.
- Only binary media is replaced (image/file → text placeholder); every text byte survives.
- Prefix is byte-stable across calls, so a future cache layer can slot in without refactoring.

### Wrong — split by message count regardless of role

Splitting at `length - keepCount` can land in the middle of an assistant's tool_call or on a `tool_result`, producing malformed conversation halves. The fix is to scan forward until `messages[firstKeptIndex].role === "user"`.
