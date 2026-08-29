export interface BrowserTrajectoryBootstrap {
	readonly origin: string;
	readonly sessionId: string;
	readonly launchId: string;
}

export interface BrowserTrajectoryCapability {
	readonly origin: string;
	readonly sessionId: string;
	readonly token: string;
}

export function takeBrowserTrajectoryBootstrap(
	location: Location,
	history: History,
): BrowserTrajectoryBootstrap | undefined {
	const fragment = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
	const launchId = fragment.get("launch");
	const sessionId = fragment.get("sessionId");
	const origin = location.origin;
	history.replaceState(null, "", `${location.pathname}${location.search}`);
	if (!sessionId || !isLoopbackOrigin(origin)) return undefined;
	return launchId ? { origin, sessionId, launchId } : undefined;
}

function isLoopbackOrigin(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && Boolean(parsed.port);
	} catch {
		return false;
	}
}
