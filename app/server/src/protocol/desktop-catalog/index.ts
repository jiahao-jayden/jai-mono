export type { DesktopCatalogControl } from "./control";
export { createDesktopCatalogControl } from "./control";
export { localDesktopCatalogEndpointFor } from "./local-endpoint";
export {
	DesktopCatalogControlListenFailed,
	type LocalDesktopCatalogControlServer,
	openLocalDesktopCatalogControlServer,
} from "./local-transport";
export {
	type DesktopCatalogAccess,
	type DesktopCatalogProject,
	DesktopCatalogProjectNotFound,
	DesktopCatalogProjectPathConflict,
	type DesktopCatalogSession,
	type DesktopCatalogSessionCursor,
	DesktopCatalogSessionNotFound,
	type DesktopCatalogSessionPage,
	DesktopCatalogStorageCorrupted,
	type DesktopCatalogStorageError,
	DesktopCatalogStorageFailed,
	type DesktopCatalogTitleSource,
} from "./types";
