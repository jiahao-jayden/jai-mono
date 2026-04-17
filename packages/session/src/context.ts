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
		// Matches claude-code's getCompactUserSummaryMessage with
		// suppressFollowUpQuestions=true + recentMessagesPreserved=true.
		// The wording is intentionally strong: the agent should not acknowledge
		// the summary, recap what was happening, or preface with "I'll
		// continue" — it just picks up the last task as if no break happened.
		const wrappedSummary = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${lastCompaction.summary}

Recent messages are preserved verbatim.
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`;

		messages.push({
			role: "user",
			content: [{ type: "text", text: wrappedSummary }],
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
