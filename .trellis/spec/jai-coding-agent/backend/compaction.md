# Compaction

> Cross-layer contract for the context compaction mechanism inside `@jayden/jai-coding-agent`.

The module lives at [`packages/coding-agent/src/core/session/compaction.ts`](../../../../packages/coding-agent/src/core/session/compaction.ts) and its orchestration at [`packages/coding-agent/src/core/session/agent-session.ts`](../../../../packages/coding-agent/src/core/session/agent-session.ts). Persisted shape is owned by `@jayden/jai-session`.

## 1. Scope / Trigger

Cross-layer contract across **three layers** — any change here triggers code-spec depth:

- `@jayden/jai-session` owns the persisted `CompactionEntry` schema and rebuild logic.
- `@jayden/jai-coding-agent` owns the compact algorithm, prompts, cut planning, and `AgentSession` orchestration.
- `@jayden/jai-gateway` translates emitted `AgentEvent` (`compaction_start`, `compaction_end`) into AG-UI `COMPACTION_START` / `COMPACTION_END`.

Two tiers of compaction:

- **Microcompact** (non-destructive, in-memory): before each `runAgentLoop` API call, old `tool_result` bodies for whitelisted tools are swapped for a `[Tool result cleared to save context]` placeholder. Original session log is untouched.
- **Full Compact** (persistent, LLM-generated summary): when `inputTokens` crosses the threshold, an LLM is asked to produce a structured summary of older messages. A `CompactionEntry` is appended to the session log and all subsequent context rebuilds start from the summary + kept tail.

Trigger points in `AgentSession.chat()`:

1. **Pre-loop** — after persisting the user message, before `runAgentLoop`. Catches the "first turn already over-limit" case.
2. **Post-loop** — after `runAgentLoop` returns. Proactively compacts so the next `chat()` starts clean.

Microcompact lives inside the `contextTransform` hook of `runAgentLoop`, so it runs once per iteration with the latest `lastInputTokens` (tracked via `step_finish` events, not stale message usage).

Emitted events (`AgentEvent`):

- `{ type: "compaction_start" }` — fired when the LLM summary request is about to start.
- `{ type: "compaction_end", summary: string }` — fired after a successful compaction with the formatted summary.

## 2. Signatures

```ts
// packages/coding-agent/src/core/session/compaction.ts

export const RESERVED_OUTPUT_TOKENS: 20_000;
export const COMPACT_BUFFER_TOKENS: 13_000;

// Single public decision function; the underlying window math is module-private.
export function shouldCompact(inputTokens: number, contextLimit: number): boolean;

export function stripMediaFromMessages(messages: Message[]): Message[];

export function microcompact(opts: {
  messages: Message[];
  lastInputTokens: number;
  contextLimit: number;
  keepRecentTurns?: number; // default 4
}): Message[];

export type CompactOptions = {
  messages: Message[];
  model: ModelInfo | string;
  baseURL?: string;
  signal?: AbortSignal;
  /**
   * When provided, triggers the INCREMENTAL UPDATE path: `messages` should
   * hold only the NEW messages since the previous compaction, and
   * `previousSummary` gets embedded in the prompt inside <previous-summary>
   * tags for the model to fold forward.
   */
  previousSummary?: string;
};

export function compactMessages(opts: CompactOptions): Promise<string>;
export function generateTurnPrefixSummary(opts: CompactOptions): Promise<string>;

export function findLastTurnStart(messages: Message[]): number;
export function findSplitPointInLastTurn(
  messages: Message[],
  turnStart: number,
  minSuffixCount?: number, // default 4
): number | null;

export function formatCompactSummary(raw: string): string;
export function collectRecentFileReadPaths(messages: Message[], limit?: number): string[];
```

```ts
// packages/coding-agent/src/core/session/agent-session.ts

export type CompactionCutPlan = {
  firstKeptIndex: number;     // index into MessageEntry[] where kept tail starts
  splitPoint: number | null;  // null = normal path; non-null = split-turn fallback
};

export function planCompactionCut(messageEntries: MessageEntry[]): CompactionCutPlan | null;
export function findLastCompactionEntryInBranch(branch: SessionEntry[]): CompactionEntry | null;
export function indexOfEntryById(entries: MessageEntry[], id: string): number;
export function isSummaryDrift(updatedRaw: string, previousSummary: string): boolean;
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
  firstKeptEntryId: string;  // MUST point to a MessageEntry with a valid kept-tail role
  turnPrefixSummary?: string; // PRESENT when the compaction split a turn
};
```

