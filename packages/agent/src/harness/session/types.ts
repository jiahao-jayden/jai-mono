import type { Usage } from "@jai/ai";
import { TaggedError } from "better-result";
import type { JsonObject } from "../../core/agent-state";
import type { AgentMessage } from "../../core/types";

/**
 * 树上的节点：它占据对话中的一个位置，parentId 定义这个位置。
 *
 * parentId 禁止 undefined：JSON.stringify 会把值为 undefined 的键整个丢掉，
 * round-trip 回来就和"树外 entry"无法区分了。根节点写 null。
 */
interface TreeEntryBase {
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface MessageEntry extends TreeEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface AppStateEntry<TAppState extends JsonObject = JsonObject> extends TreeEntryBase {
	type: "app_state";
	value: TAppState;
}

/**
 * 一次压缩的事实：摘要文本，加上"从哪条 message entry 开始保留原文"。
 * 原始 message entry 一条不删，压缩只是叠加一层新的读取视角。
 */
export interface CompactionEntry extends TreeEntryBase {
	type: "compaction";
	summary: string;
	/** 摘要之后第一条保留原文的 message entry id */
	firstKeptEntryId: string;
	tokensBefore: number;
	tokensAfter: number;
	/** 生成这条摘要本身花掉的 tokens */
	usage: Usage;
}

/**
 * 一次导航发生的那一刻，同时也是新分支的第一个节点：parentId 是导航目标，
 * fromId 是被放弃那条路的旧 leaf。
 *
 * 让它是树节点而不是一个旁挂的标记，leaf 推进规则才能保持统一——applyEntry
 * 因此不需要任何导航特例。
 */
export interface BranchEntry extends TreeEntryBase {
	type: "branch";
	/** 被放弃那条分支的 leaf。旧分支的 entry 一条都不删，这里只是指回去。 */
	fromId: string;
}

/** 占据对话中一个位置的 entry。 */
export type TreeEntry<TAppState extends JsonObject = JsonObject> =
	| MessageEntry
	| AppStateEntry<TAppState>
	| CompactionEntry
	| BranchEntry;

/** 一次 session 变更的最小事实单位。 */
export type SessionEntry<TAppState extends JsonObject = JsonObject> = TreeEntry<TAppState>;

export interface SessionSnapshot<TAppState extends JsonObject = JsonObject> {
	/** 整棵树，写入顺序。分支视图由 branchOf(entries, leafId) 派生。 */
	entries: SessionEntry<TAppState>[];
	/** 对话当前停在哪个节点上。 */
	leafId: string | null;
	/** 沿当前分支折叠的结果。 */
	appState: TAppState;
	/** header 里的初值。切分支后要重算 appState，而当前折叠值自己给不出这个基准。 */
	readonly initialAppState: TAppState;
	createdAt: string;
	updatedAt: string;
}

export interface StoredSession<TAppState extends JsonObject = JsonObject> {
	snapshot: SessionSnapshot<TAppState>;
	revision: string;
	/** 存在本版本无法解释的 entry 时为 true，此时禁止写入。 */
	readOnly: boolean;
}

/**
 * append-only 存储契约。没有"整份覆盖写"：创建走 create()，
 * 导入外部 snapshot 是独立工具函数，不进核心接口。
 */
export interface SessionStore<TAppState extends JsonObject = JsonObject> {
	load(id: string): Promise<StoredSession<TAppState> | undefined>;
	/** 仅当 session 不存在时创建，返回初始 revision。 */
	create(id: string, appState: TAppState): Promise<string>;
	append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string>;
	delete(id: string): Promise<void>;
}

/** 持有 revision 的写入句柄，调用方因此不必手工接力 revision。 */
export interface SessionHandle<TAppState extends JsonObject = JsonObject> {
	readonly id: string;
	readonly snapshot: SessionSnapshot<TAppState>;
	readonly readOnly: boolean;
	append(entry: SessionEntry<TAppState>): Promise<void>;
}

export class SessionConflictError extends TaggedError("session.conflict")<{
	readonly cause?: unknown;
	readonly message: string;
}> {
	constructor(message: string, options: { cause?: unknown } = {}) {
		super({ message, ...options });
	}
}

export class SessionBusyError extends TaggedError("session.busy")<{
	readonly cause?: unknown;
	readonly message: string;
}> {
	constructor(message: string, options: { cause?: unknown } = {}) {
		super({ message, ...options });
	}
}

export class SessionReadOnlyError extends TaggedError("session.read_only")<{
	readonly cause?: unknown;
	readonly message: string;
}> {
	constructor(message: string, options: { cause?: unknown } = {}) {
		super({ message, ...options });
	}
}

/** 导航目标不在树上。调用方给错了 id，什么都还没被碰过。 */
export class SessionUnknownEntry extends TaggedError("session.unknown_entry")<{
	readonly message: string;
	readonly entryId: string;
}> {}

/** 导航没能完成。抛出时保证没有写入任何 entry，leaf 也没动过。 */
export class SessionNavigateFailed extends TaggedError("session.navigate_failed")<{
	readonly cause?: unknown;
	readonly message: string;
	readonly entryId: string;
}> {}
