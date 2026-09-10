import { type Static, Type } from "@sinclair/typebox";
import { defineCodingConfig } from "../config";
import {
	mergePermissionConfigs,
	permissionConfigFields,
	permissionConfigSchema,
	permissionSettingsSchema,
} from "../permissions";

export const userTelemetryPolicySchema = Type.Object(
	{
		enabled: Type.Boolean(),
		exporter: Type.Literal("langfuse-otlp"),
		endpoint: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
	},
	{ additionalProperties: false },
);

/** A non-secret Host policy reserved in the shared user settings document. */
export type UserTelemetryPolicy = Static<typeof userTelemetryPolicySchema>;

export const defaultUserTelemetryPolicy: UserTelemetryPolicy = Object.freeze({
	enabled: false,
	exporter: "langfuse-otlp",
});

/**
 * The public SDK only consumes permission settings. It reserves telemetry and
 * mcp as user-only Host-owned fields, while the Server validates their
 * contents so a typo in either cannot block an Agent from opening.
 */
export const sdkConfigDefinition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
	schema: Type.Object(
		{
			permission: Type.Optional(permissionConfigSchema),
			permissions: permissionSettingsSchema,
			telemetry: Type.Optional(Type.Unknown()),
			mcp: Type.Optional(Type.Unknown()),
		},
		{ additionalProperties: false },
	),
	fields: {
		permission: { merge: "custom", project: "trusted", default: {}, mergeValues: mergePermissionConfigs },
		permissions: permissionConfigFields,
		telemetry: {
			merge: "replace",
			project: "never",
			default: defaultUserTelemetryPolicy,
		},
		mcp: { merge: "replace", project: "never" },
	},
});
