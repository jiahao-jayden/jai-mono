import { createHash } from "node:crypto";
import { type FSWatcher, unwatchFile, watchFile, watch as watchFileSystem } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TaggedError } from "better-result";
import { parse } from "yaml";
import type { CodingSkillSource } from "./catalog";

class CommandCatalogLoadFailed extends TaggedError("coding_commands.catalog_load_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

class InvalidCommandDocument extends TaggedError("coding_command_file.invalid_document")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

class CommandPathEscape extends TaggedError("coding_command_file.path_escape")<{
	readonly data?: Record<string, unknown>;
	readonly message: string;
}> {}

const COMMAND_NAME = /^(?!.*--)[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const MAX_COMMAND_NAME_LENGTH = 64;
const MAX_COMMAND_DESCRIPTION_LENGTH = 1_024;
const MAX_ARGUMENT_HINT_LENGTH = 500;
const COMMAND_FRONTMATTER_FIELDS = new Set(["description", "argument-hint"]);

export interface CodingPromptCommandCard {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly argumentHint?: string;
	readonly contentRevision: string;
	readonly location: string;
	readonly directory: string;
	readonly canonicalDirectory: string;
	readonly source: CodingSkillSource;
}

export interface CodingPromptCommandDiagnostic {
	readonly code: "invalid" | "shadowed";
	readonly path: string;
	readonly message: string;
	readonly commandName?: string;
	readonly shadowedBy?: string;
}

export interface CodingPromptCommandCatalogSnapshot {
	readonly revision: string;
	readonly commands: readonly CodingPromptCommandCard[];
	readonly diagnostics: readonly CodingPromptCommandDiagnostic[];
}

export interface CodingPromptCommandCatalogOptions {
	readonly homeDirectory: string;
	readonly workspaceDirectory?: string;
	readonly workspaceTrusted: boolean;
	readonly debounceMs?: number;
}

interface CatalogRoot {
	readonly path: string;
	readonly source: CodingSkillSource;
}

export class CodingPromptCommandCatalog {
	readonly #options: CodingPromptCommandCatalogOptions;
	readonly #listeners = new Set<(snapshot: CodingPromptCommandCatalogSnapshot) => void>();
	readonly #watchers = new Set<FSWatcher>();
	readonly #polledPaths = new Set<string>();
	#snapshot: CodingPromptCommandCatalogSnapshot = { revision: "empty", commands: [], diagnostics: [] };
	#reloadTimer?: ReturnType<typeof setTimeout>;
	#closed = false;

	constructor(options: CodingPromptCommandCatalogOptions) {
		this.#options = options;
	}

	get snapshot(): CodingPromptCommandCatalogSnapshot {
		return this.#snapshot;
	}

	async load(): Promise<CodingPromptCommandCatalogSnapshot> {
		try {
			const diagnostics: CodingPromptCommandDiagnostic[] = [];
			const selected = new Map<string, CodingPromptCommandCard>();
			for (const card of await this.#cards(diagnostics)) {
				const winner = selected.get(card.name);
				if (winner) {
					diagnostics.push({
						code: "shadowed",
						path: card.location,
						commandName: card.name,
						shadowedBy: winner.location,
						message: `Command "${card.name}" is shadowed by ${winner.location}`,
					});
					continue;
				}
				selected.set(card.name, card);
			}
			const commands = [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
			this.#snapshot = {
				revision: revisionOf(commands, diagnostics),
				commands,
				diagnostics,
			};
			await this.#replaceWatchers();
			return this.#snapshot;
		} catch (cause) {
			throw new CommandCatalogLoadFailed({
				message: "Failed to load the prompt command catalog",
				cause,
			});
		}
	}

	watch(listener: (snapshot: CodingPromptCommandCatalogSnapshot) => void): () => void {
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
					path: path.join(this.#options.workspaceDirectory, ".jai", "commands"),
					source: { scope: "project", directory: ".jai" },
				},
				{
					path: path.join(this.#options.workspaceDirectory, ".agents", "commands"),
					source: { scope: "project", directory: ".agents" },
				},
			);
		}
		roots.push(
			{
				path: path.join(this.#options.homeDirectory, ".jai", "commands"),
				source: { scope: "user", directory: ".jai" },
			},
			{
				path: path.join(this.#options.homeDirectory, ".agents", "commands"),
				source: { scope: "user", directory: ".agents" },
			},
		);
		return roots;
	}

	async #cards(diagnostics: CodingPromptCommandDiagnostic[]): Promise<CodingPromptCommandCard[]> {
		const roots = this.#roots();
		const projectRoots = roots.filter((root) => root.source.scope === "project");
		const userRoots = roots.filter((root) => root.source.scope === "user");
		const cards: CodingPromptCommandCard[] = [];
		for (const root of projectRoots) cards.push(...(await scanRoot(root, diagnostics)));
		for (const root of userRoots) cards.push(...(await scanRoot(root, diagnostics)));
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
			for (const commandPath of await commandFiles(root.path)) {
				directories.add(path.dirname(commandPath));
				paths.add(commandPath);
			}
		}
		for (const directory of directories) {
			const watcher = watchFileSystem(directory, () => this.#scheduleReload());
			watcher.on("error", () => this.#scheduleReload());
			this.#watchers.add(watcher);
		}
		for (const watchedPath of paths) this.#watchPath(watchedPath);
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
		for (const watchedPath of this.#polledPaths) unwatchFile(watchedPath);
		this.#polledPaths.clear();
	}

	#watchPath(watchedPath: string): void {
		watchFile(watchedPath, { interval: 100, persistent: false }, (current, previous) => {
			if (
				current.mtimeMs !== previous.mtimeMs ||
				current.ctimeMs !== previous.ctimeMs ||
				current.size !== previous.size
			) {
				this.#scheduleReload();
			}
		});
		this.#polledPaths.add(watchedPath);
	}
}

export function expandPromptCommandTemplate(template: string, args: string): string {
	const positional = args.trim() ? args.trim().split(/\s+/u) : [];
	return template.replace(
		/\$(?:(\d+)\b|(@)|ARGUMENTS\b)/gu,
		(_match, index: string | undefined, at: string | undefined) => {
			if (at || _match === "$ARGUMENTS") return args;
			const position = Number(index);
			return position > 0 ? (positional[position - 1] ?? "") : "";
		},
	);
}

export function parsePromptCommandDocument(content: string): {
	readonly frontmatter: Readonly<Record<string, unknown>>;
	readonly body: string;
} {
	const normalized = content.replace(/^\uFEFF/, "");
	if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
		return { frontmatter: {}, body: normalized };
	}
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
	if (!match) throw invalidCommandDocument("Command frontmatter must end with a YAML delimiter");
	let parsed: unknown;
	try {
		parsed = parse(match[1]!);
	} catch (cause) {
		throw invalidCommandDocument("Command frontmatter contains invalid YAML", cause);
	}
	if (!isRecord(parsed)) throw invalidCommandDocument("Command frontmatter must be a mapping");
	return { frontmatter: parsed, body: normalized.slice(match[0].length) };
}

export function validatePromptCommandFrontmatter(
	value: Readonly<Record<string, unknown>>,
	name: string,
): { readonly description: string; readonly argumentHint?: string } {
	for (const key of Object.keys(value)) {
		if (!COMMAND_FRONTMATTER_FIELDS.has(key)) {
			throw invalidCommandDocument(`Command "${name}" frontmatter contains unknown field "${key}"`);
		}
	}
	const description = optionalString(value, "description", MAX_COMMAND_DESCRIPTION_LENGTH);
	const argumentHint = optionalString(value, "argument-hint", MAX_ARGUMENT_HINT_LENGTH);
	return {
		description: description ?? `Prompt template /${name}`,
		...(argumentHint === undefined ? {} : { argumentHint }),
	};
}

async function scanRoot(
	root: CatalogRoot,
	diagnostics: CodingPromptCommandDiagnostic[],
): Promise<CodingPromptCommandCard[]> {
	const entries = await readdir(root.path, { withFileTypes: true }).catch((cause) => {
		if (isNodeError(cause, "ENOENT")) return [];
		throw cause;
	});
	if (entries.length === 0) return [];
	const canonicalRoot = await realpath(root.path);
	const cards: CodingPromptCommandCard[] = [];
	for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
		if (path.extname(entry.name) !== ".md") continue;
		const commandPath = path.join(root.path, entry.name);
		try {
			cards.push(await readCommand(root, canonicalRoot, commandPath, entry.name));
		} catch (cause) {
			diagnostics.push({
				code: "invalid",
				path: commandPath,
				commandName: path.basename(entry.name, ".md"),
				message: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}
	return cards;
}

async function readCommand(
	root: CatalogRoot,
	canonicalRoot: string,
	commandPath: string,
	fileName: string,
): Promise<CodingPromptCommandCard> {
	const name = commandNameFromFileName(fileName);
	const canonicalLocation = await realpath(commandPath);
	if (!isInside(canonicalLocation, canonicalRoot)) {
		throw new CommandPathEscape({
			message: `Command path escapes its catalog root: ${commandPath}`,
			data: { path: commandPath },
		});
	}
	const info = await stat(canonicalLocation);
	if (!info.isFile()) throw invalidCommandDocument(`Command document is not a regular file: ${commandPath}`);
	const content = await readFile(canonicalLocation, "utf8");
	const document = parsePromptCommandDocument(content);
	if (!document.body.trim()) throw invalidCommandDocument(`Command "${name}" has an empty prompt template`);
	const frontmatter = validatePromptCommandFrontmatter(document.frontmatter, name);
	return {
		name,
		displayName: name,
		description: frontmatter.description,
		...(frontmatter.argumentHint === undefined ? {} : { argumentHint: frontmatter.argumentHint }),
		contentRevision: createHash("sha256").update(content).digest("hex"),
		location: canonicalLocation,
		directory: path.dirname(commandPath),
		canonicalDirectory: canonicalRoot,
		source: root.source,
	};
}

async function commandFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch((cause) => {
		if (isNodeError(cause, "ENOENT")) return [];
		throw cause;
	});
	return entries.filter((entry) => path.extname(entry.name) === ".md").map((entry) => path.join(root, entry.name));
}

async function nearestExistingDirectory(target: string): Promise<string> {
	let current = target;
	while (true) {
		const info = await stat(current).catch((cause) =>
			isNodeError(cause, "ENOENT") ? undefined : Promise.reject(cause),
		);
		if (info?.isDirectory()) return current;
		const parent = path.dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

function commandNameFromFileName(fileName: string): string {
	const name = path.basename(fileName, ".md").normalize("NFKC");
	if (Array.from(name).length > MAX_COMMAND_NAME_LENGTH || name !== name.toLowerCase() || !COMMAND_NAME.test(name)) {
		throw invalidCommandDocument(`Invalid Command name "${name}"`);
	}
	return name;
}

function optionalString(
	value: Readonly<Record<string, unknown>>,
	key: "description" | "argument-hint",
	maxLength: number,
): string | undefined {
	if (!(key in value)) return undefined;
	if (typeof value[key] !== "string") throw invalidCommandDocument(`Command "${key}" must be a string`);
	const text = (value[key] as string).trim();
	if (!text || Array.from(text).length > maxLength) {
		throw invalidCommandDocument(`Command "${key}" must be non-empty and at most ${maxLength} characters`);
	}
	return text;
}

function revisionOf(
	commands: readonly CodingPromptCommandCard[],
	diagnostics: readonly CodingPromptCommandDiagnostic[],
): string {
	return createHash("sha256").update(JSON.stringify({ commands, diagnostics })).digest("hex");
}

function isInside(candidate: string, directory: string): boolean {
	const relative = path.relative(directory, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}

function invalidCommandDocument(message: string, cause?: unknown): InvalidCommandDocument {
	return new InvalidCommandDocument({ message, ...(cause === undefined ? {} : { cause }) });
}
