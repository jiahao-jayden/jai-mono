import { ChevronDown } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ModelItem } from "@/stores/chat";

interface ModelSelectorProps {
	models: ModelItem[];
	currentModelId: string | null;
	onSelect: (modelId: string) => void;
}

export function ModelSelector({ models, currentModelId, onSelect }: ModelSelectorProps) {
	const current = models.find((m) => m.id === currentModelId);
	const label = current?.id.split("/").pop() ?? currentModelId?.split("/").pop() ?? "选择模型";

	if (models.length === 0) {
		return <span className="text-xs text-muted-foreground px-2 py-1 select-none">{label}</span>;
	}

	const grouped = models.reduce<Record<string, ModelItem[]>>((acc, m) => {
		if (!acc[m.provider]) acc[m.provider] = [];
		acc[m.provider].push(m);
		return acc;
	}, {});

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
				>
					<span className="max-w-45 truncate">{label}</span>
					<ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-h-72 overflow-y-auto min-w-52">
				{Object.entries(grouped).map(([provider, providerModels], gi) => (
					<div key={provider}>
						{gi > 0 && <DropdownMenuSeparator />}
						<DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
							{provider}
						</DropdownMenuLabel>
						{providerModels.map((m) => (
							<DropdownMenuItem
								key={m.id}
								onSelect={() => onSelect(m.id)}
								className={cn("text-xs", m.id === currentModelId && "font-medium text-foreground")}
							>
								<span className="truncate">{m.id.split("/").pop()}</span>
								{m.id === currentModelId && <span className="ml-auto text-primary text-[10px]">✓</span>}
							</DropdownMenuItem>
						))}
					</div>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
