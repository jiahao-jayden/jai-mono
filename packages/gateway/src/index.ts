/** @deprecated Use SessionInfo instead */
export type { SessionInfo, SessionInfo as SessionRecord } from "@jayden/jai-coding-agent";
export { SessionIndex, SessionManager, type SessionManagerConfig } from "@jayden/jai-coding-agent";
export { EventAdapter } from "./events/adapter.js";
export { type AGUIEvent, AGUIEventType } from "./events/types.js";
export { type GatewayOptions, GatewayServer } from "./server.js";
export type {
	CompactionMarker,
	ConfigResponse,
	ConfigUpdateRequest,
	FetchModelsResponse,
	FileContent,
	FileEntry,
	MessagesResponse,
	ProviderModel,
	ProviderSettings,
} from "./types/api.js";
