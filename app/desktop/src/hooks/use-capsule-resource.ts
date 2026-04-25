import { useEffect, useState } from "react";
import { getBaseURL } from "@/services/gateway/client";

export interface CapsuleResource {
	manifest: { entry?: string; title?: string; id?: string; [key: string]: unknown };
	bundleCode: string;
}

interface CacheEntry {
	promise: Promise<CapsuleResource>;
	resource?: CapsuleResource;
	error?: Error;
}

// Process-wide cache; capsule bundles are immutable per (id, version) and
// the same capsule can appear in many messages as the user scrolls history.
const cache = new Map<string, CacheEntry>();

async function loadCapsule(url: string): Promise<CapsuleResource> {
	const base = getBaseURL();
	const manifestUrl = `${base}${url}/capsule.json`;
	const manifestRes = await fetch(manifestUrl);
	if (!manifestRes.ok) {
		throw new Error(`capsule.json (${manifestRes.status}) at ${manifestUrl}`);
	}
	const manifest = (await manifestRes.json()) as CapsuleResource["manifest"];
	const entryName =
		(typeof manifest.entry === "string" ? manifest.entry : "./index.js")
			.replace(/^\.?\/*/, "")
			.split("/")
			.pop() ?? "index.js";
	const bundleRes = await fetch(`${base}${url}/${entryName}`);
	if (!bundleRes.ok) {
		throw new Error(`${entryName} (${bundleRes.status})`);
	}
	const bundleCode = await bundleRes.text();
	return { manifest, bundleCode };
}

function getOrCreate(url: string): CacheEntry {
	const existing = cache.get(url);
	if (existing) return existing;
	const entry: CacheEntry = { promise: undefined as unknown as Promise<CapsuleResource> };
	entry.promise = loadCapsule(url).then(
		(r) => {
			entry.resource = r;
			return r;
		},
		(err: unknown) => {
			entry.error = err instanceof Error ? err : new Error(String(err));
			throw entry.error;
		},
	);
	cache.set(url, entry);
	return entry;
}

export type CapsuleResourceState =
	| { kind: "loading" }
	| { kind: "ready"; resource: CapsuleResource }
	| { kind: "error"; error: Error };

export function useCapsuleResource(url: string | null): CapsuleResourceState {
	const [state, setState] = useState<CapsuleResourceState>(() => {
		if (!url) return { kind: "loading" };
		const entry = cache.get(url);
		if (entry?.resource) return { kind: "ready", resource: entry.resource };
		if (entry?.error) return { kind: "error", error: entry.error };
		return { kind: "loading" };
	});

	useEffect(() => {
		if (!url) return;
		let alive = true;
		const entry = getOrCreate(url);
		if (entry.resource) {
			setState({ kind: "ready", resource: entry.resource });
			return;
		}
		if (entry.error) {
			setState({ kind: "error", error: entry.error });
			return;
		}
		setState({ kind: "loading" });
		entry.promise.then(
			(r) => {
				if (alive) setState({ kind: "ready", resource: r });
			},
			(err: unknown) => {
				if (alive) {
					setState({
						kind: "error",
						error: err instanceof Error ? err : new Error(String(err)),
					});
				}
			},
		);
		return () => {
			alive = false;
		};
	}, [url]);

	return state;
}
