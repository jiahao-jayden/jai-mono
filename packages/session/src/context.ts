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
		// 措辞刻意比较强硬：agent 不应确认 summary、不应复述之前在做什么、
		// 也不应以「我继续」之类开头，直接接着干最后那个任务。
		// 若本次 compact 切断了 turn，把 turn 前缀摘要作为额外上下文拼在主 summary 之后。
		const turnPrefixBlock = lastCompaction.turnPrefixSummary
			? `\n\n[Context for retained recent turn (its prefix was truncated)]\n${lastCompaction.turnPrefixSummary}`
			: "";

		const wrappedSummary = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${lastCompaction.summary}${turnPrefixBlock}

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
