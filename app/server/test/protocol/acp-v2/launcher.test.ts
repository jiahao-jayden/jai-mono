import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectJaiRuntimeHost } from "../../../src/acp-client";
import { openLocalAcpV2Server } from "../../../src/protocol/acp-v2";
import { createRuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";

describe("Runtime Host ACP client launcher", () => {
	test("delegates a packaged Runtime Host launch without importing its host adapter", async () => {
		const launches: { readonly entrypoint: string; readonly environment: Readonly<Record<string, string | undefined>> }[] = [];
		const client = await connectJaiRuntimeHost({
			dataDirectory: "/tmp/jai-runtime-host",
			endpoint: "/tmp/jai-runtime-host.sock",
			environment: { JAI_VERSION: "test" },
			runtimeHostEntrypoint: "/Applications/JAI.app/Contents/Resources/dist/main.js",
			launchRuntimeHost: (launch) => launches.push(launch),
			retryCount: 0,
		});
		expect(client.isErr()).toBe(true);
		expect(launches).toEqual([{
			entrypoint: "/Applications/JAI.app/Contents/Resources/dist/main.js",
			environment: {
				JAI_VERSION: "test",
				JAI_HOME: "/tmp/jai-runtime-host",
				JAI_RUNTIME_ENDPOINT: "/tmp/jai-runtime-host.sock",
			},
		}]);
	});

	test("joins an existing local Host without a model environment or a SQLite dependency", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-launcher-"));
		const endpoint = join(directory, "runtime.sock");
		const opened = await openLocalAcpV2Server({
			endpoint,
			host: createRuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});
		if (opened.isErr()) throw opened.error;
		try {
			const client = await connectJaiRuntimeHost({ endpoint, environment: {} });
			expect(client.isOk()).toBe(true);
			if (client.isErr()) throw client.error;
			const initialized = await client.value.request("initialize", {
				protocolVersion: 2,
				capabilities: {},
				info: { name: "test", version: "1.0.0" },
			});
			expect(initialized.isOk()).toBe(true);
			await client.value.close();
		} finally {
			await opened.value.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
