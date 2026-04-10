export type Theme = "light" | "dark" | "system";

export interface RpcSchema {
	window: {
		close(): void;
		minimize(): void;
		fullscreen(): void;
		titlebarDblClick(): void;
		openSettings(): void;
	};
	theme: {
		get(): Theme;
		set(theme: Theme): void;
	};
	gateway: {
		info(): { port: number; baseURL: string; ready: boolean };
	};
}

export interface EventSchema {
	"theme:changed": [theme: Theme];
}
