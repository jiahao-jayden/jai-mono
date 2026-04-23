import type { ModelInfo } from "@jayden/jai-ai";
import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import { PermissionSettingsSchema } from "../../permission/schema.js";
import { resolveSettingsModel } from "./model-resolver.js";
import type { Workspace } from "./workspace.js";

// ── Provider config schemas ─────────────────────────────────

const ModalitySchema = z.object({
	text: z.boolean().optional(),
	image: z.boolean().optional(),
	audio: z.boolean().optional(),
	video: z.boolean().optional(),
	pdf: z.boolean().optional(),
});

const ProviderModelSchema = z.object({
	id: z.string(),
	capabilities: z
		.object({
			reasoning: z.boolean().optional(),
			toolCall: z.boolean().optional(),
			structuredOutput: z.boolean().optional(),
			input: ModalitySchema.optional(),
			output: ModalitySchema.optional(),
		})
		.optional(),
	limit: z
		.object({
			context: z.number(),
			output: z.number(),
		})
		.optional(),
});

const ProviderModelEntry = z
	.union([z.string(), ProviderModelSchema])
	.transform((v) => (typeof v === "string" ? { id: v } : v));

export const ProviderConfigSchema = z.object({
	enabled: z.boolean().default(true),
	api_key: z.string().optional(),
	api_base: z.string(),
	api_format: z.enum(["anthropic", "openai", "openai-compatible", "google"]),
	models: z.array(ProviderModelEntry),
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type ProviderSettings = z.infer<typeof ProviderConfigSchema>;

// ── Settings schema ─────────────────────────────────────────

const SettingsSchema = z.object({
	/** 默认模型，格式 "provider/model" */
	model: z.string(),
	/** 默认 provider（当 model 未指定 provider 前缀时使用） */
	provider: z.string(),
	/** base url */
	baseURL: z.string().optional(),
	/** 推理强度 (e.g. "low", "medium", "high", "max") */
	reasoningEffort: z.string().optional(),
	/** agent loop 最大迭代次数 */
	maxIterations: z.number().int().positive(),
	/** 回复语言偏好 */
	language: z.string(),
	/** 注入到 session 的环境变量 */
	env: z.record(z.string(), z.string()),
	/** 自定义 provider 配置 */
	providers: z.record(z.string(), ProviderConfigSchema).optional(),
	/** 工具调用权限配置（mode + rules） */
	permission: PermissionSettingsSchema.optional(),
	/**
	 * 插件配置。key = plugin name（对应 plugin.json 的 name）。
	 * value 是任意 JSON，由插件在 index.ts 里导出的 `configSchema` 自行校验。
	 * 加载时未通过校验的插件会记录到 LoadError 并跳过。
	 */
	plugins: z.record(z.string(), z.unknown()).optional(),
});

const PartialSettingsSchema = SettingsSchema.partial();

export type Settings = z.infer<typeof PartialSettingsSchema>;
export type ResolvedSettings = z.infer<typeof SettingsSchema>;

const DEFAULTS: ResolvedSettings = {
	model: "anthropic/claude-sonnet-4-20250514",
	provider: "anthropic",
	maxIterations: 25,
	language: "zh-CN",
	env: {},
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
	private globalPath!: string;

	private constructor(
		private global: Settings,
		private project: Settings,
		private resolved: ResolvedSettings,
	) {}

	static async load(workspace: Workspace): Promise<SettingsManager> {
		const global = await readSettingsFile(workspace.globalSettingsPath);
		const project = await readSettingsFile(workspace.projectSettingsPath);
		const merged = deepMergeSettings(global, project);
		const mgr = new SettingsManager(global, project, resolve(merged));
		mgr.globalPath = workspace.globalSettingsPath;
		return mgr;
	}

	get<K extends keyof ResolvedSettings>(key: K): ResolvedSettings[K] {
		return this.resolved[key];
	}

	getAll(): Readonly<ResolvedSettings> {
		return this.resolved;
	}

	resolveModel(): ModelInfo | string {
		return resolveSettingsModel(this.resolved);
	}

	withOverrides(overrides: Settings): SettingsManager {
		const merged = deepMergeSettings(deepMergeSettings(this.global, this.project), overrides);
		return new SettingsManager(this.global, this.project, resolve(merged));
	}

	async save(patch: Settings): Promise<void> {
		this.global = deepMergeSettings(this.global, patch);
		const merged = deepMergeSettings(this.global, this.project);
		this.resolved = resolve(merged);
		await Bun.write(this.globalPath, JSON.stringify(this.global, null, 2));
	}

	async deleteProvider(providerId: string): Promise<void> {
		if (this.global.providers) {
			const { [providerId]: _, ...rest } = this.global.providers;
			this.global = { ...this.global, providers: rest };
		}
		const merged = deepMergeSettings(this.global, this.project);
		this.resolved = resolve(merged);
		await Bun.write(this.globalPath, JSON.stringify(this.global, null, 2));
	}
}
