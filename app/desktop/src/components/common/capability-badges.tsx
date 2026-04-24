import {
	AiBrain01Icon,
	EyeIcon,
	HeadphonesIcon,
	Image01Icon,
	Pdf01Icon,
	StructureCheckIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ModelCapabilities } from "@/stores/chat";

const CAPABILITY_DEFS: {
	key: keyof ModelCapabilities;
	icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
	label: string;
	color: string;
}[] = [
	{ key: "reasoning", icon: AiBrain01Icon, label: "Reasoning", color: "text-amber-600" },
	{ key: "toolCall", icon: Wrench01Icon, label: "Tool Use", color: "text-sky-600" },
	{ key: "vision", icon: EyeIcon, label: "Vision", color: "text-emerald-600" },
	{ key: "structuredOutput", icon: StructureCheckIcon, label: "Structured", color: "text-violet-600" },
	{ key: "imageGen", icon: Image01Icon, label: "Image Gen", color: "text-rose-600" },
	{ key: "audio", icon: HeadphonesIcon, label: "Audio", color: "text-cyan-600" },
	{ key: "pdf", icon: Pdf01Icon, label: "PDF", color: "text-orange-600" },
];

export function CapabilityBadges({
	capabilities,
	iconSize = 14,
}: {
	capabilities?: ModelCapabilities;
	iconSize?: number;
}) {
	if (!capabilities) return null;
	const active = CAPABILITY_DEFS.filter((d) => capabilities[d.key]);
	if (active.length === 0) return null;

	return (
		<div className="flex items-center gap-1">
			{active.map((d) => (
				<Tooltip key={d.key}>
					<TooltipTrigger asChild>
						<span className={cn("inline-flex items-center justify-center rounded-md p-0.5", d.color)}>
							<HugeiconsIcon icon={d.icon} size={iconSize} strokeWidth={2} />
						</span>
					</TooltipTrigger>
					<TooltipContent side="top">{d.label}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
