import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentEvent,
  type AgentMessage,
  InMemorySessionStore,
  type SessionStore,
} from "@jai/agent";
import type { Model, Provider } from "@jai/ai";
import { Result, type Result as ResultType } from "better-result";
import type { CodingMessageAttachment as InternalCodingAttachment } from "../attachments";
import type { PermissionSettings } from "../permissions";
import {
  createCodingAgent as createInternalCodingAgent,
  DEFAULT_CODING_AGENT_INSTRUCTIONS,
  type CodingAgent as InternalCodingAgent,
} from "../runtime";
import { ToolCatalog } from "../runtime/tool-catalog";
import { sdkConfigDefinition } from "./config";
import { CodingExtensionPolicyBlocked } from "./extension-errors";
import {
  activateExtensions,
  type CodingTurnEndInput,
  disposeExtensions,
  extensionAuthorizedToolNames,
  extensionBeforeAgentStart,
  extensionBeforeModelCall,
  extensionCatalogTools,
  extensionMiddleware,
  extensionPermissions,
  extensionSkills,
  extensionToolPresentations,
  extensionTools,
  type InitializedExtension,
  notifyExtensionSettled,
  notifyExtensionTurnEnd,
  notifyExtensionTurnStart,
  prepareExtensions,
} from "./extensions";
import { resolveSdkModel } from "./model";
import {
  agentClosedFailure,
  artifactsFromAppState,
  CodingEventProjector,
  CodingSdkFailure,
  closedError,
  projectArtifact,
  projectError,
  projectJson,
  projectMessages,
  projectPermissionRequest,
  todosFromAppState,
} from "./project";
import {
  type CodingSchema,
  createExtensionSessionStateAdapter,
  emptyPersistedCodingSessionState,
  type PersistedCodingSessionState,
} from "./session-state";
import { builtInToolPresentations } from "./tool-presentation";
import { resolveCodingToolSelection } from "./tool-selection";
import type {
  CodingAgent,
  CodingAgentArtifact,
  CodingAgentCreateOptions,
  CodingAgentEvent,
  CodingAgentState,
  CodingPermissionMode,
  CodingPromptOptions,
  CodingQueuedInput,
  CodingRunResult,
  CodingSdkError,
  CodingSessionSelection,
  JsonObject,
  JsonValue,
} from "./types";

export async function createCodingAgent<
  TAppState extends JsonObject = JsonObject,
