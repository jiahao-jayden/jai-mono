import { type Static, Type } from "@sinclair/typebox";

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

export type PermissionApprovalDecision = Static<typeof permissionApprovalDecisionSchema>;
export type PermissionRequestSummary = Static<typeof permissionRequestSummarySchema>;
export type PermissionRisk = Static<typeof permissionRiskSchema>;
