import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
		try {
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
					"--permission-mode",
					"bypassPermissions",
					"--no-session-persistence",
					"--max-turns",
					"2",
				],
				cwd: resolve(import.meta.dir, ".."),
				env: {
					...process.env,
					JAI_HOME: join(root, "home"),
					JAI_AGENT_MODEL: "test/mock",
					JAI_PROVIDERS: JSON.stringify({
						test: {
							adapter: "openai-compatible",
							baseURL: `http://127.0.0.1:${address.port}/v1`,
							auth: "none",
							models: {
								mock: {
									enabled: true,
									input: ["text"],
									modalities: { input: ["text"], output: ["text"] },
									toolCall: true,
									contextWindow: 128_000,
									maxTokens: 256,
								},
							},
						},
					}),
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			const records = stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			expect(records.some((record) => record.type === "tool_start" && record.tool_name === "Write")).toBe(true);
			expect(records.some((record) => record.type === "tool_end" && record.is_error === false)).toBe(true);
			expect(
				records.some(
					(record) =>
						record.type === "assistant" &&
						JSON.stringify(record.message).includes('"type":"tool_use"'),
				),
			).toBe(true);
			const result = records.at(-1);
			expect(result).toMatchObject({
				type: "result",
				usage: { input_tokens: 30, output_tokens: 13, total_tokens: 43 },
			});
			expect(await readFile(join(root, "smoke.txt"), "utf8")).toBe("tool completed");
		} finally {
			await closeServer(server);
		}
	});
});

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
