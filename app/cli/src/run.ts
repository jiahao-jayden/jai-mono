import { homedir } from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
	type CodingAgent,
	type CodingAgentEvent,
	type CodingAgentMessage,
	type CodingAssistantMessage,
	type CodingPermissionDecision,
	type CodingPermissionMode,
	type CodingPermissionRequest,
	type CodingSdkError,
	createCodingAgent,
	type JsonObject,
	type JsonValue,
} from "@jai/coding-agent";
import { createAgentPluginsExtension } from "@jai/extension/agent-plugins";
import { TaggedError } from "better-result";
import { discoverCliAgentPluginDirectories } from "./plugin-directories";

type OutputFormat = "text" | "json" | "stream-json";

export interface CliUsage {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_input_tokens: number;
	readonly cache_creation_input_tokens: number;
	readonly reasoning_tokens: number;
	readonly total_tokens: number;
}

/**
 * 一次 run 的可聚合诊断。无人值守调用方只能看到 final text，而模型的自我报告
 * 与真实完成度并不一致，因此停止原因与工具失败数必须由 runtime 给出，
 * 而不是让调用方去扫自然语言。
 */
export interface CliDiagnostics {
	/** 末条 assistant 消息的停止原因：stop / iteration_limit / max_tokens / error 等。 */
	readonly stop_reason: string;
	readonly tool_calls: number;
	readonly tool_errors: number;
}

export interface CliResult {
	readonly type: "result";
	readonly sessionId: string;
	readonly text: string;
	readonly messages: readonly CodingAgentMessage[];
	readonly usage: CliUsage;
	readonly total_cost_usd: number;
	readonly diagnostics: CliDiagnostics;
}

interface CliOptions {
	readonly prompt?: string;
	readonly outputFormat: OutputFormat;
	readonly model?: string;
	readonly cwd: string;
	readonly sessionId?: string;
	readonly noSessionPersistence: boolean;
	readonly permissionMode?: CodingPermissionMode;
	readonly maxTurns?: number;
	readonly trustWorkspace: boolean;
	readonly printMode: boolean;
	readonly interactive: boolean;
	readonly help: boolean;
	readonly version: boolean;
}

class CliUsageError extends TaggedError("cli.usage_invalid")<{ readonly message: string }> {}
class CliPermissionError extends TaggedError("cli.permission_unavailable")<{ readonly message: string }> {}
class CliAgentError extends TaggedError("cli.agent_failed")<{
	readonly code: string;
	readonly message: string;
	readonly phase: CodingSdkError["phase"];
	readonly retryable: boolean;
	readonly details?: JsonValue;
}> {}
const VERSION = "0.0.0";

