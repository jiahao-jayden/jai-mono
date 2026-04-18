import { describe, test, expect } from "bun:test";
import { loadCommandTemplatesFromDir, expandTemplate } from "../../src/plugin/host/commands.js";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("expandTemplate", () => {
  test("replaces $ARGUMENTS with joined args", () => {
    expect(expandTemplate("Review: $ARGUMENTS", "foo.ts bar.ts")).toBe("Review: foo.ts bar.ts");
  });

  test("replaces $ARGUMENTS with empty string when no args", () => {
    expect(expandTemplate("Run: $ARGUMENTS", "")).toBe("Run: ");
  });

  test("leaves unrecognized placeholders untouched", () => {
    expect(expandTemplate("$1 and $@", "x y")).toBe("$1 and $@");
  });
});

describe("loadCommandTemplatesFromDir", () => {
  test("returns empty when dir missing", async () => {
    const result = await loadCommandTemplatesFromDir("/tmp/definitely-missing-xyz");
    expect(result).toEqual([]);
  });

  test("loads .md files, parses frontmatter, and ignores other files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cmdload-"));
    await writeFile(
      join(dir, "review.md"),
      "---\ndescription: Review the diff\nargument-hint: \"[files]\"\n---\nReview: $ARGUMENTS\n",
    );
    await writeFile(join(dir, "bookmark.md"), "Just body here");
    await writeFile(join(dir, "README.txt"), "ignored");

    const templates = await loadCommandTemplatesFromDir(dir);
    expect(templates.length).toBe(2);

    const review = templates.find((t) => t.name === "review");
    expect(review?.description).toBe("Review the diff");
    expect(review?.argumentHint).toBe("[files]");
    expect(review?.content).toContain("$ARGUMENTS");

    const bookmark = templates.find((t) => t.name === "bookmark");
    expect(bookmark?.description).toBe("Just body here"); // first non-empty line
  });

  test("ignores files under subdirectories (non-recursive)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cmdload-"));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "ignored.md"), "x");
    await writeFile(join(dir, "root.md"), "y");

    const templates = await loadCommandTemplatesFromDir(dir);
    expect(templates.length).toBe(1);
    expect(templates[0].name).toBe("root");
  });
});
