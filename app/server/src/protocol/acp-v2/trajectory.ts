import type {
	TrajectoryBrowserLauncher,
	TrajectoryContentScope,
	TrajectoryFeed,
	TrajectoryItem,
	TrajectoryReadAccess,
	TrajectoryReadError,
	TrajectorySnapshot,
	TrajectorySubscription,
} from "../../trajectory";
import { createTrajectoryReadAccess } from "../../trajectory";
import type { AcpJsonRpcNotification } from "./types";

const scopes = new Set<TrajectoryContentScope>(["prompt", "final_text", "reasoning", "tool_input", "tool_output"]);

export interface AcpTrajectoryProtocol {
	handle(method: string, params: unknown): Promise<AcpTrajectoryResult | undefined>;
	close(): void;
}

export type AcpTrajectoryResult =
	| {
			readonly ok: true;
			readonly value:
				| { readonly snapshot: TrajectorySnapshot }
				| { readonly subscriptionId: string }
				| Record<string, never>;
	  }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

type AccessResolution =
	| { readonly ok: true; readonly value: TrajectoryReadAccess }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** ACP-only read adapter. It owns subscription lifetime, never Session control or trajectory projection. */
export function createAcpTrajectoryProtocol(input: {
	readonly feed: TrajectoryFeed;
	readonly publish: (notification: AcpJsonRpcNotification) => void;
	readonly browserLauncher?: TrajectoryBrowserLauncher;
	readonly canOpenBrowser?: () => boolean;
}): AcpTrajectoryProtocol {
	return new DefaultAcpTrajectoryProtocol(input);
}

class DefaultAcpTrajectoryProtocol implements AcpTrajectoryProtocol {
	readonly #subscriptions = new Map<string, TrajectorySubscription>();

	constructor(
		private readonly input: {
			readonly feed: TrajectoryFeed;
			readonly publish: (notification: AcpJsonRpcNotification) => void;
			readonly browserLauncher?: TrajectoryBrowserLauncher;
			readonly canOpenBrowser?: () => boolean;
		},
	) {}

	async handle(method: string, params: unknown): Promise<AcpTrajectoryResult | undefined> {
		if (method === "jai/trajectory/snapshot") return this.snapshot(params);
		if (method === "jai/trajectory/subscribe") return this.subscribe(params);
		if (method === "jai/trajectory/unsubscribe") return this.unsubscribe(params);
		if (method === "jai/trajectory/browser/open") return this.openBrowser(params);
		return undefined;
	}

	close(): void {
		for (const subscription of this.#subscriptions.values()) subscription.close();
		this.#subscriptions.clear();
	}

	private async snapshot(params: unknown): Promise<AcpTrajectoryResult> {
		const access = resolveAccess(params);
		if (!access.ok) return access;
		const snapshot = await this.input.feed.snapshot(access.value);
		return snapshot.isOk()
			? { ok: true, value: { snapshot: snapshot.value } }
			: { ok: false, error: projectReadError(snapshot.error) };
	}

	private async subscribe(params: unknown): Promise<AcpTrajectoryResult> {
		const access = resolveAccess(params);
		if (!access.ok) return access;
		const cursor = object(params)?.cursor;
		if (typeof cursor !== "string") return invalid("Trajectory subscription requires a cursor");
		const subscriptionId = crypto.randomUUID();
		const opened = await this.input.feed.subscribe(access.value, { value: cursor }, (item) => {
			this.publish(subscriptionId, access.value.sessionId, item);
		});
		if (opened.isErr()) return { ok: false, error: projectReadError(opened.error) };
		this.#subscriptions.set(subscriptionId, opened.value);
		return { ok: true, value: { subscriptionId } };
	}

	private unsubscribe(params: unknown): AcpTrajectoryResult {
		const subscriptionId = object(params)?.subscriptionId;
		if (typeof subscriptionId !== "string") return invalid("Trajectory unsubscribe requires a subscriptionId");
		this.#subscriptions.get(subscriptionId)?.close();
		this.#subscriptions.delete(subscriptionId);
		return { ok: true, value: {} };
	}

	private async openBrowser(params: unknown): Promise<AcpTrajectoryResult> {
		if (!this.input.browserLauncher || this.input.canOpenBrowser?.() !== true) {
			return {
				ok: false,
				error: { code: "forbidden", message: "Only the local CLI can open a trajectory browser" },
			};
		}
		const access = resolveAccess(params);
		if (!access.ok) return access;
		const metadataAccess = createTrajectoryReadAccess({ sessionId: access.value.sessionId });
		if (metadataAccess.isErr()) return { ok: false, error: projectReadError(metadataAccess.error) };
		const exists = await this.input.feed.snapshot(metadataAccess.value);
		if (exists.isErr()) return { ok: false, error: projectReadError(exists.error) };
		const requestedScopes = (object(params)?.scopes ?? []) as readonly TrajectoryContentScope[];
		const opened = await this.input.browserLauncher.open({
			sessionId: access.value.sessionId,
			scopes: requestedScopes,
		});
		return opened.isOk()
			? { ok: true, value: {} }
			: { ok: false, error: { code: "unavailable", message: "Could not open the trajectory browser" } };
	}

	private publish(subscriptionId: string, sessionId: string, item: TrajectoryItem): void {
		try {
			this.input.publish({
				jsonrpc: "2.0",
				method: "jai/trajectory/update",
				params: { subscriptionId, sessionId, item },
			});
		} catch {
			// A dead ACP observer is disposable and cannot affect the Agent runtime.
		}
	}
}

function resolveAccess(params: unknown): AccessResolution {
	const input = object(params);
	if (!input || typeof input.sessionId !== "string") return invalidAccess("Trajectory request requires a Session");
	const requestedScopes = input.scopes === undefined ? [] : input.scopes;
	if (
		!Array.isArray(requestedScopes) ||
		!requestedScopes.every((scope) => typeof scope === "string" && scopes.has(scope as TrajectoryContentScope))
	) {
		return invalidAccess("Trajectory request includes an invalid content scope");
	}
	const access = createTrajectoryReadAccess({
		sessionId: input.sessionId,
		scopes: requestedScopes as readonly TrajectoryContentScope[],
	});
	return access.isOk() ? { ok: true, value: access.value } : { ok: false, error: projectReadError(access.error) };
}

function invalidAccess(message: string): AccessResolution {
	return { ok: false, error: { code: "invalid_request", message } };
}

function invalid(message: string): AcpTrajectoryResult {
	return { ok: false, error: { code: "invalid_request", message } };
}

function projectReadError(error: TrajectoryReadError): { readonly code: string; readonly message: string } {
	if (error._tag === "trajectory.cursor_expired") return { code: "cursor_expired", message: error.message };
	if (error._tag === "trajectory.access_denied") return { code: "forbidden", message: error.message };
	return { code: "unavailable", message: "Trajectory is temporarily unavailable" };
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
