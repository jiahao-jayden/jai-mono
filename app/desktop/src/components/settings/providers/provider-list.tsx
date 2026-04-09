import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { BrandAvatar, resolveProviderIcon } from "@/components/common/provider-icons";
import { cn } from "@/lib/utils";
import { BUILTIN_IDS, BUILTIN_PROVIDERS } from "./provider-registry";

interface ProviderListProps {
	config?: ConfigResponse;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onAddCustom: () => void;
}

function isProviderActive(providers: Record<string, ProviderSettings> | undefined, id: string): boolean {
	const p = providers?.[id];
	return !!p && p.enabled !== false && !!p.api_key;
}

export function ProviderList({ config, selectedId, onSelect, onAddCustom }: ProviderListProps) {
	const providers = config?.providers ?? {};
	const customIds = Object.keys(providers).filter((id) => !BUILTIN_IDS.has(id));

	return (
		<div className="w-56 shrink-0 flex flex-col border-r border-border/30">
			<div className="p-3 pb-2">
				<Button variant="outline" size="sm" className="w-full gap-1.5 text-[12px]" onClick={onAddCustom}>
					<PlusIcon className="size-3.5" />
					Add Custom Provider
				</Button>
			</div>

			<ScrollArea className="flex-1">
				<div className="px-2 pb-2 space-y-px">
					{BUILTIN_PROVIDERS.map((bp) => {
						const active = isProviderActive(providers, bp.id);
						const resolved = resolveProviderIcon(bp.id);
						return (
							<button
								key={bp.id}
								type="button"
								onClick={() => onSelect(bp.id)}
								className={cn(
									"w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-all duration-150",
									selectedId === bp.id
										? "bg-muted/60 text-foreground font-medium"
										: "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
								)}
							>
								<BrandAvatar icon={resolved?.icon ?? null} size={18} />
								<span className="flex-1 text-left truncate">{bp.name}</span>
								<StatusDot active={active} />
							</button>
						);
					})}

					{customIds.length > 0 && (
						<>
							<Separator className="my-2 opacity-40" />
							{customIds.map((id) => {
								const active = isProviderActive(providers, id);
								const resolved = resolveProviderIcon(id);
								return (
									<button
										key={id}
										type="button"
										onClick={() => onSelect(id)}
										className={cn(
											"w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-all duration-150",
											selectedId === id
												? "bg-muted/60 text-foreground font-medium"
												: "text-muted-foreground hover:bg-muted/30 hover:text-foreground/80",
										)}
									>
										<BrandAvatar icon={resolved?.icon ?? null} size={18} />
										<span className="flex-1 text-left truncate">{id}</span>
										<StatusDot active={active} />
									</button>
								);
							})}
						</>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function StatusDot({ active }: { active: boolean }) {
	return (
		<span
			className={cn(
				"size-2 rounded-full shrink-0 transition-colors",
				active ? "bg-emerald-500" : "bg-muted-foreground/20",
			)}
		/>
	);
}
