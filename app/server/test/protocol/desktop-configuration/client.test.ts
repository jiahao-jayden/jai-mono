import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDesktopConfigurationClient } from "../../../src/desktop-configuration-client";
import { localDesktopConfigurationEndpointFor } from "../../../src/protocol/desktop-configuration";
import { openConfiguredRuntimeHost } from "../../../src/runtime";

describe("Desktop configuration client", () => {
	test("uses the Host-owned private configuration channel and never receives stored credentials", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-desktop-configuration-client-"));
		const host = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/example", JAI_VERSION: "test" },
			dataDirectory,
		});
		if (host.isErr()) throw host.error;
		try {
			const canonicalDataDirectory = await realpath(dataDirectory);
			expect(host.value.desktopConfigurationEndpoint).toBe(localDesktopConfigurationEndpointFor(dataDirectory));
			const client = await connectDesktopConfigurationClient({ dataDirectory, environment: {} });
			if (client.isErr()) throw client.error;
			try {
			const initial = await client.value.get();
			if (initial.isErr()) throw initial.error;
			const catalog = await client.value.getModelCatalog();
			if (catalog.isErr()) throw catalog.error;
			expect(catalog.value).toEqual({ stale: false, refreshed: false });
			const saved = await client.value.save({
					revision: initial.value.revision,
					model: "gateway/gpt-test",
					providers: [
						{
							id: "gateway",
							name: "Gateway",
							adapter: "openai-compatible",
							baseURL: "https://gateway.example.com/v1",
							authentication: "api-key",
							apiKey: "gateway-secret-1234",
							enabled: true,
							models: [{ id: "gpt-test", enabled: true }],
						},
					],
				});
				if (saved.isErr()) throw saved.error;
				expect(saved.value.profiles).toMatchObject([
					{ id: "gateway", credentialConfigured: true, credentialMask: "•••• 1234" },
				]);
			expect(JSON.stringify(saved.value)).not.toContain("gateway-secret");
			const initialTrust = await client.value.getWorkspaceTrust(dataDirectory);
			if (initialTrust.isErr()) throw initialTrust.error;
			expect(initialTrust.value).toEqual({ workspacePath: canonicalDataDirectory, trusted: false });
			const trusted = await client.value.setWorkspaceTrust(dataDirectory, true);
			if (trusted.isErr()) throw trusted.error;
			expect(trusted.value).toMatchObject({ workspacePath: canonicalDataDirectory, trusted: true });
			} finally {
				await client.value.close();
			}
		} finally {
			await host.value.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	});
});
