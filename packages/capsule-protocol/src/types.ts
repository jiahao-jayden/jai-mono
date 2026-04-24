export const CAPSULE_PROTOCOL_VERSION = "capsule/v0" as const;

export type CapsuleProtocolVersion = typeof CAPSULE_PROTOCOL_VERSION;

export type JSONSchema = Record<string, unknown>;

export interface CapsuleActionDefinition {
	schema: JSONSchema;
	description?: string;
}

export interface CapsuleFallback {
	/** Plain-text template with `{path.to.field}` placeholders, for headless environments. */
	text?: string;
}

/** Static description of a capsule; shipped as `capsule.json` or inline in `package.json.capsule`. */
export interface CapsuleManifest {
	protocol: CapsuleProtocolVersion;
	id: string;
	version: string;
	title?: string;
	description?: string;
	/** Path (relative to manifest) of the self-contained ESM bundle. */
	entry: string;
	dataSchema: JSONSchema;
	actions?: Record<string, CapsuleActionDefinition>;
	fallback?: CapsuleFallback;
	/** Forward-compatible extension field. */
	_meta?: Record<string, unknown>;
}

/** `package.json.capsule` value: either a path to the manifest JSON, or the manifest inline. */
export type PackageJsonCapsuleField = string | CapsuleManifest;

export interface CapsuleProps<D = unknown, A extends Record<string, unknown> = Record<string, never>> {
	data: D;
	/** Stable across updates of the same render instance. */
	instanceId: string;
	theme?: "light" | "dark";
	/** Invoke a named action from `manifest.actions`; resolves with the host's reply. */
	postAction: <K extends keyof A & string>(actionId: K, args: A[K]) => Promise<unknown>;
}
