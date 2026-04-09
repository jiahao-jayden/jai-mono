export type { ProviderModel, ProviderSettings } from "@jayden/jai-coding-agent";

export interface SessionInfo {
	sessionId: string;
	workspaceId: string;
	state: "idle" | "running" | "aborted";
	title: string | null;
	model: string | null;
	firstMessage: string | null;
	messageCount: number;
	totalTokens: number;
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

export interface ConfigResponse {
	model: string;
	provider: string;
	providers?: Record<string, import("@jayden/jai-coding-agent").ProviderSettings>;
	maxIterations: number;
	language: string;
}

export interface ConfigUpdateRequest {
	model?: string;
	provider?: string;
	maxIterations?: number;
	language?: string;
}

export interface FetchModelsResponse {
	providerId: string;
	models: import("@jayden/jai-coding-agent").ProviderModel[];
	fetchedAt: number;
	cached: boolean;
}
