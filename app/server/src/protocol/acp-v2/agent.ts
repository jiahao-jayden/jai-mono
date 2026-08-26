import { isAbsolute } from "node:path";
import type { ToolFileChange } from "@jai/ai";
import type { AgentMessage, JsonValue, SessionEntry } from "@jai/agent";
import { todosFromAppState, type CodingAgentTodo } from "@jai/coding-agent";
import type { RuntimeOperationContent } from "../../operations";
import type {
	RuntimeApprovalRequest,
	RuntimeSession,
	RuntimeSessionEvent,
	RuntimeSessionSnapshot,
} from "../../runtime";
import type { RuntimeSessionConfigurationChange, RuntimeSessionConfigurationSnapshot } from "../../sessions";
import type {
	AcpV2AgentOptions,
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	AcpJsonRpcResponse,
	AcpOutboundMessage,
	AcpPromptBlock,
	AcpPromptMetadata,
	AcpRequestId,
	AcpV2Agent,
} from "./types";

const ACP_V2 = 2;

export function createAcpV2Agent(
	options: AcpV2AgentOptions,
): AcpV2Agent {
	return new DefaultAcpV2Agent(options);
}

class DefaultAcpV2Agent implements AcpV2Agent {
	readonly #sessions = new Map<string, RuntimeSession>();
	readonly #unsubscribes = new Map<string, () => void>();
	readonly #outbound: AcpJsonRpcNotification[] = [];
	readonly #controllerId = crypto.randomUUID();
	#initialized = false;
	#handling = 0;

	constructor(private readonly options: AcpV2AgentOptions) {}

