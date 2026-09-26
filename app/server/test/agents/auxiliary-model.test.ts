import { describe, expect, test } from "bun:test";
import { resolveOperationAuxiliaryModel } from "../../src/agents";
import { SqliteRuntimeAgentSettings } from "../../src/config";
import { DatabaseSync } from "../../src/persistence/sqlite/driver";

const emptyCatalog = { stale: false, refreshed: false } as const;

describe("Operation auxiliary model resolution", () => {
	test("leaves review to the Session model when no auxiliary model is chosen", () => {
		withSettings(undefined, (settings) => {
			expect(resolveOperationAuxiliaryModel(settings, emptyCatalog)).toBeUndefined();
		});
	});

	test("resolves a chosen model into an SDK model with its own connection", () => {
		withSettings("gateway/aux-mini", (settings) => {
			expect(resolveOperationAuxiliaryModel(settings, emptyCatalog)).toMatchObject({
				kind: "model",
				model: "anthropic/aux-mini",
				provider: { apiKey: "gateway-secret-1234", authentication: "x-api-key" },
			});
		});
	});

	test("marks a chosen but unusable model unavailable instead of switching to the Session model", () => {
		withSettings("gateway/aux-mini", (settings, revision) => {
			const disabled = settings.write(input(revision, "gateway/aux-mini", false));
			if (disabled.isErr()) throw disabled.error;
			expect(resolveOperationAuxiliaryModel(settings, emptyCatalog)).toEqual({ kind: "unavailable" });
		});
	});
});

function withSettings(
	auxiliaryModel: string | undefined,
	run: (settings: SqliteRuntimeAgentSettings, revision: string) => void,
): void {
	const database = new DatabaseSync(":memory:");
	try {
		const settings = new SqliteRuntimeAgentSettings(database);
		const saved = settings.write(input(null, auxiliaryModel, true));
		if (saved.isErr()) throw saved.error;
		if (saved.value.revision === null) throw new Error("expected a saved revision");
		run(settings, saved.value.revision);
	} finally {
		database.close();
	}
}

function input(revision: string | null, auxiliaryModel: string | undefined, auxiliaryEnabled: boolean) {
	return {
		revision,
		model: "gateway/main",
		auxiliaryModel: { model: auxiliaryModel },
		providers: [
			{
				id: "gateway",
				name: "Gateway",
				adapter: "anthropic" as const,
				authentication: "api-key" as const,
				apiKey: "gateway-secret-1234",
				enabled: true,
				models: [
					{ id: "main", enabled: true },
					{ id: "aux-mini", enabled: auxiliaryEnabled },
				],
			},
		],
	};
}
