import { type IntlShape, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopProviderModel } from "../../../shared/desktop-rpc";
import { Tooltip } from "../ui/tooltip";

interface ModelCapabilitiesProps {
	readonly model: Pick<DesktopProviderModel, "toolCall" | "structuredOutput" | "reasoning">;
}

export function ModelCapabilities({ model }: ModelCapabilitiesProps) {
	const intl = useIntl();
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<CapabilityIcon
				label={intl.formatMessage(desktopMessages.modelTools)}
				icon="terminal"
				value={model.toolCall}
				intl={intl}
			/>
			<CapabilityIcon
				label={intl.formatMessage(desktopMessages.modelStructuredOutput)}
				icon="file-code"
				value={model.structuredOutput}
				intl={intl}
			/>
			<CapabilityIcon
				label={intl.formatMessage(desktopMessages.modelReasoning)}
				icon="brain"
				value={model.reasoning}
				intl={intl}
			/>
		</div>
	);
}

function CapabilityIcon({
	label,
	icon,
	value,
	intl,
}: {
	readonly label: string;
	readonly icon: "terminal" | "file-code" | "brain";
	readonly value: boolean | undefined;
	readonly intl: IntlShape;
}) {
	const Icon = useIcon(icon);
	const text = intl.formatMessage(
		value === true
			? desktopMessages.modelCapabilitySupported
			: value === false
				? desktopMessages.modelCapabilityUnsupported
				: desktopMessages.modelCapabilityUnknown,
	);
	const tooltip = intl.formatMessage(desktopMessages.modelCapabilityTooltip, { label, text });
	const ariaLabel = intl.formatMessage(desktopMessages.modelCapabilityAria, { label, text });

	return (
		<Tooltip content={tooltip} side="top" sideOffset={6}>
			<span
				className={cn(
					"flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground",
					value === false && "text-muted-foreground/45",
				)}
				aria-label={ariaLabel}
				role="img"
			>
				<Icon size={13} strokeWidth={1.5} />
			</span>
		</Tooltip>
	);
}
