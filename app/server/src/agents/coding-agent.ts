import {
	type CodingExtensionApprovalDecision,
	type CodingExtensionRuntimeAdapter,
	createCodingAgent,
	type CodingAgent,
	type CodingAgentCreateOptions,
	type CodingAgentEvent,
	type CodingAgentMessage,
	type JsonObject,
	type JsonValue,
} from "@jai/coding-agent";
import { Result, type Result as ResultType } from "better-result";
import {
	type OperationEffectBoundary,
	type RuntimeOperation,
	type RuntimeOperationContent,
	type RuntimeOperationDriver,
	type RuntimeOperationEvent,
	type RuntimeOperationOpenInput,
	type RuntimeOperationPreflightInput,
	type RuntimeOperationOutcome,
	type RuntimeQueuedInput,
	RuntimeOperationExecutionFailed,
	RuntimeOperationOpenFailed,
} from "../operations";
import type { RuntimeCapabilitySource } from "../runtime-capabilities";

type CodingAgentOperationOptions = Omit<
	CodingAgentCreateOptions,
	"cwd" | "effectBoundary" | "requestApproval" | "session"
>;
type CodingAgentOperationConfiguration = Omit<
	CodingAgentOperationOptions,
	"fileCapabilities"
>;

export interface CodingAgentOperationDriverOptions {
	/** Product configuration stays at the Server composition root, never inside the SDK. */
	readonly resolveOptions: (
		input: Pick<RuntimeOperationOpenInput, "sessionId" | "cwd" | "operationId" | "runtimeConfiguration">,
	) =>
		| ResultType<CodingAgentOperationConfiguration, RuntimeOperationOpenFailed>
		| Promise<ResultType<CodingAgentOperationConfiguration, RuntimeOperationOpenFailed>>;
	/** Supplies Host-selected file capabilities and disposable Extensions per Operation. */
	readonly capabilitySource: RuntimeCapabilitySource;
}

/**
 * Adapts the public Coding Agent SDK to the Runtime Host execution seam.
 * The SDK receives a generic SessionStore and EffectBoundary, never SQLite,
 * ACP, $JAI_HOME, or Desktop/CLI product configuration.
 */
export function createCodingAgentOperationDriver(
	options: CodingAgentOperationDriverOptions,
): RuntimeOperationDriver {
	return new DefaultCodingAgentOperationDriver(options);
}

class DefaultCodingAgentOperationDriver implements RuntimeOperationDriver {
	constructor(private readonly options: CodingAgentOperationDriverOptions) {}

	async preflight(input: RuntimeOperationPreflightInput): Promise<ResultType<void, RuntimeOperationOpenFailed>> {
		try {
			const configured = await this.#resolveOptions(input);
			return configured.isOk() ? Result.ok(undefined) : Result.err(configured.error);
		} catch (cause) {
			return Result.err(
				new RuntimeOperationOpenFailed({
					message: `Coding Agent configuration could not prepare Operation "${input.operationId}"`,
					sessionId: input.sessionId,
					operationId: input.operationId,
					cause,
				}),
			);
		}
	}

	async openOperation(input: RuntimeOperationOpenInput): Promise<ResultType<RuntimeOperation, RuntimeOperationOpenFailed>> {
		try {
			const configured = await this.#resolveOptions(input);
			if (configured.isErr()) return Result.err(configured.error);
			const created = await createCodingAgent({
				...configured.value,
				...(configured.value.extensionRuntime
					? { extensionRuntime: withRuntimeApprovals(configured.value.extensionRuntime, input) }
					: {}),
				permissionMode: permissionModeFor(input.runtimeConfiguration.mode),
				cwd: input.cwd,
				session: { kind: "resume", id: input.sessionId, store: input.sessionStore },
				effectBoundary: input.effectBoundary,
				requestApproval: (request, signal) =>
					input.requestApproval(
						{
							requestId: request.requestId,
							sessionId: input.sessionId,
							operationId: input.operationId,
							toolCallId: request.toolCallId,
							toolName: request.toolName,
							title: request.summary.title,
							...(request.summary.description ? { description: request.summary.description } : {}),
							...(request.summary.risk ? { risk: request.summary.risk } : {}),
							canAlwaysAllow: request.canAlwaysAllow,
							...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
						},
						signal,
					),
			});
			if (created.isErr()) {
				return Result.err(
					new RuntimeOperationOpenFailed({
						message: `Coding Agent could not open Operation "${input.operationId}"`,
						sessionId: input.sessionId,
						operationId: input.operationId,
						cause: created.error,
					}),
				);
			}
			return Result.ok(new CodingAgentOperation(input, created.value));
		} catch (error) {
			return Result.err(
				new RuntimeOperationOpenFailed({
					message: `Coding Agent configuration failed for Operation "${input.operationId}"`,
					sessionId: input.sessionId,
					operationId: input.operationId,
					cause: error,
				}),
			);
		}
	}

