#!/usr/bin/env bun

import { GatewayServer } from "./server.js";

function parseArgs(args: string[]): { port?: number } {
	const result: { port?: number } = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port" && args[i + 1]) {
			result.port = Number.parseInt(args[i + 1], 10);
			i++;
		}
	}
	return result;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));

	const server = await GatewayServer.create({
		cwd: process.cwd(),
		port: opts.port,
	});

	const { port, hostname } = server.listen(opts.port);
	console.log(`JAI Gateway listening on http://${hostname}:${port}`);

	const shutdown = async () => {
		console.log("\nShutting down...");
		await server.close();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("Failed to start gateway:", err);
	process.exit(1);
});
