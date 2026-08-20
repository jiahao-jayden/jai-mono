import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentEvent, AgentMessage } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import type { Model, Provider } from "@jai/ai";
import { Result, type Result as ResultType } from "better-result";
import type { CodingMessageAttachment as InternalCodingAttachment } from "../attachments";
import type { PermissionSettings } from "../permissions";
import {
	createCodingAgent as createInternalCodingAgent,
	DEFAULT_CODING_AGENT_INSTRUCTIONS,
	type CodingAgent as InternalCodingAgent,
} from "../runtime";
import { sdkConfigDefinition } from "./config";
import {
	disposeExtensions,
	extensionAuthorizedToolNames,
	extensionMiddleware,
	extensionPermissions,
	extensionSkills,
	extensionTools,
	initializeExtensions,
} from "./extensions";
import { resolveSdkModel } from "./model";
import {
	agentClosedFailure,
	artifactsFromAppState,
	CodingSdkFailure,
	closedError,
	projectArtifact,
	projectError,
	projectEvent,
	projectJson,
	projectMessages,
	projectPermissionRequest,
	todosFromAppState,
} from "./project";
import { resolveCodingToolSelection } from "./tool-selection";
import type {
	CodingAgent,
	CodingAgentArtifact,
	CodingAgentCreateOptions,
	CodingAgentEvent,
	CodingAgentState,
	CodingPermissionMode,
	CodingPromptOptions,
	CodingRunResult,
	CodingSdkError,
	CodingSessionSelection,
	JsonObject,
} from "./types";

