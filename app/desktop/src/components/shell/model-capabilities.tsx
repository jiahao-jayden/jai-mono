import { useIcon } from "@/lib/icon-context";
import type { DesktopProviderModel } from "../../../shared/desktop-rpc";
import { Tooltip } from "../ui/tooltip";

interface ModelCapabilitiesProps {
	readonly model: Pick<DesktopProviderModel, "toolCall" | "structuredOutput" | "reasoning">;
}

export function ModelCapabilities({ model }: ModelCapabilitiesProps) {
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<CapabilityIcon label="Tools" icon="terminal" value={model.toolCall} />
			<CapabilityIcon label="Structured output" icon="file-code" value={model.structuredOutput} />
			<CapabilityIcon label="Reasoning" icon="brain" value={model.reasoning} />
		</div>
	);
}

function CapabilityIcon({
	label,
	icon,
	value,
}: {
	readonly label: string;
	readonly icon: "terminal" | "file-code" | "brain";
	readonly value: boolean | undefined;
}) {
	const Icon = useIcon(icon);
	const text = value === true ? "Supported" : value === false ? "Unsupported" : "Unknown";

	return (
		<Tooltip content={`${label} · ${text}`} side="top" sideOffset={6}>
			<span
				className={`flex size-6 items-center justify-center rounded-md transition-colors ${
					value === true
						? "text-foreground hover:bg-accent"
						: value === false
							? "text-muted-foreground/45 hover:bg-muted/50"
							: "text-muted-foreground hover:bg-muted/50"
				}`}
				aria-label={`${label}: ${text}`}
				role="img"
			>
				<Icon size={14} strokeWidth={1.6} />
			</span>
		</Tooltip>
	);
}