	async handle(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		this.#handling += 1;
		try {
		let response: readonly AcpOutboundMessage[];
		if (request.jsonrpc !== "2.0") response = this.respondError(request.id, -32600, "Expected JSON-RPC 2.0");
		else if (request.method === "initialize") response = this.initialize(request);
		else if (!this.#initialized) response = this.respondError(request.id, -32002, "ACP connection is not initialized");
		else {
			switch (request.method) {
				case "session/new":
					response = await this.newSession(request);
					break;
				case "session/list":
					response = await this.listSessions(request);
					break;
				case "session/resume":
					response = await this.resumeSession(request);
					break;
				case "session/prompt":
					response = await this.prompt(request);
					break;
				case "session/set_config_option":
					response = await this.setConfigOption(request);
					break;
				case "session/cancel":
					response = await this.cancel(request);
					break;
				case "session/close":
					response = await this.closeSession(request);
					break;
				default:
					response = this.respondError(request.id, -32601, `Unsupported ACP method "${request.method}"`);
			}
		}
		return [...response, ...this.drain()];
		} finally {
			this.#handling -= 1;
		}
	}

	private initialize(request: AcpJsonRpcRequest): readonly AcpOutboundMessage[] {
		const params = objectParams(request.params);
		if (
			!params ||
			typeof params.protocolVersion !== "number" ||
			!isObject(params.capabilities) ||
			!isObject(params.info)
		) {
			return this.respondError(request.id, -32602, "Invalid initialize parameters");
		}
		this.#initialized = true;
		return this.respond(request.id, {
			protocolVersion: ACP_V2,
			capabilities: { session: {} },
			info: this.options.info,
		});
	}

	private async newSession(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		const cwd = params?.cwd;
		const requestedId = params?.sessionId;
		const ephemeral = params?.ephemeral;
		if (
			typeof cwd !== "string" ||
			!isAbsolute(cwd) ||
			(requestedId !== undefined && typeof requestedId !== "string") ||
			(ephemeral !== undefined && typeof ephemeral !== "boolean") ||
			hasMcpServers(params)
		) {
			return this.respondError(
				request.id,
				-32602,
				"session/new requires an absolute cwd, optional boolean ephemeral, and no MCP servers",
			);
		}
		const opened = await this.options.host.openSession({
			kind: "new",
			cwd,
			...(requestedId === undefined ? {} : { id: requestedId }),
			...(ephemeral === true ? { ephemeral: true } : {}),
			controllerId: this.#controllerId,
		});
		if (opened.isErr()) return this.respondError(request.id, -32001, opened.error.message);
		this.attach(opened.value);
		const configuration = await opened.value.configuration();
		if (configuration.isErr()) {
			await opened.value.close();
			this.detach(opened.value.id);
			return this.respondError(request.id, -32001, configuration.error.message);
		}
		return this.respond(request.id, {
			sessionId: opened.value.id,
			...(configOptions(configuration.value).length > 0 ? { configOptions: configOptions(configuration.value) } : {}),
		});
	}

	private async listSessions(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		if (request.params !== undefined && !params)
			return this.respondError(request.id, -32602, "Invalid session/list parameters");
		const cwd = params?.cwd;
		if (cwd !== undefined && (typeof cwd !== "string" || !isAbsolute(cwd))) {
			return this.respondError(request.id, -32602, "session/list cwd must be absolute");
		}
		const listed = await this.options.host.listSessions();
		if (listed.isErr()) return this.respondError(request.id, -32001, listed.error.message);
		const sessions = listed.value
			.filter((session) => cwd === undefined || session.cwd === cwd)
			.map((session) => ({
				sessionId: session.id,
				cwd: session.cwd,
				updatedAt: session.updatedAt,
				...(session.title ? { title: session.title } : {}),
			}));
		return this.respond(request.id, { sessions });
	}

	private async resumeSession(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		const sessionId = params?.sessionId;
		const cwd = params?.cwd;
		if (typeof sessionId !== "string" || typeof cwd !== "string" || !isAbsolute(cwd) || hasMcpServers(params)) {
			return this.respondError(
				request.id,
				-32602,
				"session/resume requires a sessionId, absolute cwd, and no MCP servers",
			);
		}
		const replayFrom = parseReplayFrom(params?.replayFrom);
		if (replayFrom === "invalid") return this.respondError(request.id, -32602, "Invalid session/resume replayFrom");
		const opened = await this.options.host.openSession({
			kind: "resume",
			id: sessionId,
			cwd,
			controllerId: this.#controllerId,
		});
		if (opened.isErr()) return this.respondError(request.id, -32001, opened.error.message);
		this.attach(opened.value);
		const configuration = await opened.value.configuration();
		if (configuration.isErr()) {
			await opened.value.close();
			this.detach(sessionId);
			return this.respondError(request.id, -32001, configuration.error.message);
		}
		const result = configOptions(configuration.value).length > 0 ? { configOptions: configOptions(configuration.value) } : {};
		if (replayFrom === "none") return this.respond(request.id, result);
		const snapshot = await opened.value.snapshot();
		if (snapshot.isErr()) return this.respondError(request.id, -32001, snapshot.error.message);
		// The snapshot is the replay frontier. Any volatile notification queued while
		// attaching is already represented by this durable snapshot, so discard it
		// rather than emitting a duplicate after the response.
		this.drain();
		return [...projectSnapshot(sessionId, snapshot.value), ...this.respond(request.id, result)];
	}

	private async prompt(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		const sessionId = params?.sessionId;
		const prompt = parsePrompt(params?.prompt);
		if (typeof sessionId !== "string" || !prompt)
			return this.respondError(request.id, -32602, "Invalid session/prompt parameters");
		const session = this.#sessions.get(sessionId);
		if (!session)
			return this.respondError(request.id, -32004, `Session "${sessionId}" is not active on this ACP connection`);

		const admission = await session.prompt({ text: promptText(prompt), metadata: promptMetadata(prompt) });
		if (admission.isErr()) return this.respondError(request.id, -32001, admission.error.message);

		return this.respond(request.id, {});
	}

	private async setConfigOption(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		const sessionId = params?.sessionId;
		const configuration = parseConfigurationChange(params);
		if (typeof sessionId !== "string" || !configuration) {
			return this.respondError(request.id, -32602, "Invalid session/set_config_option parameters");
		}
		const session = this.#sessions.get(sessionId);
		if (!session) {
			return this.respondError(request.id, -32004, `Session "${sessionId}" is not active on this ACP connection`);
		}
		const available = await session.configuration();
		if (available.isErr()) return this.respondError(request.id, -32001, available.error.message);
		if (configOptions(available.value).length === 0) {
			return this.respondError(request.id, -32602, "Session configuration options are unavailable");
		}
		const updated = await session.setConfiguration(configuration);
		if (updated.isErr()) return this.respondError(request.id, -32001, updated.error.message);
		return this.respond(request.id, { configOptions: configOptions(updated.value) });
	}

	private async cancel(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		if (request.id !== undefined) {
			return this.respondError(request.id, -32600, "session/cancel must be sent as an ACP notification");
		}
		const params = objectParams(request.params);
		const sessionId = params?.sessionId;
		if (typeof sessionId !== "string")
			return this.respondError(request.id, -32602, "session/cancel requires a sessionId");
		const session = this.#sessions.get(sessionId);
		if (!session)
			return this.respondError(request.id, -32004, `Session "${sessionId}" is not active on this ACP connection`);
		const cancelled = await session.cancel();
		if (cancelled.isErr()) return this.respondError(request.id, -32001, cancelled.error.message);
		return [];
	}

	private async closeSession(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]> {
		const params = objectParams(request.params);
		const sessionId = params?.sessionId;
		if (typeof sessionId !== "string")
			return this.respondError(request.id, -32602, "session/close requires a sessionId");
		const session = this.#sessions.get(sessionId);
		if (session) {
			await session.cancel();
			await session.close();
		}
		this.detach(sessionId);
		return this.respond(request.id, {});
	}

	async close(): Promise<void> {
		const sessions = [...this.#sessions.values()];
		const unsubscribes = [...this.#unsubscribes.values()];
		this.#sessions.clear();
		this.#unsubscribes.clear();
		for (const unsubscribe of unsubscribes) unsubscribe();
		await Promise.all(sessions.map((session) => session.close()));
	}

	drain(): readonly AcpJsonRpcNotification[] {
		return this.#outbound.splice(0, this.#outbound.length);
	}

	private attach(session: RuntimeSession): void {
		this.detach(session.id);
		this.#sessions.set(session.id, session);
		this.#unsubscribes.set(
			session.id,
			session.subscribe((event) => {
				if (event.type === "approval_requested") {
					void this.requestPermission(session, event.request);
					return;
				}
				if (event.type === "configuration_changed") {
					this.publishNotification(configOptionUpdate(session.id, event.configuration));
					return;
				}
				for (const notification of projectRuntimeEvent(session.id, event)) this.publishNotification(notification);
			}),
		);
	}

	private async requestPermission(session: RuntimeSession, request: RuntimeApprovalRequest): Promise<void> {
		let decision: "deny" | "allowOnce" | "alwaysAllow" = "deny";
		try {
			const response = await this.options.clientRequestSink?.request(
				"session/request_permission",
				projectPermissionRequest(session.id, request),
			);
			decision = permissionDecision(response, request.canAlwaysAllow);
		} catch {
			// The ACP connection is an interaction channel, never an authorization source.
			// Its failure becomes an explicit denial at the canonical SDK permission evaluator.
		}
		await session.respondToApproval({ requestId: request.requestId, decision });
	}

	private detach(sessionId: string): void {
		this.#unsubscribes.get(sessionId)?.();
		this.#unsubscribes.delete(sessionId);
		this.#sessions.delete(sessionId);
	}

	private publishNotification(notification: AcpJsonRpcNotification): void {
		if (this.#handling === 0 && this.options.notificationSink) {
			try {
				this.options.notificationSink(notification);
				return;
			} catch {
				// A dead transport is isolated from the Runtime Host and can reconnect/replay.
			}
		}
		this.#outbound.push(notification);
	}

	private respond(id: AcpRequestId | undefined, result: unknown): readonly AcpOutboundMessage[] {
		if (id === undefined) return [];
		return [{ jsonrpc: "2.0", id, result } satisfies AcpJsonRpcResponse];
	}

	private respondError(id: AcpRequestId | undefined, code: number, message: string): readonly AcpOutboundMessage[] {
		if (id === undefined) return [];
		return [{ jsonrpc: "2.0", id, error: { code, message } } satisfies AcpJsonRpcResponse];
	}
}

function objectParams(value: unknown): Record<string, unknown> | undefined {
	return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMcpServers(params: Record<string, unknown> | undefined): boolean {
	const mcpServers = params?.mcpServers;
	return Array.isArray(mcpServers) && mcpServers.length > 0;
}

function parsePrompt(value: unknown): readonly AcpPromptBlock[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const blocks: AcpPromptBlock[] = [];
	for (const block of value) {
		if (!isObject(block) || typeof block.type !== "string") return undefined;
		switch (block.type) {
			case "text":
				if (typeof block.text !== "string") return undefined;
				blocks.push({ type: "text", text: block.text });
				break;
			case "resource_link":
				if (typeof block.uri !== "string") return undefined;
				if (block.name !== undefined && typeof block.name !== "string") return undefined;
				if (block.title !== undefined && block.title !== null && typeof block.title !== "string") return undefined;
				blocks.push({
					type: "resource_link",
					uri: block.uri,
					...(typeof block.name === "string" ? { name: block.name } : {}),
					...(typeof block.title === "string" || block.title === null ? { title: block.title } : {}),
				});
				break;
			default:
				return undefined;
		}
	}
	return blocks;
}

function promptText(prompt: readonly AcpPromptBlock[]): string {
	return prompt
		.map((block) =>
			block.type === "text"
				? block.text
				: `[Resource link: ${block.name ?? block.title ?? block.uri}](${block.uri})`,
		)
		.join("\n");
}

function promptMetadata(prompt: readonly AcpPromptBlock[]): AcpPromptMetadata {
	return {
		acpV2Prompt: prompt.map((block) => ({ ...block })),
	};
}

function parseReplayFrom(value: unknown): "none" | "start" | "invalid" {
	if (value === undefined || value === null) return "none";
	if (!isObject(value) || value.type !== "start") return "invalid";
	return "start";
}

function parseConfigurationChange(value: Record<string, unknown> | undefined): RuntimeSessionConfigurationChange | undefined {
	if (!value || value.type !== "id" || typeof value.value !== "string") return undefined;
	if (value.configId === "model") return { configId: "model", value: value.value };
	if (value.configId === "mode") {
		return value.value === "manual" || value.value === "automate" || value.value === "plan"
			? { configId: "mode", value: value.value }
			: undefined;
	}
	return undefined;
}

function configOptions(snapshot: RuntimeSessionConfigurationSnapshot): readonly object[] {
	const models = [...snapshot.models];
	if (snapshot.configuration.model && !models.some((model) => model.value === snapshot.configuration.model)) {
		models.push({
			value: snapshot.configuration.model,
			name: snapshot.configuration.model,
			description: "This model is no longer available in the current Runtime Host configuration.",
		});
	}
	if (models.length === 0) return [];
	return [
		{
			configId: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: snapshot.configuration.model,
			options: models.map((model) => ({
				value: model.value,
				name: model.name,
				...(model.description ? { description: model.description } : {}),
			})),
		},
		{
			configId: "mode",
			name: "Session Mode",
			description: "Controls how the Agent requests permission.",
			category: "mode",
			type: "select",
			currentValue: snapshot.configuration.mode,
			options: [
				{ value: "manual", name: "Ask", description: "Request permission before making changes." },
				{ value: "automate", name: "Auto", description: "Use the configured autonomous permission policy." },
				{ value: "plan", name: "Plan", description: "Plan changes without making workspace modifications." },
			],
		},
	];
}

function configOptionUpdate(
	sessionId: string,
	configuration: RuntimeSessionConfigurationSnapshot,
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: { sessionUpdate: "config_option_update", configOptions: configOptions(configuration) },
		},
	};
}

function projectSnapshot(sessionId: string, snapshot: RuntimeSessionSnapshot): readonly AcpJsonRpcNotification[] {
	return [
		...snapshot.entries.flatMap((entry) => projectEntry(sessionId, entry)),
		...(snapshot.usage.cost === 0 ? [] : [usageUpdate(sessionId, snapshot.usage.cost)]),
		stateUpdate(sessionId, snapshot.state, snapshot.stopReason),
	];
}

function projectRuntimeEvent(sessionId: string, event: RuntimeSessionEvent): readonly AcpJsonRpcNotification[] {
	switch (event.type) {
		case "entry_appended":
			return projectEntry(sessionId, event.entry);
		case "usage_changed":
			return [usageUpdate(sessionId, event.cost)];
		case "operation_event":
			return projectOperationEvent(sessionId, event.event);
		case "state_changed":
			return [stateUpdate(sessionId, event.state, event.stopReason)];
		case "configuration_changed":
			return [configOptionUpdate(sessionId, event.configuration)];
		case "approval_requested":
			return [];
	}
}

function projectPermissionRequest(sessionId: string, request: RuntimeApprovalRequest): object {
	return {
		sessionId,
		title: request.title,
		...(request.description ? { description: request.description } : {}),
		subject: {
			type: "tool_call",
			toolCall: {
				toolCallId: request.toolCallId,
				title: request.toolName,
				kind: "other",
				status: "pending",
			},
		},
		options: [
			{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
			...(request.canAlwaysAllow
				? [{ optionId: "allow-always", name: "Always allow", kind: "allow_always" }]
				: []),
			{ optionId: "reject", name: "Deny", kind: "reject_once" },
		],
	};
}

function permissionDecision(response: unknown, canAlwaysAllow: boolean): "deny" | "allowOnce" | "alwaysAllow" {
	if (!isObject(response) || !isObject(response.outcome) || response.outcome.outcome !== "selected") return "deny";
	switch (response.outcome.optionId) {
		case "allow-once":
			return "allowOnce";
		case "allow-always":
			return canAlwaysAllow ? "alwaysAllow" : "deny";
		default:
			return "deny";
	}
}

function projectEntry(sessionId: string, entry: SessionEntry): readonly AcpJsonRpcNotification[] {
	if (entry.type === "app_state") {
		return Object.hasOwn(entry.value, "todos") ? [planUpdate(sessionId, todosFromAppState(entry.value))] : [];
	}
	if (entry.type !== "message") return [];
	switch (entry.message.role) {
		case "user":
			return [userMessageUpdate(sessionId, entry.id, userPrompt(entry.message))];
		case "assistant": {
			const content = agentMessageContent(entry.message);
			return [
				...(content.length > 0 ? [agentMessageUpdate(sessionId, entry.id, content)] : []),
				...agentThoughtUpdate(sessionId, entry.id, entry.message),
				...toolCallsFromAssistant(sessionId, entry.message),
			];
		}
		case "toolResult":
			return toolResultUpdate(sessionId, entry.message);
	}
}

function userPrompt(message: Extract<AgentMessage, { readonly role: "user" }>): readonly AcpPromptBlock[] {
	const original = message.metadata?.acpV2Prompt;
	if (Array.isArray(original)) {
		const parsed = parsePrompt(original);
		if (parsed) return parsed;
	}
	if (typeof message.content === "string") return [{ type: "text", text: message.content }];
	return message.content.flatMap((part) =>
		part.type === "text" ? [{ type: "text", text: part.text } satisfies AcpPromptBlock] : [],
	);
}

function agentMessageUpdate(
	sessionId: string,
	messageId: string,
	content: readonly AcpPromptBlock[],
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: {
				sessionUpdate: "agent_message",
				messageId,
				content,
			},
		},
	};
}