export async function runCli(argv: readonly string[]): Promise<number> {
	let options: CliOptions;
	try {
		options = parseCliOptions(argv);
	} catch (error) {
		process.stderr.write(`jai: ${errorMessage(error)}\n`);
		return 2;
	}
	if (options.help) {
		process.stdout.write(helpText());
		return 0;
	}
	if (options.version) {
		process.stdout.write(`${VERSION}\n`);
		return 0;
	}

	let agent: CodingAgent | undefined;
	let interrupted = false;
	const abort = () => {
		interrupted = true;
		void agent?.abort();
	};
	process.once("SIGINT", abort);
	try {
		const prompt = await resolvePrompt(options);
		if (!options.interactive && !prompt)
			throw new CliUsageError({ message: "A prompt or stdin input is required with -p" });

		const homeDirectory = process.env.JAI_HOME ?? homedir();
		agent = await createCliAgent(options, homeDirectory);
		const sessionId = agent.sessionId;
		if (options.interactive) {
			if (prompt) await runOne(agent, prompt, options.outputFormat, sessionId);
			await runInteractive(agent, options.outputFormat, sessionId);
		} else {
			await runOne(agent, prompt!, options.outputFormat, sessionId);
		}
		return 0;
	} catch (error) {
		if (options.outputFormat === "stream-json" || options.outputFormat === "json")
			writeEvent({ type: "error", error: projectCliError(error) });
		else process.stderr.write(`jai: ${errorMessage(error)}\n`);
		if (interrupted) return 130;
		return error instanceof CliPermissionError || error instanceof CliUsageError ? 2 : 1;
	} finally {
		process.off("SIGINT", abort);
		await agent?.close();
	}
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
	try {
		const normalized = normalizePrintFlag(argv);
		const parsed = parseArgs({
			args: normalized.argv,
			allowPositionals: true,
			strict: true,
			options: {
				print: { type: "string", short: "p" },
				"output-format": { type: "string", default: "text" },
				model: { type: "string" },
				cwd: { type: "string" },
				"session-id": { type: "string" },
				"no-session-persistence": { type: "boolean", default: false },
				"permission-mode": { type: "string" },
				"max-turns": { type: "string" },
				"trust-workspace": { type: "boolean", default: false },
				help: { type: "boolean", short: "h", default: false },
				version: { type: "boolean", short: "v", default: false },
			},
		});
		const outputFormat = parsed.values["output-format"];
		if (outputFormat !== "text" && outputFormat !== "json" && outputFormat !== "stream-json") {
			throw new CliUsageError({ message: `Unsupported output format: ${String(outputFormat)}` });
		}
		const permissionMode = parsed.values["permission-mode"];
		if (
			permissionMode !== undefined &&
			permissionMode !== "default" &&
			permissionMode !== "acceptEdits" &&
			permissionMode !== "plan" &&
			permissionMode !== "dontAsk" &&
			permissionMode !== "bypassPermissions"
		) {
			throw new CliUsageError({ message: `Unsupported permission mode: ${permissionMode}` });
		}
		const maxTurns = parsed.values["max-turns"] === undefined ? undefined : Number(parsed.values["max-turns"]);
		if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns < 1)) {
			throw new CliUsageError({ message: "--max-turns must be a positive integer" });
		}
		const positionalPrompt = parsed.positionals.length > 0 ? parsed.positionals.join(" ") : undefined;
		const prompt = parsed.values.print ?? positionalPrompt;
		const cwd = path.resolve(parsed.values.cwd ?? process.cwd());
		return {
			...(prompt === undefined ? {} : { prompt }),
			outputFormat,
			...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
			cwd,
			...(parsed.values["session-id"] === undefined ? {} : { sessionId: parsed.values["session-id"] }),
			noSessionPersistence: parsed.values["no-session-persistence"] ?? false,
			...(permissionMode === undefined ? {} : { permissionMode }),
			...(maxTurns === undefined ? {} : { maxTurns }),
			trustWorkspace: parsed.values["trust-workspace"] ?? false,
			printMode: normalized.printMode,
			interactive: !normalized.printMode && Boolean(input.isTTY),
			help: parsed.values.help ?? false,
			version: parsed.values.version ?? false,
		};
	} catch (error) {
		if (error instanceof CliUsageError) throw error;
		throw new CliUsageError({ message: error instanceof Error ? error.message : String(error) });
	}
}

function normalizePrintFlag(argv: readonly string[]): { readonly argv: string[]; readonly printMode: boolean } {
	const normalized: string[] = [];
	let printMode = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument?.startsWith("--print=") || argument?.startsWith("-p=")) printMode = true;
		if (argument === "-p" || argument === "--print") {
			printMode = true;
			if (argv[index + 1] === undefined || argv[index + 1]!.startsWith("-")) continue;
		}
		normalized.push(argument!);
	}
	return { argv: normalized, printMode };
}

async function resolvePrompt(options: CliOptions): Promise<string | undefined> {
	if (options.prompt !== undefined) return options.prompt;
	if (options.interactive) return undefined;
	if (input.isTTY) return undefined;
	const chunks: Buffer[] = [];
	for await (const chunk of input) chunks.push(Buffer.from(chunk));
	const prompt = Buffer.concat(chunks).toString("utf8").trim();
	return prompt || undefined;
}

async function createCliAgent(options: CliOptions, homeDirectory: string): Promise<CodingAgent> {
	const pluginDirectories = await discoverCliAgentPluginDirectories({
		homeDirectory,
		workspaceDirectory: options.cwd,
		workspaceTrusted: options.trustWorkspace,
	});
	const sessionDirectory = path.join(homeDirectory, "jai", "projects", path.basename(options.cwd), "sessions");
	const session = options.noSessionPersistence
		? { kind: "ephemeral" as const }
		: options.sessionId
			? { kind: "resume" as const, id: options.sessionId, directory: sessionDirectory }
			: { kind: "new" as const, directory: sessionDirectory };
	const model = options.model ?? process.env.JAI_MODEL;
	if (!model) {
		throw new CliAgentError({
			code: "coding_sdk.model_unavailable",
			message: "No model selected; pass --model <provider/model> or set JAI_MODEL",
			phase: "model",
			retryable: false,
		});
	}
	const created = await createCodingAgent({
		model,
		cwd: options.cwd,
		session,
		requestApproval: createCliApproval(options.permissionMode),
		...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
		...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
		extensions: [
			createAgentPluginsExtension({
				directories: pluginDirectories,
				dataDirectory: path.join(homeDirectory, ".jai", "agent-plugin-data"),
			}),
		],
	});
	if (created.isErr()) throw new CliAgentError(created.error);
	return created.value;
}

