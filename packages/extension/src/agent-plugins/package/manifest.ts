import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import { AgentPluginLoadFailed } from "./errors";
import { isInside } from "./paths";
import { AGENT_PLUGINS_SCHEMA, type AgentPluginManifestV1 } from "./types";

const PLUGIN_NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export async function readManifest(
	root: string,
): Promise<{ readonly manifest: AgentPluginManifestV1; readonly diagnostics: readonly AgentPluginDiagnostic[] }> {
	const location = path.join(root, "plugin.json");
	try {
		const canonicalLocation = await realpath(location).catch((cause) => {
			throw invalidManifest("plugin.json cannot be resolved", location, cause);
		});
		if (!isInside(canonicalLocation, root)) throw invalidManifest("plugin.json escapes Plugin root", location);
		const info = await stat(canonicalLocation);
		if (!info.isFile()) throw invalidManifest("plugin.json must be a regular file", location);
		const parsed: unknown = JSON.parse(await readFile(canonicalLocation, "utf8"));
		return validateManifest(parsed, canonicalLocation);
	} catch (cause) {
		if (cause instanceof AgentPluginLoadFailed) throw cause;
		throw new AgentPluginLoadFailed({
			reason: "invalid_manifest",
			path: location,
			message: "plugin.json is missing or invalid",
			cause,
		});
	}
}

function validateManifest(
	value: unknown,
	location: string,
): { readonly manifest: AgentPluginManifestV1; readonly diagnostics: readonly AgentPluginDiagnostic[] } {
	if (!isRecord(value)) throw invalidManifest("plugin.json must be an object", location);
	if (value.$schema !== AGENT_PLUGINS_SCHEMA) {
		throw new AgentPluginLoadFailed({
			reason: "unsupported_version",
			path: location,
			message: `Unsupported Agent Plugins schema: ${String(value.$schema ?? "missing")}`,
		});
	}
	if (
		typeof value.name !== "string" ||
		value.name.length < 1 ||
		value.name.length > 64 ||
		!PLUGIN_NAME.test(value.name)
	) {
		throw invalidManifest("plugin.json name is invalid", location);
	}
	for (const key of ["version", "description", "homepage", "repository", "license"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw invalidManifest(`plugin.json ${key} must be a string`, location);
		}
	}
	if (
		value.author !== undefined &&
		(!isRecord(value.author) || !Object.keys(value.author).every((key) => ["name", "email", "url"].includes(key)))
	) {
		throw invalidManifest("plugin.json author is invalid", location);
	}
	if (isRecord(value.author)) {
		for (const key of ["name", "email", "url"] as const) {
			if (value.author[key] !== undefined && typeof value.author[key] !== "string") {
				throw invalidManifest(`plugin.json author.${key} must be a string`, location);
			}
		}
	}
	if (
		value.keywords !== undefined &&
		(!Array.isArray(value.keywords) || !value.keywords.every((item) => typeof item === "string"))
	) {
		throw invalidManifest("plugin.json keywords must be a string array", location);
	}
	const diagnostics: AgentPluginDiagnostic[] = [];
	const allowed = new Set([
		"$schema",
		"name",
		"version",
		"description",
		"author",
		"homepage",
		"repository",
		"license",
		"keywords",
		"extensions",
	]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key))
			diagnostics.push({
				code: "plugin_manifest_unknown_field",
				severity: "warning",
				scope: "package",
				relativePath: "plugin.json",
				message: `Unknown manifest field "${key}" was ignored`,
			});
	}
	const extensions =
		value.extensions === undefined ? undefined : isRecord(value.extensions) ? value.extensions : undefined;
	if (value.extensions !== undefined && !isRecord(value.extensions)) {
		diagnostics.push({
			code: "plugin_manifest_extensions_invalid",
			severity: "warning",
			scope: "package",
			relativePath: "plugin.json",
			message: "Non-object extensions were ignored",
		});
	}
	if (extensions && !isExtensionMap(extensions)) {
		throw invalidManifest("plugin.json extensions entries must be objects", location);
	}
	const manifest = {
		$schema: AGENT_PLUGINS_SCHEMA,
		name: value.name,
		...(typeof value.version === "string" ? { version: value.version } : {}),
		...(typeof value.description === "string" ? { description: value.description } : {}),
		...(isRecord(value.author) ? { author: value.author as AgentPluginManifestV1["author"] } : {}),
		...(typeof value.homepage === "string" ? { homepage: value.homepage } : {}),
		...(typeof value.repository === "string" ? { repository: value.repository } : {}),
		...(typeof value.license === "string" ? { license: value.license } : {}),
		...(Array.isArray(value.keywords) ? { keywords: value.keywords as string[] } : {}),
		...(extensions ? { extensions } : {}),
	};
	return { manifest, diagnostics };
}

function invalidManifest(message: string, location: string, cause?: unknown): AgentPluginLoadFailed {
	return new AgentPluginLoadFailed({
		reason: "invalid_manifest",
		path: location,
		message,
		...(cause === undefined ? {} : { cause }),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExtensionMap(value: Record<string, unknown>): value is Record<string, Record<string, unknown>> {
	return Object.values(value).every(isRecord);
}
