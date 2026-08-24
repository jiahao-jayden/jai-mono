import { afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InMemorySessionStore } from "../../../src/harness";
import { SqliteSessionStore } from "../../../src/node/sqlite";
import {
	describeSessionStoreContract,
	type SessionStoreContractHarness,
} from "../../support/session-store-contract";
import type { AppState } from "../../support/fixtures";

const directories: string[] = [];
const sqliteStores: SqliteSessionStore<AppState>[] = [];

afterEach(async () => {
	for (const store of sqliteStores.splice(0)) store.close();
	await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const harnesses: SessionStoreContractHarness[] = [
	{
		name: "InMemorySessionStore",
		create: async () => new InMemorySessionStore<AppState>(),
		cleanup: async () => {},
	},
	{
		name: "SqliteSessionStore",
		create: async () => {
			const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jai-session-"));
			directories.push(directory);
			const store = await SqliteSessionStore.open<AppState>(path.join(directory, "data.sqlite"));
			sqliteStores.push(store);
			return store;
		},
		cleanup: async () => {},
	},
];

for (const harness of harnesses) describeSessionStoreContract(harness);
