import type {
	TrajectoryDataResult,
	TrajectoryDataSource,
	TrajectoryItem,
	TrajectorySnapshot,
	TrajectorySubscription,
	TrajectoryWireError,
} from "@jai/trajectory-ui";
import { createParser } from "eventsource-parser";

export function createHttpTrajectoryDataSource(input: {
	readonly origin: string;
	readonly token: string;
}): TrajectoryDataSource {
	return new HttpTrajectoryDataSource(input);
}

class HttpTrajectoryDataSource implements TrajectoryDataSource {
	constructor(private readonly input: { readonly origin: string; readonly token: string }) {}

	async snapshot(sessionId: string): Promise<TrajectoryDataResult<TrajectorySnapshot>> {
		try {
			const response = await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/trajectory`);
			if (!response.ok) return { ok: false, error: await responseError(response) };
			const payload = await response.json().catch(() => undefined);
			return isSnapshot(payload)
				? { ok: true, value: payload }
				: { ok: false, error: unavailable("The trajectory service returned an invalid snapshot") };
		} catch {
			return { ok: false, error: unavailable("The trajectory service is unavailable") };
		}
	}

	async subscribe(
		input: Parameters<TrajectoryDataSource["subscribe"]>[0],
	): Promise<TrajectoryDataResult<TrajectorySubscription>> {
		const controller = new AbortController();
		void this.readEvents(input, controller)
			.then(() => {
				if (!controller.signal.aborted) input.onError(unavailable("The live trajectory connection ended"));
			})
			.catch(() => {
				if (!controller.signal.aborted) input.onError(unavailable("The live trajectory connection ended"));
			});
		return { ok: true, value: { close: () => controller.abort() } };
	}

	private async readEvents(
		input: Parameters<TrajectoryDataSource["subscribe"]>[0],
		controller: AbortController,
	): Promise<void> {
		const response = await this.request(
			`/v1/sessions/${encodeURIComponent(input.sessionId)}/trajectory/events?cursor=${encodeURIComponent(input.cursor.value)}`,
			controller.signal,
		);
		if (!response.ok) {
			input.onError(await responseError(response));
			return;
		}
		if (!response.body) {
			input.onError(unavailable("The live trajectory response did not include a stream"));
			return;
		}
		const parser = createParser({
			onEvent(event) {
				if (event.event !== "trajectory") return;
				const payload = parseJson(event.data);
				if (isTrajectoryItem(payload)) input.onItem(payload);
				else input.onError(unavailable("The live trajectory stream included an invalid record"));
			},
		});
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		try {
			while (!controller.signal.aborted) {
				const next = await reader.read();
				if (next.done) return;
				parser.feed(decoder.decode(next.value, { stream: true }));
			}
		} finally {
			reader.releaseLock();
		}
	}

	private request(path: string, signal?: AbortSignal): Promise<Response> {
		return fetch(`${this.input.origin}${path}`, {
			headers: { authorization: `Bearer ${this.input.token}` },
			cache: "no-store",
			credentials: "omit",
			mode: "cors",
			...(signal ? { signal } : {}),
		});
	}
}

async function responseError(response: Response): Promise<TrajectoryWireError> {
	const payload = await response.json().catch(() => undefined);
	if (isWireError(payload)) return payload.error;
	return unavailable(`Trajectory request failed with status ${response.status}`);
}

function isSnapshot(value: unknown): value is TrajectorySnapshot {
	return (
		isRecord(value) &&
		isRecord(value.session) &&
		typeof value.session.sessionId === "string" &&
		isRecord(value.cursor) &&
		typeof value.cursor.value === "string" &&
		Array.isArray(value.items) &&
		value.items.every(isTrajectoryItem)
	);
}

function isTrajectoryItem(value: unknown): value is TrajectoryItem {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.timestamp === "string" &&
		isRecord(value.cursor) &&
		typeof value.cursor.value === "string" &&
		(value.type === "live_chunk" || value.type === "message" || value.type === "journal")
	);
}

function isWireError(value: unknown): value is { readonly error: TrajectoryWireError } {
	return (
		isRecord(value) &&
		isRecord(value.error) &&
		isWireErrorCode(value.error.code) &&
		typeof value.error.message === "string"
	);
}

function isWireErrorCode(value: unknown): value is TrajectoryWireError["code"] {
	return value === "cursor_expired" || value === "forbidden" || value === "not_found" || value === "unavailable";
}

function unavailable(message: string): TrajectoryWireError {
	return { code: "unavailable", message };
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
