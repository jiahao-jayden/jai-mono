import { describe, expect, test } from "bun:test";
import type { FileSystem } from "../../../src";
import { withFileMutationQueue } from "../../../src/harness/tools/file-mutation-queue";

describe("withFileMutationQueue", () => {
	test("serializes the same path while allowing different paths", async () => {
		const fileSystem = {} as FileSystem;
		const trace: string[] = [];
		let releaseFirst = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = withFileMutationQueue(fileSystem, "/a", async () => {
			trace.push("a1:start");
			await firstGate;
			trace.push("a1:end");
		});
		const second = withFileMutationQueue(fileSystem, "/a", async () => {
			trace.push("a2");
		});
		const other = withFileMutationQueue(fileSystem, "/b", async () => {
			trace.push("b");
		});

		await Promise.resolve();
		expect(trace).toEqual(["a1:start", "b"]);
		releaseFirst();
		await Promise.all([first, second, other]);
		expect(trace).toEqual(["a1:start", "b", "a1:end", "a2"]);
	});
});
