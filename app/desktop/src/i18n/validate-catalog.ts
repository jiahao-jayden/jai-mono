import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const catalogDirectory = resolve(import.meta.dirname, "messages");
type CatalogValue = string | { readonly defaultMessage: string; readonly description?: string };

const catalogs = ["en", "zh-CN"].map((locale) => ({
	locale,
	values: JSON.parse(readFileSync(resolve(catalogDirectory, `${locale}.json`), "utf8")) as Record<
		string,
		CatalogValue
	>,
}));
const [source, ...translations] = catalogs;
const sourceKeys = Object.keys(source.values).sort();

for (const key of sourceKeys) {
	const value = source.values[key];
	if (typeof value === "string" && value.trim() !== "") {
		continue;
	}
	if (typeof value === "object" && value !== null && value.defaultMessage.trim() !== "") {
		continue;
	}
	throw new Error(`Catalog ${source.locale} has an invalid source message for ${key}`);
}

for (const catalog of translations) {
	const keys = Object.keys(catalog.values).sort();
	if (JSON.stringify(keys) !== JSON.stringify(sourceKeys)) {
		throw new Error(`Catalog keys differ between ${source.locale} and ${catalog.locale}`);
	}
	for (const key of keys) {
		if (typeof catalog.values[key] !== "string" || catalog.values[key].trim() === "") {
			throw new Error(`Catalog ${catalog.locale} has an empty translation for ${key}`);
		}
	}
}

console.log(`Validated ${sourceKeys.length} messages across ${catalogs.length} locales.`);
