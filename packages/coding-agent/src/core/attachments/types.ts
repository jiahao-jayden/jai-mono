export interface RawAttachment {
	filename: string;
	/** base64 encoded data (without data URL prefix) */
	data: string;
	mimeType: string;
	/** Original file size in bytes */
	size: number;
}

export const ATTACHMENT_LIMITS = {
	MAX_FILE_SIZE: 20 * 1024 * 1024,
	MAX_TEXT_CHARS: 25_000,
	IMAGE_MAX_BYTES: 4.5 * 1024 * 1024,
	IMAGE_MAX_DIMENSION: 2000,
	PDF_MAX_PAGES: 50,
	PDF_MAX_SIZE: 10 * 1024 * 1024,
} as const;

export const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".json",
	".xml",
	".html",
	".css",
	".js",
	".ts",
	".jsx",
	".tsx",
	".py",
	".go",
	".rs",
	".java",
	".yml",
	".yaml",
	".toml",
	".sh",
	".sql",
	".csv",
	".c",
	".cpp",
	".h",
	".hpp",
	".rb",
	".php",
	".swift",
	".kt",
	".scala",
	".r",
	".lua",
	".vim",
	".conf",
	".ini",
	".env",
	".gitignore",
	".dockerfile",
	".makefile",
	".cmake",
	".gradle",
	".properties",
	".lock",
	".log",
	".mdx",
	".astro",
	".svelte",
	".vue",
]);

export function isTextFile(mimeType: string, filename: string): boolean {
	if (mimeType.startsWith("text/")) return true;
	if (mimeType === "application/json") return true;
	if (mimeType === "application/xml") return true;
	if (mimeType === "application/javascript") return true;
	if (mimeType === "application/typescript") return true;
	if (mimeType === "application/x-yaml") return true;
	if (mimeType === "application/toml") return true;

	const ext = getExtension(filename);
	return TEXT_EXTENSIONS.has(ext);
}

export function getExtension(filename: string): string {
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex === -1) return "";
	return filename.slice(dotIndex).toLowerCase();
}

/**
 * HTML file input `accept` string covering all supported attachment types.
 * Uses MIME wildcards to keep the list short — a long list of extensions
 * causes noticeable lag when opening the OS file picker on macOS.
 */
export const ACCEPTED_FILE_TYPES = [
	"image/*",
	"text/*",
	"application/pdf",
	"application/json",
	".md",
	".mdx",
	".json",
	".yml",
	".yaml",
	".toml",
	".js",
	".ts",
	".jsx",
	".tsx",
	".py",
	".go",
	".rs",
	".java",
	".swift",
	".kt",
	".scala",
	".rb",
	".php",
	".lua",
	".sh",
	".sql",
	".c",
	".cpp",
	".h",
	".hpp",
	".r",
	".astro",
	".svelte",
	".vue",
	".env",
	".gitignore",
	".dockerfile",
	".lock",
	".log",
].join(",");