**JSONL backward compatibility**: `turnPrefixSummary` is optional and additive; pre-existing sessions without the field continue to work unchanged. `buildSessionContext` only injects the split-turn context block when the field is present.

### Cut plan — `planCompactionCut`

Returns `{ firstKeptIndex, splitPoint }` or `null`.

**Primary path** (`splitPoint === null`): keep ~20% of messages (min 6), align forward to the next `user` message so the kept tail has a clean turn boundary. `[0..firstKeptIndex)` → summarization prefix. `[firstKeptIndex..]` → kept verbatim.

**Split-turn fallback** (`splitPoint !== null`): triggered when the last turn itself is oversized and no user boundary exists in the kept window. `splitPoint` is set to the last turn's start so the prefix is itself split:

- `[0..splitPoint)` → normal history summary (via `compactMessages`)
- `[splitPoint..firstKeptIndex)` → turn-prefix summary (via `generateTurnPrefixSummary`)
- `[firstKeptIndex..]` → kept verbatim suffix of last turn

Requires `splitPoint >= 2` (at least 2 messages of prior history worth summarizing) and a valid interior cut via `findSplitPointInLastTurn`. Returns `null` when neither path yields a usable plan.

### Cut-point validity (`findSplitPointInLastTurn`)

A cut at index `i` inside the last turn is valid iff:

1. `messages[i].role !== "tool_result"` — suffix cannot start with an orphaned tool_result.
2. `messages[i - 1]` is not an `assistant` message with a `tool_call` content block — prefix cannot end with a tool_call orphaned from its tool_result (the LLM summarization call would reject the dangling pairing).
3. At least `minSuffixCount` (default 4) messages remain in the kept suffix.

Scanner walks `maxCut = messages.length - minSuffixCount` down to `turnStart + 1`, returning the first valid index.

### Iterative summary — `compactMessages` with `previousSummary`

When `previousSummary` is supplied:

- The prompt switches from `COMPACT_USER_PROMPT` (full rewrite) to `UPDATE_SUMMARIZATION_PROMPT`.
- The prompt body is suffixed with `\n\n<previous-summary>\n{previousSummary}\n</previous-summary>`.
- Callers pass only the **incremental** messages since the previous `CompactionEntry.firstKeptEntryId`, not the full prefix.

Orchestration in `AgentSession.summarizeHistory`:

- `prevCompaction === null` → full rewrite over the entire prefix.
- `prevCompaction !== null` + `incrementalHistoryMessages.length === 0` → return `<summary>{previousSummary}</summary>` verbatim (no LLM call).
- `prevCompaction !== null` + `incrementalHistoryMessages.length > 0` → incremental UPDATE. If `isSummaryDrift(updatedRaw, previousSummary)` is `true`, fall back to full rewrite over `fullHistoryMessages` (one retry, inside the same `try` block).

### Drift heuristic — `isSummaryDrift`

```
updatedBody   = extract <summary>...</summary> (or trimmed raw)
previousBody  = extract <summary>...</summary> (or trimmed raw)
drift         = previousBody.length > 0 && updatedBody.length < previousBody.length * 0.5
```

Rationale: when the UPDATE prompt drops instead of updating, the output is usually under half the prior length. The ratio is conservative — it tolerates meaningful consolidation while catching accidental content loss.

### Context rebuild (`buildSessionContext`)

When the most recent non-message entry is a `CompactionEntry`, the rebuilt `Message[]` is:

```
[
  UserMessage{ content: wrap(compaction.summary [+ turnPrefixBlock]) },
  ...messages from firstKeptEntryId onward
]
```

