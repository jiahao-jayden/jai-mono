import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, constants, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, AgentHookMap, AgentToolResult, ToolCallContext } from "@jai/agent";
import { validateToolArguments } from "@jai/ai";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { isInside } from "../package/paths";
import type { LoadedAgentPlugin } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type {
	AgentPluginCommandHookHandler,
	AgentPluginHookEntry,
	AgentPluginHookEvent,
	AgentPluginHookInvocationDto,
	AgentPluginHookRuntime,
	AgentPluginHookRuntimeOptions,
	AgentPluginPostCompactInvocationDto,
	AgentPluginPreCompactInvocationDto,
	AgentPluginPreToolUseInvocationDto,
	AgentPluginPreToolUseResultDto,
	AgentPluginToolObservationInvocationDto,
} from "./types";

const MAX_HOOK_OUTPUT_BYTES = 64 * 1024;
const PROJECT_DIRECTORY_PLACEHOLDER = ["$", "{JAI_PROJECT_DIR}"].join("");

export class HookCommandFailed extends TaggedError("coding_agent_plugin.hook_command_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

class HookToolDenied extends TaggedError("coding_agent_plugin.hook_denied_tool")<{
	readonly message: string;
}> {}

export interface AgentPluginHooksConnectOptions {
	readonly pluginDataDirectory: string;
}

interface HookCommandResult {
	readonly stdout: string;
}

interface ToolObservation {
	readonly name: string;
	readonly callId: string;
	readonly input: Record<string, unknown>;
	readonly signal?: AbortSignal;
}

type HookInvocationDto =
	| AgentPluginHookInvocationDto
	| AgentPluginPreToolUseInvocationDto
	| AgentPluginToolObservationInvocationDto
	| AgentPluginPreCompactInvocationDto
	| AgentPluginPostCompactInvocationDto;

export async function connectAgentPluginHooks(
	plugin: LoadedAgentPlugin,
	options: AgentPluginHooksConnectOptions,
): Promise<ResultType<AgentPluginHookRuntime, HookCommandFailed>> {
	if (plugin.hooks.length === 0) return Result.ok(emptyHookRuntime);
	try {
		const pluginDataDirectory = await preparePluginDataDirectory(options.pluginDataDirectory);
		return Result.ok(new PluginHookRuntime(plugin, pluginDataDirectory));
	} catch (cause) {
		return Result.err(new HookCommandFailed({ message: "Plugin hook runtime could not be created", cause }));
	}
}

const emptyHookRuntime: AgentPluginHookRuntime = {
	createHooks: () => ({}),
	beforeToolCall: async (context) => ({ status: "allow", input: structuredClone(context.args) }),
	afterToolCall: async () => {},
	sessionStart: async () => {},
};

class PluginHookRuntime implements AgentPluginHookRuntime {
	constructor(
		private readonly plugin: LoadedAgentPlugin,
		private readonly pluginDataDirectory: string,
	) {}

	createHooks(
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): AgentHookMap {
		const trackedTools = new Map<string, ToolObservation>();
		const hasToolHooks = this.hasEvent("PreToolUse") || this.hasEvent("PostToolUse");
		const hasEventHooks =
			this.hasEvent("PostToolUseFailure") ||
			this.hasEvent("SessionStart") ||
			this.hasEvent("SessionEnd") ||
			this.hasEvent("PreCompact") ||
			this.hasEvent("PostCompact");
		return {
			...(hasToolHooks
				? {
						aroundToolCall: [
							async (context, next) =>
								this.aroundToolCall(context, next, trackedTools, options, reportDiagnostic),
						],
					}
				: {}),
			...(hasEventHooks
				? {
						onEvent: [async (event) => this.onEvent(event, trackedTools, options, reportDiagnostic)],
					}
				: {}),
		};
	}

	beforeToolCall(
		context: ToolCallContext,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	) {
		return this.runPreToolUse(context, structuredClone(context.args), options, reportDiagnostic);
	}

	afterToolCall(
		context: ToolCallContext,
		result: AgentToolResult,
		isError: boolean,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	) {
		if (!isError) return this.runPostToolUse(context, result, options, reportDiagnostic);
		return this.runEventHandlers(
			"PostToolUseFailure",
			context.tool.name,
			{
				...baseInvocation("PostToolUseFailure", options),
				tool: {
					name: context.tool.name,
					callId: context.toolCall.id,
					input: structuredClone(context.args),
					result: projectToolResult(result, true),
				},
			},
			options,
			reportDiagnostic,
			context.signal,
		);
	}

	sessionStart(options: AgentPluginHookRuntimeOptions, reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void) {
		return this.runEventHandlers(
			"SessionStart",
			undefined,
			baseInvocation("SessionStart", options),
			options,
			reportDiagnostic,
		);
	}

	private hasEvent(event: AgentPluginHookEvent): boolean {
		return this.plugin.hooks.some((document) => document.entries.some((entry) => entry.event === event));
	}

	private async aroundToolCall(
		context: ToolCallContext,
		next: () => Promise<AgentToolResult>,
		trackedTools: Map<string, ToolObservation>,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): Promise<AgentToolResult> {
		const preResult = await this.runPreToolUse(context, structuredClone(context.args), options, reportDiagnostic);
		if (preResult.status === "deny") throw new HookToolDenied({ message: preResult.reason });
		context.args = preResult.input;
		trackedTools.set(context.toolCall.id, {
			name: context.tool.name,
			callId: context.toolCall.id,
			input: structuredClone(context.args),
			...(context.signal ? { signal: context.signal } : {}),
		});
		const result = await next();
		await this.runPostToolUse(context, result, options, reportDiagnostic);
		return result;
	}

	private async onEvent(
		event: AgentEvent,
		trackedTools: Map<string, ToolObservation>,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): Promise<void> {
		if (event.type === "tool_execution_start") {
			trackedTools.set(event.toolCallId, {
				name: event.toolName,
				callId: event.toolCallId,
				input: isRecord(event.args) ? structuredClone(event.args) : {},
			});
			return;
		}
		if (event.type === "tool_execution_end") {
			const tracked = trackedTools.get(event.toolCallId);
			trackedTools.delete(event.toolCallId);
			if (!event.isError || !tracked) return;
			await this.runEventHandlers(
				"PostToolUseFailure",
				tracked.name,
				{
					...baseInvocation("PostToolUseFailure", options),
					tool: {
						name: tracked.name,
						callId: tracked.callId,
						input: tracked.input,
						result: projectToolResult(event.result, true),
					},
				},
				options,
				reportDiagnostic,
				tracked.signal,
			);
			return;
		}
		if (event.type === "agent_start") {
			await this.runEventHandlers(
				"SessionStart",
				undefined,
				baseInvocation("SessionStart", options),
				options,
				reportDiagnostic,
			);
			return;
		}
		if (event.type === "agent_end") {
			await this.runEventHandlers(
				"SessionEnd",
				undefined,
				baseInvocation("SessionEnd", options),
				options,
				reportDiagnostic,
			);
			return;
		}
		if (event.type === "compaction_start") {
			await this.runEventHandlers(
				"PreCompact",
				undefined,
				{
					...baseInvocation("PreCompact", options),
					compaction: { trigger: event.trigger, tokensBefore: event.tokensBefore },
				},
				options,
				reportDiagnostic,
			);
			return;
		}
		if (event.type === "compaction_end") {
			await this.runEventHandlers(
				"PostCompact",
				undefined,
				{
					...baseInvocation("PostCompact", options),
					compaction: { trigger: event.trigger, outcome: event.outcome.status },
				},
				options,
				reportDiagnostic,
			);
		}
	}

	private async runPreToolUse(
		context: ToolCallContext,
		input: Record<string, unknown>,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): Promise<
		| { readonly status: "allow"; readonly input: Record<string, unknown> }
		| { readonly status: "deny"; readonly reason: string }
	> {
		let current = input;
		for (const entry of this.entriesFor("PreToolUse", context.tool.name)) {
			for (const handler of entry.handlers) {
				const invocation: AgentPluginPreToolUseInvocationDto = {
					...baseInvocation("PreToolUse", options),
					tool: { name: context.tool.name, callId: context.toolCall.id, input: structuredClone(current) },
				};
				const result = await this.runHandler(handler, invocation, options, context.signal);
				if (context.signal?.aborted) context.signal.throwIfAborted();
				if (result.isErr()) {
					reportDiagnostic(commandFailureDiagnostic("plugin_hook_command_failed", "PreToolUse"));
					if (handler.onFailure === "deny")
						return { status: "deny", reason: "A plugin hook rejected this tool call" };
					continue;
				}
				const control = parsePreToolUseResult(result.value.stdout);
				if (control.isErr()) {
					reportDiagnostic(commandFailureDiagnostic("plugin_hook_invalid_result", "PreToolUse"));
					if (handler.onFailure === "deny")
						return { status: "deny", reason: "A plugin hook rejected this tool call" };
					continue;
				}
				if (control.value.decision === "deny") return { status: "deny", reason: control.value.reason };
				if (control.value.decision === "updateInput") {
					const validation = validateToolArguments(context.tool, {
						...context.toolCall,
						arguments: control.value.input,
					});
					if (validation.status === "error") {
						reportDiagnostic(commandFailureDiagnostic("plugin_hook_invalid_result", "PreToolUse"));
						if (handler.onFailure === "deny")
							return { status: "deny", reason: "A plugin hook rejected this tool call" };
						continue;
					}
					current = validation.value as Record<string, unknown>;
				}
			}
		}
		return { status: "allow", input: current };
	}

	private async runPostToolUse(
		context: ToolCallContext,
		result: AgentToolResult,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
	): Promise<void> {
		await this.runEventHandlers(
			"PostToolUse",
			context.tool.name,
			{
				...baseInvocation("PostToolUse", options),
				tool: {
					name: context.tool.name,
					callId: context.toolCall.id,
					input: structuredClone(context.args),
					result: projectToolResult(result, false),
				},
			},
			options,
			reportDiagnostic,
			context.signal,
		);
	}

	private async runEventHandlers(
		event: Exclude<AgentPluginHookEvent, "PreToolUse">,
		toolName: string | undefined,
		invocation: HookInvocationDto,
		options: AgentPluginHookRuntimeOptions,
		reportDiagnostic: (diagnostic: AgentPluginDiagnostic) => void,
		signal?: AbortSignal,
	): Promise<void> {
		for (const entry of this.entriesFor(event, toolName)) {
			for (const handler of entry.handlers) {
				const result = await this.runHandler(handler, invocation, options, signal);
				if (signal?.aborted) return;
				if (result.isErr()) reportDiagnostic(commandFailureDiagnostic("plugin_hook_command_failed", event));
			}
		}
	}

	private entriesFor(event: AgentPluginHookEvent, toolName: string | undefined): readonly AgentPluginHookEntry[] {
		return this.plugin.hooks
			.flatMap((document) => document.entries)
			.filter(
				(entry) =>
					entry.event === event &&
					(!entry.matcher || (toolName !== undefined && entry.matcher.includes(toolName))),
			);
	}

	private async runHandler(
		handler: AgentPluginCommandHookHandler,
		invocation: HookInvocationDto,
		options: AgentPluginHookRuntimeOptions,
		signal?: AbortSignal,
	): Promise<ResultType<HookCommandResult, HookCommandFailed>> {
		if (!options.workspaceDirectory && usesProjectPlaceholder(handler)) return Result.ok({ stdout: "" });
		try {
			const command = await resolveCommand(
				this.plugin.root,
				expand(handler.command, this.plugin.root, this.pluginDataDirectory, options.workspaceDirectory),
			);
			const args = handler.args.map((argument) =>
				expand(argument, this.plugin.root, this.pluginDataDirectory, options.workspaceDirectory),
			);
			return await executeHookCommand({
				command,
				args,
				cwd: options.workspaceDirectory ?? this.plugin.root,
				env: hookEnvironment(this.plugin.root, this.pluginDataDirectory, options),
				input: invocation,
				timeoutMs: handler.timeoutSeconds * 1_000,
				signal,
			});
		} catch (cause) {
			return Result.err(new HookCommandFailed({ message: "Plugin hook command could not be started", cause }));
		}
	}
}

function baseInvocation<TEvent extends AgentPluginHookEvent>(
	event: TEvent,
	options: AgentPluginHookRuntimeOptions,
): AgentPluginHookInvocationDto & { readonly event: TEvent } {
	return {
		protocolVersion: "1.0.0",
		event,
		agent: { kind: options.agentKind },
		session: { id: options.sessionId },
		...(options.workspaceDirectory ? { project: { directory: options.workspaceDirectory } } : {}),
	};
}

function projectToolResult(
	result: AgentToolResult,
	isError: boolean,
): AgentPluginToolObservationInvocationDto["tool"]["result"] {
	return {
		content: result.content.flatMap((part) =>
			part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
		),
		isError,
		...(result.terminate ? { terminate: true } : {}),
	};
}

function commandFailureDiagnostic(
	code: "plugin_hook_command_failed" | "plugin_hook_invalid_result",
	event: AgentPluginHookEvent,
): AgentPluginDiagnostic {
	return {
		code,
		severity: "error",
		scope: "hook-handler",
		componentName: event,
		relativePath: "hooks/hooks.json",
		message:
			code === "plugin_hook_invalid_result"
				? "Plugin hook returned an invalid control result"
				: "Plugin hook command failed",
	};
}

function parsePreToolUseResult(value: string): ResultType<AgentPluginPreToolUseResultDto, HookCommandFailed> {
	if (value.trim().length === 0) return Result.ok({ decision: "allow" });
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed) || typeof parsed.decision !== "string") {
			return Result.err(new HookCommandFailed({ message: "Plugin hook control output is invalid" }));
		}
		if (parsed.decision === "allow" && Object.keys(parsed).length === 1) return Result.ok({ decision: "allow" });
		if (
			parsed.decision === "deny" &&
			typeof parsed.reason === "string" &&
			parsed.reason.trim().length > 0 &&
			parsed.reason.length <= 1_000 &&
			Object.keys(parsed).every((key) => key === "decision" || key === "reason")
		) {
			return Result.ok({ decision: "deny", reason: parsed.reason.trim() });
		}
		if (
			parsed.decision === "updateInput" &&
			isRecord(parsed.input) &&
			Object.keys(parsed).every((key) => key === "decision" || key === "input")
		) {
			return Result.ok({ decision: "updateInput", input: parsed.input });
		}
		return Result.err(new HookCommandFailed({ message: "Plugin hook control output is invalid" }));
	} catch (cause) {
		return Result.err(new HookCommandFailed({ message: "Plugin hook control output is invalid", cause }));
	}
}

