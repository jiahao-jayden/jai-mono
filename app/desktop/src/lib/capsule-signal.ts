export interface ParsedCapsuleSignal {
	url: string;
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

// Mirrors the XML emitted by the capsule-plugin RenderCapsule tool.
// The data attribute is single-quoted by the plugin so quotes inside the
// JSON payload are escaped as &quot; rather than colliding with the wrapper.
const SIGNAL_RE = /<jai-capsule\s+url=(['"])([\s\S]*?)\1\s+data=(['"])([\s\S]*?)\3\s*\/?>/;

export function parseCapsuleSignal(text: string | undefined | null): ParsedCapsuleSignal | null {
	if (!text) return null;
	const match = SIGNAL_RE.exec(text);
	if (!match) return null;
	const url = decodeAttr(match[2]).trim();
	if (!url) return null;
	let data: unknown = null;
	const dataRaw = decodeAttr(match[4]);
	if (dataRaw) {
		try {
			data = JSON.parse(dataRaw);
		} catch {
			return null;
		}
	}
	return { url, data };
}
