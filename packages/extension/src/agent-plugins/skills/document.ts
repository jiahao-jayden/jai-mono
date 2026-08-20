import { TaggedError } from "better-result";
import { parse } from "yaml";

export class InvalidPluginSkillDocument extends TaggedError("jai_plugins.skill_invalid")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const SKILL_NAME = /^(?!.*--)[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_COMPATIBILITY_LENGTH = 500;
const FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

export interface ParsedPluginSkillFrontmatter {
	readonly name: string;
	readonly description: string;
	readonly license?: string;
	readonly compatibility?: string;
	readonly allowedTools: readonly string[];
	readonly metadata: Readonly<Record<string, string>>;
}

export function parseSkillDocument(content: string): {
	readonly frontmatter: Readonly<Record<string, unknown>>;
	readonly body: string;
} {
	const normalized = content.replace(/^\uFEFF/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
	if (!match) throw invalid("SKILL.md must start with YAML frontmatter");
	let parsed: unknown;
	try {
		parsed = parse(match[1]!);
	} catch (cause) {
		throw invalid("SKILL.md contains invalid YAML frontmatter", cause);
	}
	if (!isRecord(parsed)) throw invalid("SKILL.md frontmatter must be a mapping");
	return { frontmatter: parsed, body: normalized.slice(match[0].length) };
}

export function validateSkillFrontmatter(
	value: Readonly<Record<string, unknown>>,
	directoryName?: string,
): ParsedPluginSkillFrontmatter {
	for (const key of Object.keys(value))
		if (!FIELDS.has(key)) throw invalid(`Unknown Skill frontmatter field "${key}"`);
	const rawName = value.name;
	if (typeof rawName !== "string" || !rawName.trim()) throw invalid('Skill frontmatter requires "name"');
	const name = rawName.trim().normalize("NFKC");
	if (Array.from(name).length > MAX_SKILL_NAME_LENGTH || name !== name.toLowerCase() || !SKILL_NAME.test(name)) {
		throw invalid(`Invalid Skill name "${name}"`);
	}
	if (directoryName !== undefined && directoryName.normalize("NFKC") !== name)
		throw invalid(`Skill directory "${directoryName}" declares name "${name}"`);
	const rawDescription = value.description;
	if (typeof rawDescription !== "string" || !rawDescription.trim())
		throw invalid('Skill frontmatter requires "description"');
	const description = rawDescription.trim();
	if (Array.from(description).length > MAX_DESCRIPTION_LENGTH) throw invalid("Skill description is too long");
	const license = optionalString(value, "license");
	const compatibility = optionalString(value, "compatibility");
	if (
		compatibility !== undefined &&
		(compatibility.length === 0 || Array.from(compatibility).length > MAX_COMPATIBILITY_LENGTH)
	)
		throw invalid("Skill compatibility is invalid");
	const metadata = value.metadata === undefined ? {} : value.metadata;
	if (!isRecord(metadata) || !Object.values(metadata).every((item) => typeof item === "string"))
		throw invalid('Skill "metadata" must be a mapping of string values');
	const allowedTools = value["allowed-tools"];
	if (allowedTools !== undefined && typeof allowedTools !== "string")
		throw invalid('Skill "allowed-tools" must be a space-separated string');
	return {
		name,
		description,
		...(license === undefined ? {} : { license }),
		...(compatibility === undefined ? {} : { compatibility }),
		allowedTools: allowedTools?.split(/\s+/).filter(Boolean) ?? [],
		metadata: metadata as Record<string, string>,
	};
}

function optionalString(
	value: Readonly<Record<string, unknown>>,
	key: "license" | "compatibility",
): string | undefined {
	if (!(key in value)) return undefined;
	if (typeof value[key] !== "string") throw invalid(`Skill "${key}" must be a string`);
	return value[key] as string;
}

function invalid(message: string, cause?: unknown): InvalidPluginSkillDocument {
	return new InvalidPluginSkillDocument({ message, ...(cause === undefined ? {} : { cause }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