function agentMessageContent(message: Extract<AgentMessage, { readonly role: "assistant" }>): readonly AcpPromptBlock[] {
	return message.content.flatMap((part) =>
		part.type === "text" ? [{ type: "text", text: part.text } satisfies AcpPromptBlock] : [],
	);
}

function agentThoughtUpdate(
	sessionId: string,
	messageId: string,
	message: Extract<AgentMessage, { readonly role: "assistant" }>,
): readonly AcpJsonRpcNotification[] {
	const content = message.content.flatMap((part) =>
		part.type === "thinking" ? [{ type: "text", text: part.thinking } satisfies AcpPromptBlock] : [],
	);
	if (content.length === 0) return [];
	return [
		{
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId,
				update: { sessionUpdate: "agent_thought", messageId: `${messageId}:thought`, content },
			},
		},
	];
}

function toolCallsFromAssistant(
	sessionId: string,
	message: Extract<AgentMessage, { readonly role: "assistant" }>,
): readonly AcpJsonRpcNotification[] {
	return message.content.flatMap((part) => {
		if (part.type !== "toolCall") return [];
		return [
			toolCallUpdate(sessionId, {
				toolCallId: part.id,
				title: part.name,
				kind: "other",
				status: "pending",
				rawInput: jsonObject(part.arguments),
			}),
		];
	});
}

