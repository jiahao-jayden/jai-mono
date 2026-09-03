#!/usr/bin/env node

import { frontierErrorMessage } from "./core/errors";
import { frontierSmokeHelp, parseFrontierSmokeOptions } from "./runtime/options";
import { runFrontierSmoke } from "./runtime/run-trial";

const options = parseFrontierSmokeOptions(process.argv.slice(2));
if (options.isErr()) {
	process.stderr.write(`jai-frontier-smoke: ${frontierErrorMessage(options.error)}\n`);
	process.exitCode = 2;
} else if (options.value.help) {
	process.stdout.write(frontierSmokeHelp());
} else {
	const result = await runFrontierSmoke(options.value);
	if (result.isErr()) {
		process.stderr.write(`jai-frontier-smoke: ${frontierErrorMessage(result.error)}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(
			`${JSON.stringify({ status: result.value.status, result: `${result.value.outputDirectory}/result.json` })}\n`,
		);
		process.exitCode = result.value.status === "completed" ? 0 : 1;
	}
}
