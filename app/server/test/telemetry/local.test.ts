import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRuntimeTelemetry } from "../../src/telemetry";

const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true);
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Runtime local telemetry configuration", () => {
	test("没有诊断环境变量时保持 no-op", async () => {
		const stderr: string[] = [];
		const configured = resolveRuntimeTelemetry({
			environment: {},
			errorOutput: {
				write(text): void {
					stderr.push(text);
				},
			},
		});
		if (configured.isErr()) throw configured.error;
		const run = configured.value.context.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-1", runId: "operation-1" },
		});
		run.setStatus({ kind: "ok" });
		await Promise.resolve();

		expect(stderr).toEqual([]);
		expect(configured.value.close).toBeUndefined();
	});

	test("默认关闭，显式环境变量才装配文件和 stderr sink", async () => {
		const root = await temporaryDirectory();
		const path = join(root, "telemetry.jsonl");
		const stderr: string[] = [];
		const configured = resolveRuntimeTelemetry({
			environment: {
				JAI_TELEMETRY_FILE: path,
				JAI_TELEMETRY_MAX_BYTES: "1024",
				JAI_TELEMETRY_MAX_FILES: "2",
				JAI_TELEMETRY_STDERR: "1",
			},
			errorOutput: {
				write(text): void {
					stderr.push(text);
				},
			},
		});
		if (configured.isErr()) throw configured.error;
		const run = configured.value.context.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-1", runId: "operation-1" },
		});
		run.setStatus({ kind: "ok" });

		const fileRecord = await waitForFile(path);
		expect(JSON.parse(fileRecord)).toMatchObject({ id: run.id, name: "jai.run" });
		expect(stderr).toEqual([fileRecord]);
	});

	test("拒绝不完整或无效的本地诊断配置", () => {
		const emptyPath = resolveRuntimeTelemetry({
			environment: { JAI_TELEMETRY_FILE: "   " },
			errorOutput: { write() {} },
		});
		const invalidStderr = resolveRuntimeTelemetry({
			environment: { JAI_TELEMETRY_STDERR: "true" },
			errorOutput: { write() {} },
		});
		const orphanedLimit = resolveRuntimeTelemetry({
			environment: { JAI_TELEMETRY_MAX_BYTES: "1024" },
			errorOutput: { write() {} },
		});

		expect(emptyPath).toMatchObject({ status: "error", error: { _tag: "telemetry.configuration_invalid" } });
		expect(invalidStderr).toMatchObject({ status: "error", error: { _tag: "telemetry.configuration_invalid" } });
		expect(orphanedLimit).toMatchObject({ status: "error", error: { _tag: "telemetry.configuration_invalid" } });
	});

	test("OTLP 与本地文件可同时启用，关闭时完成已入队导出", async () => {
		const root = await temporaryDirectory();
		const path = join(root, "telemetry.jsonl");
		const requests: Array<{ readonly headers: Headers; readonly path: string }> = [];
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				await request.arrayBuffer();
				requests.push({ headers: request.headers, path: new URL(request.url).pathname });
				return new Response(null, { status: 200 });
			},
		});
		servers.push(server);
		const configured = resolveRuntimeTelemetry({
			environment: {
				JAI_TELEMETRY_FILE: path,
				JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-server-test",
				JAI_TELEMETRY_LANGFUSE_SECRET_KEY: "sk-server-test",
				JAI_TELEMETRY_OTLP_ENDPOINT: `${server.url}api/public/otel`,
				JAI_TELEMETRY_OTLP_MAX_BATCH_SIZE: "1",
			},
			errorOutput: { write() {} },
		});
		if (configured.isErr()) throw configured.error;
		const run = configured.value.context.startSpan({
			name: "jai.run",
			attributes: { operationId: "operation-otlp", runId: "run-otlp", sessionId: "session-otlp" },
		});
		run.setStatus({ kind: "ok" });
		if (configured.value.close === undefined) throw new Error("Expected configured OTLP telemetry to have a close callback");
		await configured.value.close();

		const fileRecord = await waitForFile(path);
		await waitForRequest(requests);
		expect(JSON.parse(fileRecord)).toMatchObject({ id: run.id, name: "jai.run" });
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ path: "/api/public/otel/v1/traces" });
		expect(requests[0].headers.get("x-langfuse-ingestion-version")).toBe("4");
		expect(fileRecord).not.toContain("sk-server-test");
	});

	test("拒绝不完整或无效的 OTLP 配置，且错误不回显凭据", () => {
		const incomplete = resolveRuntimeTelemetry({
			environment: {
				JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-should-not-appear",
				JAI_TELEMETRY_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
			},
			errorOutput: { write() {} },
		});
		const invalidEndpoint = resolveRuntimeTelemetry({
			environment: {
				JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-should-not-appear",
				JAI_TELEMETRY_LANGFUSE_SECRET_KEY: "sk-should-not-appear",
				JAI_TELEMETRY_OTLP_ENDPOINT: "not a URL",
			},
			errorOutput: { write() {} },
		});
		const invalidQueueSize = resolveRuntimeTelemetry({
			environment: {
				JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-should-not-appear",
				JAI_TELEMETRY_LANGFUSE_SECRET_KEY: "sk-should-not-appear",
				JAI_TELEMETRY_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
				JAI_TELEMETRY_OTLP_MAX_QUEUE_SIZE: "0",
			},
			errorOutput: { write() {} },
		});

		for (const result of [incomplete, invalidEndpoint, invalidQueueSize]) {
			expect(result).toMatchObject({ status: "error", error: { _tag: "telemetry.configuration_invalid" } });
			if (result.isErr()) {
				expect(result.error.message).not.toContain("pk-should-not-appear");
				expect(result.error.message).not.toContain("sk-should-not-appear");
			}
		}
	});
});

async function temporaryDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-runtime-telemetry-"));
	roots.push(root);
	return root;
}

async function waitForFile(path: string): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const text = await readFile(path, "utf8");
			if (text) return text;
		} catch {
			// 异步 sink 尚未完成第一条写入。
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for local telemetry file output");
}

async function waitForRequest(requests: readonly unknown[]): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (requests.length > 0) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for OTLP request");
}
