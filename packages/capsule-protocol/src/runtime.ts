import { type ComponentType, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { z } from "zod";
import type { CapsuleBootstrap } from "./bootstrap";
import type { CapsuleDefinition } from "./build";
import type { CapsuleFallback, CapsuleProps } from "./types";

export interface CapsuleConfig<DSchema extends z.ZodType> {
	id: string;
	version: string;
	title?: string;
	description?: string;
	dataSchema: DSchema;
	fallback?: CapsuleFallback;
	_meta?: Record<string, unknown>;
	render: (props: CapsuleProps<z.infer<DSchema>>) => ReactElement | null;
}

/** Dual-mode capsule module: React component + static `__capsule` metadata. */
export type CapsuleModule<D> = ComponentType<CapsuleProps<D>> & {
	readonly __capsule: CapsuleDefinition;
};

export function defineCapsule<DSchema extends z.ZodType>(
	config: CapsuleConfig<DSchema>,
): CapsuleModule<z.infer<DSchema>> {
	type D = z.infer<DSchema>;

	const Component: ComponentType<CapsuleProps<D>> = (props) => config.render(props);
	Component.displayName = `Capsule(${config.id})`;

	const definition: CapsuleDefinition = {
		id: config.id,
		version: config.version,
		dataSchema: config.dataSchema,
	};
	if (config.title !== undefined) definition.title = config.title;
	if (config.description !== undefined) definition.description = config.description;
	if (config.fallback) definition.fallback = config.fallback;
	if (config._meta) definition._meta = config._meta;

	const module = Component as CapsuleModule<D>;
	Object.defineProperty(module, "__capsule", {
		value: definition,
		enumerable: false,
		writable: false,
		configurable: false,
	});

	const boot = getBootstrap<D>();
	if (boot) bootstrapCapsule(module, boot);

	return module;
}

export function getBootstrap<D = unknown>(): CapsuleBootstrap<D> | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as Window).__CAPSULE_BOOT__ as CapsuleBootstrap<D> | undefined;
}

function bootstrapCapsule<D>(
	Component: ComponentType<CapsuleProps<D>>,
	boot: CapsuleBootstrap<D>,
): void {
	createRoot(boot.element).render(
		createElement(Component, {
			data: boot.initialData,
			instanceId: boot.instanceId,
			theme: boot.theme,
		}),
	);
}
