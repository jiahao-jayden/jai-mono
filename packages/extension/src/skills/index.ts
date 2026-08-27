import { createHash } from "node:crypto";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { Result, TaggedError } from "better-result";
import {
	CodingExtensionOperationFailed,
	defineExtension,
	type CodingAgentExtension,
	type CodingExtensionCommandRegistration,
	type CodingExtensionContext,
	type CodingExtensionTool,
} from "@jai/coding-agent";
import {
	type CodingSkillCard,
	CodingSkillCatalog,
	type CodingSkillCatalogOptions,
	parseSkillDocument,
	validateSkillFrontmatter,
} from "./catalog";
import {
	type CodingPromptCommandCard,
	CodingPromptCommandCatalog,
	expandPromptCommandTemplate,
	parsePromptCommandDocument,
	validatePromptCommandFrontmatter,
} from "./command-catalog";

export const SKILLS_EXTENSION_ID = "jai.skills";

type SkillRuntimeErrorInit = { readonly data?: Record<string, unknown>; readonly message: string };
class SkillNotAvailable extends TaggedError("coding_skill.not_available")<SkillRuntimeErrorInit> {}
class SkillPathOutsideRoot extends TaggedError("coding_skill.path_outside_root")<SkillRuntimeErrorInit> {}
class SkillPathNotFound extends TaggedError("coding_skill.path_not_found")<SkillRuntimeErrorInit> {}
class CommandNotAvailable extends TaggedError("coding_command.not_available")<SkillRuntimeErrorInit> {}

function skillRuntimeError(
	reason: "not_available" | "path_outside_root" | "path_not_found",
	init: SkillRuntimeErrorInit,
) {
	switch (reason) {
		case "not_available":
			return new SkillNotAvailable(init);
		case "path_outside_root":
			return new SkillPathOutsideRoot(init);
		case "path_not_found":
			return new SkillPathNotFound(init);
	}
}

function commandRuntimeError(init: SkillRuntimeErrorInit): CommandNotAvailable {
	return new CommandNotAvailable(init);
}

