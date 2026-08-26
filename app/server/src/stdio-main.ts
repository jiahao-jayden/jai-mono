#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import {
	localAcpV2EndpointFor,
	openLocalAcpV2Client,
	runAcpStdioBridge,
	resolveJaiDataDirectory,
} from "./index";

const dataDirectory = resolveJaiDataDirectory();
const endpoint = process.env.JAI_RUNTIME_ENDPOINT ?? localAcpV2EndpointFor(dataDirectory);
const connected = await connectOrLaunch(endpoint);
if (connected.isErr()) {
	process.stderr.write(`jai-acp: ${connected.error.message}\n`);
	process.exitCode = 1;
} else {
	const bridged = await runAcpStdioBridge({ endpoint, client: connected.value });
	if (bridged.isErr()) {
		process.stderr.write(`jai-acp: ${bridged.error.message}\n`);
		process.exitCode = 1;
	}
}

async function connectOrLaunch(endpoint: string) {
	const connected = await openLocalAcpV2Client(endpoint);
	if (connected.isOk()) return connected;
	const path = fileURLToPath(import.meta.url);
	const hostEntrypoint = join(dirname(path), `main${extname(path)}`);
	const host = spawn(process.execPath, [hostEntrypoint], {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	host.unref();
	for (let attempt = 0; attempt < 60; attempt += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		const retried = await openLocalAcpV2Client(endpoint);
		if (retried.isOk()) return retried;
	}
	return connected;
}
