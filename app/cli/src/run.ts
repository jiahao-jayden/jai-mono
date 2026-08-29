import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import type {
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAssistantMessage,
	CodingSdkError,
	JsonValue,
} from "@jai/coding-agent";
import type { TrajectoryContentScope } from "@jai/server";
import {
	type AcpJsonRpcNotification,
	type AcpJsonRpcRequest,
	type AcpJsonRpcResponse,
	type AcpPromptBlock,
	connectJaiRuntimeHost,
	type LocalAcpV2Client,
} from "@jai/server/acp-client";
import { TaggedError } from "better-result";

type OutputFormat = "text" | "json" | "stream-json";
type JsonObject = Record<string, JsonValue>;

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
	readonly command: "run" | "trajectory";
	readonly prompt?: string;
	readonly outputFormat: OutputFormat;
	readonly cwd: string;
	readonly sessionId?: string;
	readonly noSessionPersistence: boolean;
	readonly printMode: boolean;
	readonly interactive: boolean;
	readonly help: boolean;
	readonly version: boolean;
	readonly trajectoryScopes: readonly TrajectoryContentScope[];
}

class CliUsageError extends TaggedError("cli.usage_invalid")<{ readonly message: string }> {}
class CliAgentError extends TaggedError("cli.agent_failed")<{
	readonly code: string;
	readonly message: string;
	readonly phase: CodingSdkError["phase"];
	readonly retryable: boolean;
	readonly details?: JsonValue;
}> {}
class CliRuntimeError extends TaggedError("cli.runtime_unavailable")<{ readonly message: string }> {}
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

	let client: LocalAcpV2Client | undefined;
	let activeSessionId: string | undefined;
	let interrupted = false;
	const abort = () => {
		interrupted = true;
		if (activeSessionId) client?.notify("session/cancel", { sessionId: activeSessionId });
	};
	process.once("SIGINT", abort);
	try {
		const connected = await connectJaiRuntimeHost();
		if (connected.isErr()) throw new CliRuntimeError({ message: connected.error.message });
		client = connected.value;
		await initializeClient(client);
		if (options.command === "trajectory") {
			await openTrajectoryInBrowser(client, options);
			return 0;
		}
		const prompt = await resolvePrompt(options);
		if (!options.interactive && !prompt)
			throw new CliUsageError({ message: "A prompt or stdin input is required with -p" });
		const sessionId = await openCliSession(client, options);
		activeSessionId = sessionId;
		const session = new CliSession(client, sessionId, options.outputFormat);
		if (options.interactive) {
			if (prompt) await runOne(session, prompt);
			await runInteractive(session);
		} else {
			await runOne(session, prompt!);
		}
		session.close();
		return 0;
	} catch (error) {
		if (options.outputFormat === "stream-json" || options.outputFormat === "json")
			writeEvent({ type: "error", error: projectCliError(error) });
		else process.stderr.write(`jai: ${errorMessage(error)}\n`);
		if (interrupted) return 130;
		return error instanceof CliUsageError ? 2 : 1;
	} finally {
		process.off("SIGINT", abort);
		await client?.close();
	}
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
	try {
		const command = argv[0] === "trajectory" ? "trajectory" : "run";
		const commandArgs = command === "trajectory" ? argv.slice(1) : argv;
		const normalized = normalizePrintFlag(commandArgs);
		const parsed = parseArgs({
			args: normalized.argv,
			allowPositionals: true,
			strict: true,
			options: {
				print: { type: "string", short: "p" },
				"output-format": { type: "string", default: "text" },
				cwd: { type: "string" },
				"session-id": { type: "string" },
				"no-session-persistence": { type: "boolean", default: false },
				scope: { type: "string", multiple: true },
				help: { type: "boolean", short: "h", default: false },
				version: { type: "boolean", short: "v", default: false },
			},
		});
		const outputFormat = parsed.values["output-format"];
		if (outputFormat !== "text" && outputFormat !== "json" && outputFormat !== "stream-json") {
			throw new CliUsageError({ message: `Unsupported output format: ${String(outputFormat)}` });
		}
		const positionalPrompt = parsed.positionals.length > 0 ? parsed.positionals.join(" ") : undefined;
		const prompt = parsed.values.print ?? positionalPrompt;
		const cwd = path.resolve(parsed.values.cwd ?? process.cwd());
		if (parsed.values["no-session-persistence"] && parsed.values["session-id"] !== undefined) {
			throw new CliUsageError({ message: "--no-session-persistence cannot be combined with --session-id" });
		}
		const trajectoryScopes = parseTrajectoryScopes(parsed.values.scope ?? []);
		if (command === "trajectory") {
			if (prompt !== undefined) throw new CliUsageError({ message: "jai trajectory does not accept a prompt" });
			if (parsed.values["session-id"] === undefined)
				throw new CliUsageError({ message: "jai trajectory requires --session-id" });
			if (parsed.values["no-session-persistence"]) {
				throw new CliUsageError({ message: "jai trajectory requires a durable Session" });
			}
		}
		return {
			command,
			...(prompt === undefined ? {} : { prompt }),
			outputFormat,
			cwd,
			...(parsed.values["session-id"] === undefined ? {} : { sessionId: parsed.values["session-id"] }),
			noSessionPersistence: parsed.values["no-session-persistence"] ?? false,
			printMode: normalized.printMode,
			interactive: command === "run" && !normalized.printMode && Boolean(input.isTTY),
			help: parsed.values.help ?? false,
			version: parsed.values.version ?? false,
			trajectoryScopes,
		};
	} catch (error) {
		if (error instanceof CliUsageError) throw error;
		throw new CliUsageError({ message: error instanceof Error ? error.message : String(error) });
	}
}

