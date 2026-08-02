import { createHash } from "node:crypto";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, AgentExtension, AgentInput, AgentTool } from "@jai/agent";
import { defineCodedError } from "@jai/common";
import { Type } from "@sinclair/typebox";
import {
	type CodingSkillCard,
	CodingSkillCatalog,
	type CodingSkillCatalogOptions,
	type CodingSkillCatalogSnapshot,
	parseSkillDocument,
} from "./catalog";

const skillRuntimeError = defineCodedError("coding_skill", [
	"not_available",
	"path_outside_root",
	"path_not_found",
] as const);

const skillInputSchema = Type.Object(
	{
		skill: Type.String({ minLength: 1 }),
		path: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export interface CodingSkillsRuntimeOptions extends CodingSkillCatalogOptions {
	readonly commandNames?: readonly string[];
}

export interface SlashInvocation {
	readonly name: string;
	readonly kind: "skill" | "command";
	readonly displayName: string;
}

export class CodingSkillsRuntime {
	readonly catalog: CodingSkillCatalog;
	readonly extension: AgentExtension;
	readonly #commandNames: ReadonlySet<string>;
	#nextSnapshot?: CodingSkillCatalogSnapshot;
	#activeSnapshot?: CodingSkillCatalogSnapshot;
	#forcedSkill?: string;

	private constructor(catalog: CodingSkillCatalog, commandNames: readonly string[]) {
		this.catalog = catalog;
		this.#commandNames = new Set(commandNames);
		const tool = this.#createTool();
		const extension: AgentExtension = {
			name: "coding-skills",
			tools: [tool],
			initialize: (agent) => {
				agent.registerHooks(extension, {
					onEvent: [(event) => this.#onEvent(event)],
				});
			},
		};
		this.extension = extension;
	}

	static async create(options: CodingSkillsRuntimeOptions): Promise<CodingSkillsRuntime> {
		const catalog = new CodingSkillCatalog(options);
		await catalog.load();
		return new CodingSkillsRuntime(catalog, options.commandNames ?? []);
	}

	prepareInput(input: AgentInput): { readonly input: AgentInput; readonly slash?: SlashInvocation } {
		const snapshot = this.catalog.snapshot;
		this.#nextSnapshot = snapshot;
		this.#forcedSkill = undefined;
		const slash = resolveSlashInvocation(input, snapshot, this.#commandNames);
		if (slash?.kind === "skill") this.#forcedSkill = slash.name;
		return {
			input: slash ? annotateSlashInvocation(input, slash) : input,
			...(slash ? { slash } : {}),
		};
	}

	close(): void {
		this.catalog.close();
	}

	#createTool(): AgentTool<typeof skillInputSchema> {
		const runtime = this;
		return {
			name: "Skill",
			label: "Skill",
			get description() {
				return runtime.#description();
			},
			parameters: skillInputSchema,
			executionMode: "parallel",
			execute: async (_toolCallId, input) => runtime.#execute(input.skill, input.path),
		};
	}

	#description(): string {
		const snapshot = this.#activeSnapshot ?? this.#nextSnapshot ?? this.catalog.snapshot;
		const lines = [
			"Load an Agent Skill before doing skill-specific work.",
			"Only use skills listed in <available_skills>. Omit path to load SKILL.md; provide path to read a resource inside that Skill.",
			"Skill resources may live outside the project workspace. Use this tool, not filesystem tools, to read them.",
		];
		if (this.#forcedSkill) {
			lines.push(`The user explicitly invoked "/${this.#forcedSkill}". You MUST load that Skill before continuing.`);
		}
		lines.push("<available_skills>");
		for (const skill of snapshot.skills) {
			lines.push(
				"<skill>",
				`<name>${escapeXml(skill.name)}</name>`,
				`<description>${escapeXml(skill.description)}</description>`,
				`<source>${skill.source.scope}:${skill.source.directory}</source>`,
				"</skill>",
			);
		}
		lines.push("</available_skills>");
		return lines.join("\n");
	}

	async #execute(skillName: string, resourcePath?: string): Promise<{ content: [{ type: "text"; text: string }] }> {
		const snapshot = this.#activeSnapshot ?? this.#nextSnapshot ?? this.catalog.snapshot;
		const skill = snapshot.skills.find((candidate) => candidate.name === skillName);
		if (!skill) {
			throw skillRuntimeError("not_available", {
				message: `Skill "${skillName}" is not available`,
				data: { skill: skillName },
			});
		}
		const text =
			resourcePath && !isSkillEntryPath(resourcePath)
				? await readSkillResource(skill, resourcePath)
				: await readSkillBody(skill);
		return {
			content: [
				{
					type: "text",
					text: `Skill: ${skill.name}\nUse Skill({ skill: "${skill.name}", path }) for bundled resources.\n\n${text}`,
				},
			],
		};
	}

	#onEvent(event: AgentEvent): void {
		if (event.type === "agent_start") {
			this.#activeSnapshot = this.#nextSnapshot ?? this.catalog.snapshot;
			this.#nextSnapshot = undefined;
		}
		if (event.type === "agent_end") {
			this.#activeSnapshot = undefined;
			this.#forcedSkill = undefined;
		}
	}
}

