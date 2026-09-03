import type { RuntimeProviderAdapter } from "@jai/server";
import type { FrontierTaskDefinition } from "./task-definition";

export interface GatewayModelSource {
	readonly requestedModel: string;
	readonly adapter: RuntimeProviderAdapter;
	readonly upstreamBaseUrl: string;
	readonly upstreamAuthentication: "api-key" | "none";
	readonly upstreamApiKey?: string;
	readonly remoteModelId: string;
}

export interface RunTrialInput {
	readonly task: FrontierTaskDefinition;
	readonly model: GatewayModelSource;
	readonly maxTurns: number;
	readonly outputDirectory: string;
}

export type TrialStatus = "completed" | "agent_failed" | "timed_out" | "setup_failed" | "evidence_failed";

export interface CliFinalProjection {
	readonly stopReason: string;
	readonly toolCalls: number;
	readonly toolErrors: number;
	readonly totalCostUsd: number;
	readonly durationMs: number;
	readonly errorMessage?: string;
}

export interface TrialArtifact {
	readonly sourcePath: string;
	readonly status: "collected" | "missing";
	readonly outputPath?: string;
	readonly sha256?: string;
}

export interface FrontierSmokeResult {
	readonly format: "jai.frontier-smoke/v1";
	readonly kind: "local-smoke-evidence";
	readonly trialId: string;
	readonly outputDirectory: string;
	readonly status: TrialStatus;
	readonly task: {
		readonly name: string;
		readonly sourceRevision: string;
		readonly image: string;
		readonly limits: FrontierTaskDefinition["limits"];
		readonly agentTimeoutMs: number;
	};
	readonly model: {
		readonly requested: string;
		readonly adapter: RuntimeProviderAdapter;
	};
	readonly networkPolicy: "model-gateway-only";
	readonly timing: {
		readonly startedAt: string;
		readonly totalDurationMs: number;
	};
	readonly cli?: CliFinalProjection;
	readonly artifacts: readonly TrialArtifact[];
	readonly failure?: {
		readonly stage: "setup" | "agent" | "evidence";
		readonly tag: string;
		readonly message: string;
	};
}
