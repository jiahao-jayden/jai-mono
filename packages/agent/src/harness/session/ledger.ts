import type { JsonObject } from "../../core/agent-state";
import type { AgentMessage } from "../../core/types";
import { buildCompactedMessages, latestCompaction } from "../compaction/projection";
import type { CompactionEntry, SessionEntry, SessionHandle } from "./types";

/**
 * append-only 日志的唯一写入口：分配 entry id、先写 store 再更新内存镜像。
 *
 * 内存镜像不是缓存，而是"没有 SessionHandle 时也要能工作"的前提：
 * projection 算法因此对有存储和无存储两条路径完全一致。
 */
export class SessionLedger<TAppState extends JsonObject> {
	private readonly entries: SessionEntry<TAppState>[];
	private sequence: number;

	constructor(
		private readonly handle: SessionHandle<TAppState> | undefined,
		initialMessages: readonly AgentMessage[] = [],
	) {
		this.entries = handle
			? [...handle.snapshot.entries]
			: initialMessages.map((message, index) => toEntry(message, index));
		this.sequence = this.entries.length;
	}

	get log(): readonly SessionEntry<TAppState>[] {
		return this.entries;
	}

	get latestCompaction(): CompactionEntry | undefined {
		return latestCompaction(this.entries);
	}

	/**
	 * 本次要发给 provider 的消息序列。
	 *
	 * 消息本身取自调用方给的权威列表，日志只提供压缩边界：core 的事件是异步分发的，
	 * 日志尾部可能比 run 内的 transcript 落后一两条，直接读日志会漏掉最新那条消息。
	 */
	project(messages: readonly AgentMessage[]): AgentMessage[] {
		const latest = this.latestCompaction;
		if (!latest) return [...messages];

		const dropped = this.messageIndexOf(latest.firstKeptEntryId);
		if (dropped < 0) return [...messages];

		return buildCompactedMessages(latest.summary, Date.parse(latest.timestamp), messages.slice(dropped));
	}

	/** entry id 在"仅 message entry"序列中的位置，与 transcript 的下标一致。 */
	private messageIndexOf(id: string): number {
		return this.entries.filter((entry) => entry.type === "message").findIndex((entry) => entry.id === id);
	}

	async appendMessage(message: AgentMessage): Promise<void> {
		await this.append({ type: "message", id: this.nextId(), timestamp: now(), message });
	}

	/** 没有 handle 时 app_state 不进内存镜像：它对 projection 没有影响。 */
	async appendAppState(value: TAppState): Promise<void> {
		if (!this.handle) return;
		await this.append({ type: "app_state", id: this.nextId(), timestamp: now(), value });
	}

	async appendCompaction(entry: Omit<CompactionEntry, "type" | "id" | "timestamp">): Promise<CompactionEntry> {
		const full: CompactionEntry = { type: "compaction", id: this.nextId(), timestamp: now(), ...entry };
		await this.append(full);
		return full;
	}

	/** 只清进程内视图；store 是 append-only，磁盘上的历史不会因此消失。 */
	clear(): void {
		this.entries.length = 0;
	}

	private async append(entry: SessionEntry<TAppState>): Promise<void> {
		await this.handle?.append(entry);
		this.entries.push(entry);
	}

	private nextId(): string {
		return `${this.handle?.id ?? "local"}:${this.sequence++}`;
	}
}

function toEntry<TAppState extends JsonObject>(message: AgentMessage, index: number): SessionEntry<TAppState> {
	return { type: "message", id: `local:${index}`, timestamp: now(), message };
}

function now(): string {
	return new Date().toISOString();
}
