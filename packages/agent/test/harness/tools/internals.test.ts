import { describe, expect, test } from "bun:test";
import { createWriteTool, type FileSystem } from "../../../src";
import { withFileMutationQueue } from "../../../src/harness/tools/file-mutation-queue";
import { truncateText } from "../../../src/harness/tools/truncate";

describe("harness tool internals", () => {
	test("truncation supports unchanged, head, tail, and long-line output", () => {
		expect(truncateText("one\ntwo")).toEqual({ content: "one\ntwo", linesTruncated: false });
		expect(truncateText("one\ntwo\nthree", { maxLines: 2 }).content).toBe("one\ntwo");
		expect(truncateText("one\ntwo\nthree", { direction: "tail", maxLines: 2 }).content).toBe(
			"two\nthree",
		);
		const long = truncateText("123456", { maxLineLength: 3 });
		expect(long.content).toBe("123… [line truncated]");
		expect(long.details?.truncated).toBe(true);
	});

	test("mutation queues serialize by filesystem identity and canonical path", async () => {
		const firstFileSystem = {} as FileSystem;
		const secondFileSystem = {} as FileSystem;
		const trace: string[] = [];
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = withFileMutationQueue(firstFileSystem, "/canonical", async () => {
			trace.push("first:start");
			await gate;
			trace.push("first:end");
		});
		const same = withFileMutationQueue(firstFileSystem, "/canonical", async () => trace.push("same"));
		const otherPath = withFileMutationQueue(firstFileSystem, "/other", async () => trace.push("other-path"));
		const otherFileSystem = withFileMutationQueue(secondFileSystem, "/canonical", async () =>
			trace.push("other-fs"),
		);
		await Promise.resolve();
		expect(trace).toEqual(["first:start", "other-path", "other-fs"]);
		release();
		await Promise.all([first, same, otherPath, otherFileSystem]);
		expect(trace).toEqual(["first:start", "other-path", "other-fs", "first:end", "same"]);
	});

	test("tools run against injected capabilities without Node I/O", async () => {
		let written: string | Uint8Array | undefined;
		const fileSystem = {
			resolvePath: async () => ({ path: "memory:/file.txt", canonicalPath: "memory:/file.txt" }),
			writeFileAtomic: async (_path: string, content: string | Uint8Array) => {
				written = content;
				return { created: true };
			},
		} as unknown as FileSystem;
		const tool = createWriteTool({ fileSystem, workspaceRoot: "memory:/" });
		const result = await tool.execute("write-1", { path: "file.txt", content: "hello" });
		expect(written).toBe("hello");
		expect(result.content[0]).toEqual({
			type: "text",
			text: "Created 5 bytes to file.txt",
		});
	});
});