>(
  input: CodingAgentCreateOptions,
): Promise<ResultType<CodingAgent<TAppState>, CodingSdkError>> {
  let ephemeralDirectory: string | undefined;
  let modelRuntime:
    | { readonly model: Model; readonly provider: Provider }
    | undefined;
  let extensions: readonly InitializedExtension[] = [];
  try {
    const session = input.session ?? { kind: "ephemeral" as const };
    const sessionId = resolveSessionId(session);
    const cwd = input.cwd ?? process.cwd();
    const enabledTools = resolveCodingToolSelection(
      input.tools,
      input.excludeTools,
    );
    if (session.kind === "ephemeral") {
      ephemeralDirectory = await mkdtemp(
        path.join(tmpdir(), "jai-coding-agent-"),
      );
    }
    const agentDataRoot =
      session.kind === "ephemeral"
        ? ephemeralDirectory!
        : (input.agentDataRoot ?? cwd);
    const store: SessionStore<PersistedCodingSessionState<TAppState>> =
      session.kind === "ephemeral"
        ? new InMemorySessionStore<PersistedCodingSessionState<TAppState>>()
        : (session.store as SessionStore<
            PersistedCodingSessionState<TAppState>
          >);
    await validateSessionSelection(session, store, sessionId);
    const preparedExtensions = prepareExtensions(input.extensions ?? []);
    if (preparedExtensions.isErr()) throw preparedExtensions.error;
    extensions = preparedExtensions.value;
    const extensionToolPermissions = extensionPermissions(extensions);
    const extensionAuthorizedToolNameSet =
      extensionAuthorizedToolNames(extensions);
    const internal = await createInternalCodingAgent<
      CodingSchema,
      PersistedCodingSessionState<TAppState>
    >({
      executionContext: {
        localFileAccess: true,
        cwd,
        configRoot: agentDataRoot,
        defaultAllowedDirectories: [cwd] as readonly [string, ...string[]],
      },
      sessionId,
      sessionStore: store,
      appState: emptyPersistedCodingSessionState<TAppState>(),
      instructions: [DEFAULT_CODING_AGENT_INSTRUCTIONS, input.instructions]
        .filter(Boolean)
        .join("\n\n"),
      configDefinition: sdkConfigDefinition,
      configOptions: {
        homeDir: agentDataRoot,
        workspaceTrusted: false,
      },
      resolveProvider: () => {
        const runtime = resolveSdkModel(input.model, input.provider);
        modelRuntime = runtime;
        return runtime;
      },
      resolveMcpServers: () => [],
      resolveAgentOptions: () => ({
        ...(input.maxTurns === undefined
          ? {}
          : { maxIterations: input.maxTurns }),
        ...(input.providerOptions === undefined
          ? {}
          : { providerOptions: input.providerOptions }),
        ...(input.effectBoundary
          ? { effectBoundary: input.effectBoundary }
          : {}),
      }),
      permissions: {
        requestApproval: input.requestApproval
          ? (request, signal) =>
              input.requestApproval!(
                projectPermissionRequest(sessionId, request),
                signal,
              )
          : undefined,
        selectSettings: (snapshot) =>
          selectPermissionSettings(
            snapshot.settings.permissions,
            input.permissionMode,
          ),
      },
      extensionTools: extensionTools(extensions),
      extensionBeforeModelCall: async (messages) => {
        await notifyExtensionTurnStart(extensions);
        const transformed = await extensionBeforeModelCall(
          extensions,
          messages,
        );
        // The internal Agent hook cannot return Result, so this is the adapter seam that rethrows it.
        if (transformed.isErr()) throw transformed.error;
        return transformed.value;
      },
      extensionToolMiddleware: extensionMiddleware(extensions),
      extensionToolPermissions,
      extensionAuthorizedToolNames: extensionAuthorizedToolNameSet,
      extensionSkills: extensionSkills(extensions),
      enabledTools,
      agent: input.compactionSummaryInstructions
        ? {
            compaction: {
              summaryInstructions: input.compactionSummaryInstructions,
            },
          }
        : {},
    });
    const activatedExtensions = await activateExtensions(
      extensions,
      { sessionId, cwd, permissionMode: input.permissionMode ?? "default" },
      input.extensionRuntime,
      createExtensionSessionStateAdapter(internal),
      {
        permissions: extensionToolPermissions,
        authorizedToolNames: extensionAuthorizedToolNameSet,
      },
    );
    if (activatedExtensions.isErr()) throw activatedExtensions.error;
    const catalogTools = extensionCatalogTools(extensions);
    if (catalogTools.length > 0)
      internal.setExtensionToolCatalog(new ToolCatalog(catalogTools));
    if (!modelRuntime) {
      throw new CodingSdkFailure({
        phase: "runtime_creation",
        code: "coding_sdk.model_unavailable",
        message: "Model runtime was not resolved during Agent creation",
      });
    }
    return Result.ok(
      new PublicCodingAgent<TAppState>(
        internal,
        sessionId,
        modelRuntime,
        ephemeralDirectory,
        extensions,
        new Map([
          ...builtInToolPresentations(),
          ...extensionToolPresentations(extensions),
        ]),
      ),
    );
  } catch (error) {
    await disposeExtensions(extensions).catch(() => {});
    if (ephemeralDirectory)
      await rm(ephemeralDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
    return Result.err(projectError(error, "runtime_creation"));
  }
}

class PublicCodingAgent<
  TAppState extends JsonObject,
> implements CodingAgent<TAppState> {
  readonly #internal: InternalCodingAgent<
    CodingSchema,
    PersistedCodingSessionState<TAppState>
  >;
  readonly #sessionId: string;
  readonly #model: Model;
  readonly #provider: Provider;
  readonly #ephemeralDirectory?: string;
  readonly #extensions: readonly InitializedExtension[];
  readonly #artifacts = new Map<string, CodingAgentArtifact>();
  readonly #pendingArtifacts = new Map<string, CodingAgentArtifact>();
  readonly #listeners = new Set<(event: CodingAgentEvent) => void>();
  readonly #stopArtifactProjection: () => void;
  readonly #eventProjector: CodingEventProjector;
  #closed = false;
  #running = false;
  #tail: Promise<void> = Promise.resolve();
  #settlementTail: Promise<void> = Promise.resolve();
  #admissionEpoch = 0;
  #artifactWriteTail: Promise<void> = Promise.resolve();

  constructor(
    internal: InternalCodingAgent<
      CodingSchema,
      PersistedCodingSessionState<TAppState>
    >,
    sessionId: string,
    modelRuntime: { readonly model: Model; readonly provider: Provider },
    ephemeralDirectory?: string,
    extensions: readonly InitializedExtension[] = [],
    toolPresentations = builtInToolPresentations(),
  ) {
    this.#internal = internal;
    this.#sessionId = sessionId;
    this.#model = modelRuntime.model;
    this.#provider = modelRuntime.provider;
    this.#ephemeralDirectory = ephemeralDirectory;
    this.#extensions = extensions;
    this.#eventProjector = new CodingEventProjector(toolPresentations);
    for (const artifact of artifactsFromAppState(internal.state.appState)) {
      this.#artifacts.set(artifact.id, artifact);
    }
    this.#stopArtifactProjection = this.#internal.subscribe(async (event) => {
      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_end"
      ) {
        this.#observeArtifact(event);
      }
      if (event.type === "turn_end") {
        const outcome = extensionOutcome(event.message.stopReason);
        await notifyExtensionTurnEnd(this.#extensions, { outcome });
      }
      const projected = this.#eventProjector.project(event);
      if (this.#listeners.size === 0) return;
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
      status: this.#closed
        ? "closed"
        : this.#running
          ? "running"
          : state.error
            ? "aborted"
            : "idle",
      messages: projectMessages(state.messages),
      todos: todosFromAppState(state.appState),
      artifacts: [...this.#artifacts.values()].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
      appState: structuredClone(state.appState.appState) as TAppState,
      ...(state.error ? { error: projectJson(state.error) as JsonObject } : {}),
    };
  }

  prompt(
    prompt: string,
    options?: CodingPromptOptions,
  ): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>> {
    // Captured outside the run so a rejected execution can still be settled. Stays undefined when
    // the prompt never passed admission, where there is no run to settle.
    let admittedEpoch: number | undefined;
    const run = this.#tail.then(async () => {
      if (this.#closed) throw agentClosedFailure();
      if (!prompt.trim()) {
        throw new CodingSdkFailure({
          phase: "admission",
          code: "coding_sdk.empty_prompt",
          message: "Prompt must not be empty",
        });
      }
      const admission = await extensionBeforeAgentStart(
        this.#extensions,
        prompt,
      );
      if (admission.isErr()) throw admission.error;
      if (admission.value) {
        throw new CodingExtensionPolicyBlocked({
          extensionId: admission.value.extensionId,
          reason: admission.value.reason,
          message: admission.value.reason,
        });
      }
      const admissionEpoch = ++this.#admissionEpoch;
      admittedEpoch = admissionEpoch;
      this.#running = true;
      try {
        const messages = options?.attachments?.length
          ? await this.#internal.invokeWithAttachments({
              text: prompt,
              attachments:
                options.attachments as readonly InternalCodingAttachment[],
            })
          : await this.#internal.stream(prompt).result();
        return {
          result: {
            sessionId: this.#sessionId,
            messages: projectMessages(messages),
            state: this.state,
          },
          outcome: extensionOutcomeFromMessages(messages),
          admissionEpoch,
        };
      } finally {
        this.#running = false;
      }
    });
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    const settlement = this.#settlementTail.then(() =>
      run.then(
        ({ outcome, admissionEpoch }) =>
          this.#notifySettledAfterIdle(admissionEpoch, outcome),
        // A rejected run still settles: Extensions that release locks or flush telemetry in
        // `agentSettled` need the signal most when the run failed. A prompt rejected before
        // admission never started a run, so there is nothing to settle.
        () =>
          admittedEpoch === undefined
            ? undefined
            : this.#notifySettledAfterIdle(admittedEpoch, "failed"),
      ),
    );
    this.#settlementTail = settlement.then(
      () => undefined,
      () => undefined,
    );
    return run.then(
      (value) =>
        Result.ok<CodingRunResult<TAppState>, CodingSdkError>(value.result),
      // Failures after admission come from the model/tool loop, not from admission itself, and must
      // keep their retryable classification (a provider 429 is retryable; an empty prompt is not).
      (error) =>
        Result.err<CodingRunResult<TAppState>, CodingSdkError>(
          projectError(
            error,
            admittedEpoch === undefined ? "admission" : "model",
          ),
        ),
    );
  }

  advance(
    inputs: readonly CodingQueuedInput[] = [],
  ): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>> {
    let admittedEpoch: number | undefined;
    const run = this.#tail.then(async () => {
      if (this.#closed) throw agentClosedFailure();
      const admissionEpoch = ++this.#admissionEpoch;
      admittedEpoch = admissionEpoch;
      this.#running = true;
      try {
        const messages = await this.#internal.advance(
          inputs.map((input) => ({
            message: {
              role: "user",
              content: input.text,
              timestamp: Date.now(),
            },
            ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
          })),
        );
        return {
          result: {
            sessionId: this.#sessionId,
            messages: projectMessages(messages),
            state: this.state,
          },
          outcome: extensionOutcomeFromMessages(messages),
          admissionEpoch,
        };
      } finally {
        this.#running = false;
      }
    });
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    const settlement = this.#settlementTail.then(() =>
      run.then(
        ({ outcome, admissionEpoch }) =>
          this.#notifySettledAfterIdle(admissionEpoch, outcome),
        () =>
          admittedEpoch === undefined
            ? undefined
            : this.#notifySettledAfterIdle(admittedEpoch, "failed"),
      ),
    );
    this.#settlementTail = settlement.then(
      () => undefined,
      () => undefined,
    );
    return run.then(
      (value) =>
        Result.ok<CodingRunResult<TAppState>, CodingSdkError>(value.result),
      (error) =>
        Result.err<CodingRunResult<TAppState>, CodingSdkError>(
          projectError(error, "model"),
        ),
    );
  }

  steer(
    input: string | CodingQueuedInput,
  ): Promise<ResultType<void, CodingSdkError>> {
    return this.#admit(input, (message, entryId) =>
      this.#internal.steer(message, entryId),
    );
  }

  followUp(
    input: string | CodingQueuedInput,
  ): Promise<ResultType<void, CodingSdkError>> {
    return this.#admit(input, (message, entryId) =>
      this.#internal.followUp(message, entryId),
    );
  }

  waitForIdle(): Promise<ResultType<void, CodingSdkError>> {
    return this.#tail
      .then(() => this.#internal.waitForIdle())
      .then(
        () => Result.ok(undefined),
        (error) => Result.err(projectError(error, "lifecycle")),
      );
  }

  async navigate(entryId: string): Promise<ResultType<void, CodingSdkError>> {
    if (this.#closed) return Result.err(closedError());
    try {
      await this.#internal.navigate(entryId);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(projectError(error, "navigation"));
    }
  }

  async generateTitle(
    firstMessage: string,
  ): Promise<ResultType<string, CodingSdkError>> {
    if (this.#closed) return Result.err(closedError());
    try {
      const assistantText = this.state.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) =>
          message.content.flatMap((part) =>
            part.type === "text" ? [part.text] : [],
          ),
        )
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
      await this.#settlementTail;
      await this.#artifactWriteTail;
      this.#stopArtifactProjection();
      this.#internal.close();
      if (this.#ephemeralDirectory)
        await rm(this.#ephemeralDirectory, { recursive: true, force: true });
    } catch (error) {
      failure = error;
    }
    const disposal = await disposeExtensions(this.#extensions);
    if (disposal.isErr()) failure ??= disposal.error;
    return failure
      ? Result.err(projectError(failure, "lifecycle"))
      : Result.ok(undefined);
  }

  #observeArtifact(
    event: Extract<
      AgentEvent,
      { type: "tool_execution_start" | "tool_execution_end" }
    >,
  ): void {
    if (event.type === "tool_execution_start") {
      const artifact = projectArtifact(
        event.toolName,
        event.args,
        event.toolCallId,
        Date.now(),
      );
      if (artifact) this.#pendingArtifacts.set(event.toolCallId, artifact);
      return;
    }
    const artifact = this.#pendingArtifacts.get(event.toolCallId);
    this.#pendingArtifacts.delete(event.toolCallId);
    if (!artifact || event.isError) return;
    const current = this.#artifacts.get(artifact.id);
    if (current && current.updatedAt > artifact.updatedAt) return;
    const previous = this.#artifacts.get(artifact.id);
    this.#artifacts.set(artifact.id, artifact);
    const write = this.#artifactWriteTail.then(() =>
      this.#internal.updateAppState((currentState) => ({
        ...currentState,
        artifacts: {
          version: 1,
          items: [...this.#artifacts.values()].map((artifact) => ({
            ...artifact,
          })) as JsonValue,
        },
      })),
    );
    // Roll the in-memory entry back when the write fails, so `state.artifacts` never advertises an
    // artifact that a resumed session would not find.
    this.#artifactWriteTail = write.catch(() => {
      if (this.#artifacts.get(artifact.id) !== artifact) return;
      if (previous) this.#artifacts.set(artifact.id, previous);
      else this.#artifacts.delete(artifact.id);
    });
  }

  async #notifySettledAfterIdle(
    admissionEpoch: number,
    outcome: CodingTurnEndInput["outcome"],
  ): Promise<void> {
    await this.#tail;
    await this.#internal.waitForIdle();
    if (this.#admissionEpoch !== admissionEpoch) return;
    await notifyExtensionSettled(this.#extensions, {
      idleEpoch: admissionEpoch,
      outcome,
    });
  }

  #admit(
    input: string | CodingQueuedInput,
    action: (message: AgentMessage, entryId: string | undefined) => void,
  ): Promise<ResultType<void, CodingSdkError>> {
    try {
      if (this.#closed) throw agentClosedFailure();
      const prompt = typeof input === "string" ? input : input.text;
      const entryId = typeof input === "string" ? undefined : input.entryId;
      if (!prompt.trim())
        throw new CodingSdkFailure({
          phase: "admission",
          code: "coding_sdk.empty_prompt",
          message: "Prompt must not be empty",
        });
      action({ role: "user", content: prompt, timestamp: Date.now() }, entryId);
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

function extensionOutcome(stopReason: string): CodingTurnEndInput["outcome"] {
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "iterationLimit") return "iteration_limit";
  if (stopReason === "error" || stopReason === "contextOverflow")
    return "failed";
  return "completed";
}

function extensionOutcomeFromMessages(
  messages: readonly AgentMessage[],
): CodingTurnEndInput["outcome"] {
  const lastAssistant = messages.findLast(
    (message) => message.role === "assistant",
  );
  return lastAssistant ? extensionOutcome(lastAssistant.stopReason) : "failed";
}

async function validateSessionSelection<TAppState extends JsonObject>(
  selection: CodingSessionSelection,
  store: SessionStore<PersistedCodingSessionState<TAppState>>,
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
  if (existing && !isPersistedCodingSessionState(existing.snapshot.appState)) {
    throw new CodingSdkFailure({
      phase: "session",
      code: "coding_sdk.session_format_invalid",
      message: `Session "${sessionId}" does not use the current Coding Agent session format`,
    });
  }
}

function isPersistedCodingSessionState(
  value: JsonObject,
): value is PersistedCodingSessionState<JsonObject> {
  return (
    value.version === 1 &&
    isJsonObject(value.appState) &&
    isJsonObject(value.extensions) &&
    Object.values(value.extensions).every(isJsonObject)
  );
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectPermissionSettings(
  settings: PermissionSettings | undefined,
  mode?: CodingPermissionMode,
): PermissionSettings {
  return { ...(settings ?? {}), ...(mode ? { defaultMode: mode } : {}) };
}
