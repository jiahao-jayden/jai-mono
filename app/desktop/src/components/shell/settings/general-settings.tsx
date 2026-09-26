import type { ReactNode } from "react";
import { useState } from "react";
import { useIntl } from "react-intl";
import { useDesktopLocale } from "@/i18n/locale";
import { desktopMessages } from "@/i18n/messages";
import { useThemeStore } from "@/stores/theme";
import { type DesktopProviderProfile, isDesktopProviderModelRunnable } from "../../../../shared/desktop-rpc";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";

/** Model refs are always `profile/model`, so this value cannot collide with one. */
const FOLLOW_SESSION_MODEL = "follow-session";

interface GeneralSettingsProps {
	readonly maxIterations: string;
	readonly onMaxIterationsChange: (value: string) => void;
	/** Saved profiles; only their enabled, runnable models can review permissions. */
	readonly profiles: readonly DesktopProviderProfile[];
	/** Absent follows the Session model. */
	readonly auxiliaryModelRef: string | undefined;
	readonly onAuxiliaryModelChange: (modelRef: string | undefined) => void;
}

export function GeneralSettings({
	maxIterations,
	onMaxIterationsChange,
	profiles,
	auxiliaryModelRef,
	onAuxiliaryModelChange,
}: GeneralSettingsProps) {
	const intl = useIntl();
	const { preference, setPreference } = useDesktopLocale();
	const theme = useThemeStore((s) => s.theme);
	const setTheme = useThemeStore((s) => s.setTheme);
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
	const onThemeChange = (value: string) => {
		if (value === "light" || value === "dark" || value === "system") setTheme(value);
	};
	const auxiliaryModels = profiles.flatMap((profile) =>
		profile.models
			.filter((model) => model.enabled && isDesktopProviderModelRunnable(model))
			.map((model) => ({ ref: `${profile.id}/${model.remoteModelId}`, label: `${profile.name} · ${model.name}` })),
	);
	const auxiliaryModelUnavailable =
		auxiliaryModelRef !== undefined && !auxiliaryModels.some((model) => model.ref === auxiliaryModelRef);

	return (
		<div className="px-8 py-6">
			<h2 className="text-[14px] font-medium">{intl.formatMessage(desktopMessages.settingsAgentDefaults)}</h2>

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

				<SettingsRow
					label={intl.formatMessage(desktopMessages.settingsTheme)}
					description={intl.formatMessage(desktopMessages.settingsThemeDescription)}
				>
					<Select value={theme} onValueChange={onThemeChange}>
						<SelectTrigger className="w-48" aria-label={intl.formatMessage(desktopMessages.settingsTheme)} />
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value="system">
									{intl.formatMessage(desktopMessages.settingsFollowSystem)}
								</SelectItem>
								<SelectItem index={1} value="light">
									{intl.formatMessage(desktopMessages.settingsLight)}
								</SelectItem>
								<SelectItem index={2} value="dark">
									{intl.formatMessage(desktopMessages.settingsDark)}
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</SettingsRow>

				<SettingsRow
					label={intl.formatMessage(desktopMessages.settingsAuxiliaryModel)}
					description={intl.formatMessage(desktopMessages.settingsAuxiliaryModelDescription)}
				>
					<Select
						value={auxiliaryModelRef ?? FOLLOW_SESSION_MODEL}
						onValueChange={(value) => onAuxiliaryModelChange(value === FOLLOW_SESSION_MODEL ? undefined : value)}
					>
						<SelectTrigger
							className="w-48"
							aria-label={intl.formatMessage(desktopMessages.settingsAuxiliaryModel)}
						/>
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value={FOLLOW_SESSION_MODEL}>
									{intl.formatMessage(desktopMessages.settingsAuxiliaryModelFollowSession)}
								</SelectItem>
								{auxiliaryModels.map((model, position) => (
									<SelectItem key={model.ref} index={position + 1} value={model.ref}>
										{model.label}
									</SelectItem>
								))}
								{auxiliaryModelUnavailable ? (
									<SelectItem index={auxiliaryModels.length + 1} value={auxiliaryModelRef}>
										{intl.formatMessage(desktopMessages.settingsAuxiliaryModelUnavailable, {
											model: auxiliaryModelRef,
										})}
									</SelectItem>
								) : null}
							</SelectGroup>
						</SelectContent>
					</Select>
					{auxiliaryModelUnavailable ? (
						<p className="mt-1 text-[11px] text-destructive" role="alert">
							{intl.formatMessage(desktopMessages.settingsAuxiliaryModelUnavailableHint)}
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
