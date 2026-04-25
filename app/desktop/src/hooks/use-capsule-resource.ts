import { useEffect, useState } from "react";
import { getBaseURL } from "@/services/gateway/client";

export interface CapsuleResource {
	manifest: Record<string, unknown>;
	bundleCode: string;
	schemaHash: string;
}

interface CatalogEntry {
	id: string;
	manifest: Record<string, unknown>;
	schemaHashes: Record<string, string>;
}

interface CatalogCapsule {
	manifest: Record<string, unknown>;
	schemaHashes: Record<string, string>;
}

let _catalog: Map<string, CatalogCapsule> | null = null;
let _catalogPromise: Promise<Map<string, CatalogCapsule>> | null = null;
const _bundleCache = new Map<string, string>();
const _bundlePromises = new Map<string, Promise<string>>();

async function fetchCatalog(): Promise<Map<string, CatalogCapsule>> {
	const base = getBaseURL();
	const res = await fetch(`${base}/api/plugins/capsule-plugin/catalog`);
	if (!res.ok) throw new Error(`catalog fetch failed (${res.status})`);
	const data = (await res.json()) as { capsules: CatalogEntry[] };
	const map = new Map<string, CatalogCapsule>();
	for (const c of data.capsules) {
		map.set(c.id, { manifest: c.manifest, schemaHashes: c.schemaHashes });
	}
	return map;
}

function getCatalog(): Promise<Map<string, CatalogCapsule>> {
	if (_catalog) return Promise.resolve(_catalog);
	if (!_catalogPromise) {
		_catalogPromise = fetchCatalog().then(
			(m) => { _catalog = m; return m; },
			(err) => { _catalogPromise = null; throw err; },
		);
	}
	return _catalogPromise;
}

async function fetchBundle(id: string): Promise<string> {
	const cached = _bundleCache.get(id);
	if (cached) return cached;

	let promise = _bundlePromises.get(id);
	if (!promise) {
		const base = getBaseURL();
		promise = fetch(`${base}/api/plugins/capsule-plugin/capsules/${id}/bundle`)
			.then((res) => {
				if (!res.ok) throw new Error(`bundle fetch failed for "${id}" (${res.status})`);
				return res.text();
			})
			.then((code) => {
				_bundleCache.set(id, code);
				_bundlePromises.delete(id);
				return code;
			})
			.catch((err) => {
				_bundlePromises.delete(id);
				throw err;
			});
		_bundlePromises.set(id, promise);
	}
	return promise;
}

export type CapsuleResourceState =
	| { kind: "loading" }
	| { kind: "ready"; resource: CapsuleResource }
	| { kind: "error"; error: Error };

export function useCapsuleResource(id: string | null, component: string, schemaHash?: string): CapsuleResourceState {
	const [state, setState] = useState<CapsuleResourceState>({ kind: "loading" });

	useEffect(() => {
		if (!id || !schemaHash) return;
		let alive = true;

		setState({ kind: "loading" });

		getCatalog()
			.then((catalog) => {
				if (!alive) return;
				const entry = catalog.get(id);
				if (!entry) throw new Error(`capsule "${id}" not found`);
				const expectedHash = entry.schemaHashes[component];
				if (!expectedHash) throw new Error(`capsule "${id}" has no component "${component}"`);
				if (expectedHash !== schemaHash) throw new Error(`capsule "${id}/${component}" schema changed`);
				return fetchBundle(id).then((bundleCode) => {
					if (!alive) return;
					setState({
						kind: "ready",
						resource: { manifest: entry.manifest, bundleCode, schemaHash: expectedHash },
					});
				});
			})
			.catch((err: unknown) => {
				if (alive) setState({ kind: "error", error: err instanceof Error ? err : new Error(String(err)) });
			});

		return () => { alive = false; };
	}, [id, component, schemaHash]);

	return state;
}
