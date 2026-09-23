import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const strict = { additionalProperties: false } as const;

function literals<const T extends string>(values: readonly T[]) {
	return Type.Union(values.map((value) => Type.Literal(value)));
}

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NonNegativeInteger = Type.Integer({ minimum: 0 });
const PositiveInteger = Type.Integer({ minimum: 1 });
const Language = Type.String({ pattern: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$" });
const AgentMode = literals(["manual", "automate", "plan"] as const);
const Permission = literals(["ask", "allow", "deny"] as const);
const WebSearchProviderId = literals(["exa", "parallel", "anysearch"] as const);
const WebSearchCredentialId = literals(["exa", "parallel", "anysearch", "jina"] as const);

const ProviderModel = Type.Object(
	{
		id: Type.String(),
		remoteModelId: Type.Optional(Type.String()),
		enabled: Type.Boolean(),
	},
	strict,
);

const ProviderProfile = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		adapter: literals(["anthropic", "openai-compatible", "openai-responses"] as const),
		baseURL: Type.Optional(Type.String()),
		authentication: literals(["api-key", "none"] as const),
		credentialConfigured: Type.Boolean(),
		credentialMask: Type.Optional(Type.String()),
		enabled: Type.Boolean(),
		modelsFetchedAt: Type.Optional(NonNegativeInteger),
		models: Type.Array(ProviderModel),
	},
	strict,
);

const ConnectorCredential = Type.Object(
	{
		key: Type.String(),
		configured: Type.Boolean(),
		mask: Type.Optional(Type.String()),
	},
	strict,
);

const Connector = Type.Object(
	{
		id: Type.String(),
		enabled: Type.Boolean(),
		credentials: Type.Array(ConnectorCredential),
		oauth: Type.Optional(
			Type.Object(
				{
					connected: Type.Boolean(),
					scopes: Type.Array(Type.String()),
					expiresAt: Type.Optional(Type.Integer()),
				},
				strict,
			),
		),
	},
	strict,
);

export const agentSettingsSnapshotSchema = Type.Object(
	{
		revision: NullableString,
		model: Type.String(),
		agentMode: Type.Optional(AgentMode),
		maxTurns: Type.Optional(PositiveInteger),
		language: Type.Optional(Language),
		reasoningEffort: Type.Optional(literals(["low", "medium", "high"] as const)),
		profiles: Type.Array(ProviderProfile),
		connector: Type.Object(
			{
				policy: Type.Object({ default: Permission, actions: Type.Record(Type.String(), Permission) }, strict),
				connectors: Type.Array(Connector),
			},
			strict,
		),
		webSearch: Type.Object(
			{
				providers: Type.Array(
					Type.Object(
						{
							id: WebSearchProviderId,
							enabled: Type.Boolean(),
							order: Type.Optional(PositiveInteger),
							credentialConfigured: Type.Boolean(),
							credentialMask: Type.Optional(Type.String()),
						},
						strict,
					),
				),
				fetch: Type.Object(
					{
						jina: Type.Object(
							{
								credentialConfigured: Type.Boolean(),
								credentialMask: Type.Optional(Type.String()),
							},
							strict,
						),
					},
					strict,
				),
			},
			strict,
		),
	},
	strict,
);

export const telemetrySettingsSnapshotSchema = Type.Object(
	{
		credential: Type.Object(
			{
				revision: NullableString,
				configured: Type.Boolean(),
				publicKeyMask: Type.Optional(Type.String()),
				secretKeyMask: Type.Optional(Type.String()),
			},
			strict,
		),
		enabled: Type.Boolean(),
		endpoint: Type.Optional(Type.String()),
		environmentOverride: Type.Boolean(),
		exporter: Type.Literal("langfuse-otlp"),
		policyRevision: NullableString,
		configurationError: Type.Optional(Type.String()),
	},
	strict,
);

export const modelFetchResultSchema = Type.Object(
	{
		profileId: Type.String(),
		modelCount: NonNegativeInteger,
		fetchedAt: NonNegativeInteger,
		snapshot: agentSettingsSnapshotSchema,
	},
	strict,
);

export const oauthStartSchema = Type.Object(
	{
		connectorId: Type.String(),
		authorizationUrl: Type.String(),
		expiresAt: PositiveInteger,
	},
	strict,
);

export const oauthCompletionSchema = Type.Object(
	{
		connectorId: Type.String(),
		snapshot: agentSettingsSnapshotSchema,
	},
	strict,
);

export const workspaceTrustSnapshotSchema = Type.Object(
	{
		workspacePath: Type.String(),
		trusted: Type.Boolean(),
		updatedAt: Type.Optional(Type.String()),
	},
	strict,
);

const JsonRecord = Type.Record(Type.String(), Type.Unknown());

export const mcpSettingsSnapshotSchema = Type.Object(
	{
		revision: NullableString,
		mcp: Type.Unknown(),
	},
	strict,
);

export const mcpStatusSchema = Type.Object(
	{
		servers: Type.Array(
			Type.Object(
				{
					name: Type.String(),
					type: literals(["stdio", "streamable-http", "sse"] as const),
					connected: Type.Boolean(),
					toolCount: Type.Optional(NonNegativeInteger),
					error: Type.Optional(Type.String()),
				},
				strict,
			),
		),
	},
	strict,
);

export const revealedApiKeySchema = Type.Object({ profileId: Type.String(), apiKey: Type.String() }, strict);
export const revealedWebSearchKeySchema = Type.Object(
	{ credentialId: WebSearchCredentialId, apiKey: Type.String() },
	strict,
);
export const revealedConnectorCredentialSchema = Type.Object(
	{ connectorId: Type.String(), credentialKey: Type.String(), value: Type.String() },
	strict,
);
export const revealedTelemetryCredentialSchema = Type.Object(
	{ credentialId: literals(["public", "secret"] as const), value: Type.String() },
	strict,
);

export const objectParamsSchema = Type.Record(Type.String(), Type.Unknown());
export const emptyParamsSchema = Type.Object({}, strict);
export const profileIdParamsSchema = Type.Object({ profileId: Type.String() }, strict);
export const languageParamsSchema = Type.Object({ language: Type.String() }, strict);
export const selectionParamsSchema = Type.Object({ model: Type.String(), agentMode: AgentMode }, strict);
export const webSearchCredentialParamsSchema = Type.Object({ credentialId: WebSearchCredentialId }, strict);
export const connectorCredentialParamsSchema = Type.Object(
	{ connectorId: Type.String(), credentialKey: Type.String() },
	strict,
);
export const telemetryCredentialParamsSchema = Type.Object(
	{ credentialId: literals(["public", "secret"] as const) },
	strict,
);
export const connectorIdParamsSchema = Type.Object({ connectorId: Type.String() }, strict);
export const callbackUrlParamsSchema = Type.Object({ callbackUrl: Type.String() }, strict);
export const workspacePathParamsSchema = Type.Object({ workspacePath: Type.String() }, strict);
export const workspaceTrustParamsSchema = Type.Object(
	{ workspacePath: Type.String(), trusted: Type.Boolean() },
	strict,
);
export const mcpSaveParamsSchema = Type.Object({ revision: Type.String(), mcp: JsonRecord }, strict);

export function readDto<T extends TSchema>(schema: T, value: unknown): Static<T> | undefined {
	return Value.Check(schema, value) ? value : undefined;
}
