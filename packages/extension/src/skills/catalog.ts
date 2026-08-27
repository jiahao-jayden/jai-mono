import { createHash } from "node:crypto";
import { type FSWatcher, unwatchFile, watchFile, watch as watchFileSystem } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { getErrorMessage } from "@jai/common";
import { TaggedError } from "better-result";
import { parse } from "yaml";

class SkillCatalogLoadFailed extends TaggedError("coding_skills.catalog_load_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

class InvalidSkillDocument extends TaggedError("coding_skill_file.invalid_document")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

class SkillPathEscape extends TaggedError("coding_skill_file.path_escape")<{
	readonly data?: Record<string, unknown>;
	readonly message: string;
}> {}
const SKILL_NAME = /^(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_COMPATIBILITY_LENGTH = 500;
const SKILL_FRONTMATTER_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
]);

export interface CodingSkillSource {
	readonly scope: "user" | "project";
	readonly directory: ".agents" | ".jai";
}

export interface CodingSkillPluginSource {
	readonly scope: "user" | "project";
	readonly directory: "plugin";
	readonly pluginName: string;
	readonly pluginVersion?: string;
	readonly pluginRoot: string;
}

export interface CodingSkillCard {
	readonly name: string;
	readonly description: string;
	readonly contentRevision: string;
	readonly location: string;
	readonly directory: string;
	readonly canonicalDirectory: string;
	readonly source: CodingSkillSource | CodingSkillPluginSource;
	readonly license?: string;
	readonly compatibility?: string;
	readonly allowedTools: readonly string[];
	readonly metadata: Readonly<Record<string, string>>;
}

/** A Skill contributed by a plugin: a catalog card whose source is always a plugin. */
export type CodingPluginSkillCard = Omit<CodingSkillCard, "source"> & { readonly source: CodingSkillPluginSource };