function toolResultUpdate(
	sessionId: string,
	message: Extract<AgentMessage, { readonly role: "toolResult" }>,
): readonly AcpJsonRpcNotification[] {
	const content: object[] = [];
	for (const part of message.content) {
		if (part.type === "text") {
			content.push({ type: "content", content: { type: "text", text: part.text } });
		} else {
			content.push({ type: "content", content: { type: "image", data: part.image, mimeType: part.mimeType } });
		}
	}
	const diff = diffContent(message.fileChanges);
	if (diff) content.push(diff);
	const terminalId = terminalIdForTool(message.toolName, message.toolCallId);
	if (terminalId) content.push(terminalReference(terminalId));
	const updates = [toolCallUpdate(sessionId, {
		toolCallId: message.toolCallId,
		status: message.isError ? "failed" : "completed",
		content,
	})];
	// The result Session entry is T2. Only now may ACP learn that the display
	// terminal has exited; live output before this point is explicitly volatile.
	if (terminalId) updates.push(terminalUpdate(sessionId, { terminalId, exitStatus: {} }));
	return updates;
}

function projectOperationEvent(
	sessionId: string,
	event: Extract<RuntimeSessionEvent, { readonly type: "operation_event" }>["event"],
): readonly AcpJsonRpcNotification[] {
	switch (event.type) {
		case "usage_settled":
			// RuntimeSession converts this durable ledger signal into `usage_changed`.
			return [];
		case "message_chunk":
			return [messageChunkUpdate(sessionId, event.messageId, event.channel, { type: "text", text: event.text })];
		case "message_cleared":
			return [messageClearUpdate(sessionId, event.messageId, event.channel)];
		case "tool_started":
			const updates = [
				toolCallUpdate(sessionId, {
					toolCallId: event.toolCallId,
					title: event.title,
					kind: event.kind,
					status: "in_progress",
					rawInput: event.rawInput,
					...(event.terminal ? { content: [terminalReference(event.terminal.terminalId)] } : {}),
				}),
			];
			if (event.terminal) {
				updates.push(
					terminalUpdate(sessionId, {
						terminalId: event.terminal.terminalId,
						command: event.terminal.command,
						cwd: event.terminal.cwd,
					}),
				);
			}
			return updates;
		case "tool_content_chunk":
			return [
				{
					jsonrpc: "2.0",
					method: "session/update",
					params: {
						sessionId,
						update: {
							sessionUpdate: "tool_call_content_chunk",
							toolCallId: event.toolCallId,
							content: { type: "content", content: operationContent(event.content) },
						},
					},
				},
			];
		case "terminal_output_chunk":
			return [terminalOutputChunk(sessionId, event.terminalId, event.text)];
		case "terminal_output":
			return [
				terminalUpdate(sessionId, {
					terminalId: event.terminalId,
					output: { data: Buffer.from(event.text, "utf8").toString("base64") },
				}),
			];
	}
}

