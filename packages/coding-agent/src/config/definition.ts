import { type TObject, type TSchema, Type } from "@sinclair/typebox";
import { configDefinitionError } from "./errors";
import type { CodingConfigDefinition, ConfigFieldRule, ConfigFieldTree } from "./types";

export function defineCodingConfig<const TSchema extends TObject>(
	definition: CodingConfigDefinition<TSchema>,
): CodingConfigDefinition<TSchema> {
	if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
		throw configDefinitionError("schemaVersion must be a positive integer", "schemaVersion");
	}
	if (!definition.schemaUrl) throw configDefinitionError("schemaUrl is required", "schemaUrl");

	validateFieldTree(definition.schema, definition.fields, "");

	const versions = new Set<number>();
	for (const migration of definition.migrations) {
		if (!Number.isInteger(migration.from) || migration.from < 1 || migration.from >= definition.schemaVersion) {
			throw configDefinitionError(`Invalid migration source version ${migration.from}`, "migrations");
		}
		if (versions.has(migration.from)) {
			throw configDefinitionError(`Duplicate migration from version ${migration.from}`, "migrations");
		}
		versions.add(migration.from);
	}

	return Object.freeze({
		...definition,
		migrations: Object.freeze([...definition.migrations].sort((left, right) => left.from - right.from)),
	});
}

export function createScopeSchema(schema: TObject): TObject {
	return Type.Object(
		Object.fromEntries(
			Object.entries(schema.properties).map(([key, property]) => [
				key,
				Type.Optional(isObjectSchema(property) ? createScopeSchema(property) : property),
			]),
		),
		{ additionalProperties: false },
	);
}

/** Runtime validation schema and publishable JSON Schema come from the same definition. */
export function createCodingConfigFileSchema(definition: CodingConfigDefinition<TObject>): TObject {
	const settings = createScopeSchema(definition.schema);
	return Type.Object(
		{
			$schema: Type.Literal(definition.schemaUrl),
			schemaVersion: Type.Literal(definition.schemaVersion),
			...settings.properties,
		},
		{ additionalProperties: false },
	);
}

function validateFieldTree(schema: TObject, fields: ConfigFieldTree, parentPath: string): void {
	const schemaKeys = new Set(Object.keys(schema.properties));
	for (const key of Object.keys(fields)) {
		const path = parentPath ? `${parentPath}.${key}` : key;
		if (!schemaKeys.has(key))
			throw configDefinitionError(`Field rule has no matching schema property: ${path}`, path);
	}

	for (const [key, propertySchema] of Object.entries(schema.properties)) {
		const path = parentPath ? `${parentPath}.${key}` : key;
		const field = fields[key];
		if (!field) throw configDefinitionError(`Missing field rule: ${path}`, path);
		if (isFieldRule(field)) {
			if (field.merge === "restrictOnly" && !field.combineRestrictions) {
				throw configDefinitionError(`restrictOnly requires combineRestrictions: ${path}`, path);
			}
			if (field.merge === "custom" && !field.mergeValues) {
				throw configDefinitionError(`custom requires mergeValues: ${path}`, path);
			}
			if (field.environment && !field.environment.name.startsWith("JAI_")) {
				throw configDefinitionError(`Environment binding must start with JAI_: ${path}`, path);
			}
			continue;
		}
		if (!isObjectSchema(propertySchema)) {
			throw configDefinitionError(`Nested field rules require an object schema: ${path}`, path);
		}
		validateFieldTree(propertySchema, field, path);
	}
}

export function isFieldRule(value: ConfigFieldRule | ConfigFieldTree): value is ConfigFieldRule {
	return "merge" in value;
}

function isObjectSchema(schema: TSchema): schema is TObject {
	return "properties" in schema && typeof schema.properties === "object" && schema.properties !== null;
}
