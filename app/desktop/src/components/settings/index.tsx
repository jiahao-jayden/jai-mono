import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Info, Layers, Settings2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { Titlebar } from "../shell/titlebar";

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
		queryFn: () => gateway.config.get(),
	});

	console.log(config);
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
								type="button"
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
					{active === "model" && <ModelPane config={config} />}
					{active === "about" && <AboutPane />}
				</div>
			</main>
		</div>
	);
}

function GeneralPane({ config }: { config?: ConfigResponse }) {
	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">通用</h2>
			<div className="rounded-xl border bg-card divide-y divide-border/60">
				<SettingsRow label="默认模型" value={config?.model ?? "未配置"} />
				<SettingsRow label="Provider" value={config?.provider ?? "未配置"} />
			</div>
			<p className="text-[12px] text-muted-foreground/50 mt-3">编辑 ~/.jai/settings.toml 以修改配置</p>
		</section>
	);
}

function ModelPane({ config }: { config?: ConfigResponse }) {
	const providers = config?.providers ?? {};
	const entries = Object.entries(providers) as [string, ProviderSettings][];

	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">
				Providers & 模型
			</h2>
			{entries.length === 0 ? (
				<p className="text-[13px] text-muted-foreground/50">无配置的 provider，使用默认模型 {config?.model}</p>
			) : (
				<div className="space-y-4">
					{entries.map(([providerId, providerConfig]) => (
						<div key={providerId} className="rounded-xl border bg-card overflow-hidden">
							<div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/40">
								<span className="text-[13px] font-medium">{providerId}</span>
								<span
									className={cn(
										"text-[11px] px-1.5 py-0.5 rounded-md font-mono",
										providerConfig.enabled
											? "bg-emerald-500/10 text-emerald-600"
											: "bg-muted text-muted-foreground/50",
									)}
								>
									{providerConfig.enabled ? "已启用" : "已禁用"}
								</span>
							</div>
							<div className="divide-y divide-border/60">
								{providerConfig.models.map((model) => {
									const modelId = typeof model === "string" ? model : model.id;
									return (
										<div key={modelId} className="flex items-center justify-between px-4 py-3">
											<span className="text-[13px] font-medium">{modelId}</span>
											<span className="text-[12px] text-muted-foreground/60 font-mono">{providerId}</span>
										</div>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}
			<p className="text-[12px] text-muted-foreground/50 mt-3">编辑 ~/.jai/settings.toml 以添加或修改模型配置</p>
		</section>
	);
}

function AboutPane() {
	return (
		<section>
			<h2 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-2.5">关于</h2>
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
