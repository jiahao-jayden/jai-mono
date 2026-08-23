import { describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connectMcpServers } from "../src/mcp";

describe("通用 MCP 客户端", () => {
	test("通过 stdio 完成 initialize、tools/list 和 tools/call", async () => {
		const probe = [
			"const readline=require('node:readline');",
			"const rl=readline.createInterface({input:process.stdin});",
			"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list')result={tools:[{name:'echo',description:'Echo input',annotations:{title:'Fetch value',readOnlyHint:true},inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};else if(r.method==='tools/call')result={content:[{type:'text',text:String(r.params.arguments.text)}]};else result={};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
		].join("");
		const runtime = await connectMcpServers({
			namespace: "settings",
			servers: [{ name: "probe", type: "stdio", command: "node", args: ["-e", probe], env: {} }],
		});

		expect(runtime.isOk()).toBe(true);
		if (runtime.isErr()) return;
		expect(runtime.value.tools.map((entry) => entry.tool.name)).toEqual(["mcp__settings__probe__echo"]);
		expect(runtime.value.tools[0]?.presentation.activityKind).toBe("call");
		expect(runtime.value.tools[0]?.presentation.title?.({ text: "hello" })).toBe("Fetch value");
		const result = await runtime.value.tools[0]!.tool.execute("call-1", { text: "hello" });
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
		await runtime.value.close();
	});

	test.each(["streamable-http", "sse"] as const)(
		"通过 %s 完成 initialize、tools/list 和 tools/call",
		async (type) => {
			const probe = await createHttpProbe(type);
			try {
				const runtime = await connectMcpServers({
					namespace: "settings",
					servers: [{ name: type, type, url: probe.url, headers: {} }],
				});

				expect(runtime.isOk()).toBe(true);
				if (runtime.isErr()) return;
				expect(runtime.value.diagnostics).toEqual([]);
				expect(runtime.value.tools.map((entry) => entry.tool.name)).toEqual([
					`mcp__settings__${type}__echo`,
				]);
				expect(runtime.value.tools[0]?.presentation.activityKind).toBe("call");
				const result = await runtime.value.tools[0]!.tool.execute("call-1", { text: type });
				expect(result.content).toEqual([{ type: "text", text: type }]);
				await runtime.value.close();
			} finally {
				await probe.close();
			}
		},
	);
});

type HttpProbeType = "streamable-http" | "sse";

async function createHttpProbe(type: HttpProbeType): Promise<{
	readonly url: string;
	close(): Promise<void>;
}> {
	let eventStream: ServerResponse<IncomingMessage> | undefined;
	const server = createServer(async (request, response) => {
		if (type === "sse" && request.method === "GET" && request.url === "/sse") {
			eventStream = response;
			response.writeHead(200, {
				"cache-control": "no-cache",
				connection: "keep-alive",
				"content-type": "text/event-stream",
			});
			response.write("event: endpoint\ndata: /messages\n\n");
			return;
		}
		if (type === "streamable-http" && request.method === "GET" && request.url === "/mcp") {
			response.writeHead(405, { allow: "POST" });
			response.end();
			return;
		}
		const expectedPath = type === "sse" ? "/messages" : "/mcp";
		if (request.method !== "POST" || request.url !== expectedPath) {
			response.writeHead(404);
			response.end();
			return;
		}

		const message = (await readJsonBody(request)) as {
			readonly id?: string | number;
			readonly method?: string;
			readonly params?: { readonly arguments?: { readonly text?: string } };
		};
		if (message.id === undefined) {
			response.writeHead(202);
			response.end();
			return;
		}
		const result =
			message.method === "initialize"
				? {
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: type, version: "1" },
				}
				: message.method === "tools/list"
					? {
						tools: [
							{
								name: "echo",
								description: "Echo input",
								inputSchema: {
									type: "object",
									properties: { text: { type: "string" } },
									required: ["text"],
									additionalProperties: false,
								},
							},
						],
					}
					: {
						content: [{ type: "text", text: String(message.params?.arguments?.text) }],
					};
		const payload = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
		if (type === "sse") {
				response.writeHead(202);
				response.end();
				eventStream?.write(`event: message\ndata: ${payload}\n\n`);
				return;
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(payload);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("MCP probe did not bind to a TCP port");
	}
	return {
		url: `http://127.0.0.1:${address.port}${type === "sse" ? "/sse" : "/mcp"}`,
		close: async () => {
			eventStream?.end();
			await closeServer(server);
		},
	};
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
