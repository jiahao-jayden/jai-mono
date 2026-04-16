export type { EnrichedModelInfo as ProviderModel } from "@jayden/jai-ai";
export type { ProviderSettings } from "@jayden/jai-coding-agent";

export interface SessionInfo {
	sessionId: string;
	workspaceId: string;
	title: string | null;
	model: string | null;
	firstMessage: string | null;
	messageCount: number;
	totalTokens: number;
	createdAt: number;
	updatedAt: number;
}

export interface ConfigResponse {
	model: string;
	provider: string;
	providers?: Record<string, import("@jayden/jai-coding-agent").ProviderSettings>;
	maxIterations: number;
	language: string;
	reasoningEffort?: string;
	contextWindow: number;
}

export interface ConfigUpdateRequest {
	model?: string;
	provider?: string;
	maxIterations?: number;
	language?: string;
	reasoningEffort?: string;
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
