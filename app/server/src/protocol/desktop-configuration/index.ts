export type { DesktopConfigurationControl } from "./control";
export { createDesktopConfigurationControl } from "./control";
export { localDesktopConfigurationEndpointFor } from "./local-endpoint";
export {
	DesktopConfigurationControlListenFailed,
	type LocalDesktopConfigurationControlServer,
	openLocalDesktopConfigurationControlServer,
} from "./local-transport";
