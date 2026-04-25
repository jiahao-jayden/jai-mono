import type { ReactElement } from "react";
import type { z } from "zod";
import type { CapsuleDefinition } from "./build";
import type { CapsuleProps } from "./types";

/** Component definition within a capsule. */
export interface CapsuleComponentConfig<DSchema extends z.ZodType> {
	title?: string;
	description?: string;
	dataSchema: DSchema;
	render: (props: CapsuleProps<z.infer<DSchema>>) => ReactElement | null;
}

export interface CapsuleConfig {
	id: string;
	version: string;
	components: Record<string, CapsuleComponentConfig<z.ZodType>>;
}

/** Runtime component entry — what the host gets after loading the module. */
export interface CapsuleComponentEntry {
	title?: string;
	description?: string;
	dataSchema: z.ZodType;
	render: (props: CapsuleProps<any>) => ReactElement | null;
}

/** The registry object returned by `defineCapsule()`. */
export interface CapsuleRegistry {
	readonly id: string;
	readonly version: string;
	readonly components: Readonly<Record<string, CapsuleComponentEntry>>;
	readonly __capsule: CapsuleDefinition;
}

/**
 * Register capsule components. Returns a registry object — does NOT execute rendering.
 * The host loads this module via dynamic import and picks which component to render.
 */
export function defineCapsule(config: CapsuleConfig): CapsuleRegistry {
	const components: Record<string, CapsuleComponentEntry> = {};
	const schemaMap: Record<string, z.ZodType> = {};

	for (const [key, comp] of Object.entries(config.components)) {
		components[key] = {
			title: comp.title,
			description: comp.description,
			dataSchema: comp.dataSchema,
			render: comp.render,
		};
		schemaMap[key] = comp.dataSchema;
	}

	const definition: CapsuleDefinition = {
		id: config.id,
		version: config.version,
		components: schemaMap,
	};

	const registry: CapsuleRegistry = {
		id: config.id,
		version: config.version,
		components,
		__capsule: definition,
	};

	return registry;
}
