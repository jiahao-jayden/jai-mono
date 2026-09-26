/** Client-safe Model Catalog projection helpers. This entry never imports SQLite. */
export {
	type ReasoningLevel,
	type RuntimeModelCapabilities,
	reasoningLevelSchema,
	reasoningLevels,
	resolveEffectiveReasoningLevel,
	resolveRuntimeModelCapabilities,
	runtimeModelCapabilitiesSchema,
} from "./model-catalog/capabilities";
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
	type ConfirmedModelFixture,
	resolveConfirmedModelFixture,
	resolveRuntimeModelCompatibilityProfile,
} from "./model-catalog/compatibility";
