import { Type } from "@sinclair/typebox";
import { defineCodingConfig } from "../config";
import {
	mergePermissionConfigs,
	permissionConfigFields,
	permissionConfigSchema,
	permissionSettingsSchema,
} from "../permissions";

/**
 * The public SDK only needs its own permission defaults. Jai product provider,
 * connector, catalog, and workspace configuration belongs to product hosts.
 */
export const sdkConfigDefinition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
	schema: Type.Object(
		{
			permission: Type.Optional(permissionConfigSchema),
			permissions: permissionSettingsSchema,
		},
		{ additionalProperties: false },
	),
	fields: {
		permission: { merge: "custom", project: "trusted", default: {}, mergeValues: mergePermissionConfigs },
		permissions: permissionConfigFields,
	},
});
