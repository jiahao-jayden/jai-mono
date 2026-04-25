import { useEffect, useState } from "react";
import { getBaseURL } from "@/services/gateway/client";

export interface CapsuleResource {
	manifest: Record<string, unknown>;
	bundleCode: string;
	schemaHash: string;
}

interface CatalogEntry {
	id: string;
	schemaHash: string;
	manifest: Record<string, unknown>;
	bundleCode: string;
}

let _catalog: Map<string, CapsuleResource> | null = null;
let _catalogPromise: Promise<Map<string, CapsuleResource>> | null = null;

async function fetchCatalog(): Promise<Map<string, CapsuleResource>> {
	const base = getBaseURL();
	const res = await fetch(`${base}/api/plugins/capsule-plugin/catalog`);
	if (!res.ok) throw new Error(`catalog fetch failed (${res.status})`);
	const data = (await res.json()) as { capsules: CatalogEntry[] };
	const map = new Map<string, CapsuleResource>();
	for (const c of data.capsules) {
		map.set(c.id, { manifest: c.manifest, bundleCode: c.bundleCode, schemaHash: c.schemaHash });
	}
	return map;
}

function getCatalog(): Promise<Map<string, CapsuleResource>> {
	if (_catalog) return Promise.resolve(_catalog);
	if (!_catalogPromise) {
		_catalogPromise = fetchCatalog().then(
			(m) => { _catalog = m; return m; },
			(err) => { _catalogPromise = null; throw err; },
		);
	}
	return _catalogPromise;
}

function lookupCapsule(catalog: Map<string, CapsuleResource>, id: string, schemaHash: string): CapsuleResourceState {
	const entry = catalog.get(id);
	if (!entry) return { kind: "error", error: new Error(`capsule "${id}" not found`) };
	if (entry.schemaHash !== schemaHash) return { kind: "error", error: new Error(`capsule "${id}" schema changed`) };
	return { kind: "ready", resource: entry };
}

export type CapsuleResourceState =
	| { kind: "loading" }
	| { kind: "ready"; resource: CapsuleResource }
	| { kind: "error"; error: Error };

export function useCapsuleResource(id: string | null, schemaHash?: string): CapsuleResourceState {
	const [state, setState] = useState<CapsuleResourceState>(() => {
		if (!id || !schemaHash) return { kind: "loading" };
		if (_catalog) return lookupCapsule(_catalog, id, schemaHash);
		return { kind: "loading" };
	});

	useEffect(() => {
		if (!id || !schemaHash) return;
		let alive = true;

		if (_catalog) {
			setState(lookupCapsule(_catalog, id, schemaHash));
			return;
		}

		setState({ kind: "loading" });
		getCatalog().then(
			(catalog) => { if (alive) setState(lookupCapsule(catalog, id, schemaHash)); },
			(err: unknown) => { if (alive) setState({ kind: "error", error: err instanceof Error ? err : new Error(String(err)) }); },
		);
		return () => { alive = false; };
	}, [id, schemaHash]);

	return state;
}
