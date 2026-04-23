import { loader } from "@monaco-editor/react";

type Schema = Record<string, unknown>;

/**
 * Tracks plugin config schemas keyed by plugin name and publishes them to
 * Monaco's JSON language defaults. Each plugin gets a dedicated model URI
 * (`inmemory://plugin-config/<name>.json`) and `fileMatch` so validation and
 * IntelliSense only fire on that plugin's editor.
 */
const schemas = new Map<string, Schema>();
let monacoReady: Promise<typeof import("monaco-editor")> | null = null;

function getMonaco() {
	if (!monacoReady) monacoReady = loader.init();
	return monacoReady;
}

function buildFileName(pluginName: string): string {
	return `plugin-config-${pluginName}.json`;
}

/** Model path consumed by `<Editor path=... />` so its URI matches `fileMatch`. */
export function schemaModelPath(pluginName: string): string {
	return buildFileName(pluginName);
}

/** The public monaco namespace marks `languages.json` as deprecated, but the
 *  runtime API is still the official way to configure JSON diagnostics. Declare
 *  only the surface we need so TS doesn't complain. */
type JsonLanguageApi = {
	languages: {
		json: {
			jsonDefaults: {
				setDiagnosticsOptions(options: {
					validate?: boolean;
					allowComments?: boolean;
					trailingCommas?: "error" | "warning" | "ignore";
					schemaValidation?: "error" | "warning" | "ignore";
					schemas?: Array<{
						uri: string;
						fileMatch?: string[];
						schema?: unknown;
					}>;
				}): void;
			};
		};
	};
};

async function publish(): Promise<void> {
	const monaco = (await getMonaco()) as unknown as JsonLanguageApi;
	const list = Array.from(schemas.entries()).map(([name, schema]) => ({
		uri: `inmemory://plugin-config/${name}.json`,
		fileMatch: [buildFileName(name)],
		schema,
	}));

	monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
		validate: true,
		allowComments: false,
		trailingCommas: "error",
		schemaValidation: "error",
		schemas: list,
	});
}

export function registerPluginSchema(pluginName: string, schema: Schema | null | undefined): void {
	if (!schema) {
		if (schemas.delete(pluginName)) void publish();
		return;
	}
	schemas.set(pluginName, schema);
	void publish();
}

export function unregisterPluginSchema(pluginName: string): void {
	if (schemas.delete(pluginName)) void publish();
}