	async #resolveOptions(
		input: Pick<RuntimeOperationOpenInput, "sessionId" | "cwd" | "operationId" | "runtimeConfiguration">,
	): Promise<ResultType<CodingAgentOperationOptions, RuntimeOperationOpenFailed>> {
		const configured = await this.options.resolveOptions(input);
		if (configured.isErr()) return Result.err(configured.error);
		const capabilities = await this.options.capabilitySource.resolve({
			sessionId: input.sessionId,
			operationId: input.operationId,
			cwd: input.cwd,
		});
		if (capabilities.isErr()) {
			return Result.err(
				new RuntimeOperationOpenFailed({
					message: `Coding Agent capability source could not prepare Operation "${input.operationId}"`,
					sessionId: input.sessionId,
					operationId: input.operationId,
					cause: capabilities.error,
				}),
			);
		}
		return Result.ok({
			...configured.value,
			fileCapabilities: capabilities.value.fileCapabilities,
			extensions: [...(configured.value.extensions ?? []), ...capabilities.value.extensions],
		});
	}
}

/**
 * Extension-owned approvals still travel through the Runtime Host's one
 * approval registry. Extensions receive the SDK-level decision vocabulary;
 * they never learn ACP request ids or the active Desktop controller.
 */
function withRuntimeApprovals(
	runtime: CodingExtensionRuntimeAdapter,
	input: RuntimeOperationOpenInput,
): CodingExtensionRuntimeAdapter {
	return {
		...runtime,
		requestApproval: async (request, signal) => {
			const decision = await input.requestApproval(
				{
					requestId: request.requestId,
					sessionId: input.sessionId,
					operationId: input.operationId,
					toolCallId: request.toolCallId,
					toolName: `extension:${request.extensionId}`,
					title: request.presentation.title,
					...(request.presentation.description ? { description: request.presentation.description } : {}),
					risk: approvalRisk(request.sideEffect),
					canAlwaysAllow: true,
				},
				signal,
			);
			return Result.ok<CodingExtensionApprovalDecision>(
				decision === "alwaysAllow" ? "allow" : decision,
			);
		},
	};
}

function approvalRisk(sideEffect: "read" | "write" | "destructive"): "low" | "medium" | "high" {
	if (sideEffect === "destructive") return "high";
	return sideEffect === "write" ? "medium" : "low";
}

function permissionModeFor(
	mode: RuntimeOperationOpenInput["runtimeConfiguration"]["mode"],
): "default" | "bypassPermissions" | "plan" {
	switch (mode) {
		case "manual":
			return "default";
		case "automate":
			return "bypassPermissions";
		case "plan":
			return "plan";
	}
}

class CodingAgentOperation implements RuntimeOperation {
	readonly #outcome: Promise<ResultType<RuntimeOperationOutcome, RuntimeOperationExecutionFailed>>;
	readonly #listeners = new Set<(event: RuntimeOperationEvent) => void>();
	readonly #reservedAssistantEntryIds: string[] = [];
	readonly #pendingEvents: RuntimeOperationEvent[] = [];
	readonly #terminalSnapshots = new Map<string, string>();
	#stopAgentObservation?: () => void;
	#stopEffectObservation?: () => void;
	#activeAssistant?: { readonly messageId: string; readonly thoughtMessageId: string };
	#closed = false;

