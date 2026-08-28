import { type CodingToolName, codingToolNames, defaultCodingToolNames } from "../tools/names";
import { CodingSdkFailure } from "./project";

export { codingToolNames, defaultCodingToolNames };

export function resolveCodingToolSelection(
	tools: readonly CodingToolName[] | undefined,
	excludeTools: readonly CodingToolName[] | undefined,
): ReadonlySet<CodingToolName> {
	assertKnownTools(tools, "tools");
	assertKnownTools(excludeTools, "excludeTools");
	const selected = new Set<CodingToolName>(tools ?? defaultCodingToolNames);
	for (const tool of excludeTools ?? []) selected.delete(tool);
	return selected;
}

function assertKnownTools(value: readonly CodingToolName[] | undefined, field: "tools" | "excludeTools"): void {
	for (const name of value ?? []) {
		if ((codingToolNames as readonly string[]).includes(name)) continue;
		throw new CodingSdkFailure({
			phase: "runtime_creation",
			code: "coding_sdk.invalid_tool_selection",
			message: `Unknown built-in tool "${String(name)}" in ${field}`,
		});
	}
}
