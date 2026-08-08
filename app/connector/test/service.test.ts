import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpConnectorClient } from "../src/client";
import { MemoryConnectorService } from "../src/runtime";
import {
	readConnectorDiscovery,
	readConnectorRuntimeToken,
	resolveConnectorRuntimePaths,
	resolveConnectorRuntimePathsWithOverrides,
	startManagedConnectorService,
} from "../src/service";
import { ConnectorSupervisor } from "../src/service/supervisor";
import { ConnectorRuntimeLockUnavailable } from "../src/errors";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Connector managed service runtime", () => {
	test("keeps the default connector directory when only homeDirectory is overridden", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-connector-default-paths-"));
		const expected = resolveConnectorRuntimePaths(root);
		const actual = resolveConnectorRuntimePathsWithOverrides(root);

		expect(actual).toEqual(expected);
	});

	test("writes discovery and a protected runtime token, then removes both on close", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-connector-service-"));
		roots.push(root);
		const paths = resolveConnectorRuntimePaths(root);
		const service = await startManagedConnectorService(new MemoryConnectorService({ adapters: [], connections: [] }), { paths });
		expect(service.isOk()).toBe(true);
		if (service.isErr()) return;

		const discovery = await readConnectorDiscovery(paths);
		const token = await readConnectorRuntimeToken(paths);
		expect(discovery.isOk()).toBe(true);
		expect(token.isOk()).toBe(true);
		expect(token.isOk() ? token.value : "").toBe(service.value.runtimeToken);
		expect((await stat(paths.runtimeTokenFile)).mode & 0o777).toBe(0o600);
		expect(await readFile(paths.discoveryFile, "utf8")).toContain('"protocolVersion": 1');

		const client = new HttpConnectorClient({ endpoint: service.value.discovery.endpoint, runtimeToken: service.value.runtimeToken });
		const health = await client.health({ requestId: "health-1" });
		expect(health.isOk() ? health.value.status : "failed").toBe("ready");
		await service.value.close();
		expect((await readConnectorDiscovery(paths)).isErr()).toBe(true);
		expect((await readConnectorRuntimeToken(paths)).isErr()).toBe(true);
	});

	test("holds one lock per user runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-connector-lock-"));
		roots.push(root);
		const paths = resolveConnectorRuntimePaths(root);
		const first = await startManagedConnectorService(new MemoryConnectorService({ adapters: [], connections: [] }), { paths });
		expect(first.isOk()).toBe(true);
		const second = await startManagedConnectorService(new MemoryConnectorService({ adapters: [], connections: [] }), { paths });
		expect(second.isErr()).toBe(true);
		expect(second.isErr() && second.error instanceof ConnectorRuntimeLockUnavailable).toBe(true);
		if (first.isOk()) await first.value.close();
	});

	test("supervisor discovers and health-checks a managed service from isolated runtime paths", async () => {
		const runtimeHome = await mkdtemp(join(tmpdir(), "jai-connector-supervisor-runtime-"));
		const unrelatedHome = await mkdtemp(join(tmpdir(), "jai-connector-supervisor-unrelated-"));
		roots.push(runtimeHome, unrelatedHome);
		const paths = resolveConnectorRuntimePaths(join(runtimeHome, "custom-runtime"));
		const service = await startManagedConnectorService(new MemoryConnectorService({ adapters: [], connections: [] }), { paths });
		expect(service.isOk()).toBe(true);
		if (service.isErr()) return;

		let healthRequests = 0;
		const supervisor = new ConnectorSupervisor({
			homeDirectory: unrelatedHome,
			paths,
			fetcher: (async (input, init) => {
				healthRequests += 1;
				return fetch(input, init);
			}) as typeof fetch,
		});
		const first = await supervisor.connect();
		const second = await supervisor.connect();

		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(healthRequests).toBe(1);
		expect((await readConnectorDiscovery(paths)).isOk()).toBe(true);
		expect((await readConnectorDiscovery(resolveConnectorRuntimePaths(unrelatedHome))).isErr()).toBe(true);
		if (first.isOk()) {
			const apps = await first.value.client.listApps({ requestId: "supervisor-apps-1" });
			expect(apps.isOk() ? apps.value.apps : []).toEqual([]);
			await first.value.close();
		}
		await supervisor.close();
		await service.value.close();
	});
});
