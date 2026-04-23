import { InformationCircleIcon, Layers01Icon, PuzzleIcon, Setting07Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { Titlebar } from "../shell/titlebar";
import { AboutPane } from "./about-pane";
import { GeneralPane } from "./general-pane";
import { PluginsPane } from "./plugins/plugins-pane";
import { ProvidersPane } from "./providers/providers-pane";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const navItems = [
	{ id: "general", label: "General", icon: Setting07Icon },
	{ id: "providers", label: "Providers", icon: Layers01Icon },
	{ id: "plugins", label: "Plugins", icon: PuzzleIcon },
	{ id: "about", label: "About", icon: InformationCircleIcon },
] as const;

type NavId = (typeof navItems)[number]["id"];

export default function Settings() {
	const [active, setActive] = useState<NavId>("general");
	const { data: config } = useQuery({
		queryKey: ["config"],
		queryFn: () => gateway.config.get(),
	});

	return (
		<div className="flex h-svh bg-background text-foreground">
			<aside className="flex w-52 shrink-0 flex-col border-r border-sidebar-border/40 bg-sidebar">
				<Titlebar />
				<nav className="flex-1 space-y-px px-3">
					{navItems.map((item) => {
						const isActive = active === item.id;
						return (
							<button
								type="button"
								key={item.id}
								className={cn(
									"group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
									isActive
										? "bg-sidebar-accent text-sidebar-foreground font-medium"
										: "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/85",
								)}
								onClick={() => setActive(item.id)}
							>
								<HugeiconsIcon icon={item.icon} size={15} strokeWidth={1.5} className="shrink-0" />
								<span className="flex-1 text-left">{item.label}</span>
								{isActive && <span aria-hidden className="size-1.5 rounded-full bg-primary-2/80" />}
							</button>
						);
					})}
				</nav>
			</aside>

			<main className="flex flex-1 flex-col overflow-hidden">
				<div className="h-12 shrink-0" style={drag} />
				{active === "providers" ? (
					<div className="flex-1 overflow-hidden">
						<ProvidersPane config={config} />
					</div>
				) : (
					<div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
						{active === "general" && <GeneralPane config={config} />}
						{active === "plugins" && <PluginsPane />}
						{active === "about" && <AboutPane />}
					</div>
				)}
			</main>
		</div>
	);
}
