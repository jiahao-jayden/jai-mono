import { parseArgs } from "node:util";
import { runConnectorServiceProcess } from "@jai/connector/service/main";
import { createCodingConnectorConfigStore } from "./config-store";

if (import.meta.main) {
	const values = parseArgs({
		options: {
			"discovery-file": { type: "string" },
			"runtime-token-file": { type: "string" },
			"log-directory": { type: "string" },
			"home-directory": { type: "string" },
		},
	}).values;
	const homeDirectory = values["home-directory"];
	const configStore = createCodingConnectorConfigStore({ ...(homeDirectory ? { homeDir: homeDirectory } : {}) });
	await runConnectorServiceProcess({
		configStore,
		discoveryFile: values["discovery-file"],
		runtimeTokenFile: values["runtime-token-file"],
		logDirectory: values["log-directory"],
		homeDirectory,
	});
}
