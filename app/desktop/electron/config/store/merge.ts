import { isFieldRule } from "./definition";
import { resolvedConfigValidationError } from "./errors";
import type { ConfigFieldRule, ConfigFieldTree, ConfigMergeCandidate, ConfigProvenance, ConfigSource } from "./types";

export interface ConfigSourceValue {
	readonly source: ConfigSource;
	readonly sourceFile?: string;
	readonly value: Record<string, unknown>;
}

export function mergeCodingConfig(
	fields: ConfigFieldTree,
	sources: readonly ConfigSourceValue[],
	workspaceTrusted: boolean,
): { readonly value: Record<string, unknown>; readonly provenance: readonly ConfigProvenance[] } {
	const provenance: ConfigProvenance[] = [];
	const value = mergeTree(fields, sources, workspaceTrusted, "", provenance);
	return { value: deepFreeze(cloneValue(value) as Record<string, unknown>), provenance: Object.freeze(provenance) };
}

export function buildEnvironmentSettings(
	fields: ConfigFieldTree,
	environment: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(fields)) {
		if (isFieldRule(field)) {
			const binding = field.environment;
			if (!binding) continue;
			const raw = environment[binding.name];
			if (raw === undefined) continue;
			try {
				output[key] = binding.parse ? binding.parse(raw) : raw;
			} catch {
				throw resolvedConfigValidationError([
					{ path: key, message: `Environment variable ${binding.name} could not be parsed` },
				]);
			}
			continue;
		}
		const nested = buildEnvironmentSettings(field, environment);
		if (Object.keys(nested).length > 0) output[key] = nested;
	}
	return output;
}

function mergeTree(
	fields: ConfigFieldTree,
	sources: readonly ConfigSourceValue[],
	workspaceTrusted: boolean,
	parentPath: string,
	provenance: ConfigProvenance[],
): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(fields)) {
		const path = parentPath ? `${parentPath}.${key}` : key;
		if (isFieldRule(field)) {
			const candidates = candidatesFor(key, field, sources, workspaceTrusted);
			const merged = mergeField(field, candidates);
			if (!merged.present) continue;
			output[key] = merged.value;
			for (const candidate of merged.contributors) {
				provenance.push({
					path,
					source: candidate.source,
					mergePolicy: field.merge,
					sourceFile: candidate.sourceFile,
				});
			}
			continue;
		}

		const nestedSources: ConfigSourceValue[] = [];
		for (const source of sources) {
			if (!Object.hasOwn(source.value, key)) continue;
			const nested = source.value[key];
			if (isPlainObject(nested)) nestedSources.push({ ...source, value: nested });
		}
		const nested = mergeTree(field, nestedSources, workspaceTrusted, path, provenance);
		if (Object.keys(nested).length > 0) output[key] = nested;
	}
	return output;
}

function candidatesFor(
	key: string,
	field: ConfigFieldRule,
	sources: readonly ConfigSourceValue[],
	workspaceTrusted: boolean,
): ConfigMergeCandidate[] {
	const candidates: ConfigMergeCandidate[] = [];
	if ("default" in field) candidates.push({ source: "default", value: field.default });
	for (const source of sources) {
		if (
			!workspaceTrusted &&
			field.project === "trusted" &&
			(source.source === "project-shared" || source.source === "project-local")
		) {
			continue;
		}
		if (!Object.hasOwn(source.value, key)) continue;
		candidates.push({ source: source.source, sourceFile: source.sourceFile, value: source.value[key] });
	}
	return candidates;
}

function mergeField(
	field: ConfigFieldRule,
	candidates: readonly ConfigMergeCandidate[],
): { readonly present: boolean; readonly value?: unknown; readonly contributors: readonly ConfigMergeCandidate[] } {
	if (candidates.length === 0) return { present: false, contributors: [] };
	if (field.merge === "replace") {
		const winner = candidates.at(-1)!;
		return { present: true, value: winner.value, contributors: [winner] };
	}
	if (field.merge === "deepMerge") {
		let value: Record<string, unknown> = {};
		for (const candidate of candidates) {
			if (isPlainObject(candidate.value)) value = deepMerge(value, candidate.value);
		}
		return { present: true, value, contributors: candidates };
	}
	if (field.merge === "appendUnique" || field.merge === "denyUnion") {
		const values: unknown[] = [];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			if (!Array.isArray(candidate.value)) continue;
			for (const value of candidate.value) {
				const key = field.uniqueBy?.(value) ?? stableKey(value);
				if (seen.has(key)) continue;
				seen.add(key);
				values.push(value);
			}
		}
		return { present: true, value: values, contributors: candidates };
	}
	if (field.merge === "custom") {
		return { present: true, value: field.mergeValues!(candidates), contributors: candidates };
	}

	let value = candidates[0]!.value;
	for (const candidate of candidates.slice(1)) {
		value = field.combineRestrictions!(value, candidate.value);
	}
	return { present: true, value, contributors: candidates };
}

function deepMerge(lower: Record<string, unknown>, higher: Record<string, unknown>): Record<string, unknown> {
	const output = { ...lower };
	for (const [key, value] of Object.entries(higher)) {
		output[key] =
			isPlainObject(value) && isPlainObject(output[key]) ? deepMerge(output[key], value) : cloneValue(value);
	}
	return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneValue);
	if (isPlainObject(value))
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
	return value;
}

function stableKey(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableKey(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
	} else if (isPlainObject(value)) {
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return Object.freeze(value);
}

