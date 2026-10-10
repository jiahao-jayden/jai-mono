import { expect, test } from "bun:test";
import { docsHeadersForMarketing, mountedDocsPaths } from "../scripts/mount-docs";

const sampleHeaders = `/*.md
  Content-Type: text/markdown; charset=utf-8
/*.txt
  Content-Type: text/plain; charset=utf-8
/
  Link: </index.md>; rel="alternate"; type="text/markdown"
`;

test("mounted docs files do not replace the landing page", () => {
	const paths: readonly string[] = mountedDocsPaths;
	expect(paths).not.toContain("index.html");
	expect(paths).not.toContain("_redirects");
	expect(paths).not.toContain("vercel.json");
});

test("docs headers keep markdown charset and leave the landing page alone", () => {
	const mounted = docsHeadersForMarketing(sampleHeaders);
	expect(mounted).toContain("/*.md");
	expect(mounted).toContain("text/markdown; charset=utf-8");
	expect(mounted).not.toContain('rel="alternate"');
	expect(mounted.split("\n").filter((line) => line === "/")).toEqual([]);
});
