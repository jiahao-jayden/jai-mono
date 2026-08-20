import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, watch as watchFileSystem } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Static, TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { createCodingConfigFileSchema, defineCodingConfig } from "./definition";
import {
	configMigrationError,
	configParseError,
	configReadError,
	configScopeUnavailableError,
	configUnsupportedVersionError,
	configValidationError,
	configWatchError,
	configWriteConflictError,
	configWriteError,
	resolvedConfigValidationError,
} from "./errors";
import { buildEnvironmentSettings, type ConfigSourceValue, mergeCodingConfig } from "./merge";
import type {
	CodingConfigDefinition,
	CodingConfigStoreOptions,
	ConfigFileScope,
	ConfigPaths,
	ConfigSnapshot,
	ConfigWatchEvent,
	ResolvedCodingSettings,
	WriteScopeOptions,
} from "./types";

interface LoadedScope {
	readonly settings: Record<string, unknown>;
	readonly revision: string;
}

export interface ConfigScopeSnapshot<TSchema extends TObject> {
	readonly settings: Partial<ResolvedCodingSettings<TSchema>>;
	readonly revision: string | null;
}

const scopes = ["user", "project-shared", "project-local"] as const;

export function resolveCodingConfigPaths(
	options: Pick<CodingConfigStoreOptions, "homeDir" | "projectRoot">,
): ConfigPaths {
	const home = options.homeDir ?? homedir();
	const projectRoot = options.projectRoot;
	return {
		user: join(home, ".jai", "settings.json"),
		"project-shared": projectRoot ? join(projectRoot, ".jai", "settings.json") : undefined,
		"project-local": projectRoot ? join(projectRoot, ".jai", "settings.local.json") : undefined,
	};
}

export class CodingConfigStore<TSchema extends TObject> {
	readonly definition: CodingConfigDefinition<TSchema>;
	readonly paths: ConfigPaths;
	private readonly environment: Readonly<Record<string, string | undefined>>;
	private readonly listeners = new Set<(event: ConfigWatchEvent<TSchema>) => void>();
	private readonly watchers = new Set<FSWatcher>();
	private readonly debounceMs: number;
	private workspaceTrusted: boolean;
	private lastValid?: ConfigSnapshot<TSchema>;
	private reloadTimer?: ReturnType<typeof setTimeout>;
	private watcherRefresh = Promise.resolve();

	constructor(
		definition: CodingConfigDefinition<TSchema>,
		readonly options: CodingConfigStoreOptions,
	) {
		this.definition = defineCodingConfig(definition);
		this.paths = resolveCodingConfigPaths(options);
		this.environment = options.environment ?? process.env;
		this.workspaceTrusted = options.workspaceTrusted ?? false;
		this.debounceMs = options.watchDebounceMs ?? 25;
	}

	async load(): Promise<ConfigSnapshot<TSchema>> {
		const loadedEntries = await Promise.all(
			scopes.map(async (scope) => [scope, await this.readScopeFile(scope)] as const),
		);
		const loaded = Object.fromEntries(loadedEntries) as Record<ConfigFileScope, LoadedScope | undefined>;
		const sources: ConfigSourceValue[] = [];
		for (const scope of scopes) {
			const item = loaded[scope];
			const sourceFile = this.paths[scope];
			if (item && sourceFile) sources.push({ source: scope, sourceFile, value: item.settings });
		}
		const environmentSettings = buildEnvironmentSettings(this.definition.fields, this.environment);
		if (Object.keys(environmentSettings).length > 0) {
			sources.push({ source: "environment", value: environmentSettings });
		}

		const merged = mergeCodingConfig(this.definition.fields, sources, this.workspaceTrusted);
		const issues = validationIssues(this.definition.schema, merged.value);
		if (issues.length > 0) throw resolvedConfigValidationError(issues);

		const scopeRevisions: Record<ConfigFileScope, string | null> = {
			user: loaded.user?.revision ?? null,
			"project-shared": loaded["project-shared"]?.revision ?? null,
			"project-local": loaded["project-local"]?.revision ?? null,
		};
		const revision = digest(
			JSON.stringify({
				settings: merged.value,
				scopeRevisions,
				workspaceTrusted: this.workspaceTrusted,
			}),
		);
		const snapshot: ConfigSnapshot<TSchema> = Object.freeze({
			settings: merged.value as Readonly<Static<TSchema>>,
			provenance: merged.provenance,
			revision,
			scopeRevisions: Object.freeze(scopeRevisions),
			workspaceTrusted: this.workspaceTrusted,
		});
		this.lastValid = snapshot;
		if (this.listeners.size > 0) await this.refreshWatchers();
		return snapshot;
	}

