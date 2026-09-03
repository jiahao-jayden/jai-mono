import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type {
	DesktopWebSearchConfigInput,
	DesktopWebSearchConfigSnapshot,
	DesktopWebSearchCredentialId,
	DesktopWebSearchJinaInput,
	DesktopWebSearchProviderId,
	DesktopWebSearchProviderInput,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { ApiKeyInput } from "./api-key-input";

const providerLabels: Record<DesktopWebSearchProviderId, string> = {
	exa: "Exa",
	parallel: "Parallel",
	anysearch: "AnySearch",
};

interface WebSearchSettingsProps {
	readonly snapshot: DesktopWebSearchConfigSnapshot;
	readonly value: DesktopWebSearchConfigInput;
	readonly onRevealApiKey: (credentialId: DesktopWebSearchCredentialId) => Promise<string>;
	readonly onChange: (value: DesktopWebSearchConfigInput) => void;
}

export function WebSearchSettings({ snapshot, value, onRevealApiKey, onChange }: WebSearchSettingsProps) {
	const intl = useIntl();
	const providers = snapshot.providers.map((provider) => ({
		...provider,
		...(value.providers.find((candidate) => candidate.id === provider.id) ?? {}),
	}));

	const updateProvider = (
		id: DesktopWebSearchProviderId,
		update: (provider: DesktopWebSearchProviderInput) => DesktopWebSearchProviderInput,
	) => {
		const current = value.providers.find((provider) => provider.id === id) ?? {
			id,
			enabled: false,
		};
		const next = update(current);
		onChange({
			providers: value.providers.some((provider) => provider.id === id)
				? value.providers.map((provider) => (provider.id === id ? next : provider))
				: [...value.providers, next],
		});
	};
	const updateJina = (update: (jina: DesktopWebSearchJinaInput) => DesktopWebSearchJinaInput) => {
		const current = value.fetch?.jina ?? {};
		onChange({ fetch: { jina: update(current) }, providers: value.providers });
	};
	const jinaDraft = value.fetch?.jina;
	const jinaApiKey = jinaDraft?.apiKey ?? "";
	const jinaClearApiKey = jinaDraft?.clearApiKey === true;
	const jinaConfigured = snapshot.fetch.jina.credentialConfigured && !jinaClearApiKey;

	return (
		<div className="px-8 py-6">
			<h2 className="text-base font-semibold">{intl.formatMessage(desktopMessages.settingsWebSearch)}</h2>

			<div className="mt-5 divide-y divide-border/55 border-y border-border/55">
				{providers.map((provider) => {
					const draft = value.providers.find((candidate) => candidate.id === provider.id);
					const enabled = draft?.enabled ?? provider.enabled;
					const order = draft?.order ?? provider.order;
					const apiKey = draft?.apiKey ?? "";
					const clearApiKey = draft?.clearApiKey === true;
					const configured = provider.credentialConfigured && !clearApiKey;
					const label = providerLabels[provider.id];
					return (
						<div key={provider.id} className="flex flex-col gap-3 py-4">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<p className="text-[14px] font-semibold">{label}</p>
									{configured ? (
										<p className="mt-1 text-[12px] text-muted-foreground">
											{intl.formatMessage(desktopMessages.settingsWebSearchConfigured, {
												mask: provider.credentialMask ?? "••••",
											})}
										</p>
									) : null}
								</div>
								<Switch
									label={intl.formatMessage(desktopMessages.settingsWebSearchEnabled)}
									checked={enabled}
									onToggle={() =>
										updateProvider(provider.id, (current) => ({ ...current, enabled: !current.enabled }))
									}
								/>
							</div>

							<div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
								<div className="flex min-w-0 flex-col gap-1.5 text-[12px] text-muted-foreground">
									<span>{intl.formatMessage(desktopMessages.settingsWebSearchApiKey)}</span>
									<ApiKeyInput
										key={`${provider.id}:${provider.credentialMask ?? "new"}`}
										value={apiKey}
										credentialConfigured={configured}
										credentialMask={provider.credentialMask}
										onReveal={() => onRevealApiKey(provider.id)}
										label={`${label} ${intl.formatMessage(desktopMessages.settingsWebSearchApiKey)}`}
										showLabel={intl.formatMessage(desktopMessages.settingsProviderShowApiKey)}
										hideLabel={intl.formatMessage(desktopMessages.settingsProviderHideApiKey)}
										revealErrorLabel={intl.formatMessage(desktopMessages.settingsProviderRevealError)}
										replacementPlaceholder={intl.formatMessage(desktopMessages.settingsWebSearchReplaceKey)}
										enterPlaceholder={intl.formatMessage(desktopMessages.settingsWebSearchEnterKey)}
										onChange={(nextApiKey) =>
											updateProvider(provider.id, (current) => ({
												...current,
												apiKey: nextApiKey,
												clearApiKey: false,
											}))
										}
									/>
								</div>
								<label
									className="flex flex-col gap-1.5 text-[12px] text-muted-foreground"
									htmlFor={`${provider.id}-web-search-order`}
								>
									<span>{intl.formatMessage(desktopMessages.settingsWebSearchOrder)}</span>
									<Input
										id={`${provider.id}-web-search-order`}
										type="number"
										min={1}
										step={1}
										value={order?.toString() ?? ""}
										placeholder={intl.formatMessage(desktopMessages.settingsWebSearchRandom)}
										aria-label={`${label} ${intl.formatMessage(desktopMessages.settingsWebSearchOrder)}`}
										onChange={(event) => {
											const nextOrder = event.target.value ? Number(event.target.value) : undefined;
											updateProvider(provider.id, (current) => ({
												...current,
												...(nextOrder === undefined ? { order: undefined } : { order: nextOrder }),
											}));
										}}
									/>
								</label>
							</div>

							{configured ? (
								<div className="flex justify-end">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() =>
											updateProvider(provider.id, (current) => ({
												...current,
												apiKey: "",
												clearApiKey: true,
											}))
										}
									>
										{intl.formatMessage(desktopMessages.settingsWebSearchClearKey)}
									</Button>
								</div>
							) : null}
						</div>
					);
				})}
			</div>

			<div className="border-b border-border/55 py-4">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<p className="text-[14px] font-semibold">
							{intl.formatMessage(desktopMessages.settingsWebSearchJina)}
						</p>
						{jinaConfigured ? (
							<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
								{intl.formatMessage(desktopMessages.settingsWebSearchJinaConfigured, {
									mask: snapshot.fetch.jina.credentialMask ?? "••••",
								})}
							</p>
						) : null}
					</div>
					<p className="shrink-0 text-[12px] text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsWebSearchJinaPreferred)}
					</p>
				</div>

				<div className="mt-3 flex min-w-0 flex-col gap-1.5 text-[12px] text-muted-foreground">
					<span>{intl.formatMessage(desktopMessages.settingsWebSearchJinaApiKey)}</span>
					<ApiKeyInput
						key={`jina:${snapshot.fetch.jina.credentialMask ?? "new"}`}
						value={jinaApiKey}
						credentialConfigured={jinaConfigured}
						credentialMask={snapshot.fetch.jina.credentialMask}
						onReveal={() => onRevealApiKey("jina")}
						label={intl.formatMessage(desktopMessages.settingsWebSearchJinaApiKey)}
						showLabel={intl.formatMessage(desktopMessages.settingsProviderShowApiKey)}
						hideLabel={intl.formatMessage(desktopMessages.settingsProviderHideApiKey)}
						revealErrorLabel={intl.formatMessage(desktopMessages.settingsProviderRevealError)}
						replacementPlaceholder={intl.formatMessage(desktopMessages.settingsWebSearchJinaReplaceKey)}
						enterPlaceholder={intl.formatMessage(desktopMessages.settingsWebSearchJinaEnterKey)}
						onChange={(nextApiKey) =>
							updateJina((current) => ({ ...current, apiKey: nextApiKey, clearApiKey: false }))
						}
					/>
				</div>

				<div className="mt-1 flex items-start justify-between gap-4">
					<p className="max-w-120 text-[12px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsWebSearchJinaDescription)}
					</p>
					{jinaConfigured ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => updateJina((current) => ({ ...current, apiKey: "", clearApiKey: true }))}
						>
							{intl.formatMessage(desktopMessages.settingsWebSearchJinaClearKey)}
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}
