import type { JsonObject } from "../../core/agent-state";
import type { AgentMessage } from "../../core/types";
import type { EffectGate, EffectGateAction } from "../../core/effect-gate";
import { buildCompactedMessages, latestCompaction } from "../compaction/projection";
import { branchOf, contextEntries } from "./tree";
import type { BranchEntry, CompactionEntry, MessageEntry, SessionEntry, SessionHandle, TreeEntry } from "./types";

/**
 * append-only 日志的唯一写入口：分配 entry id、写 store、更新内存镜像。
 *
 * 内存镜像不是缓存，而是"没有 SessionHandle 时也要能工作"的前提：
 * projection 算法因此对有存储和无存储两条路径完全一致。
 */
export class SessionLedger<TAppState extends JsonObject> {
	/** 整棵树，写入顺序。 */
	private readonly tree: SessionEntry<TAppState>[];
	/** 从 tree 派生的当前分支，root → leaf。projection 只认这一个。 */
	private branch: TreeEntry<TAppState>[];
	private sequence: number;
	/** Serializes durable appends so parent ids are allocated only after prior commits settle. */
	private appendTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly handle: SessionHandle<TAppState> | undefined,
		initialMessages: readonly AgentMessage[] = [],
		private readonly effectGate?: EffectGate,
	) {
		this.tree = handle ? [...handle.snapshot.entries] : localEntries(initialMessages);
		this.branch = branchOf(this.tree, handle ? handle.snapshot.leafId : (this.tree.at(-1)?.id ?? null));
		// 树是 append-only 所以树长单调；分支长度不是——导航回退之后
		// `${id}:${branchLength}` 会和旧分支上还活着的 entry 撞号。
		this.sequence = this.tree.length;
	}

	/**
	 * 当前分支，不是整棵树。estimate.ts 与 overflow.ts 都在比这个数组里的下标，
	 * 谁把它改成返回 tree，压缩就会在跨分支比下标之后随机触发。
	 */
	get log(): readonly SessionEntry<TAppState>[] {
		return this.branch;
	}

	get latestCompaction(): CompactionEntry | undefined {
		return latestCompaction(this.branch);
	}

	/** 整棵树，写入顺序。导航要在旁支上找目标，分支视图给不出它们。 */
	get entries(): readonly SessionEntry<TAppState>[] {
		return this.tree;
	}

	get leafId(): string | null {
		return this.branch.at(-1)?.id ?? null;
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

	/** entry id 在模型可见序列中的位置，与 transcript 的下标一致。 */
	private messageIndexOf(id: string): number {
		return contextEntries(this.branch).findIndex((entry) => entry.id === id);
	}

	async appendMessage(message: AgentMessage, entryId?: string): Promise<MessageEntry> {
		let entry!: MessageEntry;
		await this.enqueueAppend(() => {
			const node = this.nextNode();
			entry = { type: "message", ...node, ...(entryId ? { id: entryId } : {}), message };
			return entry;
		});
		return entry;
	}

	/** 没有 handle 时 app_state 不进内存镜像：它对 projection 没有影响。 */
	async appendAppState(value: TAppState): Promise<void> {
		if (!this.handle) return;
		await this.enqueueAppend(() => ({ type: "app_state", ...this.nextNode(), value }));
	}

	async appendCompaction(
		entry: Omit<CompactionEntry, "type" | "id" | "parentId" | "timestamp">,
	): Promise<CompactionEntry> {
		let full!: CompactionEntry;
		await this.enqueueAppend(() => {
			full = { type: "compaction", ...this.nextNode(), ...entry };
			return full;
		});
		return full;
	}

	/**
	 * 铸一个 branch entry，但**不落盘**。
	 *
	 * 导航要先拿这条 entry 算出新分支的 transcript，在唯一能拒绝的那一步
	 * （CoreAgent.reset 的运行中守卫）通过之后才 commitBranch。反过来做的话，
	 * leaf 已经持久化移动了，内存里的 reset 却可能被拒。
	 */
	mintBranch(input: { targetId: string; fromId: string }): BranchEntry {
		return {
			type: "branch",
			...this.nextNode(),
			// 分叉点：这个节点接的是导航目标，不是当前分支的末端。
			parentId: input.targetId,
			fromId: input.fromId,
		};
	}

	/**
	 * 导航的落盘：单次 append，之后按新 leaf 重新线性化分支。
	 *
	 * 与私有 append 相反，这里先落盘再改内存镜像：写失败时 ledger 必须还停在旧分支上，
	 * 否则进程内会活在一条磁盘上不存在的分支里。它不受那条"铸号与入镜像同一个同步块"
	 * 的约束——branch entry 在 mintBranch 时就已经铸完号了。
	 */
	async commitBranch(entry: BranchEntry): Promise<void> {
		await this.enqueueAppend(() => entry);
	}

	/**
	 * 新分支上的 appState。store 的 applyEntry 已经沿新分支从 header 初值重算过一遍，
	 * 这里直接采信那一份，不在进程内复制第二份折叠。
	 * 没有 handle 时 appendAppState 本就是 no-op，故也没有需要回退的 appState。
	 */
	get appState(): TAppState | undefined {
		return this.handle?.snapshot.appState;
	}

	/**
	 * 只清进程内视图；store 是 append-only，磁盘上的历史不会因此消失。
	 * sequence 故意不重置：重置会铸出磁盘上已经存在的 id。
	 */
	clear(): void {
		this.tree.length = 0;
		this.branch = [];
	}

	/**
	 * Allocate and persist one entry at a time. The in-memory mirror is updated only after
	 * the store accepts the entry, so a failed write cannot become a parent for later work.
	 */
	private enqueueAppend(createEntry: () => TreeEntry<TAppState>): Promise<void> {
		const next = this.appendTail.then(async () => {
			const entry = createEntry();
			if (this.handle) await this.effectGate?.beforeEffect(entryEffect(entry));
			await this.handle?.append(entry);
			this.tree.push(entry);
			this.branch = branchOf(this.tree, entry.id);
		});
		this.appendTail = next.catch(() => {});
		return next;
	}

	/** 新节点接在当前分支末端。 */
	private nextNode(): { id: string; parentId: string | null; timestamp: string } {
		return {
			id: `${this.handle?.id ?? "local"}:${this.sequence++}`,
			parentId: this.branch.at(-1)?.id ?? null,
			timestamp: now(),
		};
	}
}

function entryEffect(entry: TreeEntry<JsonObject>): EffectGateAction {
	return {
		type: "session_entry",
		entryId: entry.id,
		entryType: entry.type,
		...(entry.type === "message" ? { messageRole: entry.message.role } : {}),
	};
}

function localEntries<TAppState extends JsonObject>(messages: readonly AgentMessage[]): SessionEntry<TAppState>[] {
	return messages.map((message, index) => ({
		type: "message",
		id: `local:${index}`,
		parentId: index === 0 ? null : `local:${index - 1}`,
		timestamp: now(),
		message,
	}));
}

function now(): string {
	return new Date().toISOString();
}
