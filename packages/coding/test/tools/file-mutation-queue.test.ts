import { describe, expect, test } from "bun:test";
import { withFileMutationQueue } from "../../src/internal/file-mutation-queue";

describe("withFileMutationQueue", () => {
	test("serializes the same path while allowing different paths", async () => {
		const trace: string[] = [];
		let releaseFirst = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = withFileMutationQueue("/a", async () => {
			trace.push("a1:start");
			await firstGate;
			trace.push("a1:end");
		});
		const second = withFileMutationQueue("/a", async () => {
			trace.push("a2");
		});
		const other = withFileMutationQueue("/b", async () => {
			trace.push("b");
		});

		await Promise.resolve();
		expect(trace).toEqual(["a1:start", "b"]);
		releaseFirst();
		await Promise.all([first, second, other]);
		expect(trace).toEqual(["a1:start", "b", "a1:end", "a2"]);
	});
});
