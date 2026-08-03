import { useState } from "react";
import { useIcon, useIcons } from "@/lib/icon-context";
import type {
	DesktopProviderAdapter,
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderModel,
	DesktopProviderProfile,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";

interface ProviderSettingsDialogProps {
	readonly open: boolean;
	readonly snapshot?: DesktopProviderConfigSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<void>;
}

interface ProfileDraft extends DesktopProviderProfile {
	apiKey: string;
	clearApiKey: boolean;
	models: DesktopProviderModel[];
}

type SettingsCategory = "general" | "providers";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function ProviderSettingsDialog({
	open,
	snapshot,
	loading,
	loadError,
	onOpenChange,
	onRetry,
	onSave,
}: ProviderSettingsDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="lg"
				className="max-h-[min(720px,calc(100vh-48px))] max-w-190 overflow-hidden bg-background p-0"
			>
				{snapshot ? (
					<ProviderConfigForm key={formKey(snapshot)} snapshot={snapshot} onSave={onSave} />
				) : (
					<ProviderLoadState loading={loading} error={loadError} onRetry={onRetry} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function formKey(snapshot: DesktopProviderConfigSnapshot): string {
	return `${snapshot.revision ?? "new"}:${snapshot.profiles
		.map(
			(profile) =>
				`${profile.id}:${profile.models.map((model) => `${model.source ?? "local"}:${model.id}`).join(",")}`,
		)
		.join("|")}`;
}

function ProviderLoadState({
	loading,
	error,
	onRetry,
}: {
	readonly loading: boolean;
	readonly error: boolean;
	readonly onRetry: () => void;
}) {
	const SettingsIcon = useIcon("settings");

	return (
		<div className="flex min-h-80 flex-col">
			<DialogHeader className="border-b border-border px-6 py-5">
				<DialogTitle>Settings</DialogTitle>
			</DialogHeader>
			<div className="flex flex-1 items-center justify-center px-6 text-center">
				<div>
					<SettingsIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
					<p className="text-[14px] font-semibold">{loading ? "Loading settings…" : "Settings unavailable"}</p>
				</div>
			</div>
			{error ? (
				<DialogFooter className="border-t border-border px-6 py-4">
					<Button type="button" variant="tertiary" onClick={onRetry}>
						Retry
					</Button>
				</DialogFooter>
			) : null}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                              Settings Shell                                */
/* -------------------------------------------------------------------------- */

function ProviderConfigForm({
	snapshot,
	onSave,
}: {
	readonly snapshot: DesktopProviderConfigSnapshot;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<void>;
}) {
	const icons = useIcons();
	const [category, setCategory] = useState<SettingsCategory>("general");
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [activeModelRef, setActiveModelRef] = useState(snapshot.activeModelRef ?? "");
	const [language, setLanguage] = useState(snapshot.language ?? "");
	const [maxIterations, setMaxIterations] = useState(snapshot.maxIterations?.toString() ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(snapshot.reasoningEffort ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const canSave = profiles.length > 0 || snapshot.profiles.length > 0;

	const submit = async () => {
		const validationError = validateDraft(profiles, activeModelRef, language, maxIterations);
		if (validationError) {
			setError(validationError);
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			await onSave({
				revision: snapshot.revision,
				...(activeModelRef ? { activeModelRef } : {}),
				...(language ? { language } : {}),
				...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
				...(reasoningEffort ? { reasoningEffort: reasoningEffort as "low" | "medium" | "high" } : {}),
				profiles: profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => ({
					id: profile.id,
					name: profile.name,
					adapter: profile.adapter,
					...(profile.catalogProvider ? { catalogProvider: profile.catalogProvider } : {}),
					baseURL: profile.baseURL,
					authentication: profile.authentication,
					...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
					...(profile.clearApiKey ? { clearApiKey: true } : {}),
					models: profile.models,
				})),
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "配置未保存，请重试。");
		} finally {
			setSaving(false);
		}
	};

	const categories: { id: SettingsCategory; label: string; icon: keyof typeof icons }[] = [
		{ id: "general", label: "General", icon: "settings" },
		{ id: "providers", label: "Providers", icon: "key" },
	];

	return (
		<form
			className="flex max-h-[min(720px,calc(100vh-48px))] min-h-140 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<DialogHeader className="border-b border-border px-6 py-5">
				<DialogTitle>Settings</DialogTitle>
			</DialogHeader>

			<div className="flex min-h-0 flex-1">
				{/* Category sidebar */}
				<nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-3" aria-label="Settings">
					{categories.map((cat) => {
						const Icon = icons[cat.icon];
						return (
							<Button
								type="button"
								variant="ghost"
								size="md"
								key={cat.id}
								onClick={() => setCategory(cat.id)}
								active={category === cat.id}
								aria-current={category === cat.id ? "page" : undefined}
								className={`h-auto w-full justify-start gap-2.5 px-3 py-2 text-left text-[13.5px] ${
									category === cat.id ? "font-semibold" : "text-muted-foreground"
								}`}
							>
								<Icon className="size-4 shrink-0" />
								{cat.label}
							</Button>
						);
					})}
				</nav>

				{/* Content area */}
				<div className="min-w-0 flex-1 overflow-y-auto">
					{category === "general" ? (
						<GeneralSettings
							language={language}
							maxIterations={maxIterations}
							reasoningEffort={reasoningEffort}
							onLanguageChange={setLanguage}
							onMaxIterationsChange={setMaxIterations}
							onReasoningEffortChange={setReasoningEffort}
						/>
					) : (
						<ProvidersSettings
							profiles={profiles}
							selectedProfileId={selectedProfileId}
							activeModelRef={activeModelRef}
							onProfilesChange={setProfiles}
							onSelectedProfileChange={setSelectedProfileId}
							onActiveModelChange={setActiveModelRef}
						/>
					)}
				</div>
			</div>

			<DialogFooter className="items-center border-t border-border px-6 py-4">
				{error ? (
					<p className="mr-auto max-w-115 text-[12px] leading-relaxed text-destructive" role="alert">
						{error}
					</p>
				) : null}
				<Button type="submit" loading={saving} disabled={!canSave}>
					Save
				</Button>
			</DialogFooter>
		</form>
	);
}

/* -------------------------------------------------------------------------- */
/*                             General Settings                               */
/* -------------------------------------------------------------------------- */

function GeneralSettings({
	language,
	maxIterations,
	reasoningEffort,
	onLanguageChange,
	onMaxIterationsChange,
	onReasoningEffortChange,
}: {
	readonly language: string;
	readonly maxIterations: string;
	readonly reasoningEffort: string;
	readonly onLanguageChange: (value: string) => void;
	readonly onMaxIterationsChange: (value: string) => void;
	readonly onReasoningEffortChange: (value: string) => void;
}) {
	return (
		<div className="px-8 py-6">
			<h2 className="text-[15px] font-semibold">Agent Defaults</h2>

			<div className="mt-5 flex flex-col gap-5">
				<SettingsRow label="Response language">
					<input
						value={language}
						onChange={(event) => onLanguageChange(event.target.value)}
						placeholder="zh-CN"
						className={settingsInputClassName}
						aria-label="Response language"
						autoComplete="off"
					/>
				</SettingsRow>

				<SettingsRow label="Max iterations">
					<input
						type="number"
						min={1}
						value={maxIterations}
						onChange={(event) => onMaxIterationsChange(event.target.value)}
						placeholder="Unlimited"
						className={settingsInputClassName}
						aria-label="Max iterations"
					/>
				</SettingsRow>

				<SettingsRow label="Reasoning effort">
					<Select
						value={reasoningEffort || "none"}
						onValueChange={(value) => onReasoningEffortChange(value === "none" ? "" : value)}
					>
						<SelectTrigger className="w-48" aria-label="Reasoning effort" />
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value="none">
									Default
								</SelectItem>
								<SelectItem index={1} value="low">
									Low
								</SelectItem>
								<SelectItem index={2} value="medium">
									Medium
								</SelectItem>
								<SelectItem index={3} value="high">
									High
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</SettingsRow>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                            Providers Settings                              */
/* -------------------------------------------------------------------------- */

function ProvidersSettings({
	profiles,
	selectedProfileId,
	activeModelRef,
	onProfilesChange,
	onSelectedProfileChange,
	onActiveModelChange,
}: {
	readonly profiles: ProfileDraft[];
	readonly selectedProfileId: string;
	readonly activeModelRef: string;
	readonly onProfilesChange: (profiles: ProfileDraft[]) => void;
	readonly onSelectedProfileChange: (id: string) => void;
	readonly onActiveModelChange: (ref: string) => void;
}) {
	const KeyIcon = useIcon("key");
	const PlusIcon = useIcon("plus");
	const TrashIcon = useIcon("trash");
	const selectedIndex = profiles.findIndex((profile) => profile.id === selectedProfileId);
	const selected = profiles[selectedIndex];

	const updateSelected = (update: (profile: ProfileDraft) => ProfileDraft) => {
		if (selectedIndex < 0) return;
		onProfilesChange(profiles.map((profile, index) => (index === selectedIndex ? update(profile) : profile)));
	};

	const addProfile = () => {
		const id = uniqueProfileId(profiles, "provider");
		const profile: ProfileDraft = {
			id,
			name: "New provider",
			adapter: "openai-compatible",
			baseURL: "",
			authentication: "api-key",
			credentialConfigured: false,
			models: [],
			apiKey: "",
			clearApiKey: false,
		};
		onProfilesChange([...profiles, profile]);
		onSelectedProfileChange(id);
	};

	const removeSelected = () => {
		if (!selected) return;
		const removedPrefix = `${selected.id}/`;
		const nextProfiles = profiles.filter((_, index) => index !== selectedIndex);
		onProfilesChange(nextProfiles);
		onSelectedProfileChange(nextProfiles[Math.min(selectedIndex, nextProfiles.length - 1)]?.id ?? "");
		if (activeModelRef.startsWith(removedPrefix)) onActiveModelChange("");
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Provider tab bar */}
			<div className="flex items-center gap-1 border-b border-border px-6 pt-3 pb-0">
				<div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
					{profiles.map((profile) => (
						<Button
							type="button"
							variant="ghost"
							size="md"
							key={profile.id}
							onClick={() => onSelectedProfileChange(profile.id)}
							className={`relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 pb-2.5 pt-2 text-[13px] transition-colors ${
								profile.id === selectedProfileId
									? "font-medium text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<span
								className={`size-1.5 shrink-0 rounded-full ${
									profile.authentication === "none" || profile.credentialConfigured || profile.apiKey
										? "bg-primary-2"
										: "bg-muted-foreground/30"
								}`}
							/>
							<span className="max-w-28 truncate">{profile.name}</span>
						</Button>
					))}
				</div>
				<Button type="button" variant="ghost" size="icon-sm" onClick={addProfile} title="Add provider">
					<PlusIcon />
				</Button>
			</div>

			{/* Provider content */}
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				{selected ? (
					<div className="flex flex-col gap-5">
						<section className="flex flex-col gap-4">
							<div className="flex items-center justify-between">
								<h3 className="text-[14px] font-semibold">Connection</h3>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={removeSelected}
									aria-label={`Delete ${selected.name}`}
									title="Delete provider"
								>
									<TrashIcon />
								</Button>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Profile name">
									<input
										value={selected.name}
										onChange={(event) =>
											updateSelected((profile) => ({ ...profile, name: event.target.value }))
										}
										className={inputClassName}
										aria-label="Profile name"
										autoComplete="off"
									/>
								</Field>
								<Field label="Profile ID">
									<input
										value={selected.id}
										onChange={(event) => {
											const nextId = event.target.value;
											const previousPrefix = `${selected.id}/`;
											updateSelected((profile) => ({ ...profile, id: nextId }));
											onSelectedProfileChange(nextId);
											if (activeModelRef.startsWith(previousPrefix)) {
												onActiveModelChange(`${nextId}/${activeModelRef.slice(previousPrefix.length)}`);
											}
										}}
										className={inputClassName}
										aria-label="Profile ID"
										autoComplete="off"
										spellCheck={false}
									/>
								</Field>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Adapter">
									<Select
										value={selected.adapter}
										onValueChange={(adapter) =>
											updateSelected((profile) => ({
												...profile,
												adapter: adapter as DesktopProviderAdapter,
												authentication: adapter === "anthropic" ? "api-key" : profile.authentication,
											}))
										}
									>
										<SelectTrigger className="w-full" aria-label="Adapter" />
										<SelectContent>
											<SelectGroup>
												<SelectItem index={0} value="openai-compatible">
													OpenAI compatible
												</SelectItem>
												<SelectItem index={1} value="anthropic">
													Anthropic Messages
												</SelectItem>
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>
								<Field label="Models.dev provider">
									<input
										value={selected.catalogProvider ?? ""}
										onChange={(event) =>
											updateSelected((profile) => ({
												...profile,
												catalogProvider: event.target.value,
											}))
										}
										placeholder="openai"
										className={inputClassName}
										aria-label="Models.dev provider"
										autoComplete="off"
										spellCheck={false}
									/>
								</Field>
							</div>
							<Field label="Endpoint">
								<input
									type="url"
									value={selected.baseURL}
									onChange={(event) =>
										updateSelected((profile) => ({ ...profile, baseURL: event.target.value }))
									}
									placeholder="https://…"
									className={inputClassName}
									aria-label="Endpoint"
									autoComplete="url"
									spellCheck={false}
								/>
							</Field>
						</section>

						<section className="flex flex-col gap-3 border-t border-border pt-4">
							<h3 className="text-[14px] font-semibold">Credential</h3>
							{selected.adapter === "openai-compatible" ? (
								<label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
									<input
										type="checkbox"
										checked={selected.authentication === "none"}
										onChange={(event) =>
											updateSelected((profile) => ({
												...profile,
												authentication: event.target.checked ? "none" : "api-key",
												clearApiKey: event.target.checked,
											}))
										}
										className="accent-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35 focus-visible:ring-offset-2"
									/>
									This endpoint does not require authentication
								</label>
							) : null}
							{selected.authentication === "api-key" ? (
								<Field label="API key">
									<div className="relative">
										<KeyIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
										<input
											type="password"
											value={selected.apiKey}
											onChange={(event) =>
												updateSelected((profile) => ({
													...profile,
													apiKey: event.target.value,
													clearApiKey: false,
												}))
											}
											placeholder={selected.credentialMask ?? "Enter API key"}
											className={`${inputClassName} pl-10`}
											aria-label="API key"
											autoComplete="new-password"
										/>
									</div>
								</Field>
							) : null}
						</section>

						<ModelEditor
							profile={selected}
							activeModelRef={activeModelRef}
							onActiveModelChange={onActiveModelChange}
							onChange={(models) => updateSelected((profile) => ({ ...profile, models }))}
						/>
					</div>
				) : (
					<div className="flex h-full min-h-72 items-center justify-center text-center">
						<div>
							<KeyIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
							<p className="text-[14px] font-semibold">No Provider yet</p>
							<Button type="button" variant="secondary" size="sm" className="mt-4" onClick={addProfile}>
								Add provider
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                              Model Editor                                  */
/* -------------------------------------------------------------------------- */

function ModelEditor({
	profile,
	activeModelRef,
	onActiveModelChange,
	onChange,
}: {
	readonly profile: ProfileDraft;
	readonly activeModelRef: string;
	readonly onActiveModelChange: (value: string) => void;
	readonly onChange: (models: DesktopProviderModel[]) => void;
}) {
	const PlusIcon = useIcon("plus");
	const TrashIcon = useIcon("trash");
	const addModel = () => {
		const id = uniqueModelId(profile.models, "model");
		onChange([
			...profile.models,
			{
				id,
				name: "New model",
				remoteModelId: id,
				source: "local",
				reasoning: false,
				input: ["text"],
				inputModalities: ["text"],
				outputModalities: ["text"],
				toolCall: false,
				structuredOutput: false,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 4_096,
			},
		]);
		onActiveModelChange(`${profile.id}/${id}`);
	};
	return (
		<section className="flex flex-col gap-3 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="text-[14px] font-semibold">Models</h3>
				</div>
				<Button type="button" variant="ghost" size="sm" onClick={addModel} leadingIcon={PlusIcon}>
					Add model
				</Button>
			</div>
			{profile.models.map((model, index) => {
				const ref = `${profile.id}/${model.id}`;
				const readOnly = model.source === "catalog";
				const input = model.input ?? ["text"];
				const inputModalities = model.inputModalities ?? input;
				const outputModalities = model.outputModalities ?? ["text"];
				return (
					<div key={model.id} className="rounded-lg border border-border/65 p-3">
						<div className="grid grid-cols-[28px_1fr_1fr_1fr_32px] items-end gap-2">
							<label className="flex h-9 items-center justify-center" title="Use as current model">
								<input
									type="radio"
									name="active-provider-model"
									checked={activeModelRef === ref}
									onChange={() => onActiveModelChange(ref)}
									aria-label={`Use ${model.name}`}
									className="accent-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35 focus-visible:ring-offset-2"
								/>
							</label>
							<CompactField label={readOnly ? "Catalog ID" : "Local ID"}>
								<input
									value={model.id}
									disabled={readOnly}
									onChange={(event) => {
										const nextId = event.target.value;
										onChange(
											profile.models.map((item, itemIndex) =>
												itemIndex === index ? { ...item, id: nextId } : item,
											),
										);
										if (activeModelRef === ref) onActiveModelChange(`${profile.id}/${nextId}`);
									}}
									className={compactInputClassName}
									aria-label={`${model.name} Local ID`}
									spellCheck={false}
								/>
							</CompactField>
							<CompactField label="Display name">
								<input
									value={model.name}
									disabled={readOnly}
									onChange={(event) =>
										onChange(
											profile.models.map((item, itemIndex) =>
												itemIndex === index ? { ...item, name: event.target.value } : item,
											),
										)
									}
									className={compactInputClassName}
									aria-label={`${model.name} display name`}
								/>
							</CompactField>
							<CompactField label="Remote ID">
								<input
									value={model.remoteModelId}
									disabled={readOnly}
									onChange={(event) =>
										onChange(
											profile.models.map((item, itemIndex) =>
												itemIndex === index ? { ...item, remoteModelId: event.target.value } : item,
											),
										)
									}
									className={compactInputClassName}
									aria-label={`${model.name} Remote ID`}
									spellCheck={false}
								/>
							</CompactField>
							{readOnly ? (
								<span className="flex h-8 items-center justify-center text-[11px] text-muted-foreground">
									Catalog
								</span>
							) : (
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={() => {
										onChange(profile.models.filter((_, itemIndex) => itemIndex !== index));
										if (activeModelRef === ref) onActiveModelChange("");
									}}
									aria-label={`Delete ${model.name}`}
									title="Delete model"
								>
									<TrashIcon />
								</Button>
							)}
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
							<span>{model.contextWindow?.toLocaleString() ?? "128,000"} context</span>
							<span>{model.maxTokens?.toLocaleString() ?? "4,096"} output</span>
							<span>{inputModalities.join(" + ")} in</span>
							<span>{outputModalities.join(" + ")} out</span>
							<span>{model.toolCall ? "Tools" : "No tools"}</span>
							<span>{model.structuredOutput ? "Structured" : "Freeform"}</span>
							{!readOnly ? (
								<>
									<Button
										type="button"
										variant={model.reasoning ? "secondary" : "ghost"}
										size="sm"
										onClick={() =>
											onChange(
												profile.models.map((item, itemIndex) =>
													itemIndex === index ? { ...item, reasoning: !item.reasoning } : item,
												),
											)
										}
									>
										Reasoning {model.reasoning ? "on" : "off"}
									</Button>
									<Button
										type="button"
										variant={input.includes("image") ? "secondary" : "ghost"}
										size="sm"
										onClick={() => {
											const nextInput: ("text" | "image")[] = input.includes("image")
												? input.filter((value): value is "text" => value !== "image")
												: [...input, "image"];
											onChange(
												profile.models.map((item, itemIndex) =>
													itemIndex === index
														? {
																...item,
																input: nextInput,
																inputModalities: uniqueModalities([
																	...(item.inputModalities ?? ["text"]),
																	...(nextInput.includes("image") ? ["image" as const] : []),
																]),
															}
														: item,
												),
											);
										}}
									>
										Image input {input.includes("image") ? "on" : "off"}
									</Button>
								</>
							) : null}
						</div>
					</div>
				);
			})}
		</section>
	);
}

/* -------------------------------------------------------------------------- */
/*                          Shared field components                           */
/* -------------------------------------------------------------------------- */

function SettingsRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="text-[13.5px] font-medium">{label}</span>
			<div className="w-48 shrink-0">{children}</div>
		</div>
	);
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium">
			<span>{label}</span>
			{children}
		</div>
	);
}

function CompactField({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1 text-[12px] text-muted-foreground">
			{label}
			{children}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                             Utilities                                      */
/* -------------------------------------------------------------------------- */

function toDraft(profile: DesktopProviderProfile): ProfileDraft {
	return { ...profile, models: [...profile.models], apiKey: "", clearApiKey: false };
}

function validateDraft(
	profiles: readonly ProfileDraft[],
	activeModelRef: string,
	language: string,
	maxIterations: string,
): string | undefined {
	if (language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) {
		return "Response language 必须是有效的 BCP-47 标记，例如 zh-CN。";
	}
	if (maxIterations && (!Number.isInteger(Number(maxIterations)) || Number(maxIterations) < 1)) {
		return "Max iterations 必须是正整数。";
	}
	const profileIds = new Set<string>();
	const modelRefs = new Set<string>();
	for (const profile of profiles) {
		if (!profile.name.trim()) return "每个 Provider 都需要名称。";
		if (!profileIdPattern.test(profile.id)) return `Profile ID "${profile.id}" 格式无效。`;
		if (profileIds.has(profile.id)) return `Profile ID "${profile.id}" 重复。`;
		profileIds.add(profile.id);
		if (profile.authentication === "api-key" && !profile.credentialConfigured && !profile.apiKey.trim()) {
			return `${profile.name} 需要 API key。`;
		}
		const modelIds = new Set<string>();
		for (const model of profile.models) {
			if (!model.id.trim() || (model.source !== "catalog" && model.id.includes("/"))) {
				return `${profile.name} 中的 Local model ID 格式无效。`;
			}
			if (!model.name.trim() || !model.remoteModelId.trim()) return `${profile.name} 中的模型信息不完整。`;
			if (modelIds.has(model.id)) return `${profile.name} 中的模型 ID "${model.id}" 重复。`;
			modelIds.add(model.id);
			modelRefs.add(`${profile.id}/${model.id}`);
		}
	}
	if (profiles.length > 0 && modelRefs.size === 0) return "至少添加一个模型。";
	if (modelRefs.size > 0 && !modelRefs.has(activeModelRef)) return "请选择 Current model。";
	return undefined;
}

function uniqueModalities<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

function uniqueProfileId(profiles: readonly ProfileDraft[], base: string): string {
	const ids = new Set(profiles.map((profile) => profile.id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) suffix++;
	return `${base}-${suffix}`;
}

function uniqueModelId(models: readonly DesktopProviderModel[], base: string): string {
	const ids = new Set(models.map((model) => model.id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) suffix++;
	return `${base}-${suffix}`;
}

const inputClassName =
	"h-9 w-full rounded-lg border border-border bg-transparent px-3 text-[14px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35";
const settingsInputClassName =
	"h-9 w-full rounded-lg border border-border bg-transparent px-3 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35";
const compactInputClassName =
	"h-8 min-w-0 w-full rounded-lg border border-border bg-transparent px-2.5 text-[12px] text-foreground outline-none focus:border-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35";