export function resolveSlashInvocation(
	input: AgentInput,
	snapshot: CodingSkillCatalogSnapshot,
	commandNames: ReadonlySet<string> = new Set(),
): SlashInvocation | undefined {
	const message = Array.isArray(input) ? input[0] : input;
	const content = typeof message === "string" ? message : message?.role === "user" ? message.content : undefined;
	if (typeof content !== "string") return undefined;
	const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(content);
	if (!match) return undefined;
	const name = match[1]!;
	if (commandNames.has(name)) return { name, kind: "command", displayName: name };
	const skill = snapshot.skills.find((candidate) => candidate.name === name);
	return skill ? { name, kind: "skill", displayName: skill.displayName } : undefined;
}

function annotateSlashInvocation(input: AgentInput, slash: SlashInvocation): AgentInput {
	const metadata = {
		slashInvocation: {
			name: slash.name,
			kind: slash.kind,
			displayName: slash.displayName,
		},
	};
	if (typeof input === "string") {
		return { role: "user", content: input, metadata, timestamp: Date.now() };
	}
	if (!Array.isArray(input)) {
		return input.role === "user" ? { ...input, metadata: { ...input.metadata, ...metadata } } : input;
	}
	let annotated = false;
	return input.map((message) => {
		if (annotated || message.role !== "user") return message;
		annotated = true;
		return { ...message, metadata: { ...message.metadata, ...metadata } };
	});
}

async function readSkillBody(skill: CodingSkillCard): Promise<string> {
	const handle = await openCanonicalSkillFile(skill, skill.location);
	try {
		const content = await handle.readFile("utf8");
		if (createHash("sha256").update(content).digest("hex") !== skill.contentRevision) {
			throw skillRuntimeError("not_available", {
				message: `Skill "${skill.name}" changed during the current run; retry on the next message`,
				data: { skill: skill.name },
			});
		}
		const document = parseSkillDocument(content);
		if (document.frontmatter.name !== skill.name) {
			throw skillRuntimeError("not_available", {
				message: `Skill "${skill.name}" changed identity after catalog loading`,
				data: { skill: skill.name },
			});
		}
		return document.body;
	} finally {
		await handle.close();
	}
}

async function readSkillResource(skill: CodingSkillCard, inputPath: string): Promise<string> {
	const lexicalPath = path.resolve(skill.directory, inputPath);
	if (!isInside(lexicalPath, skill.directory)) {
		throw skillRuntimeError("path_outside_root", {
			message: `Skill resource path escapes "${skill.name}"`,
			data: { skill: skill.name, path: inputPath },
		});
	}
	const canonicalPath = await realpath(lexicalPath).catch((error) => {
		if (isNodeError(error, "ENOENT")) {
			throw skillRuntimeError("path_not_found", {
				message: `Skill resource "${inputPath}" does not exist`,
				data: { skill: skill.name, path: inputPath },
			});
		}
		throw error;
	});
	if (!isInside(canonicalPath, skill.canonicalDirectory)) {
		throw skillRuntimeError("path_outside_root", {
			message: `Skill resource path escapes "${skill.name}"`,
			data: { skill: skill.name, path: inputPath },
		});
	}
	const info = await stat(canonicalPath);
	if (info.isDirectory()) return renderDirectory(canonicalPath);
	const handle = await openCanonicalSkillFile(skill, canonicalPath);
	try {
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

async function openCanonicalSkillFile(skill: CodingSkillCard, candidate: string) {
	const canonicalPath = await realpath(candidate);
	if (!isInside(canonicalPath, skill.canonicalDirectory)) {
		throw skillRuntimeError("path_outside_root", {
			message: `Skill resource path escapes "${skill.name}"`,
			data: { skill: skill.name, path: candidate },
		});
	}
	return open(canonicalPath, "r");
}

async function renderDirectory(directory: string): Promise<string> {
	const entries = await readdir(directory, { withFileTypes: true });
	return [
		"Files:",
		...entries
			.toSorted((left, right) => left.name.localeCompare(right.name))
			.map((entry) => `- ${entry.name}${entry.isDirectory() ? "/" : ""}`),
	].join("\n");
}

function isSkillEntryPath(value: string): boolean {
	const normalized = value.trim().replaceAll("\\", "/");
	return normalized === "" || normalized === "." || normalized === "SKILL.md";
}

function isInside(candidate: string, directory: string): boolean {
	const relative = path.relative(directory, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}
