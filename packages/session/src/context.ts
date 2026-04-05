import type { Message } from "@jayden/jai-ai";
import type { CompactionEntry, SessionStore } from "./types.js";

export function buildSessionContext(store: SessionStore, leafId?: string): Message[] {
	const messages: Message[] = [];
	const branch = store.getBranch(leafId);

	let lastCompaction: CompactionEntry | null = null;

	for (const entry of branch) {
		if (entry.type === "compaction") {
			lastCompaction = entry;
		}
	}

	if (lastCompaction) {
		// Add the compaction summary as a user message
		messages.push({
			role: "user",
			content: [{ type: "text", text: lastCompaction.summary }],
			timestamp: lastCompaction.timestamp,
		});

		let keeping = false;

		for (const entry of branch) {
			if (entry.id === lastCompaction.firstKeptEntryId) {
				keeping = true;
			}
			if (keeping && entry.type === "message") {
				messages.push(entry.message);
			}
		}
	} else {
		for (const entry of branch) {
			if (entry.type === "message") {
				messages.push(entry.message);
			}
		}
	}

	return messages;
}
