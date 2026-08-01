export interface AbortOptions {
	signal?: AbortSignal;
}

export interface ResolvePathOptions extends AbortOptions {
	base: string;
	boundary: string;
	mustExist: boolean;
	expectedKind?: "file" | "directory";
}

export interface ResolvedPath {
	path: string;
	canonicalPath: string;
}

export interface PathCapability {
	readonly requestedPath: string;
	readonly canonicalPath: string;
}

export interface PathCapabilityManager {
	createPathCapability(input: string, options: ResolvePathOptions): Promise<PathCapability>;
	withPathCapability<T>(capability: PathCapability, operation: () => Promise<T>): Promise<T>;
}

export interface FileStat {
	kind: "file" | "directory" | "symlink";
	size: number;
	mtimeMs: number;
}

export interface AtomicWriteOptions extends AbortOptions {
	preserveMode?: boolean;
}

export interface TempFileOptions extends AbortOptions {
	prefix?: string;
	suffix?: string;
}

export interface TemporaryFile {
	readonly path: string;
	append(content: string | Uint8Array, options?: AbortOptions): Promise<void>;
	remove(options?: AbortOptions): Promise<void>;
}

export interface FileSystem {
	resolvePath(input: string, options: ResolvePathOptions): Promise<ResolvedPath>;
	stat(path: string, options?: AbortOptions): Promise<FileStat>;
	readFile(path: string, options?: AbortOptions): Promise<Uint8Array>;
	readFileChunks(path: string, options?: AbortOptions): AsyncIterable<Uint8Array>;
	createDirectory(path: string, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>;
	writeFileAtomic(
		path: string,
		content: string | Uint8Array,
		options?: AtomicWriteOptions,
	): Promise<{ created: boolean }>;
	createTempFile(options?: TempFileOptions): Promise<TemporaryFile>;
}

export interface GlobQuery extends AbortOptions {
	cwd: string;
	pattern: string;
	limit: number;
}

export interface GlobResult {
	paths: string[];
	limitReached: boolean;
}

export interface GrepQuery extends AbortOptions {
	cwd: string;
	target: string;
	pattern: string;
	include?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit: number;
}

export interface GrepMatch {
	path: string;
	line: number;
	text: string;
	kind: "match" | "context";
}

export interface GrepResult {
	rows: GrepMatch[];
	matches: number;
	limitReached: boolean;
}

export interface FileSearch {
	glob(query: GlobQuery): Promise<GlobResult>;
	grep(query: GrepQuery): Promise<GrepResult>;
}

export interface ShellOutputChunk {
	stream: "stdout" | "stderr";
	text: string;
}

export interface ShellExecuteOptions extends AbortOptions {
	cwd: string;
	shell?: string;
	timeoutMs: number;
	onOutput?: (chunk: ShellOutputChunk) => void | Promise<void>;
}

export interface ShellResult {
	exitCode: number | null;
	durationMs: number;
}

export interface Shell {
	execute(command: string, options: ShellExecuteOptions): Promise<ShellResult>;
}

export interface ExecutionEnvironment extends FileSystem, FileSearch, Shell {}