export interface ParsedSkillFrontmatter {
	readonly name: string;
	readonly description: string;
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
	/** Immutable plugin candidates are merged into the same catalog and precedence rules. */
	readonly pluginSkills?: readonly CodingSkillCard[];
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
	readonly #polledPaths = new Set<string>();
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
			for (const card of await this.#cards(diagnostics)) {
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
			const skills = [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
			this.#snapshot = {
				revision: revisionOf(skills, diagnostics),
				skills,
				diagnostics,
			};
			await this.#replaceWatchers();
			return this.#snapshot;
		} catch (error) {
			throw new SkillCatalogLoadFailed({
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

	async #cards(diagnostics: CodingSkillDiagnostic[]): Promise<CodingSkillCard[]> {
		const roots = this.#roots();
		const projectRoots = roots.filter((root) => root.source.scope === "project");
		const userRoots = roots.filter((root) => root.source.scope === "user");
		const cards: CodingSkillCard[] = [];
		for (const root of projectRoots) cards.push(...(await scanRoot(root, diagnostics)));
		cards.push(...(this.#options.pluginSkills ?? []).filter((skill) => skill.source.scope === "project"));
		for (const root of userRoots) cards.push(...(await scanRoot(root, diagnostics)));
		cards.push(...(this.#options.pluginSkills ?? []).filter((skill) => skill.source.scope === "user"));
		return cards;
	}

	async #replaceWatchers(): Promise<void> {
		if (this.#closed) return;
		this.#closeWatchers();
		const directories = new Set<string>();
		const paths = new Set<string>();
		for (const root of this.#roots()) {
			directories.add(await nearestExistingDirectory(root.path));
			paths.add(root.path);
			for (const skillDirectory of await childDirectories(root.path, root.source.scope === "user")) {
				directories.add(skillDirectory);
				paths.add(path.join(skillDirectory, "SKILL.md"));
			}
		}
		for (const directory of directories) {
			const watcher = watchFileSystem(directory, () => this.#scheduleReload());
			watcher.on("error", () => this.#scheduleReload());
			this.#watchers.add(watcher);
		}
		for (const path of paths) this.#watchPath(path);
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
		for (const path of this.#polledPaths) unwatchFile(path);
		this.#polledPaths.clear();
	}

	#watchPath(path: string): void {
		watchFile(path, { interval: 100, persistent: false }, (current, previous) => {
			if (
				current.mtimeMs !== previous.mtimeMs ||
				current.ctimeMs !== previous.ctimeMs ||
				current.size !== previous.size
			) {
				this.#scheduleReload();
			}
		});
		this.#polledPaths.add(path);
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
	const canonicalDirectory = await realpath(skillDirectory);
	const canonicalLocation = await realpath(location);
	if (
		(root.source.scope === "project" && !isInside(canonicalDirectory, canonicalRoot)) ||
		!isInside(canonicalLocation, canonicalDirectory)
	) {
		throw new SkillPathEscape({
			message: `Skill path escapes its catalog root: ${skillDirectory}`,
			data: { path: skillDirectory },
		});
	}
	const documentInfo = await stat(canonicalLocation);
	if (!documentInfo.isFile()) throw invalidSkillDocument(`Skill document is not a regular file: ${location}`);
	const content = await readFile(canonicalLocation, "utf8");
	const { frontmatter } = parseSkillDocument(content);
	const parsed = validateSkillFrontmatter(frontmatter, directoryName);
	return {
		name: parsed.name,
		description: parsed.description,
		contentRevision: createHash("sha256").update(content).digest("hex"),
		location: canonicalLocation,
		directory: skillDirectory,
		canonicalDirectory,
		source: root.source,
		...(parsed.license === undefined ? {} : { license: parsed.license }),
		...(parsed.compatibility === undefined ? {} : { compatibility: parsed.compatibility }),
		allowedTools: parsed.allowedTools,
		metadata: parsed.metadata,
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

export function validateSkillFrontmatter(
	value: Readonly<Record<string, unknown>>,
	directoryName?: string,
): ParsedSkillFrontmatter {
	for (const key of Object.keys(value)) {
		if (!SKILL_FRONTMATTER_FIELDS.has(key))
			throw invalidSkillDocument(`SKILL.md frontmatter contains unknown field "${key}"`);
	}
	const rawName = value.name;
	if (typeof rawName !== "string" || !rawName.trim())
		throw invalidSkillDocument('SKILL.md frontmatter requires "name"');
	const name = rawName.trim().normalize("NFKC");
	if (Array.from(name).length > MAX_SKILL_NAME_LENGTH || name !== name.toLowerCase() || !SKILL_NAME.test(name)) {
		throw invalidSkillDocument(`Invalid Skill name "${name}"`);
	}
	if (directoryName !== undefined && directoryName.normalize("NFKC") !== name) {
		throw invalidSkillDocument(`Skill directory "${directoryName}" declares name "${name}"`);
	}
	const rawDescription = value.description;
	if (typeof rawDescription !== "string" || !rawDescription.trim())
		throw invalidSkillDocument('SKILL.md frontmatter requires "description"');
	const description = rawDescription.trim();
	if (Array.from(description).length > MAX_DESCRIPTION_LENGTH) {
		throw invalidSkillDocument(`Skill "${name}" description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
	}
	const license = optionalSkillString(value, "license");
	const compatibility = optionalSkillString(value, "compatibility");
	if (
		compatibility !== undefined &&
		(compatibility.length === 0 || Array.from(compatibility).length > MAX_COMPATIBILITY_LENGTH)
	) {
		throw invalidSkillDocument(
			`Skill "${name}" compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} characters or is empty`,
		);
	}
	const metadata = skillMetadata(value.metadata);
	const allowedTools = skillAllowedTools(value["allowed-tools"]);
	return {
		name,
		description,
		...(license === undefined ? {} : { license }),
		...(compatibility === undefined ? {} : { compatibility }),
		allowedTools,
		metadata,
	};
}

function optionalSkillString(
	value: Readonly<Record<string, unknown>>,
	key: "license" | "compatibility",
): string | undefined {
	if (!(key in value)) return undefined;
	if (typeof value[key] !== "string") throw invalidSkillDocument(`SKILL.md "${key}" must be a string`);
	return (value[key] as string).trim();
}

function skillMetadata(value: unknown): Record<string, string> {
	if (value === undefined) return {};
	if (!isRecord(value) || !Object.values(value).every((item) => typeof item === "string")) {
		throw invalidSkillDocument('SKILL.md "metadata" must be a mapping of string values');
	}
	return value as Record<string, string>;
}

function skillAllowedTools(value: unknown): string[] {
	if (value === undefined) return [];
	if (typeof value !== "string")
		throw invalidSkillDocument('SKILL.md "allowed-tools" must be a space-separated string');
	return value.split(/\s+/).filter(Boolean);
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

async function childDirectories(directory: string, allowExternalTargets: boolean): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	});
	if (entries.length === 0) return [];
	const canonicalDirectory = await realpath(directory);
	const directories: string[] = [];
	for (const entry of entries) {
		const candidate = path.join(directory, entry.name);
		const info = await stat(candidate).catch(() => undefined);
		if (!info?.isDirectory()) continue;
		const canonicalCandidate = await realpath(candidate).catch(() => undefined);
		if (canonicalCandidate && (allowExternalTargets || isInside(canonicalCandidate, canonicalDirectory))) {
			directories.push(candidate);
		}
	}
	return directories;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidSkillDocument(message: string, cause?: unknown) {
	return new InvalidSkillDocument({ message, ...(cause === undefined ? {} : { cause }) });
}
