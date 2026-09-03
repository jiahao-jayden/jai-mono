import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openConfiguredRuntimeHost } from "@jai/server";
import { connectDesktopConfigurationClient } from "@jai/server/desktop-configuration-client";

const roots: string[] = [];
const describeE2E = process.env.CLI_E2E === "1" ? describe : describe.skip;

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describeE2E("jai CLI provider subprocess", () => {
	test("runs an OpenAI-compatible tool call and emits harness-consumable stream-json", async () => {
		const server = await startMockProvider();
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Mock provider did not bind a TCP address");
		const root = await mkdtemp(join(tmpdir(), "jai-cli-provider-e2e-"));
		roots.push(root);
		const dataDirectory = join(root, "home");
		const runtime = await openConfiguredRuntimeHost({ dataDirectory, environment: {} });
		if (runtime.isErr()) throw runtime.error;
		try {
			await configureMockProvider(dataDirectory, address.port);
			const child = Bun.spawn({
				cmd: [
					process.execPath,
					"src/main.ts",
					"--print",
					"Write the smoke file",
					"--cwd",
					root,
					"--output-format",
					"stream-json",
					"--no-session-persistence",
					"--model",
					"test/mock",
					"--mode",
					"automate",
				],
				cwd: resolve(import.meta.dir, ".."),
				env: {
					...process.env,
					JAI_HOME: join(root, "home"),
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);

			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			const records = stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			const result = records.at(-1);
			expect(result).toMatchObject({
				type: "result",
				diagnostics: { stop_reason: "end_turn", tool_calls: 1, tool_errors: 0 },
			});
			expect(await readFile(join(root, "smoke.txt"), "utf8")).toBe("tool completed");
		} finally {
			await runtime.value.close();
			await closeServer(server);
		}
	});
});

async function configureMockProvider(dataDirectory: string, port: number): Promise<void> {
	const connected = await connectDesktopConfigurationClient({ dataDirectory, environment: {} });
	if (connected.isErr()) throw connected.error;
	try {
		const saved = await connected.value.save({
			revision: null,
			model: "test/mock",
			providers: [
				{
					id: "test",
					name: "Test",
					adapter: "openai-compatible",
					baseURL: `http://127.0.0.1:${port}/v1`,
					authentication: "none",
					enabled: true,
					models: [{ id: "mock", enabled: true }],
				},
			],
		});
		if (saved.isErr()) throw saved.error;
	} finally {
		await connected.value.close();
	}
}

async function startMockProvider(): Promise<Server> {
	let requestCount = 0;
	const server = createServer(async (request, response) => {
		requestCount += 1;
		for await (const _chunk of request) {
			// Drain the request body before responding.
		}
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		if (requestCount === 1) {
			response.write(
				'data: {"id":"mock-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"Write","arguments":"{\\"path\\":\\"smoke.txt\\",\\"content\\":\\"tool completed\\"}"}}]},"finish_reason":null}]}\n\n',
			);
			response.write(
				'data: {"id":"mock-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":0}}}\n\n',
			);
		} else {
			response.write(
				'data: {"id":"mock-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"mock tool call completed"},"finish_reason":null}]}\n\n',
			);
			response.write(
				'data: {"id":"mock-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":6,"prompt_tokens_details":{"cached_tokens":0}}}\n\n',
			);
		}
		response.end("data: [DONE]\n\n");
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	return server;
}

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
