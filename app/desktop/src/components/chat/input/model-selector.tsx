import { ArrowDown01Icon, GridIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { CapabilityBadges } from "@/components/common/capability-badges";
import { BrandAvatar, resolveModelIcon, resolveProviderIcon } from "@/components/common/provider-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ModelItem } from "@/stores/chat";

function ModelAvatar({ model, size = 20 }: { model: ModelItem; size?: number }) {
	const match = resolveModelIcon(model.id);
	return <BrandAvatar icon={match?.icon ?? null} size={size} />;
}

// ── Main Component ──────────────────────────────────────────

interface ModelSelectorProps {
	models: ModelItem[];
	currentModelId: string | null;
	onSelect: (modelId: string) => void;
}

const ALL_PROVIDERS = "__all__";

export function ModelSelector({ models, currentModelId, onSelect }: ModelSelectorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [activeProvider, setActiveProvider] = useState(ALL_PROVIDERS);

	const current = models.find((m) => m.id === currentModelId);
	const triggerLabel = current?.displayName ?? currentModelId?.split("/").pop() ?? "Select model";

	const providers = useMemo(() => {
		const seen = new Map<string, number>();
		for (const m of models) {
			seen.set(m.provider, (seen.get(m.provider) ?? 0) + 1);
		}
		return Array.from(seen.entries()).map(([id, count]) => {
			const resolved = resolveProviderIcon(id);
			return { id, count, icon: resolved?.icon ?? null, brand: resolved?.brand ?? id };
		});
	}, [models]);

	const filtered = useMemo(() => {
		let list = models;
		if (activeProvider !== ALL_PROVIDERS) {
			list = list.filter((m) => m.provider === activeProvider);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter((m) => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
		}
		return list;
	}, [models, activeProvider, search]);

	if (models.length === 0) {
		return <span className="text-xs text-muted-foreground px-2 py-1 select-none">{triggerLabel}</span>;
	}

	const handleSelect = (modelId: string) => {
		onSelect(modelId);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"
				>
					{current && <ModelAvatar model={current} size={12} />}
					<span className="max-w-28 truncate">{triggerLabel}</span>
					<HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} className="shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>

			<PopoverContent
				align="start"
				side="top"
				sideOffset={8}
				className="w-96 p-0 overflow-hidden rounded-md! scrollbar-hidden"
			>
				{/* Search Bar */}
				<div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border/40">
					<HugeiconsIcon
						icon={Search01Icon}
						size={14}
						strokeWidth={2}
						className="shrink-0 text-muted-foreground"
					/>
					<input
						type="text"
						placeholder="Search models..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
						// biome-ignore lint/a11y/noAutofocus: intentional focus on popover open
						autoFocus
					/>
				</div>

				{/* Two-panel body */}
				<div className="flex" style={{ height: 260 }}>
					{/* Provider sidebar */}
					<div className="w-10 shrink-0 border-r border-border/40 py-1">
						<ScrollArea className="h-full scrollbar-hidden">
							<div className="flex flex-col items-center gap-0.5 px-0.5">
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												onClick={() => setActiveProvider(ALL_PROVIDERS)}
												className={cn(
													"flex items-center justify-center size-7 rounded-md transition-colors",
													activeProvider === ALL_PROVIDERS
														? "bg-accent text-foreground"
														: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
												)}
											>
												<HugeiconsIcon icon={GridIcon} size={14} strokeWidth={1.5} />
											</button>
										</TooltipTrigger>
										<TooltipContent side="right">All Providers</TooltipContent>
									</Tooltip>
								</TooltipProvider>

								<div className="w-4 h-px bg-border/40 my-0.5" />

								{providers.map((p) => (
									<TooltipProvider key={p.id}>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={() => setActiveProvider(activeProvider === p.id ? ALL_PROVIDERS : p.id)}
													className={cn(
														"flex items-center justify-center size-7 rounded-md transition-colors",
														activeProvider === p.id
															? "bg-accent text-foreground"
															: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
													)}
												>
													<BrandAvatar icon={p.icon} size={15} />
												</button>
											</TooltipTrigger>
											<TooltipContent side="right">
												{p.brand}
												<span className="ml-1 text-muted-foreground">({p.count})</span>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								))}
							</div>
						</ScrollArea>
					</div>

					{/* Model list */}
					<ScrollArea className="flex-1">
						<div className="py-0.5 px-0.5">
							{filtered.length === 0 && (
								<div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
									No models found
								</div>
							)}

							{filtered.map((m) => {
								const isSelected = m.id === currentModelId;
								return (
									<button
										key={m.id}
										type="button"
										onClick={() => handleSelect(m.id)}
										className={cn(
											"w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors",
											isSelected ? "bg-accent/80" : "hover:bg-accent/50",
										)}
									>
										<ModelAvatar model={m} size={16} />
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1.5">
												<span
													className={cn(
														"text-xs truncate",
														isSelected
															? "font-semibold text-foreground"
															: "font-medium text-foreground/90",
													)}
												>
													{m.displayName}
												</span>
												<CapabilityBadges capabilities={m.capabilities} />
											</div>
											<span className="text-[10px] text-muted-foreground/60 truncate block leading-tight">
												{m.provider}
											</span>
										</div>
										{isSelected && (
											<HugeiconsIcon
												icon={Tick02Icon}
												size={14}
												strokeWidth={2}
												className="shrink-0 text-foreground"
											/>
										)}
									</button>
								);
							})}
						</div>
					</ScrollArea>
				</div>
			</PopoverContent>
		</Popover>
	);
}
