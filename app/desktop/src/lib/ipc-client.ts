export const windowClient = {
	close: () => window.ipc.invoke("window:close"),
	minimize: () => window.ipc.invoke("window:minimize"),
	fullscreen: () => window.ipc.invoke("window:fullscreen"),
	titlebarDblClick: () => window.ipc.invoke("window:titlebar-dblclick"),
	openSettings: () => window.ipc.invoke("window:open-settings"),
};

export async function getGatewayInfo(): Promise<{
	port: number;
	baseURL: string;
	ready: boolean;
}> {
	return window.ipc.invoke("gateway:info");
}
