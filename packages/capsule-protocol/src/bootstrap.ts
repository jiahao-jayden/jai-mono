import type { CapsuleProps } from "./types";

export type CapsuleUpdateSubscriber<D = unknown> = (handler: (data: D) => void) => () => void;

/** Payload the host injects as `window.__CAPSULE_BOOT__` before importing a capsule bundle. */
export interface CapsuleBootstrap<D = unknown, A extends Record<string, unknown> = Record<string, never>> {
	element: HTMLElement;
	instanceId: string;
	initialData: D;
	props: Omit<CapsuleProps<D, A>, "data">;
	onUpdate: CapsuleUpdateSubscriber<D>;
}

declare global {
	interface Window {
		/** Present inside a capsule sandbox; undefined elsewhere. */
		__CAPSULE_BOOT__?: CapsuleBootstrap<any, any>;
	}
}
