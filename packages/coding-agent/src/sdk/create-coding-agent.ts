import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { AgentEvent, AgentMessage } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import type { Model, Provider } from "@jai/ai";
import type { ConnectorService } from "@jai/connector";
import { Result, type Result as ResultType } from "better-result";
import type { CodingMessageAttachment as InternalCodingAttachment } from "../attachments";
import type { ConnectorApprovalRequest as InternalConnectorApprovalRequest } from "../connector";
import type { PermissionSettings } from "../permissions";
import {
	type CodingAgentSettings,
	codingAgentConfigDefinition,
	createCodingAgent as createInternalCodingAgent,
	DEFAULT_CODING_AGENT_INSTRUCTIONS,
	type CodingAgent as InternalCodingAgent,
	resolveConfiguredAgentRuntime,
	resolveConfiguredMcpServers,
} from "../runtime";
import {
	agentClosedFailure,
	artifactsFromAppState,
	CodingSdkFailure,
	closedError,
	projectArtifact,
	projectConnectorApprovalRequest,
	projectError,
	projectEvent,
	projectJson,
	projectPermissionRequest,
	todosFromAppState,
} from "./project";
import type {
	CodingAgent,
	CodingAgentArtifact,
	CodingAgentCreateInput,
	CodingAgentEvent,
	CodingAgentExecutionConfiguration,
	CodingAgentState,
	CodingPrompt,
	CodingRunResult,
	CodingSdkError,
	JsonObject,
	SessionSelection,
} from "./types";

export async function createCodingAgent<TAppState extends JsonObject = JsonObject>(
	input: CodingAgentCreateInput,
): Promise<ResultType<CodingAgent<TAppState>, CodingSdkError>> {
	let ephemeralDirectory: string | undefined;
	let modelRuntime: { readonly model: Model; readonly provider: Provider } | undefined;
	try {
		const execution = input.execution ?? {};
		const sessionId = resolveSessionId(input.session);
		const { approval, capabilitySources, configuration, connector, model: modelAuthority, workspace } = input.host;
		if (input.session.kind === "ephemeral") {
			ephemeralDirectory = await mkdtemp(path.join(tmpdir(), "jai-coding-agent-"));
		}
		const sessionDirectory = ephemeralDirectory ?? input.host.session.directory;
		const store = new FileSessionStore<TAppState>(sessionDirectory);
		await validateSessionSelection(input.session, store, sessionId);
		const internal = await createInternalCodingAgent<CodingSchema, TAppState>({
			executionContext: {
				localFileAccess: workspace.localFileAccess ?? true,
				cwd: workspace.cwd,
				configRoot: workspace.configRoot ?? workspace.cwd,
				defaultAllowedDirectories: (workspace.defaultAllowedDirectories ?? [workspace.cwd]) as readonly [
					string,
					...string[],
				],
			},
			sessionId,
			sessionDirectory,
			instructions: [DEFAULT_CODING_AGENT_INSTRUCTIONS, execution.instructions].filter(Boolean).join("\n\n"),
			configDefinition: codingAgentConfigDefinition,
			configOptions: {
				homeDir: configuration?.homeDirectory ?? homedir(),
				workspaceTrusted: workspace.trusted ?? false,
			},
			resolveProvider: (snapshot) =>
				Promise.resolve(modelAuthority.resolve({ model: execution.model, settings: snapshot.settings })).then(
					(resolved) => {
						const runtime = { model: resolved.model as Model, provider: resolved.provider as Provider };
						modelRuntime = runtime;
						return runtime;
					},
				),
			resolveMcpServers: (snapshot) => resolveConfiguredMcpServers(snapshot.settings as CodingAgentSettings),
			resolveAgentOptions: (snapshot, resolved) => {
				const runtime = resolveConfiguredAgentRuntime(snapshot.settings as CodingAgentSettings, resolved);
				return {
					maxIterations: execution.maxTurns ?? runtime.maxIterations,
					providerOptions: runtime.providerOptions,
				};
			},
			permissions: {
				requestApproval: approval
					? (request, signal) => approval.request(projectPermissionRequest(sessionId, request), signal)
					: undefined,
				selectSettings: (snapshot) =>
					selectPermissionSettings(snapshot.settings.permissions, execution.permissionMode),
			},
			agentPlugins: capabilitySources?.plugins ?? false,
			connector: connector
				? {
						enabled: true,
						resolveClient: () => connector.client as ConnectorService | undefined,
						...(connector.requestApproval
							? {
									requestApproval: (request: InternalConnectorApprovalRequest, signal?: AbortSignal) =>
										connector.requestApproval!(projectConnectorApprovalRequest(request), signal),
								}
							: {}),
					}
				: false,
			agent: execution.compactionSummaryInstructions
				? { compaction: { summaryInstructions: execution.compactionSummaryInstructions } }
				: {},
		});
		if (!modelRuntime) {
			throw new CodingSdkFailure({
				phase: "runtime_creation",
				code: "coding_sdk.model_unavailable",
				message: "Model runtime was not resolved during Agent creation",
			});
		}
		return Result.ok(
			new PublicCodingAgent<TAppState>(internal, sessionId, execution, modelRuntime, ephemeralDirectory),
		);
	} catch (error) {
		if (ephemeralDirectory) await rm(ephemeralDirectory, { recursive: true, force: true }).catch(() => {});
		return Result.err(projectError(error, "runtime_creation"));
	}
}

