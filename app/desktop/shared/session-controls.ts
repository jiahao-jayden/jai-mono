import { type Static, Type } from "@sinclair/typebox";

/**
 * Desktop RPC projection of the Runtime Host Session controls. The renderer
 * may not import `@jai/server`, so the literal sets are restated here;
 * `test/session-controls-contract.test.ts` pins them to the Host's schemas.
 * The Runtime Host remains the only owner of the durable values.
 */
export const desktopPermissionModes = ["ask", "allow", "auto"] as const;
export type DesktopPermissionMode = (typeof desktopPermissionModes)[number];
export const desktopPermissionModeSchema = Type.Union(desktopPermissionModes.map((mode) => Type.Literal(mode)));

export const desktopInteractionModes = ["normal", "plan"] as const;
export type DesktopInteractionMode = (typeof desktopInteractionModes)[number];
export const desktopInteractionModeSchema = Type.Union(desktopInteractionModes.map((mode) => Type.Literal(mode)));

/** Ordered from least to most reasoning; resolution only ever moves down this list. */
export const desktopReasoningLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type DesktopReasoningLevel = (typeof desktopReasoningLevels)[number];
export const desktopReasoningLevelSchema = Type.Union(desktopReasoningLevels.map((level) => Type.Literal(level)));

/**
 * The per-Session choices sent with every prompt. `reasoningLevel` absent means
 * the user has not chosen one (the provider default applies); it is a wish kept
 * across model switches, not the level a given model will use.
 */
export const desktopSessionControlsSchema = Type.Object(
	{
		permissionMode: desktopPermissionModeSchema,
		interactionMode: desktopInteractionModeSchema,
		reasoningLevel: Type.Optional(desktopReasoningLevelSchema),
		fastMode: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type DesktopSessionControls = Static<typeof desktopSessionControlsSchema>;

/** What a new Session starts with; matches the Runtime Host default. */
export const defaultDesktopSessionControls: DesktopSessionControls = {
	permissionMode: "ask",
	interactionMode: "normal",
	fastMode: false,
};

/** The Session controls plus the model, as the Runtime Host remembers them for one Session. */
export interface DesktopSessionConfiguration {
	readonly modelRef: string;
	readonly controls: DesktopSessionControls;
}

/**
 * Which model controls one model supports. An empty `reasoningLevels` or a
 * false `supportsFastMode` means the control must not be offered for it.
 */
export interface DesktopModelCapabilities {
	readonly reasoningLevels: readonly DesktopReasoningLevel[];
	readonly supportsFastMode: boolean;
}

/**
 * The level a model will actually receive for the Session's wish: the highest
 * supported level at or below it, never above. Restates the Runtime Host's
 * `resolveEffectiveReasoningLevel` so the composer shows what will be sent.
 */
export function resolveDesktopEffectiveReasoningLevel(
	desired: DesktopReasoningLevel | undefined,
	supported: readonly DesktopReasoningLevel[],
): DesktopReasoningLevel | undefined {
	if (desired === undefined) return undefined;
	return desktopReasoningLevels
		.slice(0, desktopReasoningLevels.indexOf(desired) + 1)
		.findLast((level) => supported.includes(level));
}
