export interface ParsedCapsuleSignal {
	id: string;
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

const SIGNAL_RE = /<jai-capsule\s+id=(['"])([\s\S]*?)\1\s+schema-hash=(['"])([\s\S]*?)\3\s+data=(['"])([\s\S]*?)\5\s*\/?>/;

export function parseCapsuleSignal(text: string | undefined | null): ParsedCapsuleSignal | null {
	if (!text) return null;
	const match = SIGNAL_RE.exec(text);
	if (!match) return null;
	const id = decodeAttr(match[2]).trim();
	const schemaHash = decodeAttr(match[4]).trim();
	if (!id || !schemaHash) return null;
	let data: unknown = null;
	const dataRaw = decodeAttr(match[6]);
	if (dataRaw) {
		try {
			data = JSON.parse(dataRaw);
		} catch {
			return null;
		}
	}
	return { id, schemaHash, data };
}
