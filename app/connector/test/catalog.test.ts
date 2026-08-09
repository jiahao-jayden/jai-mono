import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	createAMapAdapter,
	createContext7Adapter,
	createGitHubAdapter,
	createGoogleAdapter,
	createMcDonaldsCnAdapter,
} from "../src/providers";

interface SelectedActionsCatalog {
	readonly providers: readonly {
		readonly providerId: string;
		readonly status: string;
		readonly actions: readonly string[];
	}[];
}

describe("Connector generated action catalog", () => {
	test("matches the public Provider Adapter Action IDs", async () => {
		const catalog = JSON.parse(await readFile(new URL("../src/catalog/selected-actions.json", import.meta.url), "utf8")) as SelectedActionsCatalog;
		const adapters = [
			createContext7Adapter(),
			createAMapAdapter(),
			createMcDonaldsCnAdapter(),
			createGoogleAdapter(),
			createGitHubAdapter(),
		];
		const expected = adapters.map((adapter) => ({
			providerId: adapter.definition.id,
			status: "adapter-specific",
			actions: adapter.actions.map((action) => `${action.providerId}.${action.actionId}`),
		}));

		expect(catalog.providers).toEqual(expected);
	});
});
