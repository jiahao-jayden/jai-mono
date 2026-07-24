export interface CodingToolOptions {
	cwd: string;
	allowOutsideWorkspace?: boolean;
}

export interface BashToolOptions extends CodingToolOptions {
	shell?: string;
	timeoutMs?: number;
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
