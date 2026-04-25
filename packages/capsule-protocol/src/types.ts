export const CAPSULE_PROTOCOL_VERSION = "capsule/v0" as const;

export type CapsuleProtocolVersion = typeof CAPSULE_PROTOCOL_VERSION;

export type JSONSchema = Record<string, unknown>;

/** Component definition within a manifest. */
export interface CapsuleComponentManifest {
	title?: string;
	description?: string;
	dataSchema: JSONSchema;
}

/** Static description of a capsule; shipped as `capsule.json`. */
export interface CapsuleManifest {
	protocol: CapsuleProtocolVersion;
	id: string;
	version: string;
	/** Path (relative to manifest) of the self-contained ESM bundle. */
	entry: string;
	/** Component registry. Single-component capsules use `"default"` as key. */
	components: Record<string, CapsuleComponentManifest>;
	/** Forward-compatible extension field. */
	_meta?: Record<string, unknown>;
}

/** Props passed to a capsule component's render function. */
export interface CapsuleProps<D = unknown> {
	data: D;
	instanceId: string;
	theme: "light" | "dark" | null;
}
