import type { ExecutionEnvironment, FileSystem, Shell } from "../environment";

export interface BackgroundShellProcessHandler {
	start(input: {
		readonly toolCallId: string;
		readonly command: string;
		readonly pid: number;
		readonly stop: () => void;
		readonly settled: Promise<number | null>;
	}): { readonly agentId: string; readonly title: string };
}

export interface TruncationDetails {
	truncated: true;
	direction: "head" | "tail";
	totalLines: number;
	outputLines: number;
	outputBytes: number;
	maxLines: number;
	maxBytes: number;
}

export interface WorkspaceToolOptions {
	fileSystem: FileSystem;
	workspaceRoot: string;
}

export interface BashToolOptions extends WorkspaceToolOptions {
	shell: Shell;
	defaultTimeoutMs?: number;
	background?: BackgroundShellProcessHandler;
}

export interface HarnessToolsOptions {
	environment: ExecutionEnvironment;
	workspaceRoot: string;
	bash?: Pick<BashToolOptions, "defaultTimeoutMs" | "background">;
}
