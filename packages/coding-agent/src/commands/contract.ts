import type { AgentInput } from "@jai/agent";
import { type Result as ResultType, TaggedError } from "better-result";

type CommandErrorInit = {
	readonly message: string;
	readonly command?: string;
	readonly extensionId?: string;
	readonly cause?: unknown;
};

export class CodingCommandRegistrationFailed extends TaggedError(
	"coding_command.registration_failed",
)<CommandErrorInit> {}

export class CodingCommandExecutionFailed extends TaggedError("coding_command.execution_failed")<CommandErrorInit> {}

export type CodingCommandKind = "extension" | "file" | "skill";

export interface CodingCommandContext {
	readonly sessionId: string;
	readonly cwd: string;
}

export type CodingCommandResult = { readonly kind: "handled" } | { readonly kind: "prompt"; readonly prompt: string };

export interface CodingCommandDefinition {
	readonly name: string;
	readonly description: string;
	readonly displayName?: string;
	readonly kind?: CodingCommandKind;
	handler(
		args: string,
		context: CodingCommandContext,
	):
		| ResultType<CodingCommandResult, CodingCommandExecutionFailed>
		| Promise<ResultType<CodingCommandResult, CodingCommandExecutionFailed>>;
}

export interface CodingCommandInvocation {
	readonly name: string;
	readonly kind: "command";
	readonly commandKind: CodingCommandKind;
	readonly displayName: string;
}

export interface CodingRegisteredCommand extends CodingCommandInvocation {
	readonly description: string;
}

/** Owns one registration for the lifetime of an Extension instance. */
export interface CodingCommandRegistration {
	unregister(): void;
}

export type CodingCommandDispatch =
	| { readonly kind: "handled"; readonly invocation: CodingCommandInvocation }
	| { readonly kind: "prompt"; readonly input: AgentInput; readonly invocation: CodingCommandInvocation };

export interface CodingCommandRegistry {
	register(
		extensionId: string,
		command: CodingCommandDefinition,
	): ResultType<CodingCommandRegistration, CodingCommandRegistrationFailed>;
	list(): readonly CodingRegisteredCommand[];
	dispatch(input: AgentInput): Promise<ResultType<CodingCommandDispatch | undefined, CodingCommandExecutionFailed>>;
	promptContext(): string | undefined;
	clearPromptContext(): void;
}