function parseTrajectoryScopes(values: readonly string[]): readonly TrajectoryContentScope[] {
	const allowed = new Set<TrajectoryContentScope>(["prompt", "final_text", "reasoning", "tool_input", "tool_output"]);
	const scopes: TrajectoryContentScope[] = [];
	for (const value of values) {
		if (!allowed.has(value as TrajectoryContentScope)) {
			throw new CliUsageError({ message: `Unsupported trajectory scope: ${value}` });
		}
		if (!scopes.includes(value as TrajectoryContentScope)) scopes.push(value as TrajectoryContentScope);
	}
	return scopes;
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

async function initializeClient(client: LocalAcpV2Client): Promise<void> {
	const initialized = await client.request("initialize", {
		protocolVersion: 2,
		capabilities: {},
		info: { name: "jai-cli", version: VERSION },
	});
	if (initialized.isErr()) throw new CliRuntimeError({ message: initialized.error.message });
}

async function openTrajectoryInBrowser(client: LocalAcpV2Client, options: CliOptions): Promise<void> {
	const opened = await client.request("jai/trajectory/browser/open", {
		sessionId: options.sessionId,
		scopes: options.trajectoryScopes,
	});
	if (opened.isErr()) throw new CliRuntimeError({ message: opened.error.message });
	if (!isRecord(opened.value) || opened.value.ok !== true) {
		const error =
			isRecord(opened.value) && isRecord(opened.value.error) && typeof opened.value.error.message === "string"
				? opened.value.error.message
				: "Trajectory browser could not be opened";
		throw new CliRuntimeError({ message: error });
	}
	if (options.outputFormat === "stream-json") {
		writeEvent({ type: "system", subtype: "trajectory_opened", session_id: options.sessionId! });
		return;
	}
	if (options.outputFormat === "json") {
		process.stdout.write(`${JSON.stringify({ type: "trajectory_opened", sessionId: options.sessionId })}\n`);
		return;
	}
	process.stdout.write(`Opened trajectory for Session ${options.sessionId}\n`);
}

async function openCliSession(client: LocalAcpV2Client, options: CliOptions): Promise<string> {
	if (options.sessionId) {
		const resumed = await client.request("session/resume", {
			sessionId: options.sessionId,
			cwd: options.cwd,
			replayFrom: "none",
		});
		if (resumed.isErr()) throw new CliRuntimeError({ message: resumed.error.message });
		return options.sessionId;
	}
	const created = await client.request("session/new", {
		cwd: options.cwd,
		...(options.noSessionPersistence ? { ephemeral: true } : {}),
	});
	if (created.isErr()) throw new CliRuntimeError({ message: created.error.message });
	if (!isRecord(created.value) || typeof created.value.sessionId !== "string") {
		throw new CliRuntimeError({ message: "Runtime Host returned an invalid session/new result" });
	}
	return created.value.sessionId;
}

async function runInteractive(session: CliSession): Promise<void> {
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
			await runOne(session, prompt);
		}
	} finally {
		reader.close();
	}
}

async function runOne(session: CliSession, prompt: string): Promise<void> {
	const outcome = await session.prompt(prompt);
	if (session.outputFormat === "json") {
		process.stdout.write(
			`${JSON.stringify({
				type: "result",
				sessionId: session.id,
				text: outcome.text,
				diagnostics: { stop_reason: outcome.stopReason },
			})}\n`,
		);
	}
	if (session.outputFormat === "stream-json") {
		writeEvent({ type: "result", session_id: session.id, text: outcome.text, stop_reason: outcome.stopReason });
	}
	if (session.outputFormat === "text") process.stdout.write("\n");
}

class CliSession {
	readonly #unsubscribe: () => void;
	readonly #unsubscribeRequests: () => void;
	#pending?: { readonly resolve: (value: CliPromptOutcome) => void };
	#text = "";
	#stopReason = "none";

