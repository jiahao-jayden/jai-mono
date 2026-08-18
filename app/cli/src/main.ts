#!/usr/bin/env node

import { runCli } from "./run";

try {
	const exitCode = await runCli(process.argv.slice(2));
	process.exitCode = exitCode;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`jai: ${message}\n`);
	process.exitCode = 1;
}