async function preparePluginDataDirectory(directory: string): Promise<string> {
	await mkdir(directory, { recursive: true });
	const canonical = await realpath(directory);
	const info = await stat(canonical);
	if (!info.isDirectory()) throw new HookCommandFailed({ message: "Plugin data directory is not a directory" });
	await access(canonical, constants.W_OK);
	return canonical;
}

async function resolveCommand(root: string, command: string): Promise<string> {
	if (!command.startsWith("./")) return command;
	const canonical = await realpath(path.resolve(root, command));
	const info = await stat(canonical);
	if (!isInside(canonical, root) || !info.isFile()) {
		throw new HookCommandFailed({ message: "Plugin hook command escapes Plugin root or is not a file" });
	}
	await access(canonical, constants.X_OK);
	return canonical;
}

function usesProjectPlaceholder(handler: AgentPluginCommandHookHandler): boolean {
	return [handler.command, ...handler.args].some((value) => value.includes(PROJECT_DIRECTORY_PLACEHOLDER));
}

function expand(value: string, root: string, data: string, project: string | undefined): string {
	return value.replace(/\$\{(JAI_PLUGIN_ROOT|JAI_PLUGIN_DATA|JAI_PROJECT_DIR)\}/g, (_match, name) => {
		if (name === "JAI_PLUGIN_ROOT") return root;
		if (name === "JAI_PLUGIN_DATA") return data;
		return project ?? PROJECT_DIRECTORY_PLACEHOLDER;
	});
}

