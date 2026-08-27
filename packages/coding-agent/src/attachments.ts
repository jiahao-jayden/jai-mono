import type { AgentMessage, AgentToolResult, ToolCallContext, ToolMiddleware } from "@jai/agent";
import type { ImageContent } from "@jai/ai";
import { TaggedError } from "better-result";

export interface CodingMessageAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sourcePath: string;
	readonly image?: () => Promise<ImageContent>;
}

export interface CodingAttachmentFile {
	readonly sourcePath: string;
	readonly filename: string;
	readonly locator: string;
}

export interface CodingAttachmentAccess {
	resolve(locator: string): CodingAttachmentFile | undefined;
	isLocator(value: string): boolean;
	shellEnvironment(): Readonly<Record<string, string>> | undefined;
	displayCommand(command: string): string;
	redact(value: string): string;
}

class AttachmentRunAlreadyActive extends TaggedError("coding_attachment.run_already_active")<{
	readonly message: string;
}> {}
class DuplicateAttachmentId extends TaggedError("coding_attachment.duplicate_id")<{
	readonly message: string;
}> {}
export class AttachmentNotAvailable extends TaggedError("coding_attachment.not_available")<{
	readonly message: string;
}> {}

export function attachmentNotAvailableError(locator: string): AttachmentNotAvailable {
	return new AttachmentNotAvailable({ message: `Attachment is no longer available: ${locator}` });
}

export class CodingAttachmentRun implements CodingAttachmentAccess {
	#active: readonly CodingMessageAttachment[] | undefined;

	async invoke<T>(attachments: readonly CodingMessageAttachment[], run: () => Promise<T>): Promise<T> {
		if (this.#active) {
			throw new AttachmentRunAlreadyActive({ message: "Attachment context is already active" });
		}
		assertUniqueIds(attachments);
		this.#active = attachments;
		try {
			return await run();
		} finally {
			this.#active = undefined;
		}
	}

	async project(messages: readonly AgentMessage[]): Promise<AgentMessage[] | undefined> {
		const active = this.#active;
		if (!active || active.length === 0) return undefined;
		const ids = active.map((attachment) => attachment.id);
		const targetIndex = findAttachmentMessage(messages, ids);
		if (targetIndex < 0) return undefined;
		const target = messages[targetIndex];
		if (!target || target.role !== "user") return undefined;
		const content =
			typeof target.content === "string" ? [{ type: "text" as const, text: target.content }] : [...target.content];
		const images = await Promise.all(active.flatMap((attachment) => (attachment.image ? [attachment.image()] : [])));
		const next = [...messages];
		next[targetIndex] = {
			...target,
			content: [
				...content,
				{ type: "text" as const, text: attachmentInstructions(active), synthetic: true },
				...images,
			],
		};
		return next;
	}

	resolve(locator: string): CodingAttachmentFile | undefined {
		const id = runAttachmentId(locator);
		if (!id) return undefined;
		const index = Number(id.slice(4));
		const attachment = Number.isInteger(index) ? this.#active?.[index - 1] : undefined;
		return attachment
			? { sourcePath: attachment.sourcePath, filename: attachment.filename, locator: attachmentLocator(id) }
			: undefined;
	}

	isLocator(value: string): boolean {
		return value.startsWith("attachment://");
	}

	shellEnvironment(): Readonly<Record<string, string>> | undefined {
		const active = this.#active;
		if (!active || active.length === 0) return undefined;
		return Object.fromEntries(active.map((attachment, index) => [shellVariable(index), attachment.sourcePath]));
	}

	displayCommand(command: string): string {
		const active = this.#active;
		if (!active || !command) return command;
		return active.reduce(
			(text, attachment, index) => text.replaceAll(`$${shellVariable(index)}`, attachment.filename),
			command,
		);
	}

	redact(value: string): string {
		const active = this.#active;
		if (!active || !value) return value;
		return active
			.map((attachment, index) => [attachment.sourcePath, `$${shellVariable(index)}`] as const)
			.sort(([left], [right]) => right.length - left.length)
			.reduce((text, [sourcePath, replacement]) => text.replaceAll(sourcePath, replacement), value);
	}

