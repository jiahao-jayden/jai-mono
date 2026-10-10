import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const marketingRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDist = join(marketingRoot, "../docs/dist");
const publicDir = join(marketingRoot, "public");

/** Directories and files the docs HTML actually requests from the site root. */
export const mountedDocsPaths = [
	"_astro",
	"docs",
	"agent-readability.json",
	"blume-search.json",
	"docs.md",
	"docs.mdx",
	"index.md",
	"index.mdx",
	"llms-full.txt",
	"llms.txt",
] as const;

/**
 * Drop the docs homepage `Link` header. It targets `/`, which on this site is the landing page.
 * Charset rules for the raw markdown and text files stay.
 */
export function docsHeadersForMarketing(headers: string): string {
	const lines = headers.split("\n");
	const kept: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (line === "/") {
			while (index + 1 < lines.length && (lines[index + 1] ?? "").startsWith("  ")) {
				index += 1;
			}
			continue;
		}
		kept.push(line);
	}
	return `${kept.join("\n").trimEnd()}\n`;
}

async function mountDocs(): Promise<void> {
	const build = spawnSync("bun", ["run", "build"], {
		cwd: join(marketingRoot, "../docs"),
		stdio: "inherit",
	});
	if (build.status !== 0) {
		process.exit(build.status ?? 1);
	}

	for (const name of mountedDocsPaths) {
		const target = join(publicDir, name);
		await rm(target, { recursive: true, force: true });
		await cp(join(docsDist, name), target, { recursive: true });
	}

	// The docs build also emits `/` → `/docs` (`index.html`, `_redirects`, `vercel.json`).
	// Publishing those would replace the landing page.
	const headers = await readFile(join(docsDist, "_headers"), "utf8");
	await writeFile(join(publicDir, "_headers"), docsHeadersForMarketing(headers));
}

if (import.meta.main) {
	await mountDocs();
}
