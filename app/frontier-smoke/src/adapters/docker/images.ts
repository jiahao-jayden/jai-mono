import type { GatewayModelSource } from "../../core/types";

export const gatewayContainerPort = 8787;
export const gatewayNetworkAlias = "provider-gateway";

export function runtimeDockerfile(): string {
	return `FROM oven/bun:1.4.0-debian AS build
WORKDIR /workspace
COPY package.json bun.lock tsconfig.base.json ./
COPY app/cli ./app/cli
COPY app/connector ./app/connector
COPY app/server ./app/server
COPY packages ./packages
RUN bun install --frozen-lockfile --ignore-scripts --filter @jai/server --filter @jayden/jai-cli
RUN cd app/server && bun run build
RUN cd app/cli && bun run build
RUN mkdir -p /opt/jai/cli /opt/jai/node_modules/@jai/server
RUN cp app/cli/dist/main.js /opt/jai/cli/main.js
RUN cp app/server/package.json /opt/jai/node_modules/@jai/server/package.json
RUN cp -R app/server/dist /opt/jai/node_modules/@jai/server/dist

FROM oven/bun:1.4.0-debian AS runtime
COPY --from=build /opt/jai /opt/jai
`;
}

export function gatewayDockerfile(): string {
	return `FROM node:22-alpine
WORKDIR /srv
COPY gateway.mjs /srv/gateway.mjs
USER node
EXPOSE ${gatewayContainerPort}
CMD ["node", "/srv/gateway.mjs"]
`;
}

export function taskDockerfile(): string {
	return `ARG JAI_RUNTIME_IMAGE
ARG TASK_IMAGE
FROM \${JAI_RUNTIME_IMAGE} AS jai_runtime
FROM \${TASK_IMAGE}
COPY --from=jai_runtime /opt/jai /opt/jai
COPY --from=jai_runtime /usr/local/bin/bun /opt/jai/bun
COPY bootstrap.mjs /opt/jai/bootstrap.mjs
COPY idle.mjs /opt/jai/idle.mjs
ENTRYPOINT []
CMD ["/opt/jai/bun", "/opt/jai/idle.mjs"]
`;
}

export function gatewayProgram(): string {
	return `import { createServer } from "node:http";

const port = Number(process.env.JAI_GATEWAY_PORT ?? "${gatewayContainerPort}");
const upstream = new URL(required("JAI_GATEWAY_UPSTREAM_URL"));
const expectedModel = required("JAI_GATEWAY_MODEL");
const authentication = required("JAI_GATEWAY_AUTHENTICATION");
const apiKey = process.env.JAI_GATEWAY_API_KEY;
const expectedPrefix = normalizedPath(upstream.pathname);

const server = createServer(async (request, response) => {
  if (request.url === "/__jai/health" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.method !== "POST" || !request.url || !request.url.startsWith(expectedPrefix)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end('{"error":"gateway route denied"}');
    return;
  }
  try {
    const body = await readJson(request);
    if (body.model !== expectedModel) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end('{"error":"gateway model denied"}');
      return;
    }
    body.model = expectedModel;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string" && !["authorization", "x-api-key", "host", "content-length"].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    headers.set("content-type", "application/json");
    if (authentication === "api-key") {
      if (!apiKey) throw new Error("Gateway API key is unavailable");
      if (process.env.JAI_GATEWAY_ADAPTER === "anthropic") headers.set("x-api-key", apiKey);
      else headers.set("authorization", "Bearer " + apiKey);
    }
    const target = new URL(request.url, upstream.origin);
    const upstreamResponse = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      duplex: "half",
    });
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("connection");
    responseHeaders.delete("transfer-encoding");
    response.writeHead(upstreamResponse.status, Object.fromEntries(responseHeaders));
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    for await (const chunk of upstreamResponse.body) response.write(chunk);
    response.end();
  } catch {
    response.writeHead(502, { "content-type": "application/json" });
    response.end('{"error":"gateway upstream unavailable"}');
  }
});

server.listen(port, "0.0.0.0");

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error("Missing gateway configuration");
  return value;
}

function normalizedPath(value) {
  const path = value === "/" ? "" : value.replace(/\\/$/, "");
  return path || "/";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.model !== "string") {
    throw new Error("Invalid model request");
  }
  return parsed;
}
`;
}

export function taskBootstrapProgram(): string {
	return `import { connectDesktopConfigurationClient } from "@jai/server/desktop-configuration-client";

const adapter = required("JAI_FRONTIER_PROVIDER_ADAPTER");
const remoteModelId = required("JAI_FRONTIER_REMOTE_MODEL");
const gatewayBaseUrl = required("JAI_FRONTIER_GATEWAY_BASE_URL");
const maxTurns = Number(required("JAI_FRONTIER_MAX_TURNS"));
if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("Invalid JAI_FRONTIER_MAX_TURNS");

const connected = await connectDesktopConfigurationClient();
if (connected.isErr()) throw new Error("Could not open the local runtime configuration channel");
try {
  const saved = await connected.value.save({
    revision: null,
    model: "gateway/" + remoteModelId,
    maxTurns,
    providers: [{
      id: "gateway",
      name: "Frontier internal gateway",
      adapter,
      baseURL: gatewayBaseUrl,
      authentication: "none",
      enabled: true,
      models: [{ id: remoteModelId, enabled: true }],
    }],
  });
  if (saved.isErr()) throw new Error("Could not save the isolated runtime configuration: " + saved.error.message);
  const trusted = await connected.value.setWorkspaceTrust("/app", true);
  if (trusted.isErr()) throw new Error("Could not trust the isolated task workspace: " + trusted.error.message);
} finally {
  await connected.value.close();
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error("Missing Frontier runtime configuration");
  return value;
}
`;
}

export function idleProgram(): string {
	return "setInterval(() => {}, 2 ** 31 - 1);\n";
}

export function taskGatewayBaseUrl(model: GatewayModelSource): string {
	const upstream = new URL(model.upstreamBaseUrl);
	const path = upstream.pathname === "/" ? "" : upstream.pathname.replace(/\/$/, "");
	return `http://${gatewayNetworkAlias}:${gatewayContainerPort}${path}`;
}