`wrap(...)` prefixes the summary with a resume instruction and suffixes with "Recent messages are preserved verbatim. Continue the conversation from where it left off..." When `turnPrefixSummary` is present, a `[Context for retained recent turn (its prefix was truncated)]\n{turnPrefixSummary}` block is appended **after** the main summary but **before** the "Recent messages are preserved verbatim" line.

### Summary content shape

Written into `CompactionEntry.summary`:

```
Summary:
1. Primary Request and Intent: ...
2. Key Technical Concepts: ...
... (9 sections total) ...
9. Optional Next Step: ...

[Recently viewed files before compaction]
- path/to/a.ts
- path/to/b.ts
(Their contents are not re-attached — re-read if needed.)
```

The `<analysis>` scratchpad from the LLM is stripped. The file-hint block is appended only when `collectRecentFileReadPaths` returns a non-empty list. The file-hint window covers the FULL prefix (history + turn-prefix if split) so no file reference is lost when a turn is split.

### Effective window math (module-private)

```
effectiveWindow  = contextLimit - RESERVED_OUTPUT_TOKENS      // 20_000
compactThreshold = effectiveWindow - COMPACT_BUFFER_TOKENS    // 13_000
shouldCompact    = inputTokens > compactThreshold
```

Example for `contextLimit = 200_000`: `effective = 180_000`, `threshold = 167_000`. The intermediate helpers `getEffectiveContextWindow` / `getCompactThreshold` are NOT exported — they are implementation details of `shouldCompact` and are only reachable through `__internal` for white-box tests.

### Tool-result whitelist for microcompact

`COMPACTABLE_TOOLS = {"FileRead", "FileWrite", "FileEdit", "Bash", "Glob", "Grep"}`. Non-whitelisted tools (e.g. any custom domain tool) are **never** cleared because we can't assume their outputs are re-derivable.

## 4. Validation & Error Matrix

| Condition | Behavior |
|-----------|----------|
| `inputTokens <= 0` | Skip compact (no usage data yet). |
| `inputTokens` below threshold | Skip compact. |
| `messageEntries.length < 4` | Skip compact (nothing to gain); `planCompactionCut` returns `null`. |
| `planCompactionCut` returns `null` (no valid cut) | `compactFailCount++`, return. |
| Split-turn required but `findSplitPointInLastTurn` returns `null` | `compactFailCount++`, return. |
| Split-turn required but `turnStart < 2` (too little prior history) | `compactFailCount++`, return. |
| Primary path with `fullHistoryMessages.length < 2` and no previous summary | Skip compact silently. |
| Iterative path with `incrementalHistoryMessages.length === 0` | Reuse `previousSummary` verbatim (NO LLM call). |
| Iterative update output shorter than 50% of `previousSummary` | Drift detected; fall back to full rewrite in the same `try`. |
| LLM returns empty string | Throw `"Compaction produced empty summary"` or `"Turn-prefix summarization produced empty summary"`, increments `compactFailCount`. |
| `streamMessage` errors (network, PTL, etc.) | Caught, increments `compactFailCount`. Session continues. |
| `compactFailCount >= MAX_COMPACT_FAILURES (3)` | Circuit breaker trips — no further auto-compact attempts this session. |
| Abort signal fires mid-compact | `streamMessage` throws `AbortError`, counts as failure; session also aborts. |

**Not handled (out of scope):**

- Prompt-too-long fallback for the compact request itself (stripping front 20% + retry).
- Manual `/compact` command.
- Prompt-cache sharing with the main loop.
- Compaction stats / per-session telemetry (no data collection yet — can be added later if we need to tune thresholds).

## 5. Good / Base / Bad Cases

### Base — first full compact

```
turn 1..20 (~170k tokens, prev compaction: none)
  → shouldCompact triggers
  → planCompactionCut: firstKeptIndex = 16 (user boundary), splitPoint = null
  → summarizeHistory: no previousSummary → full rewrite via compactMessages
  → formatCompactSummary strips <analysis>/scratchpad → "Summary:\n..."
  → CompactionEntry appended { summary, firstKeptEntryId: m16 }
  → next chat(): buildSessionContext returns [wrappedSummary, ...tail]
```

### Good — iterative update (second compact)