	async readScope(scope: ConfigFileScope): Promise<ConfigScopeSnapshot<TSchema>> {
		const loaded = await this.readScopeFile(scope);
		return {
			settings: structuredClone(loaded?.settings ?? {}) as Partial<ResolvedCodingSettings<TSchema>>,
			revision: loaded?.revision ?? null,
		};
	}

	async setWorkspaceTrusted(trusted: boolean): Promise<ConfigSnapshot<TSchema>> {
		this.workspaceTrusted = trusted;
		return this.load();
	}

	async writeScope(
		scope: ConfigFileScope,
		settings: Partial<ResolvedCodingSettings<TSchema>>,
		options: WriteScopeOptions,
	): Promise<ConfigSnapshot<TSchema>> {
		const path = this.paths[scope];
		if (!path) throw configScopeUnavailableError(scope);
		let actualRevision: string | null;
		try {
			actualRevision = await fileRevision(path);
		} catch (error) {
			throw configWriteError({ scope, path }, error);
		}
		if (actualRevision !== options.expectedRevision) {
			throw configWriteConflictError({
				scope,
				path,
				expectedRevision: options.expectedRevision,
				actualRevision,
			});
		}

		const document: Record<string, unknown> = {
			$schema: this.definition.schemaUrl,
			schemaVersion: this.definition.schemaVersion,
			...settings,
		};
		this.validateDocument(scope, path, document);
		try {
			await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`);
		} catch (error) {
			if (TaggedError.is(error)) throw error;
			throw configWriteError({ scope, path }, error);
		}
		return this.load();
	}

	watch(listener: (event: ConfigWatchEvent<TSchema>) => void): () => void {
		this.listeners.add(listener);
		if (this.listeners.size === 1) {
			void this.refreshWatchers().catch((error) => this.emitInvalid(error));
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) this.closeWatchers();
		};
	}

	close(): void {
		if (this.reloadTimer) clearTimeout(this.reloadTimer);
		this.reloadTimer = undefined;
		this.listeners.clear();
		this.closeWatchers();
	}

	private async readScopeFile(scope: ConfigFileScope): Promise<LoadedScope | undefined> {
		const path = this.paths[scope];
		if (!path) return undefined;
		let raw: string;
		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			if (isNodeError(error, "ENOENT")) return undefined;
			throw configReadError({ scope, path }, error);
		}

		let document: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!isPlainObject(parsed)) throw new SyntaxError("Configuration root must be an object");
			document = parsed;
		} catch (error) {
			throw configParseError({ scope, path }, error);
		}

		const version = document.schemaVersion;
		if (!Number.isInteger(version)) {
			throw configValidationError("Configuration schemaVersion must be an integer", {
				scope,
				path,
				issues: [{ path: "/schemaVersion", message: "Expected an integer" }],
			});
		}
		if (typeof document.$schema !== "string") {
			throw configValidationError("Configuration $schema must be a string", {
				scope,
				path,
				issues: [{ path: "/$schema", message: "Expected a string" }],
			});
		}
		if ((version as number) > this.definition.schemaVersion) {
			throw configUnsupportedVersionError({
				scope,
				path,
				expectedVersion: this.definition.schemaVersion,
				actualVersion: version as number,
			});
		}
		if ((version as number) < this.definition.schemaVersion) {
			document = await this.migrateScope(scope, path, raw, document, version as number);
			raw = `${JSON.stringify(document, null, 2)}\n`;
		}

		this.validateDocument(scope, path, document);
		const { $schema: _schema, schemaVersion: _version, ...settings } = document;
		return { settings, revision: digest(raw) };
	}

	private validateDocument(scope: ConfigFileScope, path: string, document: Record<string, unknown>): void {
		const issues = validationIssues(createCodingConfigFileSchema(this.definition), document);
		if (issues.length > 0) {
			throw configValidationError(`Invalid coding configuration in ${path}`, { scope, path, issues });
		}
	}

	private async migrateScope(
		scope: ConfigFileScope,
		path: string,
		original: string,
		input: Record<string, unknown>,
		fromVersion: number,
	): Promise<Record<string, unknown>> {
		let document = structuredClone(input);
		let version = fromVersion;
		try {
			while (version < this.definition.schemaVersion) {
				const migration = this.definition.migrations.find((candidate) => candidate.from === version);
				if (!migration) throw new Error(`No migration registered from version ${version}`);
				document = migration.migrate(structuredClone(document));
				version += 1;
				document.schemaVersion = version;
			}
			document.$schema = this.definition.schemaUrl;
			this.validateDocument(scope, path, document);
			await backupFile(path, original);
			await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`);
			return document;
		} catch (error) {
			throw configMigrationError({ scope, path, fromVersion: version }, error);
		}
	}

	private async refreshWatchers(): Promise<void> {
		const refresh = this.watcherRefresh.then(() => this.replaceWatchers());
		this.watcherRefresh = refresh.catch(() => {});
		return refresh;
	}

	private async replaceWatchers(): Promise<void> {
		this.closeWatchers();
		const directories = new Set<string>();
		try {
			for (const path of Object.values(this.paths).filter((value): value is string => value !== undefined)) {
				const configDirectory = dirname(path);
				directories.add(await nearestExistingDirectory(configDirectory));
			}
			for (const directory of directories) {
				const watcher = watchFileSystem(directory, () => this.scheduleReload());
				watcher.on("error", (error) => this.emitInvalid(configWatchError([...directories], error)));
				this.watchers.add(watcher);
			}
		} catch (error) {
			this.closeWatchers();
			throw configWatchError([...directories], error);
		}
	}

	private scheduleReload(): void {
		if (this.reloadTimer) clearTimeout(this.reloadTimer);
		this.reloadTimer = setTimeout(() => {
			this.reloadTimer = undefined;
			void this.reload();
		}, this.debounceMs);
	}

	private async reload(): Promise<void> {
		const previousRevision = this.lastValid?.revision;
		try {
			const snapshot = await this.load();
			if (snapshot.revision === previousRevision) return;
			for (const listener of this.listeners) listener({ status: "valid", snapshot });
		} catch (error) {
			try {
				await this.refreshWatchers();
			} catch (watchError) {
				this.emitInvalid(watchError);
				return;
			}
			this.emitInvalid(error);
		}
	}

	private emitInvalid(error: unknown): void {
		for (const listener of this.listeners) {
			listener({ status: "invalid", error, lastValid: this.lastValid });
		}
	}

	private closeWatchers(): void {
		for (const watcher of this.watchers) watcher.close();
		this.watchers.clear();
	}
}