	constructor(
		private readonly client: LocalAcpV2Client,
		readonly id: string,
		readonly outputFormat: OutputFormat,
	) {
		this.#unsubscribe = client.subscribe((notification) => this.handleNotification(notification));
		this.#unsubscribeRequests = client.subscribeRequest((request) => {
			void this.respondToPermission(request);
		});
	}

	async prompt(text: string): Promise<CliPromptOutcome> {
		if (this.#pending) throw new CliRuntimeError({ message: `Session "${this.id}" is already running` });
		this.#text = "";
		this.#stopReason = "none";
		const completed = new Promise<CliPromptOutcome>((resolve) => {
			this.#pending = { resolve };
		});
		const sent = await this.client.request("session/prompt", {
			sessionId: this.id,
			prompt: [{ type: "text", text } satisfies AcpPromptBlock],
		});
		if (sent.isErr()) {
			this.#pending = undefined;
			throw new CliRuntimeError({ message: sent.error.message });
		}
		if (this.outputFormat === "stream-json") writeEvent({ type: "system", subtype: "init", session_id: this.id });
		return completed;
	}

	close(): void {
		this.#unsubscribe();
		this.#unsubscribeRequests();
	}

	private handleNotification(notification: AcpJsonRpcNotification): void {
		if (notification.method !== "session/update" || !isRecord(notification.params)) return;
		if (notification.params.sessionId !== this.id || !isRecord(notification.params.update)) return;
		const update = notification.params.update;
		if (update.sessionUpdate === "agent_message") {
			const text = blocksText(update.content);
			if (text) {
				this.#text = text;
				if (this.outputFormat === "text") process.stdout.write(text);
				if (this.outputFormat === "stream-json") {
					writeEvent({ type: "assistant", session_id: this.id, content: [{ type: "text", text }] });
				}
			}
			return;
		}
		if (update.sessionUpdate !== "state_update" || update.state !== "idle") return;
		this.#stopReason = typeof update.stopReason === "string" ? update.stopReason : "none";
		const pending = this.#pending;
		this.#pending = undefined;
		pending?.resolve({ text: this.#text, stopReason: this.#stopReason });
	}

	private async respondToPermission(request: AcpJsonRpcRequest): Promise<void> {
		if (request.method !== "session/request_permission" || request.id === undefined || !isRecord(request.params))
			return;
		if (request.params.sessionId !== this.id) return;
		const optionId = await choosePermissionOption(request.params);
		const response: AcpJsonRpcResponse = {
			jsonrpc: "2.0",
			id: request.id,
			result: { outcome: { outcome: "selected", optionId } },
		};
		this.client.respond(response);
	}
}

interface CliPromptOutcome {
	readonly text: string;
	readonly stopReason: string;
}

async function choosePermissionOption(params: Record<string, unknown>): Promise<string> {
	const options = Array.isArray(params.options)
		? params.options
				.filter(isRecord)
				.filter((option): option is Record<string, unknown> => typeof option.optionId === "string")
		: [];
	const reject = options.find((option) => option.kind === "reject_once")?.optionId ?? "reject";
	if (!input.isTTY || !output.isTTY) return reject as string;
	const title = typeof params.title === "string" ? params.title : "Permission requested";
	const reader = createInterface({ input, output, terminal: true });
	try {
		const answer = (await reader.question(`${title}\nAllow? [y]es/[n]o/[a]lways `)).trim().toLowerCase();
		if (answer === "a" || answer === "always") {
			const always = options.find((option) => option.kind === "allow_always")?.optionId;
			if (typeof always === "string") return always;
		}
		if (answer === "y" || answer === "yes") {
			const once = options.find((option) => option.kind === "allow_once")?.optionId;
			if (typeof once === "string") return once;
		}
		return reject as string;
	} finally {
		reader.close();
	}
}

function blocksText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.filter(isRecord)
		.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
		.join("");
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
	if (error instanceof CliRuntimeError) return { code: "cli.runtime_unavailable", message: error.message };
	if (error instanceof CliUsageError) return { code: "cli.usage_invalid", message: error.message };
	return { code: "cli.unknown", message: errorMessage(error) };
}

function helpText(): string {
	return `Jai coding agent\n\nUsage:\n  jai [prompt]\n  jai -p [prompt] [options]\n  cat task.md | jai -p [options]\n  jai trajectory --session-id <id> [--scope <scope>]\n\nOptions:\n  -p, --print [text]               Run one non-interactive prompt\n      --output-format <format>     text | json | stream-json\n      --cwd <path>                 Workspace root (default: current directory)\n      --session-id <id>            Resume a durable session\n      --no-session-persistence    Run in a Host-managed connection-scoped Session\n      --scope <scope>              Explicit Browser content scope (repeatable)\n  -h, --help                       Show this help\n  -v, --version                    Show the CLI version\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