async function runInteractive(agent: CodingAgent, outputFormat: OutputFormat, sessionId: string): Promise<void> {
	const reader = createInterface({ input, output, terminal: true });
	try {
		while (true) {
			const prompt = (await reader.question("\njai> ")).trim();
			if (!prompt) continue;
			if (prompt === "/exit" || prompt === "/quit") return;
			if (prompt === "/help") {
				process.stdout.write("/help  /exit  /quit\n");
				continue;
			}
			await runOne(agent, prompt, outputFormat, sessionId);
		}
	} finally {
		reader.close();
	}
}

async function runOne(
	agent: CodingAgent,
	prompt: string,
	outputFormat: OutputFormat,
	sessionId: string,
): Promise<void> {
	const unsubscribe = agent.subscribe((event) => {
		if (outputFormat === "stream-json") {
			const projected = projectStreamEvent(sessionId, event);
			if (projected) writeEvent(projected);
		}
		if (outputFormat === "text" && event.type === "message_update" && event.assistantEvent.type === "text_delta") {
			process.stdout.write(event.assistantEvent.delta);
		}
	});
	const run = await agent.prompt(prompt);
	unsubscribe();
	if (run.isErr()) throw new CliAgentError(run.error);
	const messages = run.value.messages;
	const result = projectCliResult(sessionId, messages);
	if (outputFormat === "json") process.stdout.write(`${JSON.stringify(result)}\n`);
	if (outputFormat === "stream-json") writeEvent({ ...result, session_id: sessionId });
	if (outputFormat === "text") process.stdout.write("\n");
}

/**
 * 无人值守（无 TTY）时没有人能回答审批。此时唯一合理的行为取决于调用方是否
 * 已经显式选择了 bypassPermissions：选了就按该模式的语义自动放行，没选就报错。
 *
 * 这里放行的只是被风险层判为 `ask` 的命令。root/home 删除等硬熔断在
 * evaluatePermission 内部直接 deny，根本不会创建审批请求，因此不受影响。
 */
export function createCliApproval(
	permissionMode: CliOptions["permissionMode"],
): (request: CodingPermissionRequest, signal?: AbortSignal) => Promise<CodingPermissionDecision> {
	return async function requestCliApproval(request, signal) {
		if (!input.isTTY || !output.isTTY) {
			if (permissionMode === "bypassPermissions") return "allowOnce";
			throw new CliPermissionError({
				message: `Permission required for ${request.toolName}; use --permission-mode`,
			});
		}
		if (signal?.aborted) return "deny";
		const command = request.args.command;
		const question =
			typeof command === "string"
				? `${request.toolName}: ${String(request.args.command)}\nAllow? [y]es/[n]o/[a]lways `
				: `${request.toolName} requests permission. Allow? [y]es/[n]o/[a]lways `;
		const reader = createInterface({ input, output, terminal: true });
		try {
			const answer = (await reader.question(question)).trim().toLowerCase();
			if (answer === "a" || answer === "always") return "alwaysAllow";
			if (answer === "y" || answer === "yes") return "allowOnce";
			return "deny";
		} finally {
			reader.close();
		}
	};
}

function writeEvent(event: unknown): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

export function projectCliResult(sessionId: string, messages: readonly CodingAgentMessage[]): CliResult {
	const toolResults = messages.filter((message) => message.role === "toolResult");
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	return {
		type: "result",
		sessionId,
		text: finalAssistantText(messages),
		messages,
		usage: aggregateUsage(messages),
		total_cost_usd: messages.reduce(
			(total, message) => (message.role === "assistant" ? total + finiteNumber(message.usage.cost.total) : total),
			0,
		),
		diagnostics: {
			stop_reason: lastAssistant ? projectStopReason(lastAssistant.stopReason) : "none",
			tool_calls: toolResults.length,
			tool_errors: toolResults.filter((message) => message.isError).length,
		},
	};
}

export function aggregateUsage(messages: readonly CodingAgentMessage[]): CliUsage {
	return messages.reduce(
		(total, message) => {
			if (message.role !== "assistant") return total;
			return {
				input_tokens: total.input_tokens + finiteNumber(message.usage.input),
				output_tokens: total.output_tokens + finiteNumber(message.usage.output),
				cache_read_input_tokens: total.cache_read_input_tokens + finiteNumber(message.usage.cacheRead),
				cache_creation_input_tokens: total.cache_creation_input_tokens + finiteNumber(message.usage.cacheWrite),
				reasoning_tokens: total.reasoning_tokens + finiteNumber(message.usage.reasoning),
				total_tokens: total.total_tokens + finiteNumber(message.usage.totalTokens),
			};
		},
		{
			input_tokens: 0,
			output_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
			reasoning_tokens: 0,
			total_tokens: 0,
		},
	);
}

