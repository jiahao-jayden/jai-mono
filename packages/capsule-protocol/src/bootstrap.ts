/** Payload the host injects as `window.__CAPSULE_BOOT__` before importing a capsule bundle. */
export interface CapsuleBootstrap<D = unknown> {
	element: HTMLElement;
	instanceId: string;
	initialData: D;
	theme: "light" | "dark" | null;
}

declare global {
	interface Window {
		/** Present inside a capsule sandbox; undefined elsewhere. */
		__CAPSULE_BOOT__?: CapsuleBootstrap<any>;
	}
}
