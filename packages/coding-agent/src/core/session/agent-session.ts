import { type AgentEvent, type AgentTool, EventBus, runAgentLoop } from "@jayden/jai-agent";
import type {
	AssistantMessage,
	FileContent,
	ImageContent,
	Message,
	ModelInfo,
	TextContent,
	UserMessage,
} from "@jayden/jai-ai";
import { resolveModelInfo } from "@jayden/jai-ai";
import {
	buildSessionContext,
	type CompactionEntry,
	JsonlSessionStore,
	type MessageEntry,
	type SessionEntry,
	type SessionStore,
} from "@jayden/jai-session";

/** 迭代 summary 漂移阈值：新 summary 短于旧的此比例即判定为丢内容，回退全量重写。 */
const SUMMARY_DRIFT_RATIO = 0.5;

import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import { processAttachments } from "../attachments/processor.js";
import type { RawAttachment } from "../attachments/types.js";
import type { ResolvedPrompts, Workspace } from "../config/workspace.js";
import { buildSystemPrompt } from "../prompt/builder.js";
import { buildTitleInput, generateTitle } from "../prompt/title.js";
import {
	collectRecentFileReadPaths,
	compactMessages,
	findLastTurnStart,
	findSplitPointInLastTurn,
	formatCompactSummary,
	generateTurnPrefixSummary,
	microcompact,
	shouldCompact,
} from "./compaction.js";

/**
 * AgentSession 的配置。创建 session 时传入，整个生命周期不可变。
 */
export type SessionConfig = {
	/** workspace 实例 — 由外部创建，注入到 session */
	workspace: Workspace;
	/** 模型信息 — ModelInfo 对象或 "provider/model" 字符串 */
	model: ModelInfo | string;
	/** 自定义 API 地址，透传给 AI SDK */
	baseURL?: string;
	/** 恢复已有 session 时传入 sessionId，否则新建 */
	sessionId?: string;
	/** 注册的工具列表 */
	tools: AgentTool[];
	/** agent loop 最大迭代次数 */
	maxIterations?: number;
};

/**
 * AgentSession 的运行时状态。
 *
 * 状态机: idle → running → idle
 *              ↘ aborted ↗
 */
export type SessionState = "idle" | "running" | "aborted";

/** compaction 在可见时间线上的标记；`beforeMessageIndex` 指向它后面第一条消息的下标。 */
export type CompactionMarker = {
	id: string;
	timestamp: number;
	beforeMessageIndex: number;
};

/**
 * compact 切点规划结果。
 * - `firstKeptIndex`：保留后缀起点，`messages[0..firstKeptIndex)` 全部进入 summarization。
 * - `splitPoint`：非 null 时把前缀再切一刀：`[0..splitPoint)` 走历史 summary，
 *   `[splitPoint..firstKeptIndex)` 走 turn-prefix summary。仅在最后一个 turn 过大、
 *   无法按 user 边界对齐时出现。
 */
export type CompactionCutPlan = {
	firstKeptIndex: number;
	splitPoint: number | null;
};

/**
 * 规划本次 compact 的切点。
 * - 主路径：保留约 20%（≥6 条）并向后对齐到下一条 user 消息，保证后缀从干净的 turn 边界开始。
 * - 退路（split-turn）：最后一个 turn 本身过大时，在 turn 内部寻找合法切点。
 *   `splitPoint` 设为该 turn 的起点：`[0..splitPoint)` → 历史 summary，
 *   `[splitPoint..firstKeptIndex)` → turn-prefix summary，`[firstKeptIndex..]` → 原样保留。
 * 两条路径都不可行时返回 null。
 */
export function planCompactionCut(messageEntries: MessageEntry[]): CompactionCutPlan | null {
	if (messageEntries.length < 4) return null;

	const initialKeepCount = Math.max(6, Math.floor(messageEntries.length * 0.2));
	let firstKeptIndex = messageEntries.length - initialKeepCount;

	while (firstKeptIndex < messageEntries.length && messageEntries[firstKeptIndex].message.role !== "user") {
		firstKeptIndex++;
	}

	if (firstKeptIndex < messageEntries.length) {
		return { firstKeptIndex, splitPoint: null };
	}

	const allMessages = messageEntries.map((e) => e.message);
	const turnStart = findLastTurnStart(allMessages);
	// 需要最后一个 turn 之前至少 2 条历史消息，否则 split-turn 退化成仅剩 turn-prefix，
	// 为此多开一次 LLM 调用不划算。
	if (turnStart < 2) return null;

	const splitPointInsideTurn = findSplitPointInLastTurn(allMessages, turnStart);
	if (splitPointInsideTurn === null) return null;

	return { firstKeptIndex: splitPointInsideTurn, splitPoint: turnStart };
}