	constructor(
		private readonly input: RuntimeOperationOpenInput,
		private readonly agent: CodingAgent,
	) {
		const effectBoundary = operationEffectBoundary(input.effectBoundary);
		if (effectBoundary) {
			this.#stopEffectObservation = effectBoundary.subscribe((event) => {
				if (event.type === "model_reserved") {
					this.#reservedAssistantEntryIds.push(event.assistantEntryId);
					return;
				}
				this.publish({ type: "usage_settled", cost: event.usage.cost.total });
			});
		}
		this.#stopAgentObservation = this.agent.subscribe((event) => this.observe(event));
		this.#outcome = this.advance(input.pendingInputs ?? []);
	}

	abort(): Promise<ResultType<void, RuntimeOperationExecutionFailed>> {
		return this.agent.abort().then((result) => {
			if (result.isOk()) return Result.ok(undefined);
			return Result.err(this.failed("could not be aborted", result.error));
		});
	}

	enqueueInput(input: RuntimeQueuedInput): Promise<ResultType<void, RuntimeOperationExecutionFailed>> {
		const queued =
			input.delivery === "steer"
				? this.agent.steer({ text: input.text, entryId: input.entryId })
				: this.agent.followUp({ text: input.text, entryId: input.entryId });
		return queued.then((result) =>
			result.isOk() ? Result.ok(undefined) : Result.err(this.failed("could not queue input", result.error)),
		);
	}

	awaitOutcome(): Promise<ResultType<RuntimeOperationOutcome, RuntimeOperationExecutionFailed>> {
		return this.#outcome;
	}

	subscribe(listener: (event: RuntimeOperationEvent) => void): () => void {
		const buffered = this.#listeners.size === 0 ? this.#pendingEvents.splice(0) : [];
		this.#listeners.add(listener);
		for (const event of buffered) {
			try {
				listener(event);
			} catch {
				// Host observers are disposable; one broken client must not stop execution.
			}
		}
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#stopAgentObservation?.();
		this.#stopEffectObservation?.();
		this.#listeners.clear();
		this.#pendingEvents.length = 0;
		await this.agent.close();
	}

	private async advance(inputs: readonly RuntimeQueuedInput[]): Promise<ResultType<RuntimeOperationOutcome, RuntimeOperationExecutionFailed>> {
		const result = await this.agent.advance(inputs.map((input) => ({ text: input.text, entryId: input.entryId })));
		if (result.isErr()) return Result.err(this.failed("failed", result.error));
		return Result.ok(resolveOutcome(result.value.messages));
	}

	private failed(message: string, cause: unknown): RuntimeOperationExecutionFailed {
		return new RuntimeOperationExecutionFailed({
			message: `Coding Agent ${message} while executing Operation "${this.input.operationId}"`,
			sessionId: this.input.sessionId,
			operationId: this.input.operationId,
			cause,
		});
	}

	private observe(event: CodingAgentEvent): void {
		switch (event.type) {
			case "message_start":
				if (event.message.role === "assistant") this.startAssistantMessage();
				return;
			case "message_update":
				this.projectAssistantUpdate(event);
				return;
			case "message_end":
				if (event.message.role === "assistant") this.#activeAssistant = undefined;
				return;
			case "message_discard":
				this.clearAssistantMessage();
				return;
			case "tool_execution_start":
				const terminal = terminalForTool(event.toolName, event.toolCallId, event.args, this.input.cwd);
				this.publish({
					type: "tool_started",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					title: event.title,
					kind: acpToolKind(event.activityKind),
					rawInput: jsonObject(event.args),
					...(terminal ? { terminal } : {}),
				});
				return;
			case "tool_execution_update":
				const terminalId = terminalIdForTool(event.toolName, event.toolCallId);
				if (terminalId) {
					for (const content of toolProgressContent(event.partial)) {
						if (content.type === "text") {
							this.projectTerminalSnapshot(terminalId, content.text);
						}
					}
					return;
				}
				for (const content of toolProgressContent(event.partial)) {
					this.publish({ type: "tool_content_chunk", toolCallId: event.toolCallId, content });
				}
				return;
			default:
				return;
		}
	}

	private startAssistantMessage(): void {
		const messageId = this.#reservedAssistantEntryIds.shift();
		if (!messageId) return;
		this.#activeAssistant = { messageId, thoughtMessageId: `${messageId}:thought` };
	}

	private projectAssistantUpdate(event: Extract<CodingAgentEvent, { readonly type: "message_update" }>): void {
		const active = this.#activeAssistant;
		if (!active) return;
		switch (event.assistantEvent.type) {
			case "text_delta":
				this.publish({
					type: "message_chunk",
					messageId: active.messageId,
					channel: "agent",
					text: event.assistantEvent.delta,
				});
				return;
			case "thinking_delta":
				this.publish({
					type: "message_chunk",
					messageId: active.thoughtMessageId,
					channel: "thought",
					text: event.assistantEvent.delta,
				});
				return;
			default:
				return;
		}
	}

	private clearAssistantMessage(): void {
		const active = this.#activeAssistant;
		if (!active) return;
		this.publish({ type: "message_cleared", messageId: active.messageId, channel: "agent" });
		this.publish({ type: "message_cleared", messageId: active.thoughtMessageId, channel: "thought" });
		this.#activeAssistant = undefined;
	}

	private projectTerminalSnapshot(terminalId: string, text: string): void {
		const previous = this.#terminalSnapshots.get(terminalId) ?? "";
		this.#terminalSnapshots.set(terminalId, text);
		if (text.startsWith(previous)) {
			const delta = text.slice(previous.length);
			if (delta) this.publish({ type: "terminal_output_chunk", terminalId, text: delta });
			return;
		}
		this.publish({ type: "terminal_output", terminalId, text });
	}

	private publish(event: RuntimeOperationEvent): void {
		if (this.#listeners.size === 0) {
			this.#pendingEvents.push(event);
			return;
		}
		for (const listener of [...this.#listeners]) {
			try {
				listener(event);
			} catch {
				// The Runtime Host may always rebuild a client from its durable journal.
			}
		}
	}
}