function messageChunkUpdate(
	sessionId: string,
	messageId: string,
	channel: "agent" | "thought",
	content: AcpPromptBlock,
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: {
				sessionUpdate: channel === "agent" ? "agent_message_chunk" : "agent_thought_chunk",
				messageId,
				content,
			},
		},
	};
}

function messageClearUpdate(
	sessionId: string,
	messageId: string,
	channel: "agent" | "thought",
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: {
				sessionUpdate: channel === "agent" ? "agent_message" : "agent_thought",
				messageId,
				content: null,
			},
		},
	};
}

function toolCallUpdate(
	sessionId: string,
	update: {
		readonly toolCallId: string;
		readonly title?: string;
		readonly kind?: "read" | "edit" | "search" | "execute" | "other";
		readonly status?: "pending" | "in_progress" | "completed" | "failed";
		readonly rawInput?: Readonly<Record<string, JsonValue>>;
		readonly content?: readonly object[];
	},
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId, update: { sessionUpdate: "tool_call_update", ...update } },
	};
}

function terminalIdForTool(toolName: string, toolCallId: string): string | undefined {
	return toolName === "Bash" ? `terminal:${toolCallId}` : undefined;
}

function terminalReference(terminalId: string): object {
	return { type: "terminal", terminalId };
}

