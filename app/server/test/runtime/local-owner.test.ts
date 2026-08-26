import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLocalRuntimeOwner } from "../../src/runtime";

describe("Local Runtime Host ownership", () => {
	test("uses an exclusive lock and releases it for the next Host", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-runtime-owner-"));
		const lockPath = join(directory, "runtime.lock");
		try {
			const first = await acquireLocalRuntimeOwner(lockPath);
			if (first.isErr()) throw first.error;
			const held = await acquireLocalRuntimeOwner(lockPath);
			expect(held.isErr()).toBe(true);
			if (held.isOk()) throw new Error("Expected exclusive Runtime Host ownership");
			expect(held.error._tag).toBe("runtime_host.already_owned");

			await first.value.release();
			const second = await acquireLocalRuntimeOwner(lockPath);
			if (second.isErr()) throw second.error;
			await second.value.release();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
