import { type $Fetch, ofetch } from "ofetch";
import { getGatewayInfo } from "@/lib/ipc-client";

const DEFAULT_BASE_URL = "http://127.0.0.1:18900";

let instance: $Fetch | null = null;
let initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
	if (instance) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		let baseURL: string;
		try {
			const info = await getGatewayInfo();
			baseURL = info.baseURL;
		} catch {
			baseURL = DEFAULT_BASE_URL;
		}
		resolvedBaseURL = baseURL;
		instance = ofetch.create({ baseURL, retry: false });
	})();

	return initPromise;
}

export function gw(): $Fetch {
	return instance ?? ofetch.create({ baseURL: DEFAULT_BASE_URL, retry: false });
}

let resolvedBaseURL: string | null = null;

export function getBaseURL(): string {
	return resolvedBaseURL ?? DEFAULT_BASE_URL;
}

export async function health(): Promise<boolean> {
	try {
		await gw()("/health");
		return true;
	} catch {
		return false;
	}
}

export async function waitForReady(timeout = 30_000): Promise<void> {
	await init();
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await health()) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("Gateway not ready within timeout");
}
