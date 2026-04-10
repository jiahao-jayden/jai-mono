import { session } from "electron";

export function setupCorsProxy(): void {
	const filter = { urls: ["https://*/*", "http://*/*"] };

	session.defaultSession.webRequest.onBeforeSendHeaders(
		filter,
		(
			details: Electron.OnBeforeSendHeadersListenerDetails,
			callback: (response: Electron.BeforeSendResponse) => void,
		) => {
			const headers = { ...details.requestHeaders };
			delete headers.Origin;
			callback({ requestHeaders: headers });
		},
	);

	session.defaultSession.webRequest.onHeadersReceived(
		filter,
		(
			details: Electron.OnHeadersReceivedListenerDetails,
			callback: (response: Electron.HeadersReceivedResponse) => void,
		) => {
			const headers = { ...details.responseHeaders } as Record<string, string[]>;
			for (const key of Object.keys(headers)) {
				if (key.toLowerCase().startsWith("access-control-")) {
					delete headers[key];
				}
			}
			headers["Access-Control-Allow-Origin"] = ["*"];
			headers["Access-Control-Allow-Methods"] = ["GET, POST, PUT, DELETE, OPTIONS"];
			headers["Access-Control-Allow-Headers"] = ["*"];
			callback({ responseHeaders: headers });
		},
	);
}
