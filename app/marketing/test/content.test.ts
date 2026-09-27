import { describe, expect, test } from "bun:test";
import { LOCALES, resolveCopy } from "@/content";

type Shape = string | { readonly [key: string]: Shape } | readonly Shape[];

function describeShape(value: unknown): Shape {
	if (typeof value === "string") return "string";
	if (Array.isArray(value)) return value.map(describeShape);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, describeShape((value as Record<string, unknown>)[key])]),
		);
	}
	return typeof value;
}

function collectEmptyPaths(value: unknown, path: string): string[] {
	if (typeof value === "string") return value.trim() === "" ? [path] : [];
	if (value !== null && typeof value === "object") {
		return Object.entries(value).flatMap(([key, child]) => collectEmptyPaths(child, `${path}.${key}`));
	}
	return [];
}

// Headline.tail is intentionally allowed to be empty when the emphasis ends the sentence.
const OPTIONAL_EMPTY = /\.(tail|lead)$/;

describe("landing copy", () => {
	test("every locale has the same structure as English", () => {
		const reference = describeShape(resolveCopy("en"));
		for (const locale of LOCALES) {
			expect(describeShape(resolveCopy(locale))).toEqual(reference);
		}
	});

	test("no locale ships an empty string", () => {
		for (const locale of LOCALES) {
			const empty = collectEmptyPaths(resolveCopy(locale), locale).filter((path) => !OPTIONAL_EMPTY.test(path));
			expect(empty).toEqual([]);
		}
	});
});
