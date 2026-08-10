export interface AgentPluginDiagnostic {
	readonly code: string;
	readonly severity: "info" | "warning" | "error";
	readonly scope: "package" | "skills" | "skill" | "mcp" | "mcp-server" | "hooks" | "hook" | "hook-handler";
	readonly componentName?: string;
	readonly relativePath?: string;
	readonly message: string;
}
