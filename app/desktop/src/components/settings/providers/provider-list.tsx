import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { BrandAvatar, resolveProviderIcon } from "@/components/common/provider-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
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
		<aside className="flex w-56 shrink-0 flex-col border-r border-border/35 bg-sidebar/40">
			<ScrollArea className="flex-1">
				<div className="space-y-4 px-3 pt-4 pb-3">
					<SectionLabel>Built-in</SectionLabel>
					<ul className="space-y-px">
						{BUILTIN_PROVIDERS.map((bp) => {
							const active = isProviderActive(providers, bp.id);
							const resolved = resolveProviderIcon(bp.id);
							return (
								<li key={bp.id}>
									<ProviderRow
										label={bp.name}
										icon={resolved?.icon ?? null}
										active={active}
										selected={selectedId === bp.id}
										onSelect={() => onSelect(bp.id)}
									/>
								</li>
							);
						})}
					</ul>

					{customIds.length > 0 && (
						<>
							<SectionLabel>Custom</SectionLabel>
							<ul className="space-y-px">
								{customIds.map((id) => {
									const active = isProviderActive(providers, id);
									const resolved = resolveProviderIcon(id);
									return (
										<li key={id}>
											<ProviderRow
												label={id}
												icon={resolved?.icon ?? null}
												active={active}
												selected={selectedId === id}
												onSelect={() => onSelect(id)}
											/>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</div>
			</ScrollArea>

			<div className="shrink-0 border-t border-border/35 p-2.5">
				<button
					type="button"
					onClick={onAddCustom}
					className="group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] text-muted-foreground/70 transition-colors hover:bg-card/70 hover:text-foreground"
				>
					<span className="inline-flex size-5 items-center justify-center rounded-md bg-card ring-1 ring-border/45 transition-colors group-hover:ring-primary-2/40">
						<HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
					</span>
					Add custom provider
				</button>
			</div>
		</aside>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/50">{children}</p>
	);
}

function ProviderRow({
	label,
	icon,
	active,
	selected,
	onSelect,
}: {
	label: string;
	icon: React.ComponentType<{ size?: number; className?: string }> | null;
	active: boolean;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-all duration-150",
				selected
					? "bg-card text-foreground font-medium ring-1 ring-border/50"
					: "text-muted-foreground/80 hover:bg-card/60 hover:text-foreground",
			)}
		>
			<BrandAvatar icon={icon} size={18} />
			<span className="flex-1 truncate text-left">{label}</span>
			<StatusDot active={active} />
		</button>
	);
}

function StatusDot({ active }: { active: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				"size-1.5 shrink-0 rounded-full transition-colors",
				active ? "bg-primary-2" : "bg-muted-foreground/20",
			)}
		/>
	);
}
