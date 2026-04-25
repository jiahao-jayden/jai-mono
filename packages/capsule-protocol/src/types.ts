export const CAPSULE_PROTOCOL_VERSION = "capsule/v0" as const;

export type CapsuleProtocolVersion = typeof CAPSULE_PROTOCOL_VERSION;

export type JSONSchema = Record<string, unknown>;

export interface CapsuleFallback {
	/** Plain-text template with `{path.to.field}` placeholders, for headless environments. */
	text?: string;
}

/** Static description of a capsule; shipped as `capsule.json`. */
export interface CapsuleManifest {
	protocol: CapsuleProtocolVersion;
	id: string;
	version: string;
	title?: string;
	description?: string;
	/** Path (relative to manifest) of the self-contained ESM bundle. */
	entry: string;
	dataSchema: JSONSchema;
	fallback?: CapsuleFallback;
	/** Forward-compatible extension field. */
	_meta?: Record<string, unknown>;
}

/** `package.json.capsule` value: either a path to the manifest JSON, or the manifest inline. */
export type PackageJsonCapsuleField = string | CapsuleManifest;

/** Props passed to a capsule's render function. */
export interface CapsuleProps<D = unknown> {
	data: D;
	instanceId: string;
	theme: "light" | "dark" | null;
}