const skillInputSchema = Type.Object(
	{
		skill: Type.String({ minLength: 1 }),
		path: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export interface CreateSkillsExtensionOptions extends CodingSkillCatalogOptions {}

/**
 * Safe command metadata for a host UI. It intentionally excludes catalog
 * locations and plugin-provided Skills, neither of which is a slash target.
 */
export interface SkillsCommandDescriptor {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly kind: "file" | "skill";
	readonly argumentHint?: string;
}

/**
 * Reads the Commands a host may offer before an Operation exists. Catalogs
 * are closed immediately: discovery has no handlers, tools, or watchers.
 */
export async function discoverSkillsCommands(
	options: CreateSkillsExtensionOptions,
): Promise<readonly SkillsCommandDescriptor[]> {
	const skillCatalog = new CodingSkillCatalog(options);
	const commandCatalog = new CodingPromptCommandCatalog(options);
	try {
		await Promise.all([skillCatalog.load(), commandCatalog.load()]);
		const skills = skillCatalog.snapshot.skills
			.filter(isLocalSkill)
			.map((skill) => ({
				name: `skill:${skill.name}`,
				displayName: `skill:${skill.name}`,
				description: `Load the ${skill.name} Skill into the current prompt`,
				kind: "skill" as const,
			}));
		const commands = commandCatalog.snapshot.commands.map((command) => ({
			name: command.name,
			displayName: command.displayName,
			description: command.description,
			kind: "file" as const,
			...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
		}));
		return [...commands, ...skills].toSorted((left, right) => left.name.localeCompare(right.name));
	} finally {
		skillCatalog.close();
		commandCatalog.close();
	}
}

export function createSkillsExtension(
	options: CreateSkillsExtensionOptions,
): CodingAgentExtension<any, any, SkillsExtensionInstance> {
	let instance: SkillsExtensionInstance | undefined;
	const tool: CodingExtensionTool<any, any, SkillsExtensionInstance> = {
		name: "Skill",
		get description() {
			return instance?.description ?? skillToolDescription([]);
		},
		parameters: skillInputSchema,
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", reason: "Skill resources are constrained to the selected Skill root" },
		},
		presentation: {
			activityKind: "read",
			title: (_runtime, args) => `Load /${typeof args.skill === "string" ? args.skill : "skill"}`,
		},
		executionMode: "parallel",
		execute: async (runtime, call) =>
			runtime.instance.execute(call.args.skill as string, call.args.path as string | undefined),
	};
	return defineExtension({
		id: SKILLS_EXTENSION_ID,
		tools: [tool],
		lifecycle: {
			activate: async (context) => {
				const skillCatalog = new CodingSkillCatalog(options);
				const commandCatalog = new CodingPromptCommandCatalog(options);
				try {
					await Promise.all([skillCatalog.load(), commandCatalog.load()]);
					const next = new SkillsExtensionInstance(skillCatalog, commandCatalog, context);
					const activated = next.activate();
					if (activated.isErr()) {
						next.close();
						return Result.err(
							new CodingExtensionOperationFailed({
								message: activated.error.message,
								cause: activated.error,
							}),
						);
					}
					instance = next;
					return Result.ok(next);
				} catch (cause) {
					skillCatalog.close();
					commandCatalog.close();
					return Result.err(
						new CodingExtensionOperationFailed({
							message: "Failed to activate the Skills Extension",
							cause,
						}),
					);
				}
			},
			deactivate: (runtime) => {
				runtime.instance.close();
				if (instance === runtime.instance) instance = undefined;
			},
		},
	});
}

class SkillsExtensionInstance {
	readonly catalog: CodingSkillCatalog;
	readonly commandCatalog: CodingPromptCommandCatalog;
	readonly #context: CodingExtensionContext;
	readonly #skillCommands = new Map<string, CodingExtensionCommandRegistration>();
	readonly #fileCommands = new Map<string, CodingExtensionCommandRegistration>();
	#stopWatching?: readonly (() => void)[];

	constructor(
		catalog: CodingSkillCatalog,
		commandCatalog: CodingPromptCommandCatalog,
		context: CodingExtensionContext,
	) {
		this.catalog = catalog;
		this.commandCatalog = commandCatalog;
		this.#context = context;
	}

	get description(): string {
		return skillToolDescription(this.catalog.snapshot.skills);
	}

	activate() {
		const skills = this.#syncSkillCommands();
		if (skills.isErr()) return skills;
		const files = this.#syncFileCommands();
		if (files.isErr()) return files;
		this.#stopWatching = [
			this.catalog.watch(() => {
				this.#syncSkillCommands();
			}),
			this.commandCatalog.watch(() => {
				this.#syncFileCommands();
			}),
		];
		return Result.ok(undefined);
	}

	close(): void {
		for (const stopWatching of this.#stopWatching ?? []) stopWatching();
		this.#stopWatching = undefined;
		for (const registration of this.#skillCommands.values()) registration.unregister();
		for (const registration of this.#fileCommands.values()) registration.unregister();
		this.#skillCommands.clear();
		this.#fileCommands.clear();
		this.catalog.close();
		this.commandCatalog.close();
	}

	async execute(skillName: string, resourcePath?: string): Promise<{ content: [{ type: "text"; text: string }] }> {
		const skill = this.catalog.snapshot.skills.find((candidate) => candidate.name === skillName);
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

	#syncSkillCommands() {
		const localSkills = this.catalog.snapshot.skills.filter(isLocalSkill);
		const localNames = new Set(localSkills.map((skill) => skill.name));
		for (const [name, registration] of this.#skillCommands) {
			if (localNames.has(name)) continue;
			registration.unregister();
			this.#skillCommands.delete(name);
		}
		for (const skill of localSkills) {
			if (this.#skillCommands.has(skill.name)) continue;
			const registered = this.#context.registerCommand({
				name: `skill:${skill.name}`,
				description: `Load the ${skill.name} Skill into the current prompt`,
				displayName: `skill:${skill.name}`,
				kind: "skill",
				handler: async (args) => {
					const current = this.catalog.snapshot.skills.find(
						(candidate) => candidate.name === skill.name && isLocalSkill(candidate),
					);
					if (!current) {
						throw skillRuntimeError("not_available", {
							message: `Skill "${skill.name}" is not available`,
							data: { skill: skill.name },
						});
					}
					const body = await readSkillBody(current);
					return Result.ok({ kind: "prompt", prompt: renderSkillCommandPrompt(current, body, args) });
				},
			});
			if (registered.isErr()) return registered;
			this.#skillCommands.set(skill.name, registered.value);
		}
		return Result.ok(undefined);
	}

	#syncFileCommands() {
		const cards = this.commandCatalog.snapshot.commands;
		const names = new Set(cards.map((card) => card.name));
		for (const [name, registration] of this.#fileCommands) {
			if (names.has(name)) continue;
			registration.unregister();
			this.#fileCommands.delete(name);
		}
		for (const card of cards) {
			if (this.#fileCommands.has(card.name)) continue;
			const registered = this.#context.registerCommand({
				name: card.name,
				description: card.description,
				displayName: card.displayName,
				kind: "file",
				handler: async (args) => {
					const current = this.commandCatalog.snapshot.commands.find((candidate) => candidate.name === card.name);
					if (!current) {
						throw commandRuntimeError({
							message: `Command "/${card.name}" is not available`,
							data: { command: card.name },
						});
					}
					const template = await readPromptCommandBody(current);
					return Result.ok({ kind: "prompt", prompt: expandPromptCommandTemplate(template, args) });
				},
			});
			if (registered.isErr()) return registered;
			this.#fileCommands.set(card.name, registered.value);
		}
		return Result.ok(undefined);
	}
}

