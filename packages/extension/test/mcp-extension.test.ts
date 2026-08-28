import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import type { JsonObject } from "@jai/coding-agent";
import { disposeExtensions, initializeExtensions } from "../../coding-agent/src/sdk/extensions";
import { createMcpExtension, resolveMcpConfiguration } from "../src/mcp";

const context = {
	sessionId: "mcp-extension-session",
	cwd: "/workspace",
	workspace: { directory: "/workspace", trusted: true },
	permissionMode: "default" as const,
};

describe("Official MCP Extension", () => {
	test("replaces a user server with the same trusted-project server instead of deep-merging it", () => {
		const resolved = resolveMcpConfiguration({
			user: {
				servers: {
					shared: { type: "stdio", command: "user-command", args: ["--user"], env: { USER_ONLY: "1" } },
				},
			} as unknown as JsonObject,
			project: {
				servers: {
					shared: { type: "stdio", command: "project-command", args: ["--project"], env: {} },
				},
			} as unknown as JsonObject,
		});
		expect(resolved).toMatchObject({
			status: "ok",
			value: { servers: { shared: { command: "project-command", args: ["--project"], env: {} } } },
		});
	});

	test.each(["stdio", "streamable-http", "sse"] as const)(
		"connects %s through the Extension catalog and projects its tool presentation",
		async (type) => {
			const probe = type === "stdio" ? undefined : await createHttpProbe(type);
			try {
				const initialized = await initializeMcp(
					type === "stdio"
						? { type, command: "node", args: ["-e", stdioProbe("echo")], env: {} }
						: { type, url: probe!.url, headers: {} },
					type,
				);
				expect(initialized.isOk()).toBe(true);
				if (initialized.isErr()) return;
				const extension = initialized.value[0]!;
				expect(extension.catalogTools.map((tool) => tool.name)).toEqual([`mcp__settings__${type}__echo`]);
				expect(extension.toolPresentations.get(`mcp__settings__${type}__echo`)?.activityKind).toBe("call");
				const result = await extension.catalogTools[0]!.execute("call-1", { text: type });
				expect(result.content).toEqual([{ type: "text", text: type }]);
				await disposeExtensions(initialized.value);
			} finally {
				await probe?.close();
			}
		},
	);

	test("reconnects after a stdio disconnect and atomically replaces the catalog snapshot", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-mcp-extension-"));
		const statePath = join(root, "reconnected");
		try {
			const initialized = await initializeMcp(
				{
					type: "stdio",
					command: "node",
					args: ["-e", reconnectingProbe()],
					env: { MCP_PROBE_STATE: statePath },
				},
				"recovery",
				{ initialRetryDelayMs: 5, maxRetryDelayMs: 20 },
			);
			expect(initialized.isOk()).toBe(true);
			if (initialized.isErr()) return;
			await waitFor(() => initialized.value[0]!.catalogTools[0]?.name === "mcp__settings__recovery__second");
			expect(initialized.value[0]!.catalogTools.map((tool) => tool.name)).toEqual(["mcp__settings__recovery__second"]);
			await disposeExtensions(initialized.value);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("refreshes after tools/list_changed and stops recovery work on close", async () => {
		const initialized = await initializeMcp(
			{ type: "stdio", command: "node", args: ["-e", listChangedProbe()], env: {} },
			"notifications",
			{ initialRetryDelayMs: 5, maxRetryDelayMs: 20 },
		);
		expect(initialized.isOk()).toBe(true);
		if (initialized.isErr()) return;
		await waitFor(() => initialized.value[0]!.catalogTools[0]?.name === "mcp__settings__notifications__second");
		expect(initialized.value[0]!.catalogTools.map((tool) => tool.name)).toEqual(["mcp__settings__notifications__second"]);
		const disposed = await disposeExtensions(initialized.value);
		expect(disposed.isOk()).toBe(true);
	});
});

async function initializeMcp(
	server: Record<string, unknown>,
	name: string,
	options: Parameters<typeof createMcpExtension>[0] = {},
) {
	const extension = createMcpExtension({ namespace: "settings", ...options });
	return initializeExtensions([extension], context, {
		readConfiguration: ({ scope }) =>
			Result.ok(scope === "user" ? ({ servers: { [name]: server } } as unknown as JsonObject) : undefined),
	});
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(10);
	}
	expect(predicate()).toBe(true);
}

function stdioProbe(toolName: string): string {
	return [
		"const readline=require('node:readline');",
		"const rl=readline.createInterface({input:process.stdin});",
		"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list')result={tools:[{name:'" + toolName + "',description:'Echo input',annotations:{title:'Fetch value',readOnlyHint:true},inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};else if(r.method==='tools/call')result={content:[{type:'text',text:String(r.params.arguments.text)}]};else result={};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
	].join("");
}

function reconnectingProbe(): string {
	return [
		"const fs=require('node:fs');",
		"const first=!fs.existsSync(process.env.MCP_PROBE_STATE);if(first)fs.writeFileSync(process.env.MCP_PROBE_STATE,'1');",
		"const name=first?'first':'second';",
		"const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin});",
		"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list'){result={tools:[{name,description:name,inputSchema:{type:'object'}}]};if(first)setTimeout(()=>process.exit(0),30);}else result={content:[{type:'text',text:name}]};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
	].join("");
}

function listChangedProbe(): string {
	return [
		"let lists=0;const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin});",
		"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:true}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list'){lists++;const name=lists>2?'second':'first';result={tools:[{name,description:name,inputSchema:{type:'object'}}]};if(lists===1)setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/tools/list_changed'})+'\\n'),40);}else result={content:[{type:'text',text:'ok'}]};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
	].join("");
}

async function createHttpProbe(type: "streamable-http" | "sse"): Promise<{ readonly url: string; close(): Promise<void> }> {
	const { createServer } = await import("node:http");
	let eventStream: import("node:http").ServerResponse | undefined;
	const server = createServer(async (request, response) => {
		if (type === "sse" && request.method === "GET" && request.url === "/sse") {
			eventStream = response;
			response.writeHead(200, { "cache-control": "no-cache", connection: "keep-alive", "content-type": "text/event-stream" });
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
		const body = await readJsonBody(request);
		const message = body as { readonly id?: string | number; readonly method?: string; readonly params?: { readonly arguments?: { readonly text?: string } } };
		if (message.id === undefined) {
			response.writeHead(202);
			response.end();
			return;
		}
		const result = message.method === "initialize"
			? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: type, version: "1" } }
			: message.method === "tools/list"
				? { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] }
				: { content: [{ type: "text", text: String(message.params?.arguments?.text) }] };
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
	if (!address || typeof address === "string") throw new Error("MCP probe did not bind to a TCP port");
	return {
		url: `http://127.0.0.1:${address.port}${type === "sse" ? "/sse" : "/mcp"}`,
		close: async () => {
			eventStream?.end();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		},
	};
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
