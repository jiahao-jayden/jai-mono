export type CodingExecutionContext =
	| {
			readonly localFileAccess: true;
			readonly cwd: string;
			readonly configRoot: string;
			readonly defaultAllowedDirectories: readonly [string, ...string[]];
			/** Host-owned files and control directories that Shell execution must not expose. */
			readonly protectedPaths?: readonly string[];
	  }
	| {
			readonly localFileAccess: false;
	  };
