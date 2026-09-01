import type { Result } from "better-result";
import type { AcpJsonRpcRequest, AcpJsonRpcResponse, AcpOutboundMessage } from "../acp-v2/types";
import type {
	DesktopCatalogAccess,
	DesktopCatalogProject,
	DesktopCatalogSessionCursor,
	DesktopCatalogStorageError,
} from "./types";

const methodPrefix = "jai/desktop-catalog/";

/**
 * Private, local-only JSON-RPC projection for Desktop Catalog storage. It is
 * intentionally separate from ACP: ACP remains the public Agent protocol.
 */
export class DesktopCatalogControl {
	constructor(private readonly catalog: DesktopCatalogAccess) {}

	async handle(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[] | undefined> {
		if (!request.method.startsWith(methodPrefix)) return undefined;
		if (request.id === undefined) return [];
		const params = object(request.params);
		if (!params) return this.error(request.id, -32602, "Desktop Catalog request requires an object params value");

		switch (request.method) {
			case "jai/desktop-catalog/projects/list":
				if (!isEmpty(params))
					return this.error(request.id, -32602, "Invalid Desktop Catalog project list parameters");
				return this.project(request.id, this.catalog.listProjects());
			case "jai/desktop-catalog/projects/create": {
				const project = parseProject(params);
				if (!project) return this.error(request.id, -32602, "Invalid Desktop Catalog project create parameters");
				return this.project(request.id, this.catalog.createProject(project));
			}
			case "jai/desktop-catalog/projects/relink": {
				const project = parseProject(params);
				if (!project) return this.error(request.id, -32602, "Invalid Desktop Catalog project relink parameters");
				return this.project(request.id, this.catalog.relinkProject(project));
			}
			case "jai/desktop-catalog/sessions/list": {
				const input = parseSessionList(params);
				if (!input) return this.error(request.id, -32602, "Invalid Desktop Catalog Session list parameters");
				return this.project(request.id, this.catalog.listSessions(input));
			}
			case "jai/desktop-catalog/sessions/get": {
				const sessionId = requiredString(params, "sessionId");
				if (!sessionId || !hasOnly(params, ["sessionId"]))
					return this.error(request.id, -32602, "Invalid Desktop Catalog Session get parameters");
				return this.project(request.id, this.catalog.getSession(sessionId));
			}
			case "jai/desktop-catalog/sessions/delete": {
				const sessionId = requiredString(params, "sessionId");
				if (!sessionId || !hasOnly(params, ["sessionId"]))
					return this.error(request.id, -32602, "Invalid Desktop Catalog Session delete parameters");
				return this.project(request.id, this.catalog.deleteSession(sessionId));
			}
			case "jai/desktop-catalog/sessions/ensure": {
				const session = parseEnsureSession(params);
				if (!session) return this.error(request.id, -32602, "Invalid Desktop Catalog Session ensure parameters");
				return this.project(request.id, this.catalog.ensureSession(session));
			}
			case "jai/desktop-catalog/sessions/rename": {
				const session = parseSessionTitle(params);
				if (!session) return this.error(request.id, -32602, "Invalid Desktop Catalog Session rename parameters");
				return this.project(request.id, this.catalog.renameSession(session));
			}
			case "jai/desktop-catalog/sessions/mark-title-generation-attempted": {
				const sessionId = requiredString(params, "sessionId");
				const timestamp = params.timestamp;
				if (
					!sessionId ||
					typeof timestamp !== "number" ||
					!Number.isFinite(timestamp) ||
					!hasOnly(params, ["sessionId", "timestamp"])
				) {
					return this.error(request.id, -32602, "Invalid Desktop Catalog title-attempt parameters");
				}
				return this.project(request.id, this.catalog.markTitleGenerationAttempted({ sessionId, timestamp }));
			}
			case "jai/desktop-catalog/sessions/set-generated-title": {
				const session = parseSessionTitle(params);
				if (!session) return this.error(request.id, -32602, "Invalid Desktop Catalog generated-title parameters");
				return this.project(request.id, this.catalog.setGeneratedTitle(session));
			}
			case "jai/desktop-catalog/sessions/should-generate-title": {
				const sessionId = requiredString(params, "sessionId");
				if (!sessionId || !hasOnly(params, ["sessionId"]))
					return this.error(request.id, -32602, "Invalid Desktop Catalog title-check parameters");
				return this.project(request.id, this.catalog.shouldGenerateSessionTitle(sessionId));
			}
			case "jai/desktop-catalog/sessions/move": {
				const sessionId = requiredString(params, "sessionId");
				const projectId = nullableString(params, "projectId");
				if (!sessionId || projectId === undefined || !hasOnly(params, ["sessionId", "projectId"]))
					return this.error(request.id, -32602, "Invalid Desktop Catalog Session move parameters");
				return this.project(request.id, this.catalog.moveSession({ sessionId, projectId }));
			}
			default:
				return this.error(request.id, -32601, `Unsupported Desktop Catalog method "${request.method}"`);
		}
	}

	private project<T>(
		id: string | number,
		result: Result<T, DesktopCatalogStorageError>,
	): readonly AcpOutboundMessage[] {
		if (result.isErr()) return this.error(id, -32001, result.error.message);
		return [{ jsonrpc: "2.0", id, result: result.value } satisfies AcpJsonRpcResponse];
	}

	private error(id: string | number, code: number, message: string): readonly AcpOutboundMessage[] {
		return [{ jsonrpc: "2.0", id, error: { code, message } satisfies AcpJsonRpcResponse["error"] }];
	}
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function requiredString(value: Record<string, unknown>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function nullableString(value: Record<string, unknown>, key: string): string | null | undefined {
	const candidate = value[key];
	return candidate === null || (typeof candidate === "string" && candidate.trim()) ? candidate : undefined;
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

function isEmpty(value: Record<string, unknown>): boolean {
	return Object.keys(value).length === 0;
}

function parseProject(value: Record<string, unknown>): DesktopCatalogProject | undefined {
	const id = requiredString(value, "id");
	const displayName = requiredString(value, "displayName");
	const path = requiredString(value, "path");
	const canonicalPath = requiredString(value, "canonicalPath");
	const createdAt = value.createdAt;
	const updatedAt = value.updatedAt;
	if (
		!id ||
		!displayName ||
		!path ||
		!canonicalPath ||
		typeof createdAt !== "number" ||
		typeof updatedAt !== "number" ||
		!Number.isFinite(createdAt) ||
		!Number.isFinite(updatedAt) ||
		!hasOnly(value, ["id", "displayName", "path", "canonicalPath", "createdAt", "updatedAt"])
	) {
		return undefined;
	}
	return { id, displayName, path, canonicalPath, createdAt, updatedAt };
}

function parseSessionList(
	value: Record<string, unknown>,
): { readonly limit?: number; readonly cursor?: DesktopCatalogSessionCursor } | undefined {
	const limit = value.limit;
	if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1)) return undefined;
	const rawCursor = value.cursor;
	if (rawCursor === undefined)
		return hasOnly(value, ["limit"]) ? { ...(limit === undefined ? {} : { limit }) } : undefined;
	const cursor = object(rawCursor);
	if (
		!cursor ||
		typeof cursor.lastActivityAt !== "number" ||
		!Number.isFinite(cursor.lastActivityAt) ||
		typeof cursor.id !== "string" ||
		!cursor.id ||
		!hasOnly(cursor, ["lastActivityAt", "id"]) ||
		!hasOnly(value, ["limit", "cursor"])
	) {
		return undefined;
	}
	return {
		...(limit === undefined ? {} : { limit }),
		cursor: { lastActivityAt: cursor.lastActivityAt, id: cursor.id },
	};
}

function parseEnsureSession(
	value: Record<string, unknown>,
): { readonly sessionId: string; readonly projectId: string | null; readonly title: string } | undefined {
	const sessionId = requiredString(value, "sessionId");
	const projectId = nullableString(value, "projectId");
	const title = requiredString(value, "title");
	if (!sessionId || projectId === undefined || !title || !hasOnly(value, ["sessionId", "projectId", "title"]))
		return undefined;
	return { sessionId, projectId, title };
}

function parseSessionTitle(
	value: Record<string, unknown>,
): { readonly sessionId: string; readonly title: string } | undefined {
	const sessionId = requiredString(value, "sessionId");
	const title = requiredString(value, "title");
	if (!sessionId || !title || !hasOnly(value, ["sessionId", "title"])) return undefined;
	return { sessionId, title };
}