/** 返回 branch 中最近一个 CompactionEntry；没有则返回 null。 */
export function findLastCompactionEntryInBranch(branch: SessionEntry[]): CompactionEntry | null {
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") return branch[i] as CompactionEntry;
	}
	return null;
}

export function indexOfEntryById(entries: MessageEntry[], id: string): number {
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].id === id) return i;
	}
	return -1;
}

/** 更新后的 summary 若明显短于旧 summary，判定为丢内容。 */
export function isSummaryDrift(updatedRaw: string, previousSummary: string): boolean {
	const updatedBody = extractSummaryBody(updatedRaw);
	const previousBody = extractSummaryBody(previousSummary);
	if (previousBody.length === 0) return false;
	return updatedBody.length < previousBody.length * SUMMARY_DRIFT_RATIO;
}

function extractSummaryBody(raw: string): string {
	const match = raw.match(/<summary>([\s\S]*?)<\/summary>/);
	if (match?.[1]) return match[1].trim();
	return raw.trim();
}

export function extractHistory(entries: SessionEntry[]): {
	messages: Message[];
	compactions: CompactionMarker[];
} {
	const messages: Message[] = [];
	const compactions: CompactionMarker[] = [];
	for (const entry of entries) {
		if (entry.type === "message") {
			messages.push((entry as MessageEntry).message);
		} else if (entry.type === "compaction") {
			const ce = entry as CompactionEntry;
			compactions.push({
				id: ce.id,
				timestamp: ce.timestamp,
				beforeMessageIndex: messages.length,
			});
		}
	}
	return { messages, compactions };
}

export class AgentSession {
	private config: SessionConfig;
	private store!: SessionStore;
	private eventBus = new EventBus();
	private abortController: AbortController | null = null;
	private state: SessionState = "idle";
	private sessionId: string;

	private lastEntryId!: string;

	private externalListeners: Array<(event: AgentEvent) => void> = [];

	private compactFailCount = 0;
	private lastInputTokens = 0;
	private static MAX_COMPACT_FAILURES = 3;

	private prompts!: ResolvedPrompts;

	private firstUserInput: { text: string; attachments?: RawAttachment[] } | null = null;

	private constructor(config: SessionConfig) {
		this.config = config;
		this.sessionId = config.sessionId ?? crypto.randomUUID();
	}

	static async create(config: SessionConfig): Promise<AgentSession> {
		const session = new AgentSession(config);
		await session.init();
		return session;
	}

	static async restore(config: SessionConfig & { sessionId: string }): Promise<AgentSession> {
		const session = new AgentSession(config);
		await session.rehydrate();
		return session;
	}

	private get workspace() {
		return this.config.workspace;
	}

	private async init(): Promise<void> {
		const sessionPath = this.workspace.sessionPath(this.sessionId);
		this.store = await JsonlSessionStore.open(sessionPath);

		const headerId = this.store.nextId();
		await this.store.append({
			type: "session",
			id: headerId,
			parentId: null,
			version: 1,
			sessionId: this.sessionId,
			timestamp: Date.now(),
			cwd: this.workspace.cwd,
		});
		this.lastEntryId = headerId;

		this.prompts = await this.workspace.loadPrompts();
		this.wireEventPipeline();
	}

	private async rehydrate(): Promise<void> {
		const sessionPath = this.workspace.sessionPath(this.sessionId);
		this.store = await JsonlSessionStore.open(sessionPath);

		const entries = this.store.getAllEntries();
		if (entries.length === 0) {
			throw new Error(`Session file is empty: ${sessionPath}`);
		}
		this.lastEntryId = entries[entries.length - 1].id;

		this.prompts = await this.workspace.loadPrompts();
		this.wireEventPipeline();
	}

