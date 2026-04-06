#!/usr/bin/env node

import {
	AgentSession,
	SettingsManager,
	Workspace,
	createDefaultTools,
} from "@jayden/jai-coding-agent";
import { render } from "ink";
import { App } from "./App.js";

async function main() {
	const workspace = await Workspace.create({ cwd: process.cwd() });
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

	const { waitUntilExit } = render(<App session={session} />);

	try {
		await waitUntilExit();
	} finally {
		await session.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
