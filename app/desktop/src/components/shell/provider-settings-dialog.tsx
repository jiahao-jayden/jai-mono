import { useState } from "react";
import { useIcon } from "@/lib/icon-context";
import type {
	DesktopProviderAdapter,
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderModel,
	DesktopProviderProfile,
} from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../ui/select";

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
					<ProviderConfigForm key={snapshot.revision ?? "new"} snapshot={snapshot} onSave={onSave} />
				) : (
					<ProviderLoadState loading={loading} error={loadError} onRetry={onRetry} />
				)}
			</DialogContent>
		</Dialog>
	);
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
	const KeyIcon = useIcon("key");

	return (
		<div className="flex min-h-80 flex-col">
			<DialogHeader className="border-b border-border px-6 pt-6 pb-5">
				<DialogTitle>Provider & Model</DialogTitle>
				<DialogDescription>配置 API 连接和当前模型。凭证只保存在本机 main 进程可读的设置文件中。</DialogDescription>
			</DialogHeader>
			<div className="flex flex-1 items-center justify-center px-6 text-center">
				<div>
					<KeyIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
					<p className="text-[14px] font-semibold">
						{loading ? "Loading Provider settings…" : "Provider settings unavailable"}
					</p>
					<p className="mt-1 text-[12px] text-muted-foreground">
						{loading ? "正在读取本机配置。" : "未能读取本机配置；现有设置没有被覆盖。"}
					</p>
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

function ProviderConfigForm({
	snapshot,
	onSave,
}: {
	readonly snapshot: DesktopProviderConfigSnapshot;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<void>;
}) {
	const KeyIcon = useIcon("key");
	const PlusIcon = useIcon("plus");
	const TrashIcon = useIcon("trash");
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [activeModelRef, setActiveModelRef] = useState(snapshot.activeModelRef ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const selectedIndex = profiles.findIndex((profile) => profile.id === selectedProfileId);
	const selected = profiles[selectedIndex];
	const modelOptions = profiles.flatMap((profile) =>
		profile.models.map((model) => ({
			ref: `${profile.id}/${model.id}`,
			label: `${profile.name} · ${model.name}`,
		})),
	);
	const canSave = profiles.length > 0 || snapshot.profiles.length > 0;

	const updateSelected = (update: (profile: ProfileDraft) => ProfileDraft) => {
		if (selectedIndex < 0) return;
		setProfiles((current) => current.map((profile, index) => (index === selectedIndex ? update(profile) : profile)));
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
		setProfiles((current) => [...current, profile]);
		setSelectedProfileId(id);
	};

	const removeSelected = () => {
		if (!selected) return;
		const removedPrefix = `${selected.id}/`;
		const nextProfiles = profiles.filter((_, index) => index !== selectedIndex);
		setProfiles(nextProfiles);
		setSelectedProfileId(nextProfiles[Math.min(selectedIndex, nextProfiles.length - 1)]?.id ?? "");
		if (activeModelRef.startsWith(removedPrefix)) setActiveModelRef("");
	};

	const submit = async () => {
		const validationError = validateDraft(profiles, activeModelRef);
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
				profiles: profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => ({
					id: profile.id,
					name: profile.name,
					adapter: profile.adapter,
					baseURL: profile.baseURL,
					authentication: profile.authentication,
					...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
					...(profile.clearApiKey ? { clearApiKey: true } : {}),
					models: profile.models,
				})),
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Provider 配置未保存，请重试。");
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="flex max-h-[min(720px,calc(100vh-48px))] min-h-140 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<DialogHeader className="border-b border-border px-6 pt-6 pb-5">
				<DialogTitle>Provider & Model</DialogTitle>
				<DialogDescription>配置 API 连接和当前模型。凭证只保存在本机 main 进程可读的设置文件中。</DialogDescription>
			</DialogHeader>

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-47.5 shrink-0 flex-col border-r border-border bg-muted/35 p-3">
					<div className="min-h-0 flex-1 overflow-y-auto">
						{profiles.length === 0 ? (
							<p className="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground">
								添加一个 Provider 后即可连接模型。
							</p>
						) : null}
						{profiles.map((profile) => (
							<Button
								type="button"
								variant="ghost"
								size="md"
								key={profile.id}
								onClick={() => setSelectedProfileId(profile.id)}
								aria-current={profile.id === selectedProfileId ? "page" : undefined}
								active={profile.id === selectedProfileId}
								className={`h-auto w-full justify-start px-2.5 py-2 text-left text-[14px] ${
									profile.id === selectedProfileId ? "font-semibold" : ""
								}`}
							>
								<span className="flex min-w-0 items-center gap-2">
									<span
										className={`size-2 shrink-0 rounded-full ${
											profile.authentication === "none" || profile.credentialConfigured || profile.apiKey
												? "bg-primary-2"
												: "bg-muted-foreground/35"
										}`}
									/>
									<span className="min-w-0 flex-1 truncate">{profile.name}</span>
								</span>
							</Button>
						))}
					</div>
					<Button type="button" variant="tertiary" size="sm" onClick={addProfile} leadingIcon={PlusIcon}>
						Add provider
					</Button>
				</aside>

				<div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
					{selected ? (
						<div className="flex flex-col gap-4">
							<section className="flex flex-col gap-3">
								<div className="flex items-center justify-between gap-3">
									<h2 className="text-[14px] font-semibold">Connection</h2>
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
									<Field label="Profile ID" hint="小写字母、数字、点、短横线">
										<input
											value={selected.id}
											onChange={(event) => {
												const nextId = event.target.value;
												const previousPrefix = `${selected.id}/`;
												updateSelected((profile) => ({ ...profile, id: nextId }));
												setSelectedProfileId(nextId);
												if (activeModelRef.startsWith(previousPrefix)) {
													setActiveModelRef(`${nextId}/${activeModelRef.slice(previousPrefix.length)}`);
												}
											}}
											className={inputClassName}
											aria-label="Profile ID"
											autoComplete="off"
											spellCheck={false}
										/>
									</Field>
								</div>
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
								<Field label="Endpoint" hint="留空使用 adapter 默认 endpoint">
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
								<h2 className="text-[14px] font-semibold">Credential</h2>
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
									<Field
										label="API key"
										hint={
											selected.credentialConfigured && !selected.clearApiKey
												? `${selected.credentialMask ?? "Configured"} · 留空保持不变`
												: "尚未配置"
										}
									>
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
								) : (
									<p className="text-[12px] text-muted-foreground">此连接不会发送 Authorization header。</p>
								)}
							</section>

							<ModelEditor
								profile={selected}
								activeModelRef={activeModelRef}
								onActiveModelChange={setActiveModelRef}
								onChange={(models) => updateSelected((profile) => ({ ...profile, models }))}
							/>
						</div>
					) : (
						<div className="flex h-full min-h-72 items-center justify-center text-center">
							<div>
								<KeyIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
								<p className="text-[14px] font-semibold">No Provider yet</p>
								<p className="mt-1 text-[12px] text-muted-foreground">添加连接后，在这里选择模型。</p>
								<Button type="button" variant="secondary" size="sm" className="mt-4" onClick={addProfile}>
									Add provider
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>

			<DialogFooter className="items-center border-t border-border px-6 py-4">
				{error ? (
					<p className="mr-auto max-w-115 text-[12px] leading-relaxed text-destructive" role="alert">
						{error}
					</p>
				) : modelOptions.length > 0 && activeModelRef ? (
					<p className="mr-auto text-[12px] text-muted-foreground">
						Current: {modelOptions.find((model) => model.ref === activeModelRef)?.label}
					</p>
				) : null}
				<Button type="submit" loading={saving} disabled={!canSave}>
					Save configuration
				</Button>
			</DialogFooter>
		</form>
	);
}

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
		onChange([...profile.models, { id, name: "New model", remoteModelId: id }]);
		onActiveModelChange(`${profile.id}/${id}`);
	};
	return (
		<section className="flex flex-col gap-3 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-[14px] font-semibold">Models</h2>
					<p className="mt-0.5 text-[12px] text-muted-foreground">
						Local ID 用于配置引用，Remote ID 会发送给 API。
					</p>
				</div>
				<Button type="button" variant="ghost" size="sm" onClick={addModel} leadingIcon={PlusIcon}>
					Add model
				</Button>
			</div>
			{profile.models.map((model, index) => {
				const ref = `${profile.id}/${model.id}`;
				return (
					<div key={model.id} className="grid grid-cols-[28px_1fr_1fr_1fr_32px] items-end gap-2">
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
						<CompactField label="Local ID">
							<input
								value={model.id}
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
					</div>
				);
			})}
			{profile.models.length === 0 ? (
				<p className="rounded-xl bg-muted/55 px-4 py-3 text-[12px] text-muted-foreground">
					添加 API 暴露的模型 ID，然后将它设为 Current model。
				</p>
			) : null}
		</section>
	);
}

