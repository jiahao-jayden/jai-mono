import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProviderModelInventoryStore } from "../electron/config/sqlite-model-inventory";

const roots: string[] = [];
const stores: SqliteProviderModelInventoryStore[] = [];

afterEach(async () => {
	for (const store of stores.splice(0)) store.close();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SqliteProviderModelInventoryStore", () => {
	test("atomically replaces model IDs and preserves an explicit empty result", async () => {
		let now = 1_000;
		const store = await createStore(() => now++);

		expect(store.replace("openai", ["gpt-z", "gpt-a", "gpt-z"])).toEqual({
			profileId: "openai",
			modelIds: ["gpt-a", "gpt-z"],
			fetchedAt: 1_000,
		});
		expect(store.replace("openai", [])).toEqual({
			profileId: "openai",
			modelIds: [],
			fetchedAt: 1_001,
		});
	});

	test("moves and removes an inventory with its Provider profile", async () => {
		const store = await createStore();
		store.replace("old-profile", ["model-a"]);

		store.rename("old-profile", "new-profile");
		expect(store.get("old-profile")).toBeUndefined();
		expect(store.get("new-profile")).toMatchObject({ profileId: "new-profile", modelIds: ["model-a"] });

		store.delete("new-profile");
		expect(store.get("new-profile")).toBeUndefined();
	});
});

async function createStore(now?: () => number): Promise<SqliteProviderModelInventoryStore> {
	const root = await mkdtemp(join(tmpdir(), "jai-provider-model-inventory-"));
	roots.push(root);
	const store = await SqliteProviderModelInventoryStore.open(join(root, "data.sqlite"), { now });
	stores.push(store);
	return store;
}