```
previous CompactionEntry exists at m16; session has grown to m40
  → shouldCompact triggers
  → planCompactionCut: firstKeptIndex = 36, splitPoint = null
  → findLastCompactionEntryInBranch → prevCompaction@m16
  → incrementalHistoryMessages = messages[16..36]  (20 msgs, not 36)
  → summarizeHistory: UPDATE prompt + <previous-summary>
  → output length ~= previous → not drift → accept
  → CompactionEntry { summary: updatedSummary, firstKeptEntryId: m36 }
```

Cost saving: prompt input drops from 36 messages + full history prompt to 20 messages + previous summary (typically 1/3 - 1/2 the tokens).

### Good — split-turn fallback (single oversized turn)

```
turn 1..4 normal, then turn 5 = user + 40 tool_result-heavy steps → over threshold
  → shouldCompact triggers
  → planCompactionCut: user-boundary scan hits end-of-array (last turn too big)
    → fallback: findLastTurnStart = idx of turn 5's user (turnStart=8)
    → findSplitPointInLastTurn finds valid interior cut at idx 40
    → returns { firstKeptIndex: 40, splitPoint: 8 }
  → compactMessages(messages[0..8])  → historySummary (turns 1..4)
  → generateTurnPrefixSummary(messages[8..40])  → turnPrefixSummary (truncated start of turn 5)
  → CompactionEntry { summary, firstKeptEntryId: m40, turnPrefixSummary }
  → buildSessionContext renders: wrappedSummary + [Context for retained recent turn] + block + kept tail from m40
```

### Good — iterative path with no new history (all new messages inside last turn)

```
previous compaction at m16 (firstKeptEntryId=m16); messages grew to m30 but still in the same turn
  → planCompactionCut triggers split-turn fallback: splitPoint = m16 (turnStart of current turn)
  → incrementalStart = 16 → incrementalHistoryMessages = messages[16..16] = []
  → summarizeHistory: previousSummary present, 0 incremental messages
    → return <summary>{previousSummary}</summary> verbatim (NO LLM call for history)
  → generateTurnPrefixSummary runs on the big turn's prefix
  → CompactionEntry { summary: unchanged history, firstKeptEntryId, turnPrefixSummary: new }
```

### Bad — drift fallback

```
iterative UPDATE prompt produces a 200-char summary when prev was 8000 chars
  → isSummaryDrift = true
  → summarizeHistory re-runs compactMessages(fullHistoryMessages)  (full rewrite)
  → CompactionEntry uses the full-rewrite result
  → next compaction resumes iterative mode from the fresh baseline
```

### Bad — circuit-breaker tripped

```
compactMessages throws 3 times (bad key, network, PTL)
  → compactFailCount = 3
  → maybeCompact early-returns forever this session
  → context keeps growing → provider returns prompt_too_long → surfaced to user
  → user restarts session, compactFailCount resets to 0
```

## 6. Tests Required

| Suite | File | Cases |
|-------|------|-------|
| `shouldCompact / threshold math` | `packages/coding-agent/test/compaction.test.ts` | Effective window = context - reserved; threshold = effective - buffer; false at/below threshold; true above. |
| `stripMediaFromMessages` | same | UserMessage Image→`[image]`; UserMessage File→`[file: name]` / `[file]`; ToolResult nested Image; assistant passthrough; no-op returns same ref. |
| `microcompact` | same | Below-threshold no-op (ref equality); above-threshold clears first N turns' whitelisted results; non-whitelisted tools preserved; idempotent on re-run. |
| `formatCompactSummary` | same | Strips `<analysis>`; extracts `<summary>` with `Summary:\n` prefix; works with only one tag; collapses 3+ newlines; returns trimmed input with no tags. |
| `collectRecentFileReadPaths` | same | Dedup with last-occurrence-wins; non-FileRead ignored; respects limit; empty when absent; skips missing/non-string `path`. |
| `findLastTurnStart` / `findSplitPointInLastTurn` / `planCompactionCut` | `packages/coding-agent/test/compaction-split-turn.test.ts` | Last-user-index lookup; valid/invalid cut classification (tool_result suffix-start; prev assistant-with-tool_call); minSuffixCount respected; `planCompactionCut` primary path returns `{firstKeptIndex, splitPoint:null}`; split-turn fallback returns `splitPoint=turnStart` with valid `firstKeptIndex`; too-little-history returns `null`. |
| `UPDATE_SUMMARIZATION_PROMPT` shape | `packages/coding-agent/test/compaction-iterative.test.ts` | Contains `<previous-summary>` placeholder; includes `PRESERVE`/`ADD`/`UPDATE` instructions; keeps no-tools guardrails and `<analysis>`/`<summary>` blocks. |
| `findLastCompactionEntryInBranch` / `indexOfEntryById` / `isSummaryDrift` | same | Returns latest compaction when multiple present; index/-1 semantics; drift ratio < 0.5 of previous flags true; >= 0.5 flags false; longer updated OK; raw-string (no tag) still compared; empty previous returns false. |
| `buildSessionContext` with `turnPrefixSummary` | `packages/session/test/store.test.ts` | When `turnPrefixSummary` is set, wrapped summary contains `[Context for retained recent turn` block and the turn-prefix body AFTER the main summary; when unset, block is absent. |

