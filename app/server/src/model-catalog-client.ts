/** Client-safe Model Catalog projection helpers. This entry never imports SQLite. */
export {
	findRuntimeModelCatalog,
	findRuntimeModelCatalogMatch,
	normalizeRuntimeModelCatalog,
	parseRuntimeModelCatalogSnapshot,
	RUNTIME_MODEL_CATALOG_FRESHNESS_MS,
	type RuntimeModelCatalog,
	type RuntimeModelCatalogCost,
	RuntimeModelCatalogInvalid,
	type RuntimeModelCatalogMatch,
	type RuntimeModelCatalogModality,
	type RuntimeModelCatalogModel,
	type RuntimeModelCatalogProvider,
	type RuntimeModelCatalogSnapshot,
} from "./model-catalog/catalog";
export {
	CONFIRMED_MODEL_FIXTURES,
	resolveConfirmedModelFixture,
	resolveRuntimeModelCompatibilityProfile,
	type ConfirmedModelFixture,
} from "./model-catalog/compatibility";
