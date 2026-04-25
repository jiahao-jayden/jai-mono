import type { PluginMeta, PluginRouteHandler, PluginRouteMethod } from "../types.js";

export type RegisteredApiRoute = {
	plugin: PluginMeta;
	method: PluginRouteMethod;
	/** Plugin-relative path, always starting with `/`. */
	path: string;
	handler: PluginRouteHandler;
};

function normalizePath(path: string): string {
	if (typeof path !== "string" || path.length === 0) {
		throw new Error(`registerApiRoute: path must be a non-empty string, got ${JSON.stringify(path)}`);
	}
	if (!path.startsWith("/")) {
		throw new Error(`registerApiRoute: path must start with "/", got ${JSON.stringify(path)}`);
	}
	if (path.length > 1 && path.endsWith("/")) {
		return path.slice(0, -1);
	}
	return path;
}

/**
 * Process-level registry of plugin-contributed HTTP routes.
 *
 * Indexed by `(plugin name, method, path)`. `path` is the plugin-relative path
 * registered via `PluginBootAPI.registerApiRoute`; the gateway is responsible
 * for stripping the `/api/plugins/<plugin>` prefix before lookup.
 */
export class ApiRouteRegistry {
	private readonly routes: RegisteredApiRoute[] = [];
	private readonly index = new Map<string, RegisteredApiRoute>();

	private key(plugin: string, method: PluginRouteMethod, path: string): string {
		return `${plugin}\u0001${method}\u0001${path}`;
	}

	add(plugin: PluginMeta, method: PluginRouteMethod, path: string, handler: PluginRouteHandler): void {
		const normalized = normalizePath(path);
		const k = this.key(plugin.name, method, normalized);
		if (this.index.has(k)) {
			throw new Error(
				`Plugin "${plugin.name}" already registered ${method} ${normalized}. Each (method, path) pair must be unique.`,
			);
		}
		const entry: RegisteredApiRoute = { plugin, method, path: normalized, handler };
		this.routes.push(entry);
		this.index.set(k, entry);
	}

	/** Look up a registered route by plugin name, method and plugin-relative path. */
	find(pluginName: string, method: PluginRouteMethod, path: string): RegisteredApiRoute | undefined {
		const normalized = normalizePath(path);
		return this.index.get(this.key(pluginName, method, normalized));
	}

	/**
	 * Returns true when *any* method is registered for `(pluginName, path)`.
	 * Used by the gateway to distinguish 404 (no such path) from 405 (method
	 * not allowed).
	 */
	hasPath(pluginName: string, path: string): boolean {
		const normalized = normalizePath(path);
		return this.routes.some((r) => r.plugin.name === pluginName && r.path === normalized);
	}

	list(): readonly RegisteredApiRoute[] {
		return this.routes;
	}

	removeByPlugin(pluginName: string): void {
		for (let i = this.routes.length - 1; i >= 0; i--) {
			if (this.routes[i].plugin.name === pluginName) {
				const r = this.routes[i];
				this.routes.splice(i, 1);
				this.index.delete(this.key(r.plugin.name, r.method, r.path));
			}
		}
	}
}
