import { Result, type Result as ResultType } from "better-result";
import { TrajectoryAccessDenied, type TrajectoryContentScope, type TrajectoryReadAccess } from "./types";

const scopes = new Set<TrajectoryContentScope>(["prompt", "final_text", "reasoning", "tool_input", "tool_output"]);
const accessBrand = Symbol("trajectory_read_access");
const scopesByAccess = new WeakMap<TrajectoryReadAccess, ReadonlySet<TrajectoryContentScope>>();

/**
 * Server adapters call this only after authenticating their own capability.
 * The resulting immutable context, not a request-provided scope string, is
 * handed to the read seam.
 */
export function createTrajectoryReadAccess(input: {
	readonly sessionId: string;
	readonly scopes?: readonly string[];
}): ResultType<TrajectoryReadAccess, TrajectoryAccessDenied> {
	if (!input.sessionId) {
		return Result.err(
			new TrajectoryAccessDenied({ sessionId: input.sessionId, message: "A trajectory read requires a Session" }),
		);
	}
	const granted = new Set<TrajectoryContentScope>();
	for (const scope of input.scopes ?? []) {
		if (!scopes.has(scope as TrajectoryContentScope)) {
			return Result.err(
				new TrajectoryAccessDenied({ sessionId: input.sessionId, message: `Unknown trajectory scope "${scope}"` }),
			);
		}
		granted.add(scope as TrajectoryContentScope);
	}
	const access = Object.freeze({ sessionId: input.sessionId, [accessBrand]: true }) as TrajectoryReadAccess;
	scopesByAccess.set(access, granted);
	return Result.ok(access);
}

export function isTrajectoryReadAccess(value: unknown): value is TrajectoryReadAccess {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly [accessBrand]?: unknown })[accessBrand] === true &&
		scopesByAccess.has(value as TrajectoryReadAccess)
	);
}

export function hasTrajectoryScope(access: TrajectoryReadAccess, scope: TrajectoryContentScope): boolean {
	return scopesByAccess.get(access)?.has(scope) ?? false;
}
