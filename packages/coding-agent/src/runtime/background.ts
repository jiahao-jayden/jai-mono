/**
 * Session-scoped registry for detached (background) subagent executions.
 *
 * The registry is owned by the Host: one store per live Session, shared across
 * Operations the same way `sessionAllowRules` and `approvalQueue` are. Extension
 * instances are re-activated per Operation, so a per-instance map cannot see
 * background agents started by an earlier Operation; this store is the single
 * fact owner for their handles. Entries hold live promises and abort callbacks,
 * so the store is strictly in-memory and never persisted.
 */

export type BackgroundAgentStatus = "running" | "complete" | "error";

export type BackgroundAgentOutcome = "complete" | "error" | "stopped";

export interface BackgroundAgentEntry {
	readonly toolCallId: string;
	readonly agentId: string;
	readonly title: string;
	status: BackgroundAgentStatus;
	/** True when the settlement was caused by an explicit stop request. */
	stopped: boolean;
	activity?: string;
	text?: string;
	error?: string;
	notified: boolean;
	readonly settled: Promise<void>;
}

export type BackgroundAgentListener = (entry: BackgroundAgentEntry) => void;

export interface BackgroundAgentRegistration {
	readonly toolCallId: string;
	readonly agentId: string;
	readonly title: string;
}

export class BackgroundAgentStore {
	private readonly entries = new Map<string, BackgroundAgentEntry>();
	private readonly aborts = new Map<string, () => void>();
	private readonly stopRequested = new Set<string>();
	private readonly listeners = new Set<BackgroundAgentListener>();
	private readonly resolvers = new Map<string, () => void>();
	private seq = 0;

	/** Session-scoped id. Extension instances are recreated per Operation, so they cannot count. */
	nextAgentId(): string {
		this.seq += 1;
		return `bg-${this.seq}`;
	}

	register(input: BackgroundAgentRegistration): BackgroundAgentEntry {
		const existing = this.entries.get(input.toolCallId);
		if (existing) return existing;
		let resolve!: () => void;
		const settled = new Promise<void>((settle) => {
			resolve = settle;
		});
		const entry: BackgroundAgentEntry = {
			toolCallId: input.toolCallId,
			agentId: input.agentId,
			title: input.title,
			status: "running",
			stopped: false,
			notified: false,
			settled,
		};
		this.entries.set(input.toolCallId, entry);
		this.resolvers.set(input.toolCallId, resolve);
		return entry;
	}

	get(toolCallId: string): BackgroundAgentEntry | undefined {
		return this.entries.get(toolCallId);
	}

	findByAgentId(agentId: string): BackgroundAgentEntry | undefined {
		for (const entry of this.entries.values()) {
			if (entry.agentId === agentId) return entry;
		}
		return undefined;
	}

	list(): readonly BackgroundAgentEntry[] {
		return [...this.entries.values()];
	}

	/** Registers the abort callback for a running child. Only the SDK calls this. */
	bindAbort(toolCallId: string, abort: () => void): void {
		if (this.entries.get(toolCallId)?.status === "running") this.aborts.set(toolCallId, abort);
	}

	wasStopRequested(toolCallId: string): boolean {
		return this.stopRequested.has(toolCallId);
	}

	/**
	 * Requests a stop and aborts the running child. Returns false when the id is
	 * unknown or already settled. Settlement itself still flows through
	 * complete/fail so there is exactly one settle notification per entry.
	 */
	abort(toolCallId: string): boolean {
		const entry = this.entries.get(toolCallId);
		if (entry?.status !== "running") return false;
		if (this.stopRequested.has(toolCallId)) return true;
		this.stopRequested.add(toolCallId);
		this.aborts.get(toolCallId)?.();
		return true;
	}

	abortAll(): void {
		for (const toolCallId of this.entries.keys()) this.abort(toolCallId);
	}

	/** First settle wins; late calls are ignored. */
	complete(toolCallId: string, text: string): void {
		const entry = this.entries.get(toolCallId);
		if (entry?.status !== "running") return;
		entry.status = "complete";
		entry.text = text;
		this.settle(entry);
	}

	/** First settle wins; a prior stop request marks the entry stopped. */
	fail(toolCallId: string, error: string): void {
		const entry = this.entries.get(toolCallId);
		if (entry?.status !== "running") return;
		entry.status = "error";
		entry.stopped = this.stopRequested.has(toolCallId);
		entry.error = error;
		this.settle(entry);
	}

	subscribe(listener: BackgroundAgentListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private settle(entry: BackgroundAgentEntry): void {
		this.aborts.delete(entry.toolCallId);
		this.resolvers.get(entry.toolCallId)?.();
		this.resolvers.delete(entry.toolCallId);
		for (const listener of [...this.listeners]) listener(entry);
	}
}

export function createBackgroundAgentStore(): BackgroundAgentStore {
	return new BackgroundAgentStore();
}
