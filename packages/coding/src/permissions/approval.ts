import { type Static, Type } from "@sinclair/typebox";
import { canonicalToolNameSchema } from "./types";

export const permissionApprovalDecisionSchema = Type.Union([
	Type.Literal("deny"),
	Type.Literal("allowOnce"),
	Type.Literal("alwaysAllow"),
]);

export const permissionRiskSchema = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);

export const permissionRequestSummarySchema = Type.Object(
	{
		title: Type.String({ minLength: 1 }),
		description: Type.Optional(Type.String()),
		command: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		risk: Type.Optional(permissionRiskSchema),
	},
	{ additionalProperties: false },
);

export const permissionRequestSchema = Type.Object(
	{
		requestId: Type.String({ minLength: 1 }),
		sessionId: Type.String({ minLength: 1 }),
		toolCallId: Type.String({ minLength: 1 }),
		toolName: canonicalToolNameSchema,
		reason: Type.String({ minLength: 1 }),
		summary: permissionRequestSummarySchema,
		suggestedRule: Type.Optional(Type.String({ minLength: 1 })),
		rememberScope: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("project-local")])),
	},
	{ additionalProperties: false },
);

export const permissionResolutionSchema = Type.Object(
	{
		requestId: Type.String({ minLength: 1 }),
		decision: permissionApprovalDecisionSchema,
	},
	{ additionalProperties: false },
);

export type PermissionApprovalDecision = Static<typeof permissionApprovalDecisionSchema>;
export type PermissionRequest = Static<typeof permissionRequestSchema>;
export type PermissionRequestSummary = Static<typeof permissionRequestSummarySchema>;
export type PermissionResolution = Static<typeof permissionResolutionSchema>;
export type PermissionRisk = Static<typeof permissionRiskSchema>;
