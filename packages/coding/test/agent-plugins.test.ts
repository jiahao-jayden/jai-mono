import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodingSkillCatalog } from "../src/skills";
import { connectAgentPluginMcp, loadAgentPluginDirectory } from "../src/agent-plugins";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Agent Plugins 组件适配器", () => {
	test("官方示例只发现 migrate-agent-plugin Skill，并保留 references 根目录", async () => {
		const result = await loadAgentPluginDirectory("/private/tmp/agent-plugins-example-main");

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.manifest.name).toBe("agent-plugins-example");
		expect(result.value.skills.map((skill) => skill.name)).toEqual(["migrate-agent-plugin"]);
		expect(result.value.mcpServers).toHaveLength(0);
		expect(result.value.diagnostics).toHaveLength(0);
		const catalog = new CodingSkillCatalog({ homeDirectory: await tempPath("home"), workspaceTrusted: false, pluginSkills: result.value.skills });
		const snapshot = await catalog.load();
		expect(snapshot.skills[0]?.source).toMatchObject({ directory: "plugin", pluginName: "agent-plugins-example" });
		catalog.close();
	});

	test("Skill 无效不会阻止健康 MCP entry，坏 MCP entry 也不影响 Skill", async () => {
		const root = await createPlugin({
			mcpServers: {
				good: { type: "streamable-http", url: "http://localhost:43121/mcp" },
				bad: { type: "stdio", command: "node --version" },
			},
		});
		await mkdir(path.join(root, "skills", "healthy"), { recursive: true });
		await writeFile(path.join(root, "skills", "healthy", "SKILL.md"), "---\nname: healthy\ndescription: Healthy Skill\n---\n\nInstructions\n");
		await mkdir(path.join(root, "skills", "broken"), { recursive: true });
		await writeFile(path.join(root, "skills", "broken", "SKILL.md"), "---\nname: broken\n---\n");

		const result = await loadAgentPluginDirectory(root);
		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.skills.map((skill) => skill.name)).toEqual(["healthy"]);
		expect(result.value.mcpServers.map((server) => server.name)).toEqual(["good"]);
		expect(result.value.diagnostics.map((diagnostic) => diagnostic.componentName)).toContain("broken");
		expect(result.value.diagnostics.map((diagnostic) => diagnostic.componentName)).toContain("bad");
	});

	test("stdio MCP 通过同一个 AgentTool 接缝完成 initialize、tools/list 和 tools/call", async () => {
		const probe = [
			"const readline=require('node:readline');",
			"const rl=readline.createInterface({input:process.stdin});",
			"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list')result={tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};else if(r.method==='tools/call')result={content:[{type:'text',text:String(r.params.arguments.text)}]};else result={};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
		].join("");
		const root = await createPlugin({ mcpServers: { probe: { type: "stdio", command: "node", args: ["-e", probe] } } });
		const loaded = await loadAgentPluginDirectory(root);
		expect(loaded.isOk()).toBe(true);
		if (loaded.isErr()) return;
		const runtime = await connectAgentPluginMcp(loaded.value, { pluginDataDirectory: path.join(root, "data") });
		expect(runtime.isOk()).toBe(true);
		if (runtime.isErr()) return;
		expect(runtime.value.tools.map((tool) => tool.name)).toEqual(["mcp__agent-plugins-test__probe__echo"]);
		const result = await runtime.value.tools[0]!.execute("call-1", { text: "hello" });
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
		await runtime.value.close();
	});

	test("stdio placeholder 只做一次替换，并把 PLUGIN_DATA cwd 固定在数据目录", async () => {
		const probe = [
			"const readline=require('node:readline');",
			"const rl=readline.createInterface({input:process.stdin});",
			"rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='notifications/initialized')return;let result;if(r.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}};else if(r.method==='tools/list')result={tools:[{name:'context',description:'Return process context',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};else if(r.method==='tools/call')result={content:[{type:'text',text:JSON.stringify({trace:process.env.TRACE,cwd:process.cwd()})}]};else result={};if(r.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});",
		].join("");
		const root = await createPlugin({
			mcpServers: {
				probe: {
					type: "stdio",
					command: "node",
					args: ["-e", probe, "${PLUGIN_ROOT}/${PLUGIN_DATA}/${PLUGIN_DATA}"],
					env: { TRACE: "${PLUGIN_ROOT}|${PLUGIN_DATA}" },
					cwd: "${PLUGIN_DATA}",
				},
			},
		});
		const loaded = await loadAgentPluginDirectory(root);
		expect(loaded.isOk()).toBe(true);
		if (loaded.isErr()) return;
		const dataRoot = path.join(await tempPath("data"), "literal-${PLUGIN_DATA}");
		const runtime = await connectAgentPluginMcp(loaded.value, { pluginDataDirectory: dataRoot });
		expect(runtime.isOk()).toBe(true);
		if (runtime.isErr()) return;
		const result = await runtime.value.tools[0]!.execute("context-1", {});
		const first = result.content[0];
		expect(first?.type).toBe("text");
		if (first?.type !== "text") return;
		const context = JSON.parse(first.text);
		const canonicalData = await realpath(dataRoot);
		expect(context).toEqual({ trace: `${await realpath(root)}|${canonicalData}`, cwd: canonicalData });
		await runtime.value.close();
	});
});

async function createPlugin(options: { readonly mcpServers?: Record<string, Record<string, unknown>> }): Promise<string> {
	const root = await tempPath("plugin");
	roots.push(root);
	await writeFile(path.join(root, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "agent-plugins-test", version: "1.0.0" }));
	if (options.mcpServers) {
		await writeFile(path.join(root, "mcp.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: options.mcpServers }));
	}
	return root;
}

async function tempPath(name: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), `jai-agent-plugin-${name}-`));
	roots.push(root);
	return root;
}
