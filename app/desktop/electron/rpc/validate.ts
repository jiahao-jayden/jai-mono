import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";

class InvalidDesktopInput extends TaggedError("desktop_rpc.invalid_input")<{ readonly message: string }> {}

/**
 * Parses an IPC payload against the schema its DTO type is derived from, so the
 * validator cannot drift away from the type the renderer was compiled against.
 * Every input schema sets `additionalProperties: false`, so unknown keys are
 * rejected here rather than forwarded into the SDK.
 */
export function parse<TSchemaType extends TSchema>(
	schema: TSchemaType,
	value: unknown,
	message: string,
): Static<TSchemaType> {
	if (!Value.Check(schema, value)) throw new InvalidDesktopInput({ message });
	return value as Static<TSchemaType>;
}
