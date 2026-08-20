/**
 * JSON shapes shared across every layer of the package.
 *
 * Lives here rather than in `sdk/types.ts` so the lower layers (permissions, tools, runtime) can name
 * a JSON value without importing from the public facade — that direction was the package's dependency
 * cycle. `@jai/agent` exports a mutable twin of these types; this one is readonly, which is what the
 * SDK surface promises.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };
