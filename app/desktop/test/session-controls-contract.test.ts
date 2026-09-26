import { describe, expect, test } from "bun:test";
import { runtimeSessionInteractionModes, runtimeSessionPermissionModes } from "@jai/server";
import {
	reasoningLevels,
	resolveEffectiveReasoningLevel,
	runtimeModelCapabilitiesSchema,
} from "@jai/server/model-catalog";
import { Value } from "@sinclair/typebox/value";
import {
	type DesktopModelCapabilities,
	type DesktopReasoningLevel,
	desktopInteractionModes,
	desktopPermissionModes,
	desktopReasoningLevels,
	desktopSessionControlsSchema,
	resolveDesktopEffectiveReasoningLevel,
} from "../shared/session-controls";

/**
 * Desktop restates the Runtime Host's Session control literals because the
 * renderer may not import `@jai/server`. These tests fail the moment the two
 * sides drift. Session permission/interaction modes are reached through the
 * ACP wire, so they are pinned to the values the Host accepts there.
 */
describe("Desktop Session controls contract", () => {
	test("uses the Host's ordered reasoning levels", () => {
		expect([...desktopReasoningLevels]).toEqual([...reasoningLevels]);
	});

	test("uses the Host's permission and interaction modes", () => {
		expect([...desktopPermissionModes]).toEqual([...runtimeSessionPermissionModes]);
		expect([...desktopInteractionModes]).toEqual([...runtimeSessionInteractionModes]);
	});

	test("model capability DTOs are accepted by the Host capability schema", () => {
		const capabilities: DesktopModelCapabilities = {
			reasoningLevels: ["none", "low", "max"],
			supportsFastMode: true,
		};
		expect(Value.Check(runtimeModelCapabilitiesSchema, capabilities)).toBe(true);
	});

	test("effective reasoning level matches the Host's downward resolution", () => {
		const supportedSets: readonly (readonly DesktopReasoningLevel[])[] = [
			[],
			["high", "xhigh"],
			["low", "medium", "high", "max"],
			[...desktopReasoningLevels],
		];
		for (const supported of supportedSets) {
			for (const desired of [undefined, ...desktopReasoningLevels]) {
				expect(resolveDesktopEffectiveReasoningLevel(desired, supported)).toBe(
					resolveEffectiveReasoningLevel(desired, supported),
				);
			}
		}
		expect(resolveDesktopEffectiveReasoningLevel("xhigh", ["low", "medium", "high"])).toBe("high");
		expect(resolveDesktopEffectiveReasoningLevel("low", ["high", "xhigh"])).toBeUndefined();
	});

	test("Session controls reject unknown keys and the retired mode", () => {
		expect(
			Value.Check(desktopSessionControlsSchema, {
				permissionMode: "ask",
				interactionMode: "normal",
				fastMode: false,
			}),
		).toBe(true);
		expect(
			Value.Check(desktopSessionControlsSchema, {
				permissionMode: "ask",
				interactionMode: "normal",
				fastMode: false,
				mode: "manual",
			}),
		).toBe(false);
	});
});
