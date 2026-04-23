/**
 * Public surface of @jayden/jai-coding-agent.
 *
 * Main entry: SessionManager.create({ jaiHome }) — creates the orchestrator
 * that manages all sessions, workspaces, and settings.
 *
 * For plugin authors: see ./plugin sub-entry.
 */

export {
	ACCEPTED_FILE_TYPES,
	ATTACHMENT_LIMITS,
	type RawAttachment,
} from "./core/attachments/index.js";
export { ModelResolveError } from "./core/config/model-resolver.js";
export type {
	ProviderModel,
	ProviderSettings,
	ResolvedSettings,
	Settings,
} from "./core/config/settings.js";
export type { CompactionMarker } from "./core/session/agent-session.js";
export type { SessionInfo } from "./core/session/session-index.js";
export {
	type PluginEnvEntry,
	type PluginScanEntry,
	type PluginScanResult,
	SessionManager,
	type SessionManagerConfig,
} from "./core/session/session-manager.js";
