import { Result, type Result as ResultType } from "better-result";
import type { RuntimeOperationEvent } from "../operations";
import type { RuntimeHost, RuntimeSessionEvent } from "../runtime";
import { TrajectoryReadFailed } from "./types";

export type TrajectoryLiveEvent =
	| {
			readonly type: "message_chunk";
			readonly messageId: string;
			readonly channel: "agent" | "thought";
			readonly text: string;
	  }
	| { readonly type: "tool_chunk"; readonly toolCallId: string; readonly text: string };

export interface TrajectoryLiveSource {
	subscribe(
		sessionId: string,
		listener: (event: TrajectoryLiveEvent) => void,
	): Promise<ResultType<() => void, TrajectoryReadFailed>>;
}

/** Adapts the Host's disposable observer seam without opening or controlling a Session. */
export function createRuntimeTrajectoryLiveSource(host: RuntimeHost): TrajectoryLiveSource {
	return {
		async subscribe(sessionId, listener) {
			const observed = await host.observeSession(sessionId, (event) => projectRuntimeEvent(event, listener));
			if (observed.isOk()) return Result.ok(observed.value);
			return Result.err(
				new TrajectoryReadFailed({ sessionId, message: observed.error.message, cause: observed.error }),
			);
		},
	};
}

function projectRuntimeEvent(event: RuntimeSessionEvent, listener: (event: TrajectoryLiveEvent) => void): void {
	if (event.type !== "operation_event") return;
	const projected = projectOperationEvent(event.event);
	if (projected) listener(projected);
}

function projectOperationEvent(event: RuntimeOperationEvent): TrajectoryLiveEvent | undefined {
	if (event.type === "message_chunk") return event;
	if (event.type === "tool_content_chunk" && event.content.type === "text") {
		return { type: "tool_chunk", toolCallId: event.toolCallId, text: event.content.text };
	}
	if (event.type === "terminal_output_chunk")
		return { type: "tool_chunk", toolCallId: event.terminalId, text: event.text };
	return undefined;
}
