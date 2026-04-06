import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Info, Layers, Settings2 } from "lucide-react";
import { useState } from "react";
import { gateway } from "@/lib/gateway-client";
import { cn } from "@/lib/utils";
import { Titlebar } from "../shell/titlebar";
import type { ModelInfo } from "@/types/chat";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const navItems = [
	{ id: "general", label: "通用", icon: Settings2 },
	{ id: "model", label: "模型", icon: Layers },
	{ id: "about", label: "关于", icon: Info },
] as const;

type NavId = (typeof navItems)[number]["id"];

export default function Settings() {
	const [active, setActive] = useState<NavId>("general");
	const { data: config } = useQuery({
		queryKey: ["config"],
		queryFn: () => gateway.getConfig(),
	});

	return (
		<div className="h-svh flex bg-background text-foreground">
			<aside className="w-52 shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border/40">
				<Titlebar />
				<nav className="flex-1 px-3 space-y-px">
					{navItems.map((item) => {
						const Icon = item.icon;
						const isActive = active === item.id;
						return (
							<button
								key={item.id}
								className={cn(
									"w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150",
									isActive
										? "bg-sidebar-accent text-sidebar-foreground font-medium"
										: "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/80",
								)}
								onClick={() => setActive(item.id)}
							>
								<Icon className="size-3.75 shrink-0" strokeWidth={1.5} />
								{item.label}
							</button>
						);
					})}
				</nav>
			</aside>

			<main className="flex-1 flex flex-col overflow-hidden">
				<div className="h-12 shrink-0" style={drag} />
				<div className="flex-1 overflow-y-auto px-8 pb-8">
					{active === "general" && <GeneralPane config={config} />}
					{active === "model" && <ModelPane />}
					{active === "about" && <AboutPane />}
				</div>
			</main>
		</div>
	);
}

function GeneralPane({ config }: { config?: Record<string, unknown> }) {
	const model = config?.model as string | undefined;
	const provider = config?.provider as string | undefined;
	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">
				通用
			</h2>
			<div className="rounded-xl border bg-card divide-y divide-border/60">
				<SettingsRow label="默认模型" value={model ?? "未配置"} />
				<SettingsRow label="Provider" value={provider ?? "未配置"} />
			</div>
			<p className="text-[12px] text-muted-foreground/50 mt-3">
				编辑 ~/.jai/settings.toml 以修改配置
			</p>
		</section>
	);
}

function ModelPane() {
	const { data, isLoading } = useQuery({
		queryKey: ["models"],
		queryFn: () => gateway.getModels(),
	});

	const models: ModelInfo[] = data?.models ?? [];

	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">
				可用模型
			</h2>
			{isLoading ? (
				<p className="text-[13px] text-muted-foreground/50">加载中...</p>
			) : models.length === 0 ? (
				<p className="text-[13px] text-muted-foreground/50">无可用模型</p>
			) : (
				<div className="rounded-xl border bg-card divide-y divide-border/60">
					{models.map((m) => (
						<div
							key={m.id}
							className="flex items-center justify-between px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
						>
							<span className="text-[13px] font-medium">{m.id.split("/").pop()}</span>
							<span className="text-[12px] text-muted-foreground/60 font-mono">
								{m.provider}
							</span>
						</div>
					))}
				</div>
			)}
			<p className="text-[12px] text-muted-foreground/50 mt-3">
				编辑 ~/.jai/settings.toml 以添加或修改模型配置
			</p>
		</section>
	);
}

function AboutPane() {
	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">
				关于
			</h2>
			<div className="rounded-xl border bg-card px-4 py-4">
				<p className="text-base font-semibold tracking-tight">JAI</p>
				<p className="text-[13px] text-muted-foreground mt-0.5">Version 0.0.0</p>
			</div>
		</section>
	);
}

function SettingsRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/30 first:rounded-t-xl last:rounded-b-xl">
			<span className="text-[13px]">{label}</span>
			<div className="flex items-center gap-1 text-[13px] text-muted-foreground">
				<span>{value}</span>
				<ChevronRight className="size-3.5 opacity-30" />
			</div>
		</div>
	);
}
