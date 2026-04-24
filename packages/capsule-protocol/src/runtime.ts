import { type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CapsuleBootstrap } from "./bootstrap";
import type { CapsuleProps } from "./types";

/**
 * Wrap a capsule component. Dual-mode:
 *  - imported as a normal React component (Storybook, tests, other hosts)
 *  - auto-mounted as a module-load side effect when `window.__CAPSULE_BOOT__` is present
 */
export function defineCapsule<D = unknown, A extends Record<string, unknown> = Record<string, never>>(
	Component: ComponentType<CapsuleProps<D, A>>,
): ComponentType<CapsuleProps<D, A>> {
	const boot = getBootstrap<D, A>();
	if (boot) {
		bootstrapCapsule(Component, boot);
	}
	return Component;
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

	const offUpdate = boot.onUpdate((data) => {
		render(data);
	});

	const offDispose = boot.onDispose(() => {
		offUpdate();
		offDispose();
		root.unmount();
	});
}
