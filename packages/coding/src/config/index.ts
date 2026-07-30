export { createCodingConfigFileSchema, defineCodingConfig } from "./definition";
export { CodingConfigStore, resolveCodingConfigPaths } from "./store";
export type {
	CodingConfigDefinition,
	CodingConfigStoreOptions,
	ConfigEnvironmentBinding,
	ConfigFieldRule,
	ConfigFieldTree,
	ConfigFileScope,
	ConfigMergePolicy,
	ConfigMigration,
	ConfigPaths,
	ConfigProvenance,
	ConfigSnapshot,
	ConfigSource,
	ConfigWatchEvent,
	ResolvedCodingSettings,
	WriteScopeOptions,
} from "./types";
