#!/usr/bin/env node

import { AgentSession } from "./core/agent-session.js";
import { SettingsManager } from "./core/settings.js";
import { Workspace } from "./core/workspace.js";
import { createDefaultTools } from "./tools/index.js";

async function main() {
	const userInput = process.argv.slice(2).join(" ");
	if (!userInput) {
		console.log("Usage: jai <message>");
		process.exit(1);
	}

	const workspace = Workspace.create({ cwd: process.cwd() });
	const settings = await SettingsManager.load(workspace);

	for (const [key, value] of Object.entries(settings.get("env"))) {
		process.env[key] ??= value;
	}

	const session = await AgentSession.create({
		workspace,
		model: settings.get("model"),
		baseURL: settings.get("baseURL"),
		tools: createDefaultTools(workspace.cwd),
		maxIterations: settings.get("maxIterations"),
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
