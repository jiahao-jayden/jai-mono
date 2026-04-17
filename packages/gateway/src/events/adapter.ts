import type { AgentEvent } from "@jayden/jai-agent";
import type { StreamEvent } from "@jayden/jai-ai";
import { type AGUIEvent, AGUIEventType } from "./types.js";

/**
 * Translates internal AgentEvent stream into AG-UI protocol events.
 *
 * Per-request lifecycle: create a new instance for each POST /message,
 * discard when the request ends. This avoids cross-request state leakage.
 *
 *  AgentEvent flow          →  AG-UI events
 *  ─────────────────────────────────────────
 *  agent_start              →  RUN_STARTED
 *  stream/message_start     →  TEXT_MESSAGE_START
 *  stream/reasoning_delta   →  (REASONING_START) + REASONING_CONTENT
 *  stream/text_delta        →  (REASONING_END) + TEXT_MESSAGE_CONTENT
 *  stream/message_end       →  (REASONING_END) + TEXT_MESSAGE_END
 *  stream/error             →  RUN_ERROR
 *  tool_start               →  TOOL_CALL_START + TOOL_CALL_ARGS
 *  tool_end                 →  TOOL_CALL_END + TOOL_CALL_RESULT
 *  agent_end                →  RUN_FINISHED
 */
export class EventAdapter {
	private threadId: string;
	private runId: string;
	private currentMessageId: string | null = null;
	private inReasoning = false;
	private _totalTokens = 0;

	get totalTokens(): number {
		return this._totalTokens;
	}

	constructor(threadId: string, runId?: string) {
		this.threadId = threadId;
		this.runId = runId ?? crypto.randomUUID();
	}

	translate(event: AgentEvent): AGUIEvent[] {
		switch (event.type) {
			case "agent_start":
				return this.onAgentStart();
			case "agent_end":
				return this.onAgentEnd();
			case "stream":
				return this.onStream(event.event);
			case "tool_start":
				return this.onToolStart(event.toolCallId, event.toolName, event.args);
			case "tool_end":
				return this.onToolEnd(event.toolCallId, event.result);
			case "compaction_start":
				return [{ type: AGUIEventType.COMPACTION_START }];
			case "compaction_end":
				return [{ type: AGUIEventType.COMPACTION_END, summary: event.summary }];
			case "turn_start":
			case "turn_end":
			case "message_end":
			case "tool_update":
				return [];
			default:
				return [];
		}
	}

	private onAgentStart(): AGUIEvent[] {
		return [
			{
				type: AGUIEventType.RUN_STARTED,
				threadId: this.threadId,
				runId: this.runId,
			},
		];
	}

	private onAgentEnd(): AGUIEvent[] {
		const events: AGUIEvent[] = [];
		this.closeReasoning(events);
		events.push({
			type: AGUIEventType.RUN_FINISHED,
			threadId: this.threadId,
			runId: this.runId,
		});
		return events;
	}

	private onStream(streamEvent: StreamEvent): AGUIEvent[] {
		switch (streamEvent.type) {
			case "message_start": {
				this.currentMessageId = crypto.randomUUID();
				return [
					{
						type: AGUIEventType.TEXT_MESSAGE_START,
						messageId: this.currentMessageId,
						role: "assistant" as const,
					},
				];
			}

			case "text_delta": {
				const events: AGUIEvent[] = [];
				this.closeReasoning(events);
				const messageId = this.ensureMessageId();
				events.push({
					type: AGUIEventType.TEXT_MESSAGE_CONTENT,
					messageId,
					delta: streamEvent.text,
				});
				return events;
			}

			case "reasoning_delta": {
				const events: AGUIEvent[] = [];
				const messageId = this.ensureMessageId();
				if (!this.inReasoning) {
					this.inReasoning = true;
					events.push({
						type: AGUIEventType.REASONING_START,
						messageId,
					});
				}
				events.push({
					type: AGUIEventType.REASONING_CONTENT,
					messageId,
					delta: streamEvent.text,
				});
				return events;
			}

			case "message_end": {
				const events: AGUIEvent[] = [];
				this.closeReasoning(events);
				if (this.currentMessageId) {
					events.push({
						type: AGUIEventType.TEXT_MESSAGE_END,
						messageId: this.currentMessageId,
					});
					this.currentMessageId = null;
				}
				return events;
			}

			case "error": {
				const events: AGUIEvent[] = [];
				this.closeReasoning(events);
				events.push({
					type: AGUIEventType.RUN_ERROR,
					message: streamEvent.error.message,
				});
				return events;
			}

			case "tool_call":
				return [];

			case "step_finish": {
				const { inputTokens, outputTokens } = streamEvent.usage;
				this._totalTokens += inputTokens + outputTokens;
				return [
					{
						type: AGUIEventType.USAGE_UPDATE,
						inputTokens,
						outputTokens,
						totalTokens: this._totalTokens,
					},
				];
			}

			default:
				return [];
		}
	}

	private onToolStart(toolCallId: string, toolName: string, args: unknown): AGUIEvent[] {
		const events: AGUIEvent[] = [
			{
				type: AGUIEventType.TOOL_CALL_START,
				toolCallId,
				toolCallName: toolName,
				parentMessageId: this.currentMessageId ?? undefined,
			},
			{
				type: AGUIEventType.TOOL_CALL_ARGS,
				toolCallId,
				delta: JSON.stringify(args),
			},
		];
		return events;
	}

	private onToolEnd(
		toolCallId: string,
		result: { content: Array<{ type: string; text?: string }>; isError?: boolean },
	): AGUIEvent[] {
		const textParts = result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text);

		return [
			{
				type: AGUIEventType.TOOL_CALL_RESULT,
				toolCallId,
				content: textParts.join("\n"),
			},
			{
				type: AGUIEventType.TOOL_CALL_END,
				toolCallId,
			},
		];
	}

	private closeReasoning(events: AGUIEvent[]): void {
		if (this.inReasoning && this.currentMessageId) {
			events.push({
				type: AGUIEventType.REASONING_END,
				messageId: this.currentMessageId,
			});
			this.inReasoning = false;
		}
	}

	private ensureMessageId(): string {
		if (!this.currentMessageId) {
			this.currentMessageId = crypto.randomUUID();
		}
		return this.currentMessageId;
	}
}
