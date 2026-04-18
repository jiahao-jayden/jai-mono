import { describe, test, expect } from "bun:test";
import { parseFrontmatter } from "../../src/utils/frontmatter.js";

describe("parseFrontmatter", () => {
  test("parses frontmatter and body", () => {
    const { frontmatter, body } = parseFrontmatter<{ description: string }>(
      "---\ndescription: hello\n---\nBody text\n",
    );
    expect(frontmatter.description).toBe("hello");
    expect(body).toBe("Body text");
  });

  test("returns empty frontmatter when no leading ---", () => {
    const { frontmatter, body } = parseFrontmatter("plain body");
    expect(frontmatter).toEqual({});
    expect(body).toBe("plain body");
  });

  test("returns empty frontmatter when unterminated ---", () => {
    const { frontmatter, body } = parseFrontmatter("---\nfoo: bar\nno close");
    expect(frontmatter).toEqual({});
    expect(body).toBe("---\nfoo: bar\nno close");
  });

  test("normalizes CRLF", () => {
    const { frontmatter, body } = parseFrontmatter("---\r\ndescription: x\r\n---\r\nbody\r\n");
    expect(frontmatter).toEqual({ description: "x" });
    expect(body).toBe("body");
  });
});
