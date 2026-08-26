import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalRuntimeHost } from "../../../src/protocol/acp-v2";
import { createRuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";

describe("Local Runtime Host server", () => {
	test("binds one ACP endpoint per data directory and releases it as one lifecycle resource", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-local-host-"));
		const endpoint = join(directory, "runtime.sock");
		const options = {
			dataDirectory: directory,
			endpoint,
			host: createRuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		};
		try {
			const first = await openLocalRuntimeHost(options);
			if (first.isErr()) throw first.error;
			const duplicate = await openLocalRuntimeHost(options);
			expect(duplicate.isErr()).toBe(true);
			if (duplicate.isOk()) throw new Error("Expected the first Runtime Host to retain ownership");
			expect(duplicate.error._tag).toBe("runtime_host.local_open_failed");

			await first.value.close();
			const restarted = await openLocalRuntimeHost(options);
			if (restarted.isErr()) throw restarted.error;
			await restarted.value.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
