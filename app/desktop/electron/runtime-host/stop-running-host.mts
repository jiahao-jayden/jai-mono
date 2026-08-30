import { join } from "node:path";
import { localAcpV2EndpointFor, resolveJaiDataDirectory, stopLocalRuntimeHost } from "@jai/server/acp-client";

const dataDirectory = resolveJaiDataDirectory();
await stopLocalRuntimeHost(join(dataDirectory, "runtime-host.lock"), localAcpV2EndpointFor(dataDirectory));