Circuit-breaker behavior (`compactFailCount >= 3` skip) and live end-to-end compaction are verified by code inspection + manual session run; full integration test would require `mock.module` of `streamMessage` and a live `AgentSession` harness — tracked as future work.

## 7. Wrong vs Correct

### Wrong — only cut at user boundaries

```ts
// DON'T
while (firstKeptIndex < messageEntries.length && messageEntries[firstKeptIndex].message.role !== "user") {
  firstKeptIndex++;
}
if (firstKeptIndex >= messageEntries.length) return; // give up
```

Problems:

- A single turn with 30+ large `tool_result` messages has no interior `user` boundary. The primary alignment loop runs off the end and `return`s, so `maybeCompact` gives up without compacting. The next iteration blows through the context limit with `prompt_too_long`. Under `compactFailCount++` in the old code this was silent; under the `planCompactionCut` refactor it at least surfaces as a retry budget.

### Correct — primary user-boundary, fallback to split-turn

```ts
const plan = planCompactionCut(messageEntries);
if (!plan) { this.compactFailCount++; return; }

// Primary path: splitPoint === null → summarize the whole prefix as one unit.
// Split-turn:  splitPoint !== null → summarize [0..splitPoint) as history,
//              [splitPoint..firstKeptIndex) as a separate turn-prefix summary,
//              keep [firstKeptIndex..] verbatim.
```

Why it wins:

- Rigidly pairs with Anthropic-style tool_call/tool_result invariants: the cut-point validator guarantees neither half is malformed.
- Handles the pathological single-huge-turn case by trading a cheap second LLM call (turn-prefix) for the ability to make forward progress.
- Split-turn summary is replayed out-of-band (inside the wrapped user message), so the agent sees "here's what you did earlier in this same turn; the rest is verbatim" — matching pi-mono's `TURN_PREFIX_SUMMARIZATION_PROMPT` pattern.

### Wrong — regenerate the whole summary on every compact

```ts
// DON'T (naive)
const summary = await compactMessages({ messages: entirePrefix, model });
await store.append({ type: "compaction", ..., summary });
```

Problems:

- Session with N compactions pays the full-history prompt cost N times. For a long session with 5 compactions at ~150k prefix tokens each, that's 750k input tokens spent on summarization alone.
- Each regenerated summary drifts stylistically from the last, making multi-compact sessions feel disjoint.

### Correct — iterative UPDATE with drift fallback

```ts
const prevCompaction = findLastCompactionEntryInBranch(branch);
const previousSummary = prevCompaction?.summary;
const incremental = prefixMessages.slice(indexOfEntryById(entries, prevCompaction.firstKeptEntryId), historyEnd);

const updated = await compactMessages({
  messages: incremental,
  previousSummary,
  model,
});

if (isSummaryDrift(updated, previousSummary)) {
  return compactMessages({ messages: fullHistoryMessages, model });
}
return updated;
```

Why it wins:

