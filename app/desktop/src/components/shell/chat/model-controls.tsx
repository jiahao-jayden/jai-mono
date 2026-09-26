import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import {
	type DesktopModelCapabilities,
	type DesktopSessionControls,
	resolveDesktopEffectiveReasoningLevel,
} from "../../../../shared/session-controls";
import { Switch } from "../../ui/switch";
import { ReasoningEffort } from "./reasoning-effort";

interface ModelControlsProps {
	readonly capabilities: DesktopModelCapabilities;
	readonly controls: DesktopSessionControls;
	readonly disabled: boolean;
	onChange(controls: DesktopSessionControls): void;
}

/**
 * Reasoning level and Fast mode for the selected model, offered only where the
 * model supports them. The stored reasoning wish is never rewritten on a model
 * switch; the select shows the level this model will actually receive.
 */
export function ModelControls({ capabilities, controls, disabled, onChange }: ModelControlsProps) {
	const intl = useIntl();
	const levels = capabilities.reasoningLevels;
	if (levels.length === 0 && !capabilities.supportsFastMode) return null;
	const effectiveLevel = resolveDesktopEffectiveReasoningLevel(controls.reasoningLevel, levels);

	return (
		<div className="flex shrink-0 flex-col gap-1 border-t border-border px-4 py-2">
			{levels.length > 0 ? (
				<ReasoningEffort
					levels={levels}
					value={effectiveLevel}
					disabled={disabled}
					onChange={(reasoningLevel) => onChange({ ...controls, reasoningLevel })}
				/>
			) : null}
			{capabilities.supportsFastMode ? (
				<Switch
					label={intl.formatMessage(desktopMessages.fastModeLabel)}
					checked={controls.fastMode}
					disabled={disabled}
					onToggle={() => onChange({ ...controls, fastMode: !controls.fastMode })}
					className="flex-row-reverse justify-between px-0 py-1.5"
				/>
			) : null}
		</div>
	);
}