export function projectStreamEvent(sessionId: string, event: CodingAgentEvent): JsonObject | undefined {
	switch (event.type) {
		case "agent_start":
			return { type: "system", subtype: "init", session_id: sessionId };
		// Streaming deltas carry the whole partial message; emitting one line per token would
		// amplify stdout by orders of magnitude. The completed message arrives at message_end.
		case "message_update":
			return undefined;
		case "message_end":
			if (event.message.role === "assistant") {
				return {
					type: "assistant",
					session_id: sessionId,
					message: projectAssistantMessage(event.message),
				};
			}
			return { type: "event", event: projectWireValue(event) };
		case "tool_execution_start":
			return {
				type: "tool_start",
				session_id: sessionId,
				tool_call_id: event.toolCallId,
				tool_name: event.toolName,
				title: event.title,
				args: event.args,
			};
		case "tool_execution_update":
			return {
				type: "tool_update",
				session_id: sessionId,
				tool_call_id: event.toolCallId,
				tool_name: event.toolName,
				partial: event.partial,
			};
		case "tool_execution_end":
			return {
				type: "tool_end",
				session_id: sessionId,
				tool_call_id: event.toolCallId,
				tool_name: event.toolName,
				result: event.result,
				is_error: event.isError,
			};
		default:
			return { type: "event", event: projectWireValue(event) };
	}
}

function projectAssistantMessage(message: CodingAssistantMessage): JsonObject {
	return {
		role: "assistant",
		model: message.model,
		stop_reason: projectStopReason(message.stopReason),
		content: message.content.map((part): JsonObject => {
			switch (part.type) {
				case "text":
					return { type: "text", text: part.text };
				case "thinking":
					return { type: "thinking", thinking: part.thinking };
				case "toolCall":
					return { type: "tool_use", id: part.id, name: part.name, input: projectWireValue(part.arguments) };
				default:
					return { type: "unknown", value: projectWireValue(part) };
			}
		}) as JsonObject[],
		usage: {
			input_tokens: finiteNumber(message.usage.input),
			output_tokens: finiteNumber(message.usage.output),
			cache_read_input_tokens: finiteNumber(message.usage.cacheRead),
			cache_creation_input_tokens: finiteNumber(message.usage.cacheWrite),
			reasoning_tokens: finiteNumber(message.usage.reasoning),
			total_tokens: finiteNumber(message.usage.totalTokens),
		},
	};
}

function projectStopReason(reason: CodingAssistantMessage["stopReason"]): string {
	switch (reason) {
		case "toolUse":
			return "tool_use";
		case "length":
			return "max_tokens";
		case "contextOverflow":
			return "context_overflow";
		case "iterationLimit":
			return "iteration_limit";
		default:
			return reason;
	}
}

function finiteNumber(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function projectWireValue(value: unknown): JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (Array.isArray(value)) return value.map(projectWireValue);
	if (typeof value === "object") {
		const output: Record<string, JsonValue> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry !== undefined) output[key] = projectWireValue(entry);
		}
		return output;
	}
	return String(value);
}

function finalAssistantText(messages: readonly CodingAgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("")
			.trim();
		if (text) return text;
	}
	return "";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function projectCliError(error: unknown): JsonObject {
	if (error instanceof CliAgentError) {
		return {
			code: error.code,
			message: error.message,
			phase: error.phase,
			retryable: error.retryable,
			...(error.details === undefined ? {} : { details: error.details }),
		};
	}
	if (error instanceof CliPermissionError) return { code: "cli.permission_unavailable", message: error.message };
	if (error instanceof CliUsageError) return { code: "cli.usage_invalid", message: error.message };
	return { code: "cli.unknown", message: errorMessage(error) };
}

function helpText(): string {
	return `Jai coding agent\n\nUsage:\n  jai [prompt]\n  jai -p [prompt] [options]\n  cat task.md | jai -p [options]\n\nOptions:\n  -p, --print [text]               Run one non-interactive prompt\n      --output-format <format>     text | json | stream-json\n      --model <profile/model>      Override configured model\n      --cwd <path>                 Workspace root (default: current directory)\n      --session-id <id>            Resume a durable session\n      --no-session-persistence     Use a temporary session\n      --permission-mode <mode>     default | acceptEdits | plan | dontAsk | bypassPermissions\n      --max-turns <n>              Maximum model turns\n      --trust-workspace            Enable trusted project-local configuration\n  -h, --help                       Show this help\n  -v, --version                    Show the CLI version\n`;
}