function resolveOutcome(messages: readonly CodingAgentMessage[]): RuntimeOperationOutcome {
	const finalAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	if (!finalAssistant) return "failed";
	if (finalAssistant.stopReason === "aborted") return "aborted";
	if (finalAssistant.stopReason === "error" || finalAssistant.stopReason === "contextOverflow") return "failed";
	return "completed";
}

function operationEffectBoundary(value: RuntimeOperationOpenInput["effectBoundary"]): OperationEffectBoundary | undefined {
	return typeof (value as Partial<OperationEffectBoundary>).subscribe === "function"
		? (value as OperationEffectBoundary)
		: undefined;
}

function acpToolKind(
	activityKind: Extract<CodingAgentEvent, { readonly type: "tool_execution_start" }>["activityKind"],
): "read" | "edit" | "search" | "execute" | "other" {
	switch (activityKind) {
		case "read":
			return "read";
		case "write":
			return "edit";
		case "search":
			return "search";
		case "execute":
			return "execute";
		case "call":
		case "operation":
			return "other";
	}
}

function jsonObject(value: JsonValue): JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function terminalForTool(
	toolName: string,
	toolCallId: string,
	args: JsonValue,
	cwd: string,
): Extract<RuntimeOperationEvent, { readonly type: "tool_started" }>["terminal"] | undefined {
	const terminalId = terminalIdForTool(toolName, toolCallId);
	if (!terminalId) return undefined;
	const command = jsonObject(args).command;
	return typeof command === "string" && command.length > 0 ? { terminalId, command, cwd } : undefined;
}

function terminalIdForTool(toolName: string, toolCallId: string): string | undefined {
	return toolName === "Bash" ? `terminal:${toolCallId}` : undefined;
}

function toolProgressContent(value: JsonValue): readonly Extract<RuntimeOperationEvent, { readonly type: "tool_content_chunk" }>["content"][] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
	const content = value.content;
	if (!Array.isArray(content)) return [];
	const projected: RuntimeOperationContent[] = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
		if (part.type === "text" && typeof part.text === "string") {
			projected.push({ type: "text", text: part.text });
			continue;
		}
		if (part.type === "image" && typeof part.image === "string" && typeof part.mimeType === "string") {
			projected.push({ type: "image", data: part.image, mimeType: part.mimeType });
		}
	}
	return projected;
}
