import {
	type McpServerConfig,
	McpServerConfigSchema,
	type McpServerInfo,
	type SessionManager,
} from "@jayden/jai-coding-agent";
import { Hono } from "hono";

export type McpStatusResponse = {
	servers: McpServerInfo[];
};

export type McpServersConfigResponse = {
	servers: Record<string, McpServerConfig>;
};

const NAME_RE = /^[a-zA-Z0-9_.-]+$/;

function validateName(name: string): string | null {
	if (!name) return "name is required";
	if (name.length > 64) return "name must be <= 64 characters";
	if (!NAME_RE.test(name)) return "name may only contain letters, digits, '.', '-', '_'";
	return null;
}

export function mcpRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/mcp/status", (c) => {
		const servers = manager.listMcpStatus();
		return c.json<McpStatusResponse>({ servers });
	});

	app.post("/mcp/reload", async (c) => {
		try {
			await manager.reloadMcp();
			const servers = manager.listMcpStatus();
			return c.json<McpStatusResponse>({ servers });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `reload failed: ${message}` }, 500);
		}
	});

	// 列出全局 settings.json 里的 mcpServers 原始配置（UI 编辑回填用）
	app.get("/mcp/servers", (c) => {
		const raw = manager.getSettings().getMcpServers();
		// 经 SettingsSchema 校验过的字段，类型断言安全
		return c.json<McpServersConfigResponse>({ servers: raw as Record<string, McpServerConfig> });
	});

	// 新增/覆盖一个 server，自动 reload，返回最新 status
	app.put("/mcp/servers/:name", async (c) => {
		const name = c.req.param("name");
		const nameErr = validateName(name);
		if (nameErr) return c.json({ error: nameErr }, 400);

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "invalid JSON body" }, 400);
		}

		const parsed = McpServerConfigSchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: "invalid mcp server config", issues: parsed.error.issues },
				400,
			);
		}

		try {
			await manager.getSettings().save({ mcpServers: { [name]: parsed.data } });
			await manager.reloadMcp();
			return c.json<McpStatusResponse>({ servers: manager.listMcpStatus() });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `save failed: ${message}` }, 500);
		}
	});

	app.delete("/mcp/servers/:name", async (c) => {
		const name = c.req.param("name");
		const nameErr = validateName(name);
		if (nameErr) return c.json({ error: nameErr }, 400);

		try {
			await manager.getSettings().deleteMcpServer(name);
			await manager.reloadMcp();
			return c.json<McpStatusResponse>({ servers: manager.listMcpStatus() });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `delete failed: ${message}` }, 500);
		}
	});

	app.get("/mcp/oauth/callback", async (c) => {
		const state = c.req.query("state");
		const code = c.req.query("code");
		const errorParam = c.req.query("error");

		if (errorParam) {
			return c.html(renderError(`Authorization server returned error: ${errorParam}`), 400);
		}
		if (!state || !code) {
			return c.html(renderError("Missing required query parameters: 'state' and 'code'"), 400);
		}

		try {
			const matched = await manager.completeMcpAuth(state, code);
			if (!matched) {
				return c.html(renderError("No pending authorization flow matches this state."), 404);
			}
			return c.html(renderSuccess());
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.html(renderError(message), 500);
		}
	});

	return app;
}

function renderSuccess(): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>MCP authorized</title>
<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px;color:#222}</style>
</head><body>
<h1>Authorization complete</h1>
<p>You can close this tab and return to the app.</p>
<script>setTimeout(() => window.close(), 1500)</script>
</body></html>`;
}

function renderError(message: string): string {
	const safe = message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>MCP authorization failed</title>
<style>body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px;color:#222}.err{color:#b00020}</style>
</head><body>
<h1>Authorization failed</h1>
<p class="err">${safe}</p>
<p>Please return to the app and retry.</p>
</body></html>`;
}