function skillToolDescription(skills: readonly CodingSkillCard[]): string {
	const lines = [
		"Load an Agent Skill before doing skill-specific work.",
		"Only use skills listed in <available_skills>. Omit path to load SKILL.md; provide path to read a resource inside that Skill.",
		"Skill resources may live outside the project workspace. Use this tool, not filesystem tools, to read them.",
		"<available_skills>",
	];
	for (const skill of skills) {
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

function renderSkillCommandPrompt(skill: CodingSkillCard, body: string, args: string): string {
	return [
		`<skill name="${escapeXml(skill.name)}">`,
		body,
		"</skill>",
		"<skill_args>",
		escapeXml(args),
		"</skill_args>",
	].join("\n");
}

function isLocalSkill(skill: CodingSkillCard): boolean {
	return skill.source.directory !== "plugin";
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
		try {
			validateSkillFrontmatter(document.frontmatter);
		} catch (error) {
			throw skillRuntimeError("not_available", {
				message: `Skill "${skill.name}" changed validity after catalog loading`,
				data: { skill: skill.name, cause: error instanceof Error ? error.message : "invalid frontmatter" },
			});
		}
		return document.body;
	} finally {
		await handle.close();
	}
}

async function readPromptCommandBody(command: CodingPromptCommandCard): Promise<string> {
	const handle = await openCanonicalCommandFile(command);
	try {
		const content = await handle.readFile("utf8");
		if (createHash("sha256").update(content).digest("hex") !== command.contentRevision) {
			throw commandRuntimeError({
				message: `Command "/${command.name}" changed during the current run; retry on the next message`,
				data: { command: command.name },
			});
		}
		const document = parsePromptCommandDocument(content);
		if (!document.body.trim()) {
			throw commandRuntimeError({
				message: `Command "/${command.name}" changed to an empty prompt template`,
				data: { command: command.name },
			});
		}
		try {
			validatePromptCommandFrontmatter(document.frontmatter, command.name);
		} catch (cause) {
			throw commandRuntimeError({
				message: `Command "/${command.name}" changed validity after catalog loading`,
				data: { command: command.name, cause: cause instanceof Error ? cause.message : "invalid frontmatter" },
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

async function openCanonicalCommandFile(command: CodingPromptCommandCard) {
	const canonicalPath = await realpath(command.location);
	if (!isInside(canonicalPath, command.canonicalDirectory)) {
		throw commandRuntimeError({
			message: `Command "/${command.name}" path escapes its catalog root`,
			data: { command: command.name },
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

export {
	type CodingPluginSkillCard,
	type CodingSkillCard,
	type CodingSkillCatalogOptions,
	CodingSkillCatalog,
	validateSkillFrontmatter,
} from "./catalog";
export type {
	CodingPromptCommandCard,
	CodingPromptCommandCatalogOptions,
	CodingPromptCommandCatalogSnapshot,
} from "./command-catalog";
export {
	CodingPromptCommandCatalog,
	expandPromptCommandTemplate,
	parsePromptCommandDocument,
	validatePromptCommandFrontmatter,
} from "./command-catalog";
