import type { Model, Provider } from "@jai/ai";

export interface ResolvedDesktopProvider {
	readonly provider: Provider;
	readonly model: Model;
}

export type DesktopMcpServer =
	| {
			readonly name: string;
			readonly type: "stdio";
			readonly command: string;
			readonly args: readonly string[];
			readonly env: Readonly<Record<string, string>>;
			readonly cwd?: string;
	  }
	| {
			readonly name: string;
			readonly type: "streamable-http" | "sse";
			readonly url: string;
			readonly headers: Readonly<Record<string, string>>;
	  };
