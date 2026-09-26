import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	type DesktopSessionConfiguration,
	desktopInteractionModeSchema,
	desktopPermissionModeSchema,
	desktopReasoningLevelSchema,
} from "../../shared/session-controls";

/**
 * ACP wire value for "no reasoning level chosen". ACP selects always carry a
 * current value, so the Runtime Host projects an unset level as this option.
 */
const REASONING_LEVEL_UNSET = "default";

const sessionConfigOptionsSchema = Type.Object({
	configOptions: Type.Array(Type.Object({ configId: Type.String(), currentValue: Type.Unknown() })),
});

/** One `session/set_config_option` payload, minus the session id. */
export type SessionConfigOptionChange =
	| {
			readonly configId: "model" | "permissionMode" | "interactionMode" | "reasoningLevel";
			readonly type: "id";
			readonly value: string;
	  }
	| { readonly configId: "fastMode"; readonly type: "boolean"; readonly value: boolean };

/**
 * Reads the Host's remembered Session configuration from the complete
 * `configOptions` state carried by session/resume, set_config_option and
 * `config_option_update`. Anything incomplete or unknown yields `undefined`
 * so Desktop never adopts a partial configuration.
 */
export function readSessionConfiguration(value: unknown): DesktopSessionConfiguration | undefined {
	if (!Value.Check(sessionConfigOptionsSchema, value)) return undefined;
	const current = (configId: string) =>
		value.configOptions.find((option) => option.configId === configId)?.currentValue;
	const modelRef = current("model");
	const permissionMode = current("permissionMode");
	const interactionMode = current("interactionMode");
	const reasoningLevel = current("reasoningLevel");
	const fastMode = current("fastMode");
	if (typeof modelRef !== "string" || !modelRef || typeof fastMode !== "boolean") return undefined;
	if (!Value.Check(desktopPermissionModeSchema, permissionMode)) return undefined;
	if (!Value.Check(desktopInteractionModeSchema, interactionMode)) return undefined;
	if (reasoningLevel === REASONING_LEVEL_UNSET) {
		return { modelRef, controls: { permissionMode, interactionMode, reasoningLevel: undefined, fastMode } };
	}
	if (!Value.Check(desktopReasoningLevelSchema, reasoningLevel)) return undefined;
	return { modelRef, controls: { permissionMode, interactionMode, reasoningLevel, fastMode } };
}

/**
 * The option changes that move the Host from `known` to `next`, model first.
 * `known` is `undefined` when Desktop has not yet seen the Host's values, in
 * which case every option is sent.
 */
export function sessionConfigurationChanges(
	known: DesktopSessionConfiguration | undefined,
	next: DesktopSessionConfiguration,
): readonly SessionConfigOptionChange[] {
	const changes: SessionConfigOptionChange[] = [];
	if (!known || known.modelRef !== next.modelRef) {
		changes.push({ configId: "model", type: "id", value: next.modelRef });
	}
	if (!known || known.controls.permissionMode !== next.controls.permissionMode) {
		changes.push({ configId: "permissionMode", type: "id", value: next.controls.permissionMode });
	}
	if (!known || known.controls.interactionMode !== next.controls.interactionMode) {
		changes.push({ configId: "interactionMode", type: "id", value: next.controls.interactionMode });
	}
	if (!known || known.controls.reasoningLevel !== next.controls.reasoningLevel) {
		changes.push({
			configId: "reasoningLevel",
			type: "id",
			value: next.controls.reasoningLevel ?? REASONING_LEVEL_UNSET,
		});
	}
	if (!known || known.controls.fastMode !== next.controls.fastMode) {
		changes.push({ configId: "fastMode", type: "boolean", value: next.controls.fastMode });
	}
	return changes;
}