export async function createCodingAgent<TAppState extends JsonObject = JsonObject>(
	input: CodingAgentCreateOptions,
): Promise<ResultType<CodingAgent<TAppState>, CodingSdkError>> {
	let ephemeralDirectory: string | undefined;
	let modelRuntime: { readonly model: Model; readonly provider: Provider } | undefined;
	let extensions: Awaited<ReturnType<typeof initializeExtensions>> = [];
	try {
		const session = input.session ?? { kind: "ephemeral" as const };
		const sessionId = resolveSessionId(session);
		const cwd = input.cwd ?? process.cwd();
		const enabledTools = resolveCodingToolSelection(input.tools, input.excludeTools);
		if (session.kind === "ephemeral") {
			ephemeralDirectory = await mkdtemp(path.join(tmpdir(), "jai-coding-agent-"));
		}
		const sessionDirectory = session.kind === "ephemeral" ? ephemeralDirectory! : session.directory;
		const store = new FileSessionStore<TAppState>(sessionDirectory);
		await validateSessionSelection(session, store, sessionId);
		extensions = await initializeExtensions(
			input.extensions ?? [],
			{ sessionId, cwd, permissionMode: input.permissionMode ?? "default" },
			input.extensionRuntime,
		);
		const internal = await createInternalCodingAgent<CodingSchema, TAppState>({
			executionContext: {
				localFileAccess: true,
				cwd,
				configRoot: sessionDirectory,
				defaultAllowedDirectories: [cwd] as readonly [string, ...string[]],
			},
			sessionId,
			sessionDirectory,
			instructions: [DEFAULT_CODING_AGENT_INSTRUCTIONS, input.instructions].filter(Boolean).join("\n\n"),
			configDefinition: sdkConfigDefinition,
			configOptions: {
				homeDir: sessionDirectory,
				workspaceTrusted: false,
			},
			resolveProvider: () => {
				const runtime = resolveSdkModel(input.model, input.provider);
				modelRuntime = runtime;
				return runtime;
			},
			resolveMcpServers: () => [],
			resolveAgentOptions: () => ({
				...(input.maxTurns === undefined ? {} : { maxIterations: input.maxTurns }),
			}),
			permissions: {
				requestApproval: input.requestApproval
					? (request, signal) => input.requestApproval!(projectPermissionRequest(sessionId, request), signal)
					: undefined,
				selectSettings: (snapshot) => selectPermissionSettings(snapshot.settings.permissions, input.permissionMode),
			},
			extensionTools: extensionTools(extensions),
			extensionToolMiddleware: extensionMiddleware(extensions),
			extensionToolPermissions: extensionPermissions(extensions),
			extensionAuthorizedToolNames: extensionAuthorizedToolNames(extensions),
			extensionSkills: extensionSkills(extensions),
			enabledTools,
			agent: input.compactionSummaryInstructions
				? { compaction: { summaryInstructions: input.compactionSummaryInstructions } }
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
			new PublicCodingAgent<TAppState>(internal, sessionId, modelRuntime, ephemeralDirectory, extensions),
		);
	} catch (error) {
		await disposeExtensions(extensions).catch(() => {});
		if (ephemeralDirectory) await rm(ephemeralDirectory, { recursive: true, force: true }).catch(() => {});
		return Result.err(projectError(error, "runtime_creation"));
	}
}

type CodingSchema = typeof sdkConfigDefinition.schema;

class PublicCodingAgent<TAppState extends JsonObject> implements CodingAgent<TAppState> {
	readonly #internal: InternalCodingAgent<CodingSchema, TAppState>;
	readonly #sessionId: string;
	readonly #model: Model;
	readonly #provider: Provider;
	readonly #ephemeralDirectory?: string;
	readonly #extensions: Awaited<ReturnType<typeof initializeExtensions>>;
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
		modelRuntime: { readonly model: Model; readonly provider: Provider },
		ephemeralDirectory?: string,
		extensions: Awaited<ReturnType<typeof initializeExtensions>> = [],
	) {
		this.#internal = internal;
		this.#sessionId = sessionId;
		this.#model = modelRuntime.model;
		this.#provider = modelRuntime.provider;
		this.#ephemeralDirectory = ephemeralDirectory;
		this.#extensions = extensions;
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

	get state(): CodingAgentState<TAppState> {
		const state = this.#internal.state;
		return {
			sessionId: this.#sessionId,
			status: this.#closed ? "closed" : this.#running ? "running" : state.error ? "aborted" : "idle",
			messages: projectMessages(state.messages),
			todos: todosFromAppState(state.appState),
			artifacts: [...this.#artifacts.values()].sort((left, right) => right.updatedAt - left.updatedAt),
			appState: structuredClone(state.appState) as TAppState,
			...(state.error ? { error: projectJson(state.error) as JsonObject } : {}),
		};
	}

	prompt(
		prompt: string,
		options?: CodingPromptOptions,
	): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>> {
		const run = this.#tail.then(async () => {
			if (this.#closed) throw agentClosedFailure();
			this.#running = true;
			try {
				const messages = options?.attachments?.length
					? await this.#internal.invokeWithAttachments({
							text: prompt,
							attachments: options.attachments as readonly InternalCodingAttachment[],
						})
					: await this.#internal.stream(prompt).result();
				return { sessionId: this.#sessionId, messages: projectMessages(messages), state: this.state };
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

	steer(prompt: string): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(prompt, (message) => this.#internal.steer(message));
	}

	followUp(prompt: string): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(prompt, (message) => this.#internal.followUp(message));
	}

	waitForIdle(): Promise<ResultType<void, CodingSdkError>> {
		return this.#tail
			.then(() => this.#internal.waitForIdle())
			.then(
				() => Result.ok(undefined),
				(error) => Result.err(projectError(error, "lifecycle")),
			);
	}

	async generateTitle(firstMessage: string): Promise<ResultType<string, CodingSdkError>> {
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
							content: `User request:\n${firstMessage.slice(0, 2_000)}\n\nAssistant response:\n${assistantText}`,
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
		let failure: unknown;
		try {
			this.#closed = true;
			this.#internal.abort();
			await this.#tail;
			await this.#internal.waitForIdle();
			await this.#artifactWriteTail;
			this.#stopArtifactProjection();
			this.#internal.close();
			if (this.#ephemeralDirectory) await rm(this.#ephemeralDirectory, { recursive: true, force: true });
		} catch (error) {
			failure = error;
		}
		try {
			await disposeExtensions(this.#extensions);
		} catch (error) {
			failure ??= error;
		}
		return failure ? Result.err(projectError(failure, "lifecycle")) : Result.ok(undefined);
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

	#admit(prompt: string, action: (message: AgentMessage) => void): Promise<ResultType<void, CodingSdkError>> {
		try {
			if (this.#closed) throw agentClosedFailure();
			if (!prompt.trim())
				throw new CodingSdkFailure({
					phase: "admission",
					code: "coding_sdk.empty_prompt",
					message: "Prompt must not be empty",
				});
			action({ role: "user", content: prompt, timestamp: Date.now() });
			return Promise.resolve(Result.ok(undefined));
		} catch (error) {
			return Promise.resolve(Result.err(projectError(error, "admission")));
		}
	}
}

function resolveSessionId(selection: CodingSessionSelection): string {
	if (selection.kind === "resume") return selection.id;
	if (selection.kind === "new" && selection.id) return selection.id;
	return `coding-${randomUUID()}`;
}

async function validateSessionSelection<TAppState extends JsonObject>(
	selection: CodingSessionSelection,
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
	mode?: CodingPermissionMode,
): PermissionSettings {
	return { ...(settings ?? {}), ...(mode ? { defaultMode: mode } : {}) };
}