type CodingSchema = typeof codingAgentConfigDefinition.schema;

class PublicCodingAgent<TAppState extends JsonObject> implements CodingAgent<TAppState> {
	readonly #internal: InternalCodingAgent<CodingSchema, TAppState>;
	readonly #sessionId: string;
	readonly #execution: CodingAgentExecutionConfiguration;
	readonly #model: Model;
	readonly #provider: Provider;
	readonly #ephemeralDirectory?: string;
	readonly #artifacts = new Map<string, CodingAgentArtifact>();
	readonly #pendingArtifacts = new Map<string, CodingAgentArtifact>();
	readonly #listeners = new Set<(event: CodingAgentEvent) => void>();
	readonly #stopArtifactProjection: () => void;
	#closed = false;
	#running = false;
	#tail: Promise<void> = Promise.resolve();
	#artifactWriteTail: Promise<void> = Promise.resolve();

	constructor(
		internal: InternalCodingAgent<CodingSchema, TAppState>,
		sessionId: string,
		execution: CodingAgentExecutionConfiguration,
		modelRuntime: { readonly model: Model; readonly provider: Provider },
		ephemeralDirectory?: string,
	) {
		this.#internal = internal;
		this.#sessionId = sessionId;
		this.#execution = execution;
		this.#model = modelRuntime.model;
		this.#provider = modelRuntime.provider;
		this.#ephemeralDirectory = ephemeralDirectory;
		for (const artifact of artifactsFromAppState(internal.state.appState)) this.#artifacts.set(artifact.id, artifact);
		this.#stopArtifactProjection = this.#internal.subscribe((event) => {
			if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
				this.#observeArtifact(event);
			}
			if (this.#listeners.size === 0) return;
			const projected = projectEvent(event);
			for (const listener of this.#listeners) listener(projected);
		});
	}

	get sessionId(): string {
		return this.#sessionId;
	}

	get execution(): CodingAgentExecutionConfiguration {
		return this.#execution;
	}

	get state(): CodingAgentState<TAppState> {
		const state = this.#internal.state;
		return {
			sessionId: this.#sessionId,
			status: this.#closed ? "closed" : this.#running ? "running" : state.error ? "aborted" : "idle",
			messages: state.messages,
			todos: todosFromAppState(state.appState),
			artifacts: [...this.#artifacts.values()].sort((left, right) => right.updatedAt - left.updatedAt),
			appState: structuredClone(state.appState) as TAppState,
			...(state.error ? { error: projectJson(state.error) as JsonObject } : {}),
		};
	}

	prompt(input: CodingPrompt): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>> {
		const run = this.#tail.then(async () => {
			if (this.#closed) throw agentClosedFailure();
			this.#running = true;
			try {
				const messages = input.attachments?.length
					? await this.#internal.invokeWithAttachments({
							text: input.prompt,
							attachments: input.attachments as readonly InternalCodingAttachment[],
						})
					: await this.#internal.stream(input.prompt).result();
				return { sessionId: this.#sessionId, messages, state: this.state };
			} finally {
				this.#running = false;
			}
		});
		this.#tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run.then(
			(value) => Result.ok<CodingRunResult<TAppState>, CodingSdkError>(value),
			(error) => Result.err<CodingRunResult<TAppState>, CodingSdkError>(projectError(error, "admission")),
		);
	}

	steer(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(input, (message) => this.#internal.steer(message));
	}

	followUp(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(input, (message) => this.#internal.followUp(message));
	}

	waitForIdle(): Promise<ResultType<void, CodingSdkError>> {
		return this.#tail
			.then(() => this.#internal.waitForIdle())
			.then(
				() => Result.ok(undefined),
				(error) => Result.err(projectError(error, "lifecycle")),
			);
	}

	async generateTitle(input: { readonly firstMessage: string }): Promise<ResultType<string, CodingSdkError>> {
		if (this.#closed) return Result.err(closedError());
		try {
			const assistantText = this.state.messages
				.filter((message) => message.role === "assistant")
				.flatMap((message) => message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
				.join("\n")
				.slice(0, 2_000);
			const stream = this.#provider.stream(
				this.#model,
				{
					systemPrompt:
						"Generate a concise session title of at most 8 words. Return only the title, without quotes or punctuation.",
					messages: [
						{
							role: "user",
							content: `User request:\n${input.firstMessage.slice(0, 2_000)}\n\nAssistant response:\n${assistantText}`,
							timestamp: Date.now(),
						},
					],
					tools: [],
				},
				{ temperature: 0, maxTokens: 32 },
			);
			const result = await stream.result();
			if (result.stopReason === "error" || result.stopReason === "aborted") {
				throw new CodingSdkFailure({
					phase: "model",
					code: "coding_sdk.title_generation_failed",
					message: "Session title generation failed",
				});
			}
			return Result.ok(
				result.content
					.flatMap((part) => (part.type === "text" ? [part.text] : []))
					.join("")
					.trim()
					.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""),
			);
		} catch (error) {
			return Result.err(projectError(error, "model"));
		}
	}

	async abort(): Promise<ResultType<void, CodingSdkError>> {
		if (this.#closed) return Result.err(closedError());
		try {
			this.#internal.abort();
			return Result.ok(undefined);
		} catch (error) {
			return Result.err(projectError(error, "lifecycle"));
		}
	}

	subscribe(listener: (event: CodingAgentEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async close(): Promise<ResultType<void, CodingSdkError>> {
		if (this.#closed) return Result.ok(undefined);
		try {
			this.#closed = true;
			this.#internal.abort();
			await this.#tail;
			await this.#internal.waitForIdle();
			await this.#artifactWriteTail;
			this.#stopArtifactProjection();
			this.#internal.close();
			if (this.#ephemeralDirectory) await rm(this.#ephemeralDirectory, { recursive: true, force: true });
			return Result.ok(undefined);
		} catch (error) {
			return Result.err(projectError(error, "lifecycle"));
		}
	}

	#observeArtifact(event: Extract<AgentEvent, { type: "tool_execution_start" | "tool_execution_end" }>): void {
		if (event.type === "tool_execution_start") {
			const artifact = projectArtifact(event.toolName, event.args, event.toolCallId, Date.now());
			if (artifact) this.#pendingArtifacts.set(event.toolCallId, artifact);
			return;
		}
		const artifact = this.#pendingArtifacts.get(event.toolCallId);
		this.#pendingArtifacts.delete(event.toolCallId);
		if (!artifact || event.isError) return;
		const current = this.#artifacts.get(artifact.id);
		if (current && current.updatedAt > artifact.updatedAt) return;
		this.#artifacts.set(artifact.id, artifact);
		const write = this.#artifactWriteTail.then(() =>
			this.#internal.updateAppState(
				(currentState) =>
					({
						...currentState,
						artifacts: { version: 1, items: [...this.#artifacts.values()] },
					}) as TAppState,
			),
		);
		this.#artifactWriteTail = write.catch(() => {});
	}

	#admit(input: CodingPrompt, action: (message: AgentMessage) => void): Promise<ResultType<void, CodingSdkError>> {
		try {
			if (this.#closed) throw agentClosedFailure();
			if (!input.prompt.trim())
				throw new CodingSdkFailure({
					phase: "admission",
					code: "coding_sdk.empty_prompt",
					message: "Prompt must not be empty",
				});
			action({ role: "user", content: input.prompt, timestamp: Date.now() });
			return Promise.resolve(Result.ok(undefined));
		} catch (error) {
			return Promise.resolve(Result.err(projectError(error, "admission")));
		}
	}
}

function resolveSessionId(selection: SessionSelection): string {
	if (selection.kind === "resume") return selection.id;
	if (selection.kind === "new" && selection.id) return selection.id;
	return `coding-${randomUUID()}`;
}

async function validateSessionSelection<TAppState extends JsonObject>(
	selection: SessionSelection,
	store: FileSessionStore<TAppState>,
	sessionId: string,
): Promise<void> {
	const existing = await store.load(sessionId);
	if (selection.kind === "resume" && !existing) {
		throw new CodingSdkFailure({
			phase: "session",
			code: "coding_sdk.session_not_found",
			message: `Session "${sessionId}" was not found`,
		});
	}
	if (selection.kind === "new" && existing) {
		throw new CodingSdkFailure({
			phase: "session",
			code: "coding_sdk.session_exists",
			message: `Session "${sessionId}" already exists`,
		});
	}
}

function selectPermissionSettings(
	settings: PermissionSettings | undefined,
	mode?: CodingAgentExecutionConfiguration["permissionMode"],
): PermissionSettings {
	return { ...(settings ?? {}), ...(mode ? { defaultMode: mode } : {}) };
}