function hookEnvironment(
	pluginRoot: string,
	pluginDataDirectory: string,
	options: AgentPluginHookRuntimeOptions,
): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of [
		"PATH",
		"SystemRoot",
		"WINDIR",
		"COMSPEC",
		"PATHEXT",
		"TMPDIR",
		"TMP",
		"TEMP",
		"LANG",
		"LC_ALL",
	]) {
		const value = process.env[key];
		if (value !== undefined) environment[key] = value;
	}
	return {
		...environment,
		JAI_PLUGIN_ROOT: pluginRoot,
		JAI_PLUGIN_DATA: pluginDataDirectory,
		JAI_AGENT_KIND: options.agentKind,
		...(options.workspaceDirectory ? { JAI_PROJECT_DIR: options.workspaceDirectory } : {}),
	};
}

async function executeHookCommand(options: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly input: HookInvocationDto;
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}): Promise<ResultType<HookCommandResult, HookCommandFailed>> {
	if (options.signal?.aborted)
		return Result.err(new HookCommandFailed({ message: "Plugin hook command was aborted" }));
	let input: string;
	try {
		input = JSON.stringify(options.input);
	} catch (cause) {
		return Result.err(new HookCommandFailed({ message: "Plugin hook invocation could not be serialized", cause }));
	}
	return new Promise((resolve) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(options.command, options.args, {
				cwd: options.cwd,
				env: options.env,
				detached: process.platform !== "win32",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (cause) {
			resolve(Result.err(new HookCommandFailed({ message: "Plugin hook command could not be spawned", cause })));
			return;
		}
		let settled = false;
		let timedOut = false;
		let aborted = false;
		let outputTooLarge = false;
		let outputBytes = 0;
		let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
		const stdout: Buffer[] = [];
		const sendSignal = (signal: NodeJS.Signals) => {
			try {
				if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				child.kill(signal);
			}
		};
		const kill = () => {
			sendSignal("SIGTERM");
			forceKillTimer ??= setTimeout(() => sendSignal("SIGKILL"), 250);
		};
		const finish = (result: ResultType<HookCommandResult, HookCommandFailed>) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			options.signal?.removeEventListener("abort", abort);
			resolve(result);
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			kill();
		}, options.timeoutMs);
		const abort = () => {
			aborted = true;
			kill();
		};
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			outputBytes += chunk.byteLength;
			if (outputBytes > MAX_HOOK_OUTPUT_BYTES) {
				outputTooLarge = true;
				kill();
				return;
			}
			stdout.push(chunk);
		});
		child.stderr.resume();
		child.stdin.on("error", () => {});
		child.once("error", (cause) =>
			finish(Result.err(new HookCommandFailed({ message: "Plugin hook command could not be spawned", cause }))),
		);
		child.once("close", (code) => {
			if (aborted) {
				finish(Result.err(new HookCommandFailed({ message: "Plugin hook command was aborted" })));
				return;
			}
			if (timedOut) {
				finish(Result.err(new HookCommandFailed({ message: "Plugin hook command timed out" })));
				return;
			}
			if (outputTooLarge) {
				finish(Result.err(new HookCommandFailed({ message: "Plugin hook output is too large" })));
				return;
			}
			if (code !== 0) {
				finish(Result.err(new HookCommandFailed({ message: "Plugin hook command failed" })));
				return;
			}
			finish(Result.ok({ stdout: Buffer.concat(stdout).toString("utf8") }));
		});
		child.stdin.end(input);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
