import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createTelemetryContext,
	type TelemetrySink,
	type TelemetrySpanRecord,
} from "../src";
import { createJsonlFileTelemetrySink, createJsonlStderrTelemetrySink } from "../src/node";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Node telemetry sinks", () => {
	test("写入可重建因果树的安全 JSONL 诊断记录", async () => {
		const root = await temporaryDirectory();
		const path = join(root, "telemetry.jsonl");
		const telemetry = createTelemetryContext({
			sinks: [createJsonlFileTelemetrySink({ path, maxBytes: 4_096, maxFiles: 2 })],
		});
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation-1", runId: "operation-1" } });
		const turn = telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId: "operation-1:turn:1" } });
		const tool = telemetry.startSpan({
			name: "jai.tool_call",
			parent: turn,
			attributes: { toolCallId: "call-1", toolName: "Read" },
		});
		tool.setAttributes({ input: "private prompt" as never });
		tool.setStatus({ kind: "error", name: "tool", message: "private stack" as never });
		turn.setStatus({ kind: "ok" });
		run.setStatus({ kind: "ok" });

		const records = await readJsonl(path, 3);
		const writtenRun = findRecord(records, run.id);
		const writtenTurn = findRecord(records, turn.id);
		const writtenTool = findRecord(records, tool.id);
		expect(writtenTurn.parentId).toBe(writtenRun.id);
		expect(writtenTool.parentId).toBe(writtenTurn.id);
		expect(writtenTool.attributes).toMatchObject({ input: { kind: "omitted" }, output: { kind: "omitted" } });
		expect(JSON.stringify(records)).not.toContain("private prompt");
		expect(JSON.stringify(records)).not.toContain("private stack");
		expect(JSON.stringify(records)).not.toContain("stack");
		expect(JSON.stringify(records)).not.toContain("cause");
	});

	test("严格写入 stderr 而不触碰协议 stdout", async () => {
		const stderr: string[] = [];
		const protocolStdout: string[] = [];
		const sink = createJsonlStderrTelemetrySink({
			write(text): void {
				stderr.push(text);
			},
		});

		await sink.record(record("run-1"));

		expect(stderr).toEqual([`${JSON.stringify(record("run-1"))}\n`]);
		expect(protocolStdout).toEqual([]);
	});

	test("按显式大小上限轮转，并只保留配置数量的旧文件", async () => {
		const root = await temporaryDirectory();
		const path = join(root, "telemetry.jsonl");
		const sink = createJsonlFileTelemetrySink({ path, maxBytes: 240, maxFiles: 2 });

		for (let index = 1; index <= 5; index += 1) {
			await sink.record(record(`run-${index}`));
		}

		const files = await readdir(root);
		expect(files.sort()).toEqual(["telemetry.jsonl", "telemetry.jsonl.1", "telemetry.jsonl.2"]);
		for (const file of files) {
			expect((await stat(join(root, file))).size).toBeLessThanOrEqual(240);
		}
		expect(findRecord(await readJsonl(path, 1), "run-5").id).toBe("run-5");
	});

	test("文件 sink 失败时不阻塞调用方或其他 sink", async () => {
		const root = await temporaryDirectory();
		const delivered: TelemetrySpanRecord[] = [];
		const receivingSink: TelemetrySink = {
			record(record): void {
				delivered.push(record);
			},
		};
		const telemetry = createTelemetryContext({
			sinks: [createJsonlFileTelemetrySink({ path: root, maxBytes: 512, maxFiles: 1 }), receivingSink],
		});
		const run = telemetry.startSpan({ name: "jai.run", attributes: { operationId: "operation-1", runId: "operation-1" } });

		expect(() => run.setStatus({ kind: "ok" })).not.toThrow();
		await waitFor(() => delivered.length === 1);
		expect(delivered[0]?.id).toBe(run.id);
	});
});

async function temporaryDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-telemetry-node-sink-"));
	roots.push(root);
	return root;
}

async function readJsonl(path: string, expectedRecords: number): Promise<TelemetrySpanRecord[]> {
	let records: TelemetrySpanRecord[] = [];
	await waitFor(async () => {
		try {
			const text = await readFile(path, "utf8");
			records = text
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as TelemetrySpanRecord);
			return records.length >= expectedRecords;
		} catch {
			return false;
		}
	});
	return records;
}

function findRecord(records: readonly TelemetrySpanRecord[], id: string): TelemetrySpanRecord {
	const found = records.find((record) => record.id === id);
	if (!found) throw new Error(`Expected telemetry record ${id}`);
	return found;
}

function record(id: string): TelemetrySpanRecord {
	return {
		attributes: { operationId: id, runId: id },
		endedAtMs: 1,
		events: [],
		id,
		name: "jai.run",
		runId: id,
		schemaVersion: 1,
		startedAtMs: 0,
		status: { kind: "ok" },
		traceId: `trace-${id}`,
		traceName: "jai.run",
	};
}

async function waitFor(condition: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for telemetry sink output");
}
