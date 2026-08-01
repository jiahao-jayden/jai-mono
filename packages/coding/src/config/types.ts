import type { Static, TObject } from "@sinclair/typebox";

export type ConfigFileScope = "user" | "project-shared" | "project-local";
export type ConfigSource = "default" | ConfigFileScope | "environment";
export type ConfigMergePolicy = "replace" | "deepMerge" | "appendUnique" | "restrictOnly" | "denyUnion";

export interface ConfigEnvironmentBinding {
	readonly name: `JAI_${string}`;
	readonly parse?: (value: string) => unknown;
}

export interface ConfigFieldRule {
	readonly merge: ConfigMergePolicy;
	/** Project values that can broaden authority require workspace trust. */
	readonly project: "always" | "trusted";
	readonly default?: unknown;
	readonly environment?: ConfigEnvironmentBinding;
	readonly uniqueBy?: (value: unknown) => string;
	/** Required by restrictOnly; combines values without weakening the lower-priority restriction. */
	readonly combineRestrictions?: (lower: unknown, higher: unknown) => unknown;
}

export interface ConfigFieldTree {
	readonly [key: string]: ConfigFieldRule | ConfigFieldTree;
}

export interface ConfigMigration {
	readonly from: number;
	readonly migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

export interface CodingConfigDefinition<TSchema extends TObject = TObject> {
	readonly schemaVersion: number;
	readonly schemaUrl: string;
	/** Describes settings fields only; file metadata is added by the config runtime. */
	readonly schema: TSchema;
	readonly fields: ConfigFieldTree;
	readonly migrations: readonly ConfigMigration[];
}

export type ResolvedCodingSettings<TSchema extends TObject> = Static<TSchema>;

export interface ConfigPaths {
	readonly user: string;
	readonly "project-shared": string | undefined;
	readonly "project-local": string | undefined;
}

export interface ConfigProvenance {
	readonly path: string;
	readonly source: ConfigSource;
	readonly mergePolicy: ConfigMergePolicy;
	readonly sourceFile?: string;
}

export interface ConfigSnapshot<TSchema extends TObject = TObject> {
	readonly settings: Readonly<ResolvedCodingSettings<TSchema>>;
	readonly provenance: readonly ConfigProvenance[];
	readonly revision: string;
	readonly scopeRevisions: Readonly<Record<ConfigFileScope, string | null>>;
	readonly workspaceTrusted: boolean;
}

export type ConfigWatchEvent<TSchema extends TObject = TObject> =
	| { readonly status: "valid"; readonly snapshot: ConfigSnapshot<TSchema> }
	| { readonly status: "invalid"; readonly error: unknown; readonly lastValid?: ConfigSnapshot<TSchema> };

export interface CodingConfigStoreOptions {
	readonly projectRoot?: string;
	/** @deprecated Use projectRoot. */
	readonly workspaceRoot?: string;
	readonly homeDir?: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly workspaceTrusted?: boolean;
	readonly watchDebounceMs?: number;
}

export interface WriteScopeOptions {
	/** null means the caller expects the file not to exist. */
	readonly expectedRevision: string | null;
}
