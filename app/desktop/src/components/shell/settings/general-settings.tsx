import type { ReactNode } from "react";
import { useState } from "react";
import { useIntl } from "react-intl";
import { useDesktopLocale } from "@/i18n/locale";
import { desktopMessages } from "@/i18n/messages";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";

interface GeneralSettingsProps {
	readonly maxIterations: string;
	readonly reasoningEffort: string;
	readonly onMaxIterationsChange: (value: string) => void;
	readonly onReasoningEffortChange: (value: string) => void;
}

export function GeneralSettings({
	maxIterations,
	reasoningEffort,
	onMaxIterationsChange,
	onReasoningEffortChange,
}: GeneralSettingsProps) {
	const intl = useIntl();
	const { preference, setPreference } = useDesktopLocale();
	const [localeSaving, setLocaleSaving] = useState(false);
	const [localeError, setLocaleError] = useState(false);
	const changeLocale = async (value: string) => {
		if (value !== "system" && value !== "en" && value !== "zh-CN") return;
		if (localeSaving) return;
		setLocaleSaving(true);
		setLocaleError(false);
		try {
			await setPreference(value);
		} catch {
			setLocaleError(true);
		} finally {
			setLocaleSaving(false);
		}
	};

	return (
		<div className="px-8 py-6">
			<h2 className="text-base font-semibold">{intl.formatMessage(desktopMessages.settingsAgentDefaults)}</h2>

			<div className="mt-5 flex flex-col gap-5">
				<SettingsRow
					label={intl.formatMessage(desktopMessages.settingsInterfaceLanguage)}
					description={intl.formatMessage(desktopMessages.settingsInterfaceLanguageDescription)}
				>
					<Select value={preference} onValueChange={(value) => void changeLocale(value)}>
						<SelectTrigger
							className="w-48"
							aria-label={intl.formatMessage(desktopMessages.settingsInterfaceLanguage)}
							aria-busy={localeSaving}
						/>
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value="system">
									{intl.formatMessage(desktopMessages.settingsFollowSystem)}
								</SelectItem>
								<SelectItem index={1} value="en">
									{intl.formatMessage(desktopMessages.settingsEnglish)}
								</SelectItem>
								<SelectItem index={2} value="zh-CN">
									{intl.formatMessage(desktopMessages.settingsChinese)}
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
					{localeError ? (
						<p className="mt-1 text-[11px] text-destructive" role="alert">
							{intl.formatMessage(desktopMessages.settingsLocaleSaveError)}
						</p>
					) : null}
				</SettingsRow>

				<SettingsRow label={intl.formatMessage(desktopMessages.settingsMaxIterations)}>
					<Input
						type="number"
						min={1}
						value={maxIterations}
						onChange={(event) => onMaxIterationsChange(event.target.value)}
						placeholder={intl.formatMessage(desktopMessages.settingsUnlimited)}
						aria-label={intl.formatMessage(desktopMessages.settingsMaxIterations)}
					/>
				</SettingsRow>

				<SettingsRow label={intl.formatMessage(desktopMessages.settingsReasoningEffort)}>
					<Select
						value={reasoningEffort || "none"}
						onValueChange={(value) => onReasoningEffortChange(value === "none" ? "" : value)}
					>
						<SelectTrigger
							className="w-48"
							aria-label={intl.formatMessage(desktopMessages.settingsReasoningEffort)}
						/>
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value="none">
									{intl.formatMessage(desktopMessages.settingsDefault)}
								</SelectItem>
								<SelectItem index={1} value="low">
									{intl.formatMessage(desktopMessages.settingsLow)}
								</SelectItem>
								<SelectItem index={2} value="medium">
									{intl.formatMessage(desktopMessages.settingsMedium)}
								</SelectItem>
								<SelectItem index={3} value="high">
									{intl.formatMessage(desktopMessages.settingsHigh)}
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</SettingsRow>
			</div>
		</div>
	);
}

function SettingsRow({
	label,
	description,
	children,
}: {
	readonly label: string;
	readonly description?: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-6">
			<div className="min-w-0">
				<span className="text-[13.5px] font-medium">{label}</span>
				{description ? (
					<p className="mt-1 max-w-80 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
				) : null}
			</div>
			<div className="w-48 shrink-0">{children}</div>
		</div>
	);
}
