import { describe, expect, test } from "bun:test";
import { parseRuntimeAgentSettingsInput, SqliteRuntimeAgentSettings } from "../../src/config";
import { DatabaseSync } from "../../src/persistence/sqlite/driver";

describe("Runtime Agent auxiliary model settings", () => {
	test("follows the Session model until one is chosen, keeps it across unrelated saves and clears with {}", () => {
		withSettings((settings) => {
			const initial = save(settings, { revision: null });
			expect(initial.auxiliaryModel).toEqual({});
			expect(settings.resolveAuxiliaryModel()).toMatchObject({ status: "ok", value: undefined });

			const chosen = save(settings, { revision: initial.revision, auxiliaryModel: { model: "gateway/aux-mini" } });
			expect(chosen.auxiliaryModel).toEqual({ model: "gateway/aux-mini" });

			const unrelated = save(settings, { revision: chosen.revision, maxTurns: 9 });
			expect(unrelated.auxiliaryModel).toEqual({ model: "gateway/aux-mini" });

			const cleared = save(settings, { revision: unrelated.revision, auxiliaryModel: {} });
			expect(cleared.auxiliaryModel).toEqual({});
			const reread = settings.read();
			if (reread.isErr()) throw reread.error;
			expect(reread.value.auxiliaryModel).toBeUndefined();
		});
	});

	test("resolves only the auxiliary connection, never the Session's instructions", () => {
		withSettings((settings) => {
			const initial = save(settings, { revision: null });
			save(settings, {
				revision: initial.revision,
				language: "zh-CN",
				auxiliaryModel: { model: "gateway/aux-mini" },
			});
			const resolved = settings.resolveAuxiliaryModel();
			if (resolved.isErr()) throw resolved.error;
			expect(resolved.value).toEqual({
				reference: "gateway/aux-mini",
				model: "openai-compatible/aux-mini",
				provider: {
					apiKey: "gateway-secret-1234",
					baseUrl: "https://gateway.example.com/v1",
					headers: undefined,
					authentication: "bearer",
				},
			});
			expect(resolved.value).not.toHaveProperty("instructions");
		});
	});

	test("keeps a chosen model that is later disabled, and resolving it then fails", () => {
		withSettings((settings) => {
			const initial = save(settings, { revision: null, auxiliaryModel: { model: "gateway/aux-mini" } });
			const disabled = save(settings, {
				revision: initial.revision,
				models: [
					{ id: "gpt-test", enabled: true },
					{ id: "aux-mini", enabled: false },
				],
			});
			expect(disabled.auxiliaryModel).toEqual({ model: "gateway/aux-mini" });
			expect(settings.resolveAuxiliaryModel()).toMatchObject({
				status: "error",
				error: { _tag: "runtime_config.agent_settings_invalid" },
			});
		});
	});

	test("rejects malformed auxiliary model input at the boundary", () => {
		const base = { revision: null, model: "gateway/gpt-test", providers: [] };
		expect(parseRuntimeAgentSettingsInput({ ...base, auxiliaryModel: { model: "no-provider" } })).toBeUndefined();
		expect(parseRuntimeAgentSettingsInput({ ...base, auxiliaryModel: { model: "gateway/x", extra: 1 } })).toBeUndefined();
		expect(parseRuntimeAgentSettingsInput({ ...base, auxiliaryModel: "gateway/x" })).toBeUndefined();
		expect(parseRuntimeAgentSettingsInput({ ...base, auxiliaryModel: {} })).toMatchObject({ auxiliaryModel: {} });
	});
});

function withSettings(run: (settings: SqliteRuntimeAgentSettings) => void): void {
	const database = new DatabaseSync(":memory:");
	try {
		run(new SqliteRuntimeAgentSettings(database));
	} finally {
		database.close();
	}
}

function save(
	settings: SqliteRuntimeAgentSettings,
	input: {
		readonly revision: string | null;
		readonly maxTurns?: number;
		readonly language?: string;
		readonly auxiliaryModel?: { readonly model?: string };
		readonly models?: readonly { readonly id: string; readonly enabled: boolean }[];
	},
) {
	const saved = settings.write({
		revision: input.revision,
		model: "gateway/gpt-test",
		maxTurns: input.maxTurns,
		language: input.language,
		auxiliaryModel: input.auxiliaryModel,
		providers: [
			{
				id: "gateway",
				name: "Gateway",
				adapter: "openai-compatible",
				baseURL: "https://gateway.example.com/v1",
				authentication: "api-key",
				apiKey: "gateway-secret-1234",
				enabled: true,
				models: input.models ?? [
					{ id: "gpt-test", enabled: true },
					{ id: "aux-mini", enabled: true },
				],
			},
		],
	});
	if (saved.isErr()) throw saved.error;
	return saved.value;
}