	async chat(
		text: string,
		options?: {
			model?: ModelInfo | string;
			baseURL?: string;
			reasoningEffort?: string;
			attachments?: RawAttachment[];
		},
	): Promise<AssistantMessage[]> {
		if (this.state === "running") {
			throw new AgentRunningError("AgentSession is already running");
		}
		this.state = "running";
		this.abortController = new AbortController();

		try {
			if (!this.firstUserInput) {
				this.firstUserInput = { text, attachments: options?.attachments };
			}

			const content: (TextContent | ImageContent | FileContent)[] = [{ type: "text", text }];

			if (options?.attachments?.length) {
				const modelRef = options?.model ?? this.config.model;
				const capabilities =
					typeof modelRef === "string"
						? resolveModelInfo(modelRef, {
								apiKey: undefined,
								baseURL: options?.baseURL ?? this.config.baseURL,
							}).capabilities
						: modelRef.capabilities;
				const processed = await processAttachments(options.attachments, capabilities);
				content.push(...processed);
			}

			const userMsg: UserMessage = {
				role: "user",
				content,
				timestamp: Date.now(),
			};
			await this.persistMessage(userMsg);

			const modelRef = options?.model ?? this.config.model;
			const modelInfo =
				typeof modelRef === "string"
					? resolveModelInfo(modelRef, { apiKey: undefined, baseURL: options?.baseURL ?? this.config.baseURL })
					: modelRef;
			const contextLimit = modelInfo.limit.context;

			// 进入 loop 前兜底：首轮就已超限时，runAgentLoop 会直接抛 prompt_too_long。
			await this.maybeCompact(this.lastInputTokens, modelInfo);

			const messages = buildSessionContext(this.store, this.lastEntryId);

			const systemPrompt = buildSystemPrompt({
				cwd: this.workspace.cwd,
				tools: this.config.tools,
				prompts: this.prompts,
			});

			const result = await runAgentLoop({
				messages,
				model: modelRef,
				baseURL: options?.baseURL ?? this.config.baseURL,
				reasoningEffort: options?.reasoningEffort,
				systemPrompt,
				tools: this.config.tools,
				signal: this.abortController.signal,
				events: this.eventBus,
				maxIterations: this.config.maxIterations,
				contextTransform: async (msgs) =>
					microcompact({
						messages: msgs,
						lastInputTokens: this.lastInputTokens,
						contextLimit,
					}),
			});

			// loop 结束后兜底：token 逼近上限则主动压一次，避免下一次 chat 炸掉。
			await this.maybeCompact(this.lastInputTokens, modelInfo);

			this.state = "idle";
			return result;
		} catch (err) {
			this.state = this.abortController?.signal.aborted ? "aborted" : "idle";
			throw err;
		}
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getState(): SessionState {
		return this.state;
	}

	getMessages(): Message[] {
		const entries = this.store.getBranch(this.lastEntryId);
		return entries.filter((e): e is MessageEntry => e.type === "message").map((e) => e.message);
	}

	/** 返回用于 UI 渲染的完整历史：消息列表与 compaction 标记交织。 */
	getHistory(): { messages: Message[]; compactions: CompactionMarker[] } {
		return extractHistory(this.store.getBranch(this.lastEntryId));
	}

	abort(): void {
		this.abortController?.abort();
		this.state = "aborted";
	}

	async close(): Promise<void> {
		this.abort();
		await this.store.close();
	}

	async generateSessionTitle(options?: { model?: ModelInfo | string; baseURL?: string }): Promise<string | null> {
		if (!this.firstUserInput) return null;
		const titleInput = buildTitleInput(this.firstUserInput.text, this.firstUserInput.attachments);
		return generateTitle(titleInput, options?.model ?? this.config.model, options?.baseURL ?? this.config.baseURL);
	}

	onEvent(listener: (event: AgentEvent) => void): () => void {
		this.externalListeners.push(listener);
		return () => {
			this.externalListeners = this.externalListeners.filter((l) => l !== listener);
		};
	}

	private async maybeCompact(inputTokens: number, modelInfo: ModelInfo): Promise<void> {
		if (this.compactFailCount >= AgentSession.MAX_COMPACT_FAILURES) return;
		if (inputTokens <= 0) return;
		if (!shouldCompact(inputTokens, modelInfo.limit.context)) return;

		const branch = this.store.getBranch(this.lastEntryId);
		const messageEntries = branch.filter((e): e is MessageEntry => e.type === "message");
		if (messageEntries.length < 4) return;

		const plan = planCompactionCut(messageEntries);
		if (!plan) {
			this.compactFailCount++;
			return;
		}

		const prefixEntries = messageEntries.slice(0, plan.firstKeptIndex);
		const prefixMessages = prefixEntries.map((e) => e.message);

		const historyEnd = plan.splitPoint ?? prefixMessages.length;
		const fullHistoryMessages = prefixMessages.slice(0, historyEnd);
		const turnPrefixMessages = plan.splitPoint !== null ? prefixMessages.slice(plan.splitPoint) : [];

		// 迭代更新的增量起点：跳过上一个 CompactionEntry 已经覆盖的消息。
		const prevCompaction = findLastCompactionEntryInBranch(branch);
		const previousSummary = prevCompaction?.summary;
		const incrementalStart = prevCompaction ? indexOfEntryById(messageEntries, prevCompaction.firstKeptEntryId) : 0;
		const incrementalHistoryMessages =
			incrementalStart >= 0 && incrementalStart < historyEnd
				? prefixMessages.slice(incrementalStart, historyEnd)
				: [];

		// 主路径且无旧 summary 时，历史至少 2 条才值得压。split-turn 路径允许
		// 历史为空（turn-prefix 本身仍有价值）；迭代路径若没有新历史则直接复用旧 summary。
		if (plan.splitPoint === null && !previousSummary && fullHistoryMessages.length < 2) return;

		const firstKeptEntry = messageEntries[plan.firstKeptIndex];

		try {
			for (const listener of this.externalListeners) {
				listener({ type: "compaction_start" });
			}

			const historyPromise = this.summarizeHistory({
				fullHistoryMessages,
				incrementalHistoryMessages,
				previousSummary,
				modelInfo,
			});

			const turnPrefixPromise =
				turnPrefixMessages.length > 0
					? generateTurnPrefixSummary({
							messages: turnPrefixMessages,
							model: modelInfo,
							baseURL: this.config.baseURL,
							signal: this.abortController?.signal,
						})
					: Promise.resolve<string | undefined>(undefined);

			const [historyRaw, rawTurnPrefixSummary] = await Promise.all([historyPromise, turnPrefixPromise]);

			let summary = formatCompactSummary(historyRaw);

			// compact 后的文件线索：只给出路径列表，内容由 agent 按需重新 FileRead。
			const recentFiles = collectRecentFileReadPaths(prefixMessages);
			if (recentFiles.length > 0) {
				const list = recentFiles.map((p) => `- ${p}`).join("\n");
				summary = `${summary}\n\n[Recently viewed files before compaction]\n${list}\n(Their contents are not re-attached — re-read if needed.)`;
			}

			const turnPrefixSummary = rawTurnPrefixSummary ? formatCompactSummary(rawTurnPrefixSummary) : undefined;

			const compactionId = this.store.nextId();
			await this.store.append({
				type: "compaction",
				id: compactionId,
				parentId: this.lastEntryId,
				timestamp: Date.now(),
				summary,
				firstKeptEntryId: firstKeptEntry.id,
				...(turnPrefixSummary ? { turnPrefixSummary } : {}),
			});
			this.lastEntryId = compactionId;

			this.compactFailCount = 0;

			for (const listener of this.externalListeners) {
				listener({ type: "compaction_end", summary });
			}
		} catch {
			// compact 失败不致命，仅计数。
			this.compactFailCount++;
		}
	}

	/**
	 * 生成 compaction 中「历史部分」的摘要：
	 *  1. 无旧 summary → 对 `fullHistoryMessages` 全量 summary。
	 *  2. 有旧 summary 且无新消息 → 原样复用。
	 *  3. 有旧 summary 且有新消息 → 走 UPDATE；若漂移启发式命中则回退全量重写。
	 */
	private async summarizeHistory(opts: {
		fullHistoryMessages: Message[];
		incrementalHistoryMessages: Message[];
		previousSummary: string | undefined;
		modelInfo: ModelInfo;
	}): Promise<string> {
		const { fullHistoryMessages, incrementalHistoryMessages, previousSummary, modelInfo } = opts;

		if (!previousSummary) {
			return compactMessages({
				messages: fullHistoryMessages,
				model: modelInfo,
				baseURL: this.config.baseURL,
				signal: this.abortController?.signal,
			});
		}

		if (incrementalHistoryMessages.length === 0) {
			// 没有新历史，旧 summary 仍准确；套回 <summary> 让下游统一处理。
			return `<summary>\n${previousSummary}\n</summary>`;
		}

		const updated = await compactMessages({
			messages: incrementalHistoryMessages,
			model: modelInfo,
			baseURL: this.config.baseURL,
			signal: this.abortController?.signal,
			previousSummary,
		});

		if (isSummaryDrift(updated, previousSummary)) {
			// 漂移兜底：对完整历史窗口重跑全量重写。
			return compactMessages({
				messages: fullHistoryMessages,
				model: modelInfo,
				baseURL: this.config.baseURL,
				signal: this.abortController?.signal,
			});
		}

		return updated;
	}

	private wireEventPipeline(): void {
		this.eventBus.subscribe((event) => {
			if (event.type === "message_end") {
				this.persistMessage(event.message);
			}

			// 实时追踪 inputTokens，供 microcompact / maybeCompact 使用（避免滞后一轮）。
			if (event.type === "stream" && event.event.type === "step_finish") {
				this.lastInputTokens = event.event.usage.inputTokens;
			}

			for (const listener of this.externalListeners) {
				listener(event);
			}
		});
	}

	private async persistMessage(message: Message): Promise<void> {
		const entryId = this.store.nextId();
		await this.store.append({
			type: "message",
			id: entryId,
			parentId: this.lastEntryId,
			timestamp: message.timestamp,
			message,
		});
		this.lastEntryId = entryId;
	}
}

const AgentRunningError = NamedError.create("AgentIsRunningError", z.string());