function validationIssues(schema: TObject, value: unknown): Array<{ path: string; message: string }> {
	return [...Value.Errors(schema, value)].map((error) => ({
		path: error.path || "/",
		message: error.message,
	}));
}

async function atomicWrite(path: string, content: string): Promise<void> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporary, path);
		try {
			const directoryHandle = await open(directory, "r");
			await directoryHandle.sync();
			await directoryHandle.close();
		} catch {
			// Some platforms cannot fsync directories; the file rename is still atomic.
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

async function backupFile(path: string, content: string): Promise<void> {
	const backupDirectory = join(dirname(path), "backups");
	await mkdir(backupDirectory, { recursive: true });
	const backupPath = join(backupDirectory, `${basename(path)}.${Date.now()}.${randomUUID()}.bak`);
	await copyFile(path, backupPath);
	// Verify the backup corresponds to the bytes that were read before migration.
	if ((await readFile(backupPath, "utf8")) !== content) throw new Error("Configuration backup verification failed");
	const backups = (await readdir(backupDirectory))
		.filter((entry) => entry.startsWith(`${basename(path)}.`) && entry.endsWith(".bak"))
		.sort()
		.reverse();
	await Promise.all(backups.slice(5).map((entry) => rm(join(backupDirectory, entry), { force: true })));
}

async function fileRevision(path: string): Promise<string | null> {
	try {
		return digest(await readFile(path, "utf8"));
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return null;
		throw error;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return false;
		throw error;
	}
}

async function nearestExistingDirectory(path: string): Promise<string> {
	let candidate = path;
	while (!(await exists(candidate))) {
		const parent = dirname(candidate);
		if (parent === candidate) return candidate;
		candidate = parent;
	}
	return candidate;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

