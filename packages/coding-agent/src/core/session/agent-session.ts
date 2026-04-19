import { join } from "node:path";
import {
	type AgentEvent,
	type AgentTool,
	type BeforeToolCallContext,
	type BeforeToolCallResult,
	EventBus,
	runAgentLoop,
} from "@jayden/jai-agent";
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
import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import { PermissionPolicy } from "../../permission/policy.js";
import type { PermissionSettings } from "../../permission/schema.js";
import { PermissionService } from "../../permission/service.js";
import { type LoadResult, loadPluginsFromDirs } from "../../plugin/host/loader.js";
import type { PluginMeta, RegisteredCommand } from "../../plugin/types.js";
import { processAttachments } from "../attachments/processor.js";
import type { RawAttachment } from "../attachments/types.js";
import type { ResolvedPrompts, Workspace } from "../config/workspace.js";
import { buildSystemPrompt } from "../prompt/builder.js";
import { buildTitleInput, generateTitle } from "../prompt/title.js";
import {
	collectRecentFileReadPaths,
	compactMessages,
	formatCompactSummary,
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
	/** 工具权限：仅 dangerousPaths（额外敏感路径），其余 auto 直接放行 */
	permissionSettings?: PermissionSettings;
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
 * 规划本次 compact 的切点。保留约 20%（≥6 条）并向后对齐到下一条 user 消息，
 * 保证后缀从干净的 turn 边界开始。找不到 user 边界时返回 null（由调用方自增失败计数）。
 */
export function planCompactionCut(messageEntries: MessageEntry[]): number | null {
	if (messageEntries.length < 4) return null;

	const initialKeepCount = Math.max(6, Math.floor(messageEntries.length * 0.2));
	let firstKeptIndex = messageEntries.length - initialKeepCount;

	while (firstKeptIndex < messageEntries.length && messageEntries[firstKeptIndex].message.role !== "user") {
		firstKeptIndex++;
	}

	return firstKeptIndex < messageEntries.length ? firstKeptIndex : null;
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

	// 串行化所有写入 store 的操作，避免 message_end 事件并发触发 persistMessage
	// 时多条 entry 共享同一个 parentId（race condition → fork → getBranch 漏 entry）。
	private writeQueue: Promise<unknown> = Promise.resolve();

	private externalListeners: Array<(event: AgentEvent) => void> = [];

	private compactFailCount = 0;
	private lastInputTokens = 0;
	private static MAX_COMPACT_FAILURES = 3;

	private prompts!: ResolvedPrompts;

	private plugins?: LoadResult;

	private permissionService = new PermissionService();
	private permissionPolicy?: PermissionPolicy;

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
		await this.loadPlugins();
		this.loadPermissionPolicy();
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
		await this.loadPlugins();
		this.loadPermissionPolicy();
		this.wireEventPipeline();
	}

	private loadPermissionPolicy(): void {
		const settings = this.config.permissionSettings ?? { dangerousPaths: [] };
		this.permissionPolicy = new PermissionPolicy({
			cwd: this.workspace.cwd,
			settings,
			service: this.permissionService,
		});
	}

	private async loadPlugins(): Promise<void> {
		this.plugins = await loadPluginsFromDirs([
			{ path: join(this.workspace.cwd, ".jai", "plugins"), scope: "project" },
			{ path: join(this.workspace.jaiHome, "plugins"), scope: "user" },
		]);
		for (const err of this.plugins.errors) {
			console.warn(`[plugin:${err.pluginName}] load error in ${err.dir}: ${err.message}`);
		}
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

			// Command expansion: if text matches a plugin command, replace with expanded prompt
			let effectiveText = text;
			let originalCommand: string | undefined;
			const expansion = await this.tryExpandCommand(text);
			if (expansion) {
				effectiveText = expansion.expanded;
				originalCommand = expansion.originalCommand;
			}

			const content: (TextContent | ImageContent | FileContent)[] = [{ type: "text", text: effectiveText }];

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
			await this.persistMessage(userMsg, originalCommand ? { originalCommand } : undefined);

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

			const preToolCall = this.buildBeforeToolCall();
			const preModelRequest = this.getCombinedPreModelRequest();

			const result = await runAgentLoop({
				messages,
				model: modelRef,
				baseURL: options?.baseURL ?? this.config.baseURL,
				reasoningEffort: options?.reasoningEffort,
				systemPrompt,
				tools: [...this.config.tools, ...(this.plugins?.registry.listTools() ?? [])],
				signal: this.abortController.signal,
				events: this.eventBus,
				maxIterations: this.config.maxIterations,
				contextTransform: async (msgs) =>
					microcompact({
						messages: msgs,
						lastInputTokens: this.lastInputTokens,
						contextLimit,
					}),
				...(preToolCall && { beforeToolCall: preToolCall }),
				...(preModelRequest && { preModelRequest: preModelRequest as never }),
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
		this.permissionService.abortAll("session aborted");
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

		// Plugin preCompact hook
		const preCompact = this.getCombinedPreCompact();
		if (preCompact) {
			const hookResult = await preCompact({
				sessionId: this.sessionId,
				messageCount: this.store.getAllEntries().filter((e) => e.type === "message").length,
				inputTokens,
				contextLimit: modelInfo.limit.context,
			});
			if (hookResult?.skip) return;
		}

		const branch = this.store.getBranch(this.lastEntryId);
		const messageEntries = branch.filter((e): e is MessageEntry => e.type === "message");
		if (messageEntries.length < 4) return;

		const firstKeptIndex = planCompactionCut(messageEntries);
		if (firstKeptIndex === null) {
			this.compactFailCount++;
			return;
		}

		const prefixMessages = messageEntries.slice(0, firstKeptIndex).map((e) => e.message);
		if (prefixMessages.length < 2) return;

		const firstKeptEntry = messageEntries[firstKeptIndex];

		try {
			for (const listener of this.externalListeners) {
				listener({ type: "compaction_start" });
			}

			const historyRaw = await compactMessages({
				messages: prefixMessages,
				model: modelInfo,
				baseURL: this.config.baseURL,
				signal: this.abortController?.signal,
			});

			let summary = formatCompactSummary(historyRaw);

			// compact 后的文件线索：只给出路径列表，内容由 agent 按需重新 FileRead。
			const recentFiles = collectRecentFileReadPaths(prefixMessages);
			if (recentFiles.length > 0) {
				const list = recentFiles.map((p) => `- ${p}`).join("\n");
				summary = `${summary}\n\n[Recently viewed files before compaction]\n${list}\n(Their contents are not re-attached — re-read if needed.)`;
			}

			await this.enqueueWrite(async () => {
				const compactionId = this.store.nextId();
				await this.store.append({
					type: "compaction",
					id: compactionId,
					parentId: this.lastEntryId,
					timestamp: Date.now(),
					summary,
					firstKeptEntryId: firstKeptEntry.id,
				});
				this.lastEntryId = compactionId;
			});

			this.compactFailCount = 0;

			for (const listener of this.externalListeners) {
				listener({ type: "compaction_end", summary });
			}
		} catch {
			// compact 失败不致命，仅计数。
			this.compactFailCount++;
		}
	}

	private wireEventPipeline(): void {
		this.eventBus.subscribe((event) => {
			if (event.type === "message_end") {
				this.persistMessage(event.message).catch((err) => {
					console.error("[agent-session] persistMessage failed:", err);
				});
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

	private persistMessage(message: Message, meta?: { originalCommand?: string }): Promise<void> {
		return this.enqueueWrite(async () => {
			const entryId = this.store.nextId();
			await this.store.append({
				type: "message",
				id: entryId,
				parentId: this.lastEntryId,
				timestamp: message.timestamp,
				message,
				...(meta && { meta }),
			});
			this.lastEntryId = entryId;
		});
	}

	/**
	 * 把一段「读 lastEntryId → store.append → 写 lastEntryId」的写操作排进串行队列。
	 * 即使调用方不 await，也能保证父子链单调；调用方 await 时拿到本次任务完成的 promise。
	 * 单次任务失败不会毒化后续任务。
	 */
	private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
		const next = this.writeQueue.then(task, task);
		this.writeQueue = next.then(
			() => {},
			() => {},
		);
		return next;
	}

	listPluginCommands(): RegisteredCommand[] {
		return this.plugins?.registry.listCommands() ?? [];
	}

	listPluginMetas(): PluginMeta[] {
		return this.plugins?.loaded.map((p) => p.meta) ?? [];
	}

	/**
	 * If text starts with /<plugin:cmd> and matches a registered command,
	 * returns { expanded, originalCommand }. Otherwise returns null.
	 *
	 * Currently only supports prompt-template commands (.md), which register handlers
	 * that call `ctx.sendUserMessage(expanded)`. We intercept that call and return
	 * the expanded text instead of actually sending.
	 */
	async tryExpandCommand(text: string): Promise<{ expanded: string; originalCommand: string } | null> {
		if (!text.startsWith("/")) return null;
		const spaceIdx = text.indexOf(" ");
		const cmdName = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
		const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);

		const cmd = this.plugins?.registry.findCommand(cmdName);
		if (!cmd) return null;

		let captured: string | null = null;
		await cmd.handler(args, {
			sessionId: this.sessionId,
			workspaceId: this.workspace.workspaceId,
			meta: cmd.meta,
			sendUserMessage: async (expanded: string) => {
				captured = expanded;
			},
		});

		if (captured === null) return null;
		return { expanded: captured, originalCommand: text };
	}

	/** @internal — used by chat() to pass into runAgentLoop; exposed for tests */
	getCombinedPreToolCall() {
		if (!this.plugins) return undefined;
		return this.plugins.registry.buildPreToolCall({
			sessionId: this.sessionId,
			workspaceId: this.workspace.workspaceId,
		});
	}

	/**
	 * 把 plugin chain + PermissionPolicy 串成 jai-agent 用的 beforeToolCall。
	 *
	 * 顺序：
	 *   1. plugin chain                    — 用户插件可任意 short-circuit / 改写参数
	 *   2. PermissionPolicy.dangerHandler  — 内置危险检测：命中即问用户
	 *
	 * 任何一步返回非 undefined → 短路。
	 */
	private buildBeforeToolCall() {
		const plugin = this.getCombinedPreToolCall() as
			| ((ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined>)
			| undefined;
		const danger = this.permissionPolicy?.dangerHandler;

		const chain = [plugin, danger].filter(
			(h): h is (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined> => Boolean(h),
		);
		if (chain.length === 0) return undefined;

		return async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
			for (const handler of chain) {
				const result = await handler(ctx);
				if (result !== undefined) return result;
			}
			return undefined;
		};
	}

	/** Gateway 用：订阅 pending 权限请求 / reply / abort。 */
	getPermissionService(): PermissionService {
		return this.permissionService;
	}

	/** @internal */
	getCombinedPreModelRequest() {
		if (!this.plugins) return undefined;
		return this.plugins.registry.buildPreModelRequest({
			sessionId: this.sessionId,
			workspaceId: this.workspace.workspaceId,
		});
	}

	/** @internal */
	getCombinedPreCompact() {
		if (!this.plugins) return undefined;
		return this.plugins.registry.buildPreCompact({
			sessionId: this.sessionId,
			workspaceId: this.workspace.workspaceId,
		});
	}
}

const AgentRunningError = NamedError.create("AgentIsRunningError", z.string());
