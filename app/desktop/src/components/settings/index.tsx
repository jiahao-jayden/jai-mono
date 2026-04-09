import { useQuery } from "@tanstack/react-query";
import { InfoIcon, LayersIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { Titlebar } from "../shell/titlebar";
import { AboutPane } from "./about-pane";
import { GeneralPane } from "./general-pane";
import { ProvidersPane } from "./providers/providers-pane";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const navItems = [
	{ id: "general", label: "General", icon: Settings2Icon },
	{ id: "providers", label: "Providers", icon: LayersIcon },
	{ id: "about", label: "About", icon: InfoIcon },
] as const;

type NavId = (typeof navItems)[number]["id"];

export default function Settings() {
	const [active, setActive] = useState<NavId>("general");
	const { data: config } = useQuery({
		queryKey: ["config"],
		queryFn: () => gateway.config.get(),
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
				{active === "providers" ? (
					<div className="flex-1 overflow-hidden">
						<ProvidersPane config={config} />
					</div>
				) : (
					<div className="flex-1 overflow-y-auto px-8 pb-8">
						{active === "general" && <GeneralPane config={config} />}
						{active === "about" && <AboutPane />}
					</div>
				)}
			</main>
		</div>
	);
}
