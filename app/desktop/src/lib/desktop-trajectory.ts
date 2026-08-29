import type {
	TrajectoryContentScope,
	TrajectoryDataResult,
	TrajectoryDataSource,
	TrajectoryItem,
	TrajectorySnapshot,
	TrajectorySubscription,
} from "@jai/trajectory-ui";
import { desktop } from "./desktop";

export function createDesktopTrajectoryDataSource(
	scopes: readonly TrajectoryContentScope[] = [],
): TrajectoryDataSource {
	return new DesktopTrajectoryDataSource(scopes);
}

class DesktopTrajectoryDataSource implements TrajectoryDataSource {
	constructor(private readonly scopes: readonly TrajectoryContentScope[]) {}

	async snapshot(sessionId: string): Promise<TrajectoryDataResult<TrajectorySnapshot>> {
		const result = await desktop.trajectory.snapshot({
			sessionId,
			...(this.scopes.length > 0 ? { scopes: this.scopes } : {}),
		});
		if (!result.ok) return result;
		return isTrajectorySnapshot(result.value.snapshot)
			? { ok: true, value: result.value.snapshot }
			: unavailable("The desktop trajectory projection was invalid");
	}

	async subscribe(
		input: Parameters<TrajectoryDataSource["subscribe"]>[0],
	): Promise<TrajectoryDataResult<TrajectorySubscription>> {
		let subscriptionId: string | undefined;
		const pending: TrajectoryItem[] = [];
		const unsubscribeEvents = window.desktopRpc.onAgentEvent((envelope) => {
			if (envelope.sessionId !== input.sessionId || envelope.event.type !== "trajectory_update") return;
			if (!isTrajectoryItem(envelope.event.item)) return;
			if (subscriptionId === undefined) {
				pending.push(envelope.event.item);
				return;
			}
			if (envelope.event.subscriptionId === subscriptionId) input.onItem(envelope.event.item);
		});
		const result = await desktop.trajectory.subscribe({
			sessionId: input.sessionId,
			cursor: input.cursor.value,
			...(this.scopes.length > 0 ? { scopes: this.scopes } : {}),
		});
		if (!result.ok) {
			unsubscribeEvents();
			return result;
		}
		subscriptionId = result.value.subscriptionId;
		for (const item of pending) input.onItem(item);
		return {
			ok: true,
			value: {
				close: () => {
					unsubscribeEvents();
					desktop.trajectory.unsubscribe({ subscriptionId: result.value.subscriptionId }).catch(() => undefined);
				},
			},
		};
	}
}

function unavailable<T>(message: string): TrajectoryDataResult<T> {
	return { ok: false, error: { code: "unavailable", message } };
}

function isTrajectorySnapshot(value: unknown): value is TrajectorySnapshot {
	return (
		isRecord(value) &&
		isRecord(value.session) &&
		typeof value.session.sessionId === "string" &&
		typeof value.session.cwd === "string" &&
		isRecord(value.cursor) &&
		typeof value.cursor.value === "string" &&
		Array.isArray(value.items) &&
		value.items.every(isTrajectoryItem)
	);
}

function isTrajectoryItem(value: unknown): value is TrajectoryItem {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.timestamp !== "string" ||
		!isRecord(value.cursor) ||
		typeof value.cursor.value !== "string"
	)
		return false;
	if (value.type === "live_chunk") {
		return (
			isRecord(value.chunk) &&
			typeof value.chunk.messageId === "string" &&
			(value.chunk.channel === "agent" || value.chunk.channel === "thought" || value.chunk.channel === "tool") &&
			typeof value.chunk.text === "string"
		);
	}
	if (value.type === "journal") return isRecord(value.journal);
	if (value.type !== "message" || !isRecord(value.message)) return false;
	return (
		typeof value.message.entryId === "string" &&
		(value.message.role === "user" || value.message.role === "assistant" || value.message.role === "toolResult") &&
		(value.message.parentId === null || typeof value.message.parentId === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
