import { readdir, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Hono } from "hono";
import type { SessionManager } from "../session-manager.js";

interface FileEntry {
	name: string;
	path: string;
	type: "file" | "directory";
	size: number;
	mimeType?: string;
	children?: FileEntry[];
}

const EXT_MIME: Record<string, string> = {
	".ts": "text/typescript",
	".tsx": "text/typescript",
	".js": "text/javascript",
	".jsx": "text/javascript",
	".mjs": "text/javascript",
	".cjs": "text/javascript",
	".json": "application/json",
	".jsonl": "application/json",
	".md": "text/markdown",
	".yaml": "text/yaml",
	".yml": "text/yaml",
	".toml": "text/toml",
	".xml": "application/xml",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	".scss": "text/scss",
	".less": "text/less",
	".py": "text/x-python",
	".rs": "text/x-rust",
	".go": "text/x-go",
	".java": "text/x-java",
	".kt": "text/x-kotlin",
	".c": "text/x-c",
	".cpp": "text/x-c++",
	".h": "text/x-c",
	".cs": "text/x-csharp",
	".rb": "text/x-ruby",
	".php": "text/x-php",
	".swift": "text/x-swift",
	".sh": "text/x-shellscript",
	".bash": "text/x-shellscript",
	".zsh": "text/x-shellscript",
	".sql": "text/x-sql",
	".graphql": "text/x-graphql",
	".txt": "text/plain",
	".log": "text/plain",
	".env": "text/plain",
	".gitignore": "text/plain",
	".dockerignore": "text/plain",
	".editorconfig": "text/plain",
	".csv": "text/csv",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".bmp": "image/bmp",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".avi": "video/x-msvideo",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".pdf": "application/pdf",
	".zip": "application/zip",
	".gz": "application/gzip",
	".tar": "application/x-tar",
	".wasm": "application/wasm",
};

function getMimeType(filename: string): string {
	const ext = extname(filename).toLowerCase();
	return EXT_MIME[ext] ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
	return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "image/svg+xml";
}

const BLOCKED_DIRS = ["sessions", ".jai"];

function safePath(root: string, relativePath: string): string | null {
	const normalized = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
	const resolved = resolve(root, normalized);
	if (!resolved.startsWith(root)) return null;
	const firstSegment = normalized.split(/[/\\]/)[0];
	if (BLOCKED_DIRS.includes(firstSegment)) return null;
	return resolved;
}

const IGNORED = new Set(["node_modules", ".git", ".DS_Store", "Thumbs.db", "sessions"]);

async function listDir(root: string, relativePath: string, depth: number): Promise<FileEntry[]> {
	const absPath = safePath(root, relativePath);
	if (!absPath) return [];

	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(absPath, { withFileTypes: true, encoding: "utf-8" }) as import("node:fs").Dirent[];
	} catch {
		return [];
	}

	const result: FileEntry[] = [];
	const sorted = entries
		.filter((e) => !IGNORED.has(e.name) && !e.name.startsWith("."))
		.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

	for (const entry of sorted) {
		const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
		const entryAbsPath = join(absPath, entry.name);

		if (entry.isDirectory()) {
			const item: FileEntry = { name: entry.name, path: entryRelPath, type: "directory", size: 0 };
			if (depth > 1) {
				item.children = await listDir(root, entryRelPath, depth - 1);
			}
			result.push(item);
		} else if (entry.isFile()) {
			let size = 0;
			try {
				const s = await stat(entryAbsPath);
				size = s.size;
			} catch {}
			result.push({
				name: entry.name,
				path: entryRelPath,
				type: "file",
				size,
				mimeType: getMimeType(entry.name),
			});
		}
	}
	return result;
}

const MAX_TEXT_SIZE = 2 * 1024 * 1024;
const MAX_RAW_SIZE = 50 * 1024 * 1024;

export function workspaceRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/workspace/:workspaceId/files", async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const relativePath = c.req.query("path") ?? "";
		const depth = Math.min(Number(c.req.query("depth") ?? "1"), 5);
		const root = manager.getWorkspacePath(workspaceId);

		try {
			const entries = await listDir(root, relativePath, depth);
			return c.json({ entries });
		} catch (err) {
			return c.json({ error: String(err) }, 500);
		}
	});

	app.get("/workspace/:workspaceId/file", async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const relativePath = c.req.query("path");
		if (!relativePath) return c.json({ error: "path is required" }, 400);

		const root = manager.getWorkspacePath(workspaceId);
		const absPath = safePath(root, relativePath);
		if (!absPath) return c.json({ error: "Invalid path" }, 400);

		const mime = getMimeType(relativePath);
		if (!isTextMime(mime)) {
			return c.json({ error: "Not a text file. Use /raw endpoint for binary files." }, 400);
		}

		try {
			const file = Bun.file(absPath);
			const size = file.size;
			if (size > MAX_TEXT_SIZE) {
				return c.json({ error: `File too large (${size} bytes, max ${MAX_TEXT_SIZE})` }, 413);
			}
			const content = await file.text();
			return c.json({ content, path: relativePath, size, mimeType: mime });
		} catch {
			return c.json({ error: "File not found" }, 404);
		}
	});

	app.get("/workspace/:workspaceId/raw", async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const relativePath = c.req.query("path");
		if (!relativePath) return c.json({ error: "path is required" }, 400);

		const root = manager.getWorkspacePath(workspaceId);
		const absPath = safePath(root, relativePath);
		if (!absPath) return c.json({ error: "Invalid path" }, 400);

		try {
			const file = Bun.file(absPath);
			const size = file.size;
			if (size > MAX_RAW_SIZE) {
				return c.json({ error: `File too large (${size} bytes, max ${MAX_RAW_SIZE})` }, 413);
			}
			const mime = getMimeType(relativePath);
			return new Response(file, {
				headers: {
					"Content-Type": mime,
					"Content-Length": String(size),
					"Cache-Control": "private, max-age=60",
				},
			});
		} catch {
			return c.json({ error: "File not found" }, 404);
		}
	});

	return app;
}
