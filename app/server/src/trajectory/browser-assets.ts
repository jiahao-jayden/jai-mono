import { resolve, sep } from "node:path";

export interface TrajectoryBrowserAssets {
	respond(request: Request): Promise<Response | undefined>;
}

/** Serves only the production Browser bundle; it has no access to trajectory facts or capabilities. */
export function createTrajectoryBrowserAssets(directory: string): TrajectoryBrowserAssets {
	const root = resolve(directory);
	return {
		async respond(request) {
			if (request.method !== "GET" && request.method !== "HEAD") return undefined;
			const pathname = new URL(request.url).pathname;
			if (pathname !== "/trajectory" && !pathname.startsWith("/trajectory/")) return undefined;
			const relative =
				pathname === "/trajectory" || pathname === "/trajectory/"
					? "index.html"
					: decodeURIComponent(pathname.slice("/trajectory/".length));
			const candidate = resolve(root, relative);
			if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined;
			const file = Bun.file(candidate);
			if (!(await file.exists())) {
				if (!relative.includes(".")) {
					const fallback = resolve(root, "index.html");
					return browserResponse(Bun.file(fallback), request.method, fallback);
				}
				return undefined;
			}
			return browserResponse(file, request.method, candidate);
		},
	};
}

function browserResponse(file: Blob, method: string, path: string): Response {
	const contentType = browserContentType(path);
	const headers = new Headers({
		"content-type": contentType,
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
	});
	if (contentType === "text/html; charset=utf-8") {
		headers.set("cache-control", "no-store");
		headers.set(
			"content-security-policy",
			"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		);
	} else headers.set("cache-control", "public, max-age=31536000, immutable");
	return new Response(method === "HEAD" ? null : file, { headers });
}

function browserContentType(path: string): string {
	if (path.endsWith(".html")) return "text/html; charset=utf-8";
	if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (path.endsWith(".css")) return "text/css; charset=utf-8";
	if (path.endsWith(".svg")) return "image/svg+xml";
	return "application/octet-stream";
}
