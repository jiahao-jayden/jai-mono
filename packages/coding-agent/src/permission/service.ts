/**
 * PermissionService —— "挂起 ask 请求 → 等用户回复 → resolve" 的极简服务。
 *
 * 进程内 in-memory：每个 session 各持一个实例。
 *
 * 双向通道：
 *   - agent 这边：`request(req)` 创建 pending 并返回 promise；外部订阅 `onPending` 把请求广播出去（gateway 转 SSE）
 *   - 客户端这边：拿到 reqId 后调用 `reply(reqId, decision)` 把 promise resolve
 *
 * abort 语义：
 *   - 单条 `abort(reqId, reason)`：把对应 promise resolve 为 reject
 *   - 全部 `abortAll(reason)`：所有 pending 都 reject —— session 终止/abort 时调用
 */

import type { PermissionDecision, PermissionRequest } from "./types.js";

export type PendingPermission = {
	id: string;
	toolCallId: string;
	toolName: string;
	request: PermissionRequest;
	createdAt: number;
};

type PendingEntry = {
	pending: PendingPermission;
	resolve: (decision: PermissionDecision) => void;
};

export type PendingListener = (pending: PendingPermission) => void;

export type ResolvedListener = (args: { pending: PendingPermission; decision: PermissionDecision }) => void;

export class PermissionService {
	private pending = new Map<string, PendingEntry>();
	private listeners: PendingListener[] = [];
	private resolvedListeners: ResolvedListener[] = [];
	private idCounter = 0;

	/**
	 * 提交一条权限请求。返回 promise 在用户回复时 resolve。
	 *
	 * - reject 决策也通过 resolve 返回（kind: "reject"），不抛异常
	 * - session abort 触发 abortAll 时，promise resolve 为 `{ kind: "reject", reason }`
	 */
	request(args: { toolCallId: string; toolName: string; request: PermissionRequest }): {
		id: string;
		promise: Promise<PermissionDecision>;
	} {
		const id = this.nextId();
		const pending: PendingPermission = {
			id,
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			request: args.request,
			createdAt: Date.now(),
		};

		const promise = new Promise<PermissionDecision>((resolve) => {
			this.pending.set(id, { pending, resolve });
		});

		// Notify listeners (gateway → SSE) AFTER setting pending so reply() races are impossible
		for (const listener of this.listeners) {
			try {
				listener(pending);
			} catch (err) {
				console.warn("[permission] pending listener threw:", err);
			}
		}

		return { id, promise };
	}

	/** 用户回复。reqId 不存在 → 静默 no-op（请求已被 abort）。 */
	reply(reqId: string, decision: PermissionDecision): void {
		const entry = this.pending.get(reqId);
		if (!entry) return;
		this.pending.delete(reqId);
		entry.resolve(decision);
		this.notifyResolved(entry.pending, decision);
	}

	/** 单条 abort。会把 pending promise resolve 为 reject。 */
	abort(reqId: string, reason = "aborted"): void {
		const entry = this.pending.get(reqId);
		if (!entry) return;
		this.pending.delete(reqId);
		const decision: PermissionDecision = { kind: "reject", reason };
		entry.resolve(decision);
		this.notifyResolved(entry.pending, decision);
	}

	/** 全部 abort —— session 终止时调用。 */
	abortAll(reason = "session aborted"): void {
		const entries = Array.from(this.pending.values());
		this.pending.clear();
		const decision: PermissionDecision = { kind: "reject", reason };
		for (const entry of entries) {
			entry.resolve(decision);
			this.notifyResolved(entry.pending, decision);
		}
	}

	/** 订阅"有新 pending"事件——gateway 用来转 SSE。 */
	onPending(listener: PendingListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	/** 订阅"pending 被 resolve"事件——gateway 用来转 SSE，让客户端清理 UI。 */
	onResolved(listener: ResolvedListener): () => void {
		this.resolvedListeners.push(listener);
		return () => {
			this.resolvedListeners = this.resolvedListeners.filter((l) => l !== listener);
		};
	}

	private notifyResolved(pending: PendingPermission, decision: PermissionDecision): void {
		for (const listener of this.resolvedListeners) {
			try {
				listener({ pending, decision });
			} catch (err) {
				console.warn("[permission] resolved listener threw:", err);
			}
		}
	}

	/** 仅测试 / 调试。 */
	listPending(): PendingPermission[] {
		return Array.from(this.pending.values()).map((e) => e.pending);
	}

	private nextId(): string {
		this.idCounter += 1;
		return `perm_${Date.now()}_${this.idCounter}`;
	}
}