- Input-token cost on compact N>1 drops to `incremental messages + previousSummary size` (typically 1/3 of full rewrite).
- Preserves continuity: the UPDATE prompt explicitly tells the model to PRESERVE existing content, so section identity is stable across compactions.
- Drift heuristic catches the degenerate case where the model misunderstands the UPDATE instruction and rewrites minimally; the full-rewrite retry restores correctness at the cost of one extra LLM call.

### Wrong — flatten conversation to a string

```ts
// DON'T
const transcript = messages.map((m) => `${m.role}: ${textOnly(m.content)}`).join("\n\n");
await streamMessage({ systemPrompt, messages: [{ role: "user", content: [{type:"text", text: transcript}] }] });
```

Problems:

- Loses role structure / `tool_call` ↔ `tool_result` pairing (LLMs summarize conversations better when they see native turns).
- Tool-result truncation silently drops stack traces and error details.
- Blocks future prompt-cache reuse (cache keys depend on the raw `Message[]` prefix).

### Correct — native `Message[]` + `summaryRequest`

```ts
const stripped = stripMediaFromMessages(messages);
const summaryRequest: UserMessage = {
  role: "user",
  content: [{ type: "text", text: promptText }],
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

## Design Decisions

### Why split-turn, not larger `initialKeepCount`?

Initial approach was to bail out (`compactFailCount++`) when the last turn was too large. That produced a session-ending `prompt_too_long` loop for any session where a single turn contained enough tool_result bodies to exceed the threshold. Enlarging `initialKeepCount` would cap max-summarizable turns but not fix the root issue — a single 40-step `Bash`-heavy turn would still fail.

Split-turn solves it by allowing a **second** LLM call that summarizes the truncated start of the problem turn, letting the kept suffix refer to that summary for context. The trade-off is one extra LLM call in the pathological case, which is acceptable because the alternative (session death) has zero recovery path.

### Why additive `turnPrefixSummary` instead of a second `CompactionEntry`?

Two options for persisting the split-turn state:

1. One `CompactionEntry` with `summary` + optional `turnPrefixSummary` (chosen).
2. Two chained `CompactionEntry` records.

Chose option 1 because:

- The two summaries are semantically one atomic compaction event (same wall clock, same trigger, same consumer).
- `buildSessionContext` only needs to find the "most recent" compaction; two chained entries would require more complex walk logic with no corresponding readability win.
- Additive field is trivially JSONL-backward-compatible.

### Why iterative UPDATE prompt instead of sliding-window summary?

Claude-code-style: regenerate whole summary every compact. pi-mono-style: iterative update with `<previous-summary>` as input. Picked iterative because:

- After 2+ compactions, input token cost flattens (summary + incremental delta stays roughly constant) instead of growing linearly with conversation length.
- Section identity is preserved across compactions (same "Primary Request", same "Files and Code" headings), making historical diff trivial.

Downside accepted: occasional drift when the model misunderstands UPDATE. Mitigated by `isSummaryDrift` + full-rewrite fallback.

### Why drift threshold = 0.5 and not stricter?

Empirically, legitimate consolidation can drop up to ~30% of length (completed tasks move from Pending to done; unrelated debug context gets pruned). 0.5 is conservative: a 50% shrink is almost always drift, not consolidation. If drift fallback fires frequently in production, consider 0.6 or 0.7 but do NOT go below 0.4 — false positives there would defeat the cost-saving purpose of iterative updates.

## Common Mistakes

### Mistake: forgetting to slice incremental messages

**Symptom**: iterative UPDATE path sends the full prefix (not just new messages), costing more tokens than a fresh rewrite.

**Cause**: `maybeCompact` accidentally passes `prefixMessages` instead of `incrementalHistoryMessages` to `compactMessages` when `previousSummary` is set.

**Fix**: always slice by `indexOfEntryById(entries, prevCompaction.firstKeptEntryId)` before the call.

### Mistake: treating `turnPrefixSummary` as mandatory in `buildSessionContext`

**Symptom**: TypeScript complains (or runtime crashes) on sessions predating the field.

**Cause**: reading `lastCompaction.turnPrefixSummary` without optional chaining.

**Fix**: the field is optional; use `lastCompaction.turnPrefixSummary ? '...' : ''` and never rely on its presence for correctness of the kept suffix.
