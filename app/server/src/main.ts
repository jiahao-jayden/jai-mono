#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openConfiguredRuntimeHost } from "./runtime";

const opened = await openConfiguredRuntimeHost({
	browserAssetsDirectory: join(dirname(fileURLToPath(import.meta.url)), "trajectory-browser"),
});
if (opened.isErr()) {
	process.stderr.write(`jai-runtime-host: ${opened.error.message}\n`);
	process.exitCode = 1;
} else {
	const server = opened.value;
	let stopping = false;
	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		void server.close().finally(resolveStopped);
	};
	let resolveStopped!: () => void;
	const stopped = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	process.stderr.write(`jai-runtime-host: listening on ${server.endpoint}\n`);
	await stopped;
}
