import { Result, type Result as ResultType, TaggedError } from "better-result";
import { connectJaiRuntimeHost, type RuntimeHostClientConnectError } from "./protocol/acp-v2/launcher";
import {
	type AcpLocalClientConnectFailed,
	type AcpLocalClientError,
	type LocalAcpV2Client,
	openLocalAcpV2Client,
} from "./protocol/acp-v2/local-client";
import { localDesktopCatalogEndpointFor } from "./protocol/desktop-catalog/local-endpoint";
import type {
	DesktopCatalogProject,
	DesktopCatalogSession,
	DesktopCatalogSessionCursor,
	DesktopCatalogSessionPage,
} from "./protocol/desktop-catalog/types";
import { resolveJaiDataDirectory } from "./runtime/paths";

export class DesktopCatalogClientResponseInvalid extends TaggedError("desktop_catalog_client.invalid_response")<{
	readonly method: string;
	readonly message: string;
}> {}

export type DesktopCatalogClientError =
	| RuntimeHostClientConnectError
	| AcpLocalClientConnectFailed
	| AcpLocalClientError
	| DesktopCatalogClientResponseInvalid;

export interface ConnectDesktopCatalogClientOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly dataDirectory?: string;
	/** Optional override for the ACP endpoint used only to ensure the Host is running. */
	readonly runtimeEndpoint?: string;
	/** Desktop's packaged Runtime Host entrypoint, when it lives outside app.asar. */
	readonly runtimeHostEntrypoint?: string;
	/** Host-owned launcher for a packaged Runtime Host that cannot use Node's child_process. */
	readonly launchRuntimeHost?: (input: {
		readonly entrypoint: string;
		readonly environment: Readonly<Record<string, string | undefined>>;
	}) => void;
	/** Optional override for the private Desktop Catalog control endpoint. */
	readonly endpoint?: string;
	readonly retryDelayMs?: number;
	readonly retryCount?: number;
}

/**
 * Typed local client for the Desktop-owned catalog. It only ensures the
 * Runtime Host is running, then uses its private control endpoint; it has no
 * SQLite, Agent runtime, or ACP stdio dependency.
 */
export async function connectDesktopCatalogClient(
	options: ConnectDesktopCatalogClientOptions = {},
): Promise<ResultType<DesktopCatalogClient, DesktopCatalogClientError>> {
	const environment = options.environment ?? process.env;
	const dataDirectory = options.dataDirectory ?? resolveJaiDataDirectory(environment);
	const runtime = await connectJaiRuntimeHost({
		environment,
		dataDirectory,
		...(options.runtimeEndpoint === undefined ? {} : { endpoint: options.runtimeEndpoint }),
		...(options.runtimeHostEntrypoint === undefined ? {} : { runtimeHostEntrypoint: options.runtimeHostEntrypoint }),
		...(options.launchRuntimeHost === undefined ? {} : { launchRuntimeHost: options.launchRuntimeHost }),
		...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
		...(options.retryCount === undefined ? {} : { retryCount: options.retryCount }),
	});
	if (runtime.isErr()) return Result.err(runtime.error);
	await runtime.value.close();
	const endpoint = options.endpoint ?? localDesktopCatalogEndpointFor(dataDirectory);
	const retryDelayMs = options.retryDelayMs ?? 50;
	const retryCount = options.retryCount ?? 60;
	for (let attempt = 0; attempt < retryCount; attempt += 1) {
		const opened = await openLocalAcpV2Client(endpoint);
		if (opened.isOk()) return Result.ok(new DefaultDesktopCatalogClient(opened.value));
		if (attempt === retryCount - 1) return Result.err(opened.error);
		await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
	}
	return Result.err(
		new DesktopCatalogClientResponseInvalid({
			method: "connect",
			message: `Desktop Catalog control endpoint "${endpoint}" was not available`,
		}),
	);
}

