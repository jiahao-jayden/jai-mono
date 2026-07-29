import type { ExecutionEnvironment, FileSearch, FileSystem, Shell } from "../environment";

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

export interface SearchToolOptions extends WorkspaceToolOptions {
	fileSearch: FileSearch;
}

export interface BashToolOptions extends WorkspaceToolOptions {
	shell: Shell;
	defaultTimeoutMs?: number;
}

export interface HarnessToolsOptions {
	environment: ExecutionEnvironment;
	workspaceRoot: string;
	bash?: Pick<BashToolOptions, "defaultTimeoutMs">;
}
