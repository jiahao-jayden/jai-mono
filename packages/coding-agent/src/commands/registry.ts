import type { AgentInput } from "@jai/agent";
import { Result, type Result as ResultType } from "better-result";
import {
	type CodingCommandContext,
	type CodingCommandDefinition,
	type CodingCommandDispatch,
	CodingCommandExecutionFailed,
	type CodingCommandInvocation,
	type CodingCommandKind,
	type CodingCommandRegistration,
	CodingCommandRegistrationFailed,
	type CodingCommandRegistry,
	type CodingCommandResult,
	type CodingRegisteredCommand,
} from "./contract";

interface RegisteredCommand {
	readonly extensionId: string;
	readonly definition: CodingCommandDefinition;
}

export interface CreateCodingCommandRegistryOptions extends CodingCommandContext {}

export function createCodingCommandRegistry(options: CreateCodingCommandRegistryOptions): CodingCommandRegistry {
	return new OperationCommandRegistry(options);
}

class OperationCommandRegistry implements CodingCommandRegistry {
	readonly #context: CodingCommandContext;
	readonly #commands = new Map<string, RegisteredCommand[]>();
	#activePromptContext?: string;

	constructor(context: CodingCommandContext) {
		this.#context = context;
	}

	register(
		extensionId: string,
		command: CodingCommandDefinition,
	): ResultType<CodingCommandRegistration, CodingCommandRegistrationFailed> {
		const extension = extensionId.trim();
		const kind = command.kind ?? "extension";
		if (
			!extension ||
			!isCommandName(command.name) ||
			!command.description.trim()
		) {
			return Result.err(
				new CodingCommandRegistrationFailed({
					command: command.name,
					extensionId,
					message: `Extension "${extensionId}" declared an invalid command`,
				}),
			);
		}
		if (command.name.endsWith(":0") || /:\d+$/u.test(command.name)) {
			return Result.err(
				new CodingCommandRegistrationFailed({
					command: command.name,
					extensionId: extension,
					message: `Command "${command.name}" reserves its numeric suffix for collision resolution`,
				}),
			);
		}
		const commands = this.#commands.get(command.name) ?? [];
		const registered = { extensionId: extension, definition: command };
		commands.push(registered);
		this.#commands.set(command.name, commands);
		return Result.ok({
			unregister: () => this.#unregister(command.name, registered),
		});
	}

	#unregister(commandName: string, registered: RegisteredCommand): void {
		const commands = this.#commands.get(commandName);
		if (!commands) return;
		const remaining = commands.filter((command) => command !== registered);
		if (remaining.length === 0) {
			this.#commands.delete(commandName);
			return;
		}
		this.#commands.set(commandName, remaining);
	}

	list(): readonly CodingRegisteredCommand[] {
		return [...this.#commands.entries()].flatMap(([name, commands]) =>
			commands.map((command, index) => {
				const invocation = this.#invocation(name, command.definition, commands.length, index);
				return {
					...invocation,
					description: command.definition.description,
				};
			}),
		);
	}

	async dispatch(
		input: AgentInput,
	): Promise<ResultType<CodingCommandDispatch | undefined, CodingCommandExecutionFailed>> {
		this.clearPromptContext();
		const parsed = parseCommandInput(input);
		if (!parsed) return Result.ok(undefined);
		const resolved = this.#resolve(parsed.name);
		if (!resolved) return Result.ok(undefined);
		let outcome: ResultType<CodingCommandResult, CodingCommandExecutionFailed>;
		try {
			outcome = await resolved.command.definition.handler(parsed.args, this.#context);
		} catch (cause) {
			return Result.err(
				new CodingCommandExecutionFailed({
					command: resolved.invocation.name,
					extensionId: resolved.command.extensionId,
					message: `Command "/${resolved.invocation.name}" handler failed`,
					cause,
				}),
			);
		}
		if (outcome.isErr()) return outcome;
		if (outcome.value.kind === "handled") {
			return Result.ok({ kind: "handled", invocation: resolved.invocation });
		}
		const prompt = outcome.value.prompt;
		if (!prompt.trim() || prompt.length > 8_000) {
			return Result.err(
				new CodingCommandExecutionFailed({
					command: resolved.invocation.name,
					extensionId: resolved.command.extensionId,
					message: `Command "/${resolved.invocation.name}" returned invalid prompt context`,
				}),
			);
		}
		this.#activePromptContext = prompt;
		return Result.ok({
			kind: "prompt",
			input: annotateSlashInvocation(input, resolved.invocation),
			invocation: resolved.invocation,
		});
	}

	promptContext(): string | undefined {
		return this.#activePromptContext;
	}

	clearPromptContext(): void {
		this.#activePromptContext = undefined;
	}

	#resolve(
		invocationName: string,
	): { readonly command: RegisteredCommand; readonly invocation: CodingCommandInvocation } | undefined {
		for (const [name, commands] of this.#commands) {
			for (let index = 0; index < commands.length; index++) {
				const command = commands[index]!;
				const invocation = this.#invocation(name, command.definition, commands.length, index);
				if (invocation.name === invocationName) return { command, invocation };
			}
		}
		return undefined;
	}

	#invocation(
		name: string,
		definition: CodingCommandDefinition,
		duplicateCount: number,
		index: number,
	): CodingCommandInvocation {
		const kind: CodingCommandKind = definition.kind ?? "extension";
		return {
			name: duplicateCount === 1 ? name : `${name}:${index + 1}`,
			kind: "command",
			commandKind: kind,
			displayName: definition.displayName?.trim() || name,
		};
	}
}

function parseCommandInput(input: AgentInput): { readonly name: string; readonly args: string } | undefined {
	const message = Array.isArray(input) ? input.find((candidate) => candidate.role === "user") : input;
	const content = typeof message === "string" ? message : message?.role === "user" ? message.content : undefined;
	if (typeof content !== "string") return undefined;
	const match = /^\/([^\s]+)([\s\S]*)$/u.exec(content);
	if (!match || !isCommandName(match[1]!)) return undefined;
	return { name: match[1]!, args: match[2]!.replace(/^\s+/u, "") };
}

function annotateSlashInvocation(input: AgentInput, invocation: CodingCommandInvocation): AgentInput {
	const metadata = {
		slashInvocation: {
			name: invocation.name,
			kind: invocation.kind,
			commandKind: invocation.commandKind,
			displayName: invocation.displayName,
		},
	};
	if (typeof input === "string") {
		return { role: "user", content: input, metadata, timestamp: Date.now() };
	}
	if (!Array.isArray(input)) {
		return input.role === "user" ? { ...input, metadata: { ...input.metadata, ...metadata } } : input;
	}
	let annotated = false;
	return input.map((message) => {
		if (annotated || message.role !== "user") return message;
		annotated = true;
		return { ...message, metadata: { ...message.metadata, ...metadata } };
	});
}

function isCommandName(name: string): boolean {
	if (!name || name.startsWith(":") || name.endsWith(":")) return false;
	return name.split(":").every((segment) => /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(segment));
}
