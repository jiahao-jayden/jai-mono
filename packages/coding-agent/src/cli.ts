#!/usr/bin/env node

import { AgentSession } from "./core/agent-session.js";
import { createDefaultTools } from "./tools/index.js";

async function main() {
	const userInput = process.argv.slice(2).join(" ");
	if (!userInput) {
		console.log("Usage: jai <message>");
		process.exit(1);
	}

	const cwd = process.cwd();

	const session = await AgentSession.create({
		cwd,
		model: "anthropic/claude-sonnet-4-20250514",
		tools: createDefaultTools(cwd),
	});

	session.onEvent((event) => {
		if (event.type === "stream" && event.event.type === "text_delta") {
			process.stdout.write(event.event.text);
		}
	});

	try {
		await session.chat(userInput);
		console.log();
	} finally {
		await session.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
