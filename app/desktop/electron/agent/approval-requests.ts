import type {
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalRequest,
	CodingPermissionDecision,
	CodingPermissionRequest,
} from "@jai/coding-agent";
import type {
	DesktopAgentEvent,
	DesktopExtensionApprovalRequest,
	DesktopExtensionPermissionItem,
	DesktopPermissionItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { DesktopApprovalRegistry } from "./approval-registry";
import { desktopAgentError } from "./errors";
import { projectExtensionApprovalRequest, projectPermissionRequest } from "./projection/permissions";

export interface ApprovalSessionRuntime {
	readonly items: Map<string, DesktopTranscriptItem>;
	readonly sessionId: string;
	readonly closed: boolean;
}

export class DesktopAgentApprovalRequests<TRuntime extends ApprovalSessionRuntime> {
	readonly #tool = new DesktopApprovalRegistry<CodingPermissionRequest, CodingPermissionDecision>();
	readonly #extension = new DesktopApprovalRegistry<
		DesktopExtensionApprovalRequest,
		CodingExtensionApprovalDecision
	>();

	constructor(
		private readonly requireSession: (sessionId: string) => TRuntime,
		private readonly emit: (runtime: TRuntime, event: DesktopAgentEvent) => void,
	) {}

	async requestTool(
		sessionId: string,
		request: CodingPermissionRequest,
		signal?: AbortSignal,
	): Promise<CodingPermissionDecision> {
		const runtime = this.requireSession(sessionId);
		const pending = this.#tool.register(request, signal);
		const item: DesktopPermissionItem = {
			kind: "permission",
			id: `permission:${request.requestId}`,
			request: projectPermissionRequest(request),
			status: "pending",
		};
		runtime.items.set(item.id, item);
		this.emit(runtime, { type: "transcript_upsert", item });
		try {
			const decision = await pending.result;
			const resolved: DesktopPermissionItem = {
				...item,
				status: decision === "deny" ? "denied" : "allowed",
				approvalOrigin: "manual",
			};
			runtime.items.set(item.id, resolved);
			this.emit(runtime, { type: "transcript_upsert", item: resolved });
			return decision;
		} catch (error) {
			if (runtime.closed) throw error;
			const cancelled: DesktopPermissionItem = { ...item, status: "cancelled" };
			runtime.items.set(item.id, cancelled);
			this.emit(runtime, { type: "transcript_upsert", item: cancelled });
			throw error;
		}
	}

	async requestExtension(
		sessionId: string,
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): Promise<CodingExtensionApprovalDecision> {
		const runtime = this.requireSession(sessionId);
		if (request.sessionId !== sessionId) {
			throw desktopAgentError("session_not_found", {
				message: `Extension approval session "${request.sessionId}" does not match active session`,
				data: { sessionId: request.sessionId },
			});
		}
		const safeRequest = projectExtensionApprovalRequest(request);
		const pending = this.#extension.register(safeRequest, signal);
		const item: DesktopExtensionPermissionItem = {
			kind: "extension_permission",
			id: `extension-permission:${request.requestId}`,
			request: safeRequest,
			status: "pending",
		};
		runtime.items.set(item.id, item);
		this.emit(runtime, { type: "transcript_upsert", item });
		try {
			const decision = await pending.result;
			const resolved: DesktopExtensionPermissionItem = {
				...item,
				status: decision === "deny" ? "denied" : "allowed",
			};
			runtime.items.set(item.id, resolved);
			this.emit(runtime, { type: "transcript_upsert", item: resolved });
			return decision;
		} catch (error) {
			if (runtime.closed) throw error;
			const cancelled: DesktopExtensionPermissionItem = { ...item, status: "cancelled" };
			runtime.items.set(item.id, cancelled);
			this.emit(runtime, { type: "transcript_upsert", item: cancelled });
			throw error;
		}
	}

	resolveTool(resolution: { readonly requestId: string; readonly decision: CodingPermissionDecision }): void {
		this.#tool.resolve(resolution);
	}

	resolveExtension(resolution: {
		readonly requestId: string;
		readonly decision: CodingExtensionApprovalDecision;
	}): void {
		this.#extension.resolve(resolution);
	}

	cancelSession(sessionId: string): void {
		this.#tool.cancelSession(sessionId);
		this.#extension.cancelSession(sessionId);
	}

	close(): void {
		this.#tool.close();
		this.#extension.close();
	}
}