	readonly aroundToolCall: ToolMiddleware = async (context, next) => {
		const active = this.#active;
		const path = stringArgument(context, "path");
		if (!active) {
			if (path && this.isLocator(path)) throw attachmentNotAvailableError(path);
			return next();
		}
		const attachment = path ? this.resolve(path) : undefined;
		if (path && this.isLocator(path) && !attachment) throw attachmentNotAvailableError(path);
		if (attachment) context.args.path = attachment.sourcePath;
		if (context.tool.name === "Bash") {
			const command = stringArgument(context, "command");
			const projected = command ? injectShellEnvironment(command, this.shellEnvironment()) : undefined;
			if (projected) context.args.command = projected;
		}
		const result = await next();
		return redactResult(result, this);
	};
}

export function attachmentUserMessage(input: {
	readonly text: string;
	readonly attachments: readonly Pick<CodingMessageAttachment, "id" | "filename" | "mimeType" | "size">[];
	readonly timestamp?: number;
}): Extract<AgentMessage, { readonly role: "user" }> {
	return {
		role: "user",
		content: input.text,
		metadata: {
			messageAttachments: input.attachments.map(({ id, filename, mimeType, size }) => ({
				id,
				filename,
				mimeType,
				size,
			})),
		},
		timestamp: input.timestamp ?? Date.now(),
	};
}

function attachmentInstructions(attachments: readonly CodingMessageAttachment[]): string {
	return [
		"The user attached local files for this run:",
		...attachments.flatMap((attachment, index) => [
			`- ${attachment.filename} (${attachment.mimeType}, ${attachment.size} bytes)`,
			`  Exact attachment handle: ${attachmentLocator(runAttachmentIdForIndex(index))}`,
			`  Use this handle as the path for Read, Edit, Write, Bash, or an Extension-provided resource tool: $${shellVariable(index)}.`,
		]),
		"Only the attachment handles listed in this run are active; previous-run handles are unavailable.",
		"Attachments are available only to this CodingAgent run, not to subagents.",
	].join("\n");
}

function findAttachmentMessage(messages: readonly AgentMessage[], ids: readonly string[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || message.role !== "user") continue;
		const value = message.metadata?.messageAttachments;
		if (!Array.isArray(value) || value.length !== ids.length) continue;
		const messageIds = value.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []));
		if (messageIds.length === ids.length && messageIds.every((id, itemIndex) => id === ids[itemIndex])) return index;
	}
	return -1;
}

function assertUniqueIds(attachments: readonly CodingMessageAttachment[]): void {
	const ids = new Set<string>();
	for (const attachment of attachments) {
		if (ids.has(attachment.id))
			throw new DuplicateAttachmentId({ message: `Duplicate attachment id: ${attachment.id}` });
		ids.add(attachment.id);
	}
}

function runAttachmentId(locator: string): string | undefined {
	if (!locator.startsWith("attachment://")) return undefined;
	const id = locator.slice("attachment://".length);
	return /^att_[1-9][0-9]*$/.test(id) ? id : undefined;
}

function runAttachmentIdForIndex(index: number): string {
	return `att_${index + 1}`;
}

function attachmentLocator(id: string): string {
	return `attachment://${id}`;
}

function shellVariable(index: number): string {
	return `JAI_ATTACHMENT_${index + 1}`;
}

function injectShellEnvironment(command: string, environment: Readonly<Record<string, string>> | undefined): string {
	if (!environment || Object.keys(environment).length === 0) return command;
	const prefix = Object.entries(environment)
		.map(([name, value]) => `${name}=${shellQuote(value)}`)
		.join(" ");
	return `${prefix} ${command}`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function redactResult(result: AgentToolResult, access: CodingAttachmentAccess): AgentToolResult {
	return {
		...result,
		content: result.content.map((part) =>
			part.type === "text" ? { ...part, text: access.redact(part.text) } : part,
		),
	};
}

function stringArgument(context: ToolCallContext, key: string): string | undefined {
	const value = context.args[key];
	return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
