export type { EnrichedModelInfo as ProviderModel } from "@jayden/jai-ai";
export type {
	CompactionMarker,
	PluginEnvEntry,
	PluginScanEntry,
	ProviderSettings,
	SessionInfo,
} from "@jayden/jai-coding-agent";
export type { PluginListItem, PluginListResponse } from "../routes/plugins.js";

import type { Message } from "@jayden/jai-ai";
import type { CompactionMarker } from "@jayden/jai-coding-agent";

export interface MessagesResponse {
	messages: Message[];
	compactions: CompactionMarker[];
}

export interface ConfigResponse {
	model: string;
	provider: string;
	providers?: Record<string, import("@jayden/jai-coding-agent").ProviderSettings>;
	maxIterations: number;
	language: string;
	reasoningEffort?: string;
	contextWindow: number;
	env: Record<string, string>;
	plugins: Record<string, unknown>;
}

export interface ConfigUpdateRequest {
	model?: string;
	provider?: string;
	maxIterations?: number;
	language?: string;
	reasoningEffort?: string;
	env?: Record<string, string>;
	plugins?: Record<string, unknown>;
}

export interface FetchModelsResponse {
	providerId: string;
	models: import("@jayden/jai-ai").EnrichedModelInfo[];
	fetchedAt: number;
	cached: boolean;
}

export interface FileEntry {
	name: string;
	path: string;
	type: "file" | "directory";
	size: number;
	mimeType?: string;
	children?: FileEntry[];
}

export interface FileContent {
	content: string;
	path: string;
	size: number;
	mimeType: string;
}

export interface WorkspacePathsResponse {
	paths: string[];
	truncated: boolean;
}
