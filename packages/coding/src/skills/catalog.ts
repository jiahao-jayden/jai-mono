import { createHash } from "node:crypto";
import { type FSWatcher, watch as watchFileSystem } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { defineCodedError, getErrorMessage } from "@jai/common";
import { parse } from "yaml";

const skillCatalogError = defineCodedError("coding_skills", ["catalog_load_failed"] as const);
const skillFileError = defineCodedError("coding_skill_file", ["invalid_document", "path_escape"] as const);
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CodingSkillSource {
	readonly scope: "user" | "project";
	readonly directory: ".agents" | ".jai";
}

export interface CodingSkillCard {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly contentRevision: string;
	readonly location: string;
	readonly directory: string;
	readonly canonicalDirectory: string;
	readonly source: CodingSkillSource;
	readonly license?: string;
	readonly compatibility?: string;
	readonly allowedTools: readonly string[];
	readonly metadata: Readonly<Record<string, string>>;
}

export interface CodingSkillDiagnostic {
	readonly code: "invalid" | "shadowed";
	readonly path: string;
	readonly message: string;
	readonly skillName?: string;
	readonly shadowedBy?: string;
}

export interface CodingSkillCatalogSnapshot {
	readonly revision: string;
	readonly skills: readonly CodingSkillCard[];
	readonly diagnostics: readonly CodingSkillDiagnostic[];
}

export interface CodingSkillCatalogOptions {
	readonly homeDirectory: string;
	readonly workspaceDirectory?: string;
	readonly workspaceTrusted: boolean;
	readonly debounceMs?: number;
}

interface CatalogRoot {
	readonly path: string;
	readonly source: CodingSkillSource;
}

export class CodingSkillCatalog {
	readonly #options: CodingSkillCatalogOptions;
	readonly #listeners = new Set<(snapshot: CodingSkillCatalogSnapshot) => void>();
	readonly #watchers = new Set<FSWatcher>();
	#snapshot: CodingSkillCatalogSnapshot = { revision: "empty", skills: [], diagnostics: [] };
	#reloadTimer?: ReturnType<typeof setTimeout>;
	#closed = false;

	constructor(options: CodingSkillCatalogOptions) {
		this.#options = options;
	}

	get snapshot(): CodingSkillCatalogSnapshot {
		return this.#snapshot;
	}

	async load(): Promise<CodingSkillCatalogSnapshot> {
		try {
			const diagnostics: CodingSkillDiagnostic[] = [];
			const selected = new Map<string, CodingSkillCard>();
			for (const root of this.#roots()) {
				for (const card of await scanRoot(root, diagnostics)) {
					const winner = selected.get(card.name);
					if (winner) {
						diagnostics.push({
							code: "shadowed",
							path: card.location,
							skillName: card.name,
							shadowedBy: winner.location,
							message: `Skill "${card.name}" is shadowed by ${winner.location}`,
						});
						continue;
					}
					selected.set(card.name, card);
				}
			}
			const skills = [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
			this.#snapshot = {
				revision: revisionOf(skills, diagnostics),
				skills,
				diagnostics,
			};
			await this.#replaceWatchers();
			return this.#snapshot;
		} catch (error) {
			throw skillCatalogError("catalog_load_failed", {
				message: "Failed to load the Agent Skills catalog",
				cause: error,
			});
		}
	}

	watch(listener: (snapshot: CodingSkillCatalogSnapshot) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
		this.#reloadTimer = undefined;
		this.#closeWatchers();
		this.#listeners.clear();
	}