function Field({
	label,
	hint,
	children,
}: {
	readonly label: string;
	readonly hint?: string;
	readonly children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium">
			<span className="flex items-baseline justify-between gap-2">
				<span>{label}</span>
				{hint ? <span className="font-normal text-muted-foreground">{hint}</span> : null}
			</span>
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

function toDraft(profile: DesktopProviderProfile): ProfileDraft {
	return { ...profile, models: [...profile.models], apiKey: "", clearApiKey: false };
}

function validateDraft(profiles: readonly ProfileDraft[], activeModelRef: string): string | undefined {
	const profileIds = new Set<string>();
	const modelRefs = new Set<string>();
	for (const profile of profiles) {
		if (!profile.name.trim()) return "每个 Provider 都需要名称。";
		if (!profileIdPattern.test(profile.id)) return `Profile ID “${profile.id}” 格式无效。`;
		if (profileIds.has(profile.id)) return `Profile ID “${profile.id}” 重复。`;
		profileIds.add(profile.id);
		if (profile.authentication === "api-key" && !profile.credentialConfigured && !profile.apiKey.trim()) {
			return `${profile.name} 需要 API key。`;
		}
		const modelIds = new Set<string>();
		for (const model of profile.models) {
			if (!model.id.trim() || model.id.includes("/")) return `${profile.name} 中的 Local model ID 格式无效。`;
			if (!model.name.trim() || !model.remoteModelId.trim()) return `${profile.name} 中的模型信息不完整。`;
			if (modelIds.has(model.id)) return `${profile.name} 中的模型 ID “${model.id}” 重复。`;
			modelIds.add(model.id);
			modelRefs.add(`${profile.id}/${model.id}`);
		}
	}
	if (profiles.length > 0 && modelRefs.size === 0) return "至少添加一个模型。";
	if (modelRefs.size > 0 && !modelRefs.has(activeModelRef)) return "请选择 Current model。";
	return undefined;
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
const compactInputClassName =
	"h-8 min-w-0 w-full rounded-lg border border-border bg-transparent px-2.5 text-[12px] text-foreground outline-none focus:border-primary-2 focus-visible:ring-2 focus-visible:ring-primary-2/35";