/**
 * ACP requires absolute paths and treats structured changes as authoritative.
 * A Session Journal may contain tool results from arbitrary SDK tools, so this
 * projection keeps the ACP surface to the narrow, durable file-change allowlist.
 */
function diffContent(fileChanges: readonly ToolFileChange[] | undefined): object | undefined {
	if (!fileChanges) return undefined;
	const changes = fileChanges.flatMap((change) => {
		if (!isAbsolute(change.path)) return [];
		switch (change.operation) {
			case "add":
			case "modify":
			case "delete":
				return [{ operation: change.operation, path: change.path }];
		}
		return [];
	});
	return changes.length > 0 ? { type: "diff", changes } : undefined;
}

function terminalUpdate(
	sessionId: string,
	update: {
		readonly terminalId: string;
		readonly command?: string;
		readonly cwd?: string;
		readonly exitStatus?: object;
		readonly output?: object;
	},
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId, update: { sessionUpdate: "terminal_update", ...update } },
	};
}

function terminalOutputChunk(sessionId: string, terminalId: string, text: string): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: {
				sessionUpdate: "terminal_output_chunk",
				terminalId,
				data: Buffer.from(text, "utf8").toString("base64"),
			},
		},
	};
}

function operationContent(content: RuntimeOperationContent): object {
	return content.type === "text"
		? { type: "text", text: content.text }
		: { type: "image", data: content.data, mimeType: content.mimeType };
}

