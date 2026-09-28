import { branchOf, type MessageEntry, type SessionEntry } from "@jai/agent";
import type { AssistantMessage, UserMessage } from "@jai/ai";
import { generateSessionTitle, type ResolvedSdkModel, resolveSdkModel } from "@jai/coding-agent";
import type { SqliteRuntimeAgentSettings } from "../config";
import type { HostLog } from "../logging";
import type { SqliteDesktopCatalogAccess } from "../persistence/sqlite/desktop-catalog";
import type { ProductSessionPersistence } from "../sessions";

export interface SessionTitleGeneratorOptions {
	readonly catalog: SqliteDesktopCatalogAccess;
	readonly persistence: ProductSessionPersistence;
	readonly agentSettings: SqliteRuntimeAgentSettings;
	readonly now: () => Date;
	readonly log?: HostLog;
}

/**
 * Schedules async session-title generation for a durable Session whose turn
 * just ended. Fire-and-forget: the caller (`RuntimeHost.onTurnEnded`) never
 * awaits this. Every step degrades silently — a missing catalog row, a failed
 * model call, or a provider error leaves the existing fallback title in place.
 */
export class SessionTitleGenerator {
	readonly #options: SessionTitleGeneratorOptions;
	#running = new Set<string>();

	constructor(options: SessionTitleGeneratorOptions) {
		this.#options = options;
	}

	schedule(sessionId: string): void {
		if (this.#running.has(sessionId)) return;
		this.#running.add(sessionId);
		void this.generate(sessionId).finally(() => this.#running.delete(sessionId));
	}

	private async generate(sessionId: string): Promise<void> {
		const { catalog, persistence, agentSettings, now, log } = this.#options;
		const needed = catalog.shouldGenerateSessionTitle(sessionId);
		if (needed.isErr() || !needed.value) return;

		const marked = catalog.markTitleGenerationAttempted({ sessionId, timestamp: now().getTime() });
		if (marked.isErr()) return;

		const loaded = await persistence.load(sessionId);
		if (loaded.isErr()) return;

		const branch = branchOf(loaded.value.snapshot.entries, loaded.value.snapshot.leafId);
		const firstMessage = firstUserMessageText(branch);
		if (!firstMessage) return;
		const assistantText = collectAssistantText(branch);

		const resolved = agentSettings.resolveOptions(loaded.value.runtimeConfiguration.model);
		if (resolved.isErr() || !resolved.value.provider) {
			log?.warn("session title generation skipped", { sessionId, reason: "no provider" });
			return;
		}
		let sdkModel: ResolvedSdkModel;
		try {
			sdkModel = resolveSdkModel(resolved.value.model, resolved.value.provider);
		} catch (error) {
			log?.warn("session title generation skipped", { sessionId, reason: "invalid model", error: String(error) });
			return;
		}

		const title = await generateSessionTitle(sdkModel.provider, sdkModel.model, firstMessage, assistantText);
		if (title.isErr() || !title.value.trim()) return;

		const written = catalog.setGeneratedTitle({ sessionId, title: title.value.trim() });
		if (written.isErr()) {
			log?.warn("session title write failed", { sessionId, error: written.error.message });
		}
	}
}

function firstUserMessageText(entries: readonly SessionEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = (entry as MessageEntry).message;
		if (message.role !== "user") continue;
		return userMessageText(message);
	}
	return undefined;
}

function userMessageText(message: UserMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { readonly type: "text"; readonly text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function collectAssistantText(entries: readonly SessionEntry[]): string {
	return entries
		.filter((entry): entry is MessageEntry => entry.type === "message")
		.map((entry) => entry.message)
		.filter((message): message is AssistantMessage => message.role === "assistant")
		.flatMap((message) => message.content)
		.filter((part): part is { readonly type: "text"; readonly text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.slice(0, 2_000);
}
