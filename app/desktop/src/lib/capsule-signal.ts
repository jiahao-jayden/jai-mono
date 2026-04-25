export interface ParsedCapsuleSignal {
	id: string;
	component: string;
	schemaHash: string;
	data: unknown;
}

function decodeAttr(s: string): string {
	return s
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

const SIGNAL_RE = /<jai-capsule\s+([\s\S]*?)\/?>/;
const ATTR_RE = /([\w-]+)=(['"])([\s\S]*?)\2/g;

export function parseCapsuleSignal(text: string | undefined | null): ParsedCapsuleSignal | null {
	if (!text) return null;
	const match = SIGNAL_RE.exec(text);
	if (!match) return null;

	const attrs: Record<string, string> = {};
	ATTR_RE.lastIndex = 0;
	for (let m = ATTR_RE.exec(match[1]); m !== null; m = ATTR_RE.exec(match[1])) {
		attrs[m[1]] = decodeAttr(m[3]);
	}

	const id = attrs.id?.trim();
	const schemaHash = attrs["schema-hash"]?.trim();
	if (!id || !schemaHash) return null;

	const component = attrs.component?.trim() || "default";

	let data: unknown = null;
	const dataRaw = attrs.data;
	if (dataRaw) {
		try {
			data = JSON.parse(dataRaw);
		} catch {
			return null;
		}
	}
	return { id, component, schemaHash, data };
}
