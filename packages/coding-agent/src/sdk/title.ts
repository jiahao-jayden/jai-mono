import type { Model, Provider } from "@jai/ai";
import { Result, type Result as ResultType } from "better-result";
import { CodingSdkFailure, projectError } from "./project";
import type { CodingSdkError } from "./types";

/**
 * Generates a concise session title from the first user message and the
 * assistant's text. Stateless: callers pass the resolved provider and model,
 * so this works without a live Coding Agent instance.
 */
export async function generateSessionTitle(
	provider: Provider,
	model: Model,
	firstMessage: string,
	assistantText: string,
): Promise<ResultType<string, CodingSdkError>> {
	try {
		const stream = provider.stream(
			model,
			{
				systemPrompt:
					"Generate a concise session title of at most 8 words. Return only the title, without quotes or punctuation.",
				messages: [
					{
						role: "user",
						content: `User request:\n${firstMessage.slice(0, 2_000)}\n\nAssistant response:\n${assistantText}`,
						timestamp: Date.now(),
					},
				],
				tools: [],
			},
			{ temperature: 0, maxTokens: 32 },
		);
		const result = await stream.result();
		if (result.stopReason === "error" || result.stopReason === "aborted") {
			throw new CodingSdkFailure({
				phase: "model",
				code: "coding_sdk.title_generation_failed",
				message: "Session title generation failed",
			});
		}
		return Result.ok(
			result.content
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("")
				.trim()
				.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""),
		);
	} catch (error) {
		return Result.err(projectError(error, "model"));
	}
}