function jsonObject(value: unknown): Readonly<Record<string, JsonValue>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	const projected: Record<string, JsonValue> = {};
	for (const [key, candidate] of Object.entries(value)) {
		const json = jsonValue(candidate);
		if (json !== undefined) projected[key] = json;
	}
	return projected;
}

function jsonValue(value: unknown): JsonValue | undefined {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		const items: JsonValue[] = [];
		for (const item of value) {
			const json = jsonValue(item);
			if (json === undefined) return undefined;
			items.push(json);
		}
		return items;
	}
	if (typeof value === "object") return jsonObject(value);
	return undefined;
}

function userMessageUpdate(
	sessionId: string,
	messageId: string,
	content: readonly AcpPromptBlock[],
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId, update: { sessionUpdate: "user_message", messageId, content } },
	};
}

function stateUpdate(
	sessionId: string,
	state: "running" | "requires_action" | "idle",
	stopReason?: "end_turn" | "cancelled" | "error",
): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: { sessionUpdate: "state_update", state, ...(stopReason ? { stopReason } : {}) },
		},
	};
}

function usageUpdate(sessionId: string, cost: number): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: { sessionId, update: { sessionUpdate: "usage_update", cost } },
	};
}

function planUpdate(sessionId: string, todos: readonly CodingAgentTodo[]): AcpJsonRpcNotification {
	return {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId,
			update: {
				sessionUpdate: "plan_update",
				plan: {
					planId: "todos",
					entries: todos.map((todo) => ({ content: todo.content, status: todo.status })),
				},
			},
		},
	};
}
