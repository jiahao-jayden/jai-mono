import type { ImageContent, Message, Model, TextContent } from "./types";

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

export function transformMessagesForModel(messages: readonly Message[], model: Pick<Model, "input">): Message[] {
	if (model.input.includes("image")) return [...messages];

	return messages.map((message) => {
		if (message.role === "user" && Array.isArray(message.content)) {
			return {
				...message,
				content: replaceImages(message.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
			};
		}
		if (message.role === "toolResult") {
			return {
				...message,
				content: replaceImages(message.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
			};
		}
		return message;
	});
}

function replaceImages(content: readonly (TextContent | ImageContent)[], placeholder: string): TextContent[] {
	const result: TextContent[] = [];
	let previousWasPlaceholder = false;

	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({ type: "text", text: placeholder });
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}

	return result;
}
