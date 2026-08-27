import { homedir } from "node:os";
import { discoverSkillsCommands, type SkillsCommandDescriptor } from "@jai/extension/skills";

export interface DesktopCommandCatalog {
	list(input: {
		readonly workspaceDirectory?: string;
		readonly workspaceTrusted: boolean;
	}): Promise<readonly SkillsCommandDescriptor[]>;
}

/**
 * Desktop's read-only adapter for the built-in Skills Extension. It exposes
 * presentation metadata only; command execution remains in the Runtime Host.
 */
export function createDesktopCommandCatalog(
	homeDirectory: string = homedir(),
): DesktopCommandCatalog {
	return {
		list(input) {
			return discoverSkillsCommands({ homeDirectory, ...input });
		},
	};
}