export interface DesktopCatalogClient {
	listProjects(): Promise<ResultType<readonly DesktopCatalogProject[], DesktopCatalogClientError>>;
	createProject(input: DesktopCatalogProject): Promise<ResultType<DesktopCatalogProject, DesktopCatalogClientError>>;
	relinkProject(input: DesktopCatalogProject): Promise<ResultType<DesktopCatalogProject, DesktopCatalogClientError>>;
	listSessions(input?: {
		readonly limit?: number;
		readonly cursor?: DesktopCatalogSessionCursor;
	}): Promise<ResultType<DesktopCatalogSessionPage, DesktopCatalogClientError>>;
	getSession(sessionId: string): Promise<ResultType<DesktopCatalogSession | undefined, DesktopCatalogClientError>>;
	deleteSession(sessionId: string): Promise<ResultType<void, DesktopCatalogClientError>>;
	ensureSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>>;
	renameSession(input: {
		readonly sessionId: string;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>>;
	markTitleGenerationAttempted(input: {
		readonly sessionId: string;
		readonly timestamp: number;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>>;
	setGeneratedTitle(input: {
		readonly sessionId: string;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>>;
	shouldGenerateSessionTitle(sessionId: string): Promise<ResultType<boolean, DesktopCatalogClientError>>;
	moveSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>>;
	close(): Promise<void>;
}

class DefaultDesktopCatalogClient implements DesktopCatalogClient {
	constructor(private readonly client: LocalAcpV2Client) {}

	async listProjects(): Promise<ResultType<readonly DesktopCatalogProject[], DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/projects/list", {}, projects);
	}

	async createProject(
		input: DesktopCatalogProject,
	): Promise<ResultType<DesktopCatalogProject, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/projects/create", input, project);
	}

	async relinkProject(
		input: DesktopCatalogProject,
	): Promise<ResultType<DesktopCatalogProject, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/projects/relink", input, project);
	}

	async listSessions(
		input: { readonly limit?: number; readonly cursor?: DesktopCatalogSessionCursor } = {},
	): Promise<ResultType<DesktopCatalogSessionPage, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/list", input, sessionPage);
	}

	async getSession(
		sessionId: string,
	): Promise<ResultType<DesktopCatalogSession | undefined, DesktopCatalogClientError>> {
		const response = await this.client.request("jai/desktop-catalog/sessions/get", { sessionId });
		if (response.isErr()) return Result.err(response.error);
		if (response.value === undefined) return Result.ok(undefined);
		const parsed = session(response.value);
		if (parsed) return Result.ok(parsed);
		return Result.err(
			new DesktopCatalogClientResponseInvalid({
				method: "jai/desktop-catalog/sessions/get",
				message: "Desktop Catalog Session get response did not match the expected projection",
			}),
		);
	}

	async deleteSession(sessionId: string): Promise<ResultType<void, DesktopCatalogClientError>> {
		const response = await this.client.request("jai/desktop-catalog/sessions/delete", { sessionId });
		if (response.isErr()) return Result.err(response.error);
		return response.value === undefined
			? Result.ok(undefined)
			: Result.err(
					new DesktopCatalogClientResponseInvalid({
						method: "jai/desktop-catalog/sessions/delete",
						message: "Desktop Catalog Session delete response was not empty",
					}),
				);
	}

	async ensureSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/ensure", input, session);
	}

	async renameSession(input: {
		readonly sessionId: string;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/rename", input, session);
	}

	async markTitleGenerationAttempted(input: {
		readonly sessionId: string;
		readonly timestamp: number;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/mark-title-generation-attempted", input, session);
	}

	async setGeneratedTitle(input: {
		readonly sessionId: string;
		readonly title: string;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/set-generated-title", input, session);
	}

	async shouldGenerateSessionTitle(sessionId: string): Promise<ResultType<boolean, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/should-generate-title", { sessionId }, boolean);
	}

	async moveSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
	}): Promise<ResultType<DesktopCatalogSession, DesktopCatalogClientError>> {
		return this.request("jai/desktop-catalog/sessions/move", input, session);
	}

	close(): Promise<void> {
		return this.client.close();
	}

	private async request<T>(
		method: string,
		params: unknown,
		parse: (value: unknown) => T | undefined,
	): Promise<ResultType<T, DesktopCatalogClientError>> {
		const response = await this.client.request(method, params);
		if (response.isErr()) return Result.err(response.error);
		const parsed = parse(response.value);
		if (parsed !== undefined) return Result.ok(parsed);
		return Result.err(
			new DesktopCatalogClientResponseInvalid({
				method,
				message: `Desktop Catalog response for "${method}" did not match the expected projection`,
			}),
		);
	}
}

function projects(value: unknown): readonly DesktopCatalogProject[] | undefined {
	return Array.isArray(value) && value.every((candidate) => project(candidate) !== undefined)
		? value.map((candidate) => project(candidate)!)
		: undefined;
}

function project(value: unknown): DesktopCatalogProject | undefined {
	if (!record(value)) return undefined;
	if (
		typeof value.id !== "string" ||
		typeof value.displayName !== "string" ||
		typeof value.path !== "string" ||
		typeof value.canonicalPath !== "string" ||
		typeof value.createdAt !== "number" ||
		typeof value.updatedAt !== "number"
	) {
		return undefined;
	}
	return {
		id: value.id,
		displayName: value.displayName,
		path: value.path,
		canonicalPath: value.canonicalPath,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function sessionPage(value: unknown): DesktopCatalogSessionPage | undefined {
	if (!record(value) || !Array.isArray(value.sessions)) return undefined;
	const sessions = value.sessions.map(session);
	if (sessions.some((candidate) => candidate === undefined)) return undefined;
	const rawCursor = value.nextCursor;
	if (rawCursor === undefined) return { sessions: sessions as DesktopCatalogSession[] };
	if (!record(rawCursor) || typeof rawCursor.lastActivityAt !== "number" || typeof rawCursor.id !== "string")
		return undefined;
	return {
		sessions: sessions as DesktopCatalogSession[],
		nextCursor: { lastActivityAt: rawCursor.lastActivityAt, id: rawCursor.id },
	};
}

function session(value: unknown): DesktopCatalogSession | undefined {
	if (!record(value)) return undefined;
	if (
		typeof value.id !== "string" ||
		(value.projectId !== null && typeof value.projectId !== "string") ||
		typeof value.title !== "string" ||
		(value.titleSource !== "fallback" && value.titleSource !== "generated" && value.titleSource !== "manual") ||
		typeof value.lastActivityAt !== "number"
	) {
		return undefined;
	}
	return {
		id: value.id,
		projectId: value.projectId,
		title: value.title,
		titleSource: value.titleSource,
		lastActivityAt: value.lastActivityAt,
	};
}

function boolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