	#roots(): CatalogRoot[] {
		const roots: CatalogRoot[] = [];
		if (this.#options.workspaceTrusted && this.#options.workspaceDirectory) {
			roots.push(
				{
					path: path.join(this.#options.workspaceDirectory, ".jai", "skills"),
					source: { scope: "project", directory: ".jai" },
				},
				{
					path: path.join(this.#options.workspaceDirectory, ".agents", "skills"),
					source: { scope: "project", directory: ".agents" },
				},
			);
		}
		roots.push(
			{
				path: path.join(this.#options.homeDirectory, ".jai", "skills"),
				source: { scope: "user", directory: ".jai" },
			},
			{
				path: path.join(this.#options.homeDirectory, ".agents", "skills"),
				source: { scope: "user", directory: ".agents" },
			},
		);
		return roots;
	}

	async #replaceWatchers(): Promise<void> {
		if (this.#closed) return;
		this.#closeWatchers();
		const directories = new Set<string>();
		for (const root of this.#roots()) {
			directories.add(await nearestExistingDirectory(root.path));
			for (const skillDirectory of await childDirectories(root.path)) directories.add(skillDirectory);
		}
		for (const directory of directories) {
			const watcher = watchFileSystem(directory, () => this.#scheduleReload());
			watcher.on("error", () => this.#scheduleReload());
			this.#watchers.add(watcher);
		}
	}

	#scheduleReload(): void {
		if (this.#closed) return;
		if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
		this.#reloadTimer = setTimeout(() => {
			this.#reloadTimer = undefined;
			void this.#reload();
		}, this.#options.debounceMs ?? 75);
	}

	async #reload(): Promise<void> {
		const previousRevision = this.#snapshot.revision;
		const snapshot = await this.load().catch(() => undefined);
		if (!snapshot || snapshot.revision === previousRevision) return;
		for (const listener of this.#listeners) listener(snapshot);
	}

	#closeWatchers(): void {
		for (const watcher of this.#watchers) watcher.close();
		this.#watchers.clear();
	}
}

async function scanRoot(root: CatalogRoot, diagnostics: CodingSkillDiagnostic[]): Promise<CodingSkillCard[]> {
	const entries = await readdir(root.path, { withFileTypes: true }).catch((error) => {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	});
	if (entries.length === 0) return [];
	const canonicalRoot = await realpath(root.path);
	const cards: CodingSkillCard[] = [];
	for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
		const skillDirectory = path.join(root.path, entry.name);
		try {
			const info = await stat(skillDirectory);
			if (!info.isDirectory()) continue;
			cards.push(await readSkill(root, canonicalRoot, skillDirectory, entry.name));
		} catch (error) {
			diagnostics.push({
				code: "invalid",
				path: skillDirectory,
				skillName: entry.name,
				message: getErrorMessage(error),
			});
		}
	}
	return cards;
}

async function readSkill(
	root: CatalogRoot,
	canonicalRoot: string,
	skillDirectory: string,
	directoryName: string,
): Promise<CodingSkillCard> {
	const location = path.join(skillDirectory, "SKILL.md");
	const [content, canonicalDirectory, canonicalLocation] = await Promise.all([
		readFile(location, "utf8"),
		realpath(skillDirectory),
		realpath(location),
	]);
	if (!isInside(canonicalDirectory, canonicalRoot) || !isInside(canonicalLocation, canonicalDirectory)) {
		throw skillFileError("path_escape", {
			message: `Skill path escapes its catalog root: ${skillDirectory}`,
			data: { path: skillDirectory },
		});
	}
	const { frontmatter } = parseSkillDocument(content);
	const name = requiredString(frontmatter, "name");
	const description = requiredString(frontmatter, "description");
	if (name.length > 64 || !SKILL_NAME.test(name)) throw invalidSkillDocument(`Invalid Skill name "${name}"`);
	if (description.length > 1_024) throw invalidSkillDocument(`Skill "${name}" description exceeds 1024 characters`);
	if (name !== directoryName) {
		throw invalidSkillDocument(`Skill directory "${directoryName}" declares name "${name}"`);
	}
	const metadata = stringRecord(frontmatter.metadata);
	const license = optionalString(frontmatter, "license");
	const compatibility = optionalString(frontmatter, "compatibility");
	return {
		name,
		displayName: metadata.displayName ?? name,
		description,
		contentRevision: createHash("sha256").update(content).digest("hex"),
		location,
		directory: skillDirectory,
		canonicalDirectory,
		source: root.source,
		...(license ? { license } : {}),
		...(compatibility ? { compatibility } : {}),
		allowedTools: allowedTools(frontmatter["allowed-tools"]),
		metadata,
	};
}

export function parseSkillDocument(content: string): {
	readonly frontmatter: Readonly<Record<string, unknown>>;
	readonly body: string;
} {
	const normalized = content.replace(/^\uFEFF/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
	if (!match) throw invalidSkillDocument("SKILL.md must start with YAML frontmatter");
	let parsed: unknown;
	try {
		parsed = parse(match[1]!);
	} catch (error) {
		throw invalidSkillDocument("SKILL.md contains invalid YAML frontmatter", error);
	}
	if (!isRecord(parsed)) throw invalidSkillDocument("SKILL.md frontmatter must be a mapping");
	return { frontmatter: parsed, body: normalized.slice(match[0].length) };
}

function requiredString(value: Readonly<Record<string, unknown>>, key: string): string {
	const result = optionalString(value, key);
	if (!result) throw invalidSkillDocument(`SKILL.md frontmatter requires "${key}"`);
	return result;
}

function optionalString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) throw invalidSkillDocument('SKILL.md "metadata" must be a mapping');
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function allowedTools(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
	if (Array.isArray(value))
		return value
			.map(String)
			.map((item) => item.trim())
			.filter(Boolean);
	throw invalidSkillDocument('SKILL.md "allowed-tools" must be a string or list');
}

function revisionOf(skills: readonly CodingSkillCard[], diagnostics: readonly CodingSkillDiagnostic[]): string {
	return createHash("sha256").update(JSON.stringify({ skills, diagnostics })).digest("hex");
}

function isInside(candidate: string, directory: string): boolean {
	const relative = path.relative(directory, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}

async function nearestExistingDirectory(candidate: string): Promise<string> {
	let current = candidate;
	while (true) {
		try {
			const info = await stat(current);
			if (info.isDirectory()) return current;
		} catch (error) {
			if (!isNodeError(error, "ENOENT")) throw error;
		}
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

async function childDirectories(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	});
	return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSkillDocument(message: string, cause?: unknown) {
	return skillFileError("invalid_document", { message, ...(cause === undefined ? {} : { cause }) });
}
