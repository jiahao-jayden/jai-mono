export interface SessionInfo {
	sessionId: string;
	state: "idle" | "running" | "aborted";
	createdAt: number;
}

export interface ModelInfo {
	id: string;
	provider: string;
}
