import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import type { Workspace } from "./workspace.js";

const SettingsSchema = z.object({
	defaultModel: z.string(),
	defaultProvider: z.string(),
	maxIterations: z.number().int().positive(),
});

const PartialSettingsSchema = SettingsSchema.partial().strict();

export type Settings = z.infer<typeof PartialSettingsSchema>;
export type ResolvedSettings = z.infer<typeof SettingsSchema>;

const DEFAULTS: ResolvedSettings = {
	defaultModel: "anthropic/claude-sonnet-4-20250514",
	defaultProvider: "anthropic",
	maxIterations: 25,
};

export const SettingsParseError = NamedError.create(
	"SettingsParseError",
	z.object({ path: z.string(), message: z.string() }),
);

export const SettingsValidationError = NamedError.create(
	"SettingsValidationError",
	z.object({ path: z.string(), issues: z.array(z.any()) }),
);

async function readSettingsFile(path: string): Promise<Settings> {
	const file = Bun.file(path);
	if (!(await file.exists())) return {};

	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch {
		throw new SettingsParseError({ path, message: `Invalid JSON in ${path}` });
	}

	const result = PartialSettingsSchema.safeParse(raw);
	if (!result.success) {
		throw new SettingsValidationError({ path, issues: result.error.issues });
	}
	return result.data;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) continue;
		const baseVal = (base as Record<string, unknown>)[key];
		if (isPlainObject(baseVal) && isPlainObject(value)) {
			result[key] = deepMergeSettings(baseVal as Settings, value as Settings);
		} else {
			result[key] = value;
		}
	}
	return result as Settings;
}

function resolve(merged: Settings): ResolvedSettings {
	return { ...DEFAULTS, ...merged } as ResolvedSettings;
}

export class SettingsManager {
	private constructor(
		private global: Settings,
		private project: Settings,
		private resolved: ResolvedSettings,
	) {}

	static async load(workspace: Workspace): Promise<SettingsManager> {
		const global = await readSettingsFile(workspace.globalSettingsPath);
		const project = await readSettingsFile(workspace.projectSettingsPath);
		const merged = deepMergeSettings(global, project);
		return new SettingsManager(global, project, resolve(merged));
	}

	get<K extends keyof ResolvedSettings>(key: K): ResolvedSettings[K] {
		return this.resolved[key];
	}

	getAll(): Readonly<ResolvedSettings> {
		return this.resolved;
	}

	withOverrides(overrides: Settings): SettingsManager {
		const merged = deepMergeSettings(deepMergeSettings(this.global, this.project), overrides);
		return new SettingsManager(this.global, this.project, resolve(merged));
	}
}
