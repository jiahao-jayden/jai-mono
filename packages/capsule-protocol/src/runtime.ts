import { type ComponentType, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { z } from "zod";
import type { CapsuleBootstrap } from "./bootstrap";
import type { CapsuleDefinition } from "./build";
import type { CapsuleFallback, CapsuleProps } from "./types";

type ActionArgs<A extends Record<string, z.ZodType>> = { [K in keyof A]: z.infer<A[K]> };

export interface CapsuleConfig<
	DSchema extends z.ZodType,
	AMap extends Record<string, z.ZodType> = Record<string, never>,
> {
	id: string;
	version: string;
	title?: string;
	description?: string;
	dataSchema: DSchema;
	actions?: AMap;
	fallback?: CapsuleFallback;
	_meta?: Record<string, unknown>;
	render: (props: CapsuleProps<z.infer<DSchema>, ActionArgs<AMap>>) => ReactElement | null;
}

/** Dual-mode capsule module: React component + static `__capsule` metadata. */
export type CapsuleModule<D, A extends Record<string, unknown>> = ComponentType<CapsuleProps<D, A>> & {
	readonly __capsule: CapsuleDefinition;
};

/**
 * Define a capsule. Dual-mode:
 *  - imported as a normal React component (Storybook, tests, other hosts)
 *  - auto-mounted as a module-load side effect when `window.__CAPSULE_BOOT__` is present
 *
 * The returned component carries a `__capsule` static so build tools can
 * derive the wire-format manifest without a separate config file.
 */
export function defineCapsule<
	DSchema extends z.ZodType,
	AMap extends Record<string, z.ZodType> = Record<string, never>,
>(config: CapsuleConfig<DSchema, AMap>): CapsuleModule<z.infer<DSchema>, ActionArgs<AMap>> {
	type D = z.infer<DSchema>;
	type A = ActionArgs<AMap>;

	const Component: ComponentType<CapsuleProps<D, A>> = (props) => config.render(props);
	Component.displayName = `Capsule(${config.id})`;

	const definition: CapsuleDefinition = {
		id: config.id,
		version: config.version,
		dataSchema: config.dataSchema,
	};
	if (config.title !== undefined) definition.title = config.title;
	if (config.description !== undefined) definition.description = config.description;
	if (config.actions) definition.actions = config.actions;
	if (config.fallback) definition.fallback = config.fallback;
	if (config._meta) definition._meta = config._meta;

	const module = Component as CapsuleModule<D, A>;
	Object.defineProperty(module, "__capsule", {
		value: definition,
		enumerable: false,
		writable: false,
		configurable: false,
	});

	const boot = getBootstrap<D, A>();
	if (boot) bootstrapCapsule(module, boot);

	return module;
}

export function getBootstrap<D = unknown, A extends Record<string, unknown> = Record<string, never>>():
	| CapsuleBootstrap<D, A>
	| undefined {
	if (typeof window === "undefined") return undefined;
	return (window as Window).__CAPSULE_BOOT__ as CapsuleBootstrap<D, A> | undefined;
}

function bootstrapCapsule<D, A extends Record<string, unknown>>(
	Component: ComponentType<CapsuleProps<D, A>>,
	boot: CapsuleBootstrap<D, A>,
): void {
	const root: Root = createRoot(boot.element);

	const render = (data: D): void => {
		root.render(
			createElement(Component, {
				...(boot.props as CapsuleProps<D, A>),
				data,
			}),
		);
	};

	render(boot.initialData);

	boot.onUpdate((data) => {
		render(data);
	});
}
