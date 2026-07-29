import { NodeExecutionEnvironment } from "../../../src/node";

export function createNodeToolOptions(cwd: string) {
	const environment = new NodeExecutionEnvironment({ cwd });
	return {
		workspace: { fileSystem: environment, workspaceRoot: cwd },
		search: { fileSystem: environment, fileSearch: environment, workspaceRoot: cwd },
		bash: { fileSystem: environment, shell: environment, workspaceRoot: cwd },
		environment,
	};
}
