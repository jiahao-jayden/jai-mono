import {
	ComputerIcon,
	LanguageSquareIcon,
	Moon02Icon,
	PaintBoardIcon,
	RepeatIcon,
	SparklesIcon,
	Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { BrandAvatar, resolveModelIcon, resolveProviderIcon } from "@/components/common/provider-icons";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useThemeStore } from "@/stores/theme";
import { SettingsGroup, SettingsHeader, SettingsPage, SettingsRow } from "./common/settings-layout";

interface ModelOption {
	id: string;
	label: string;
	provider: string;
}

function getAllModels(config: ConfigResponse): ModelOption[] {
	const items: ModelOption[] = [];
	const providers = config.providers ?? {};
	for (const [providerId, pc] of Object.entries(providers) as [string, ProviderSettings][]) {
		if (!pc.enabled) continue;
		for (const m of pc.models) {
			const modelId = typeof m === "string" ? m : m.id;
			items.push({
				id: `${providerId}/${modelId}`,
				label: modelId,
				provider: providerId,
			});
		}
	}
	return items;
}

export function GeneralPane({ config }: { config?: ConfigResponse }) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: gateway.config.update,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
	});

	const models = config ? getAllModels(config) : [];

	const handleModelChange = useCallback((value: string) => mutation.mutate({ model: value }), [mutation]);

	const handleFieldBlur = useCallback(
		(field: "language" | "maxIterations", value: string) => {
			if (!value.trim()) return;
			if (field === "maxIterations") {
				const n = Number.parseInt(value, 10);
				if (Number.isNaN(n) || n <= 0) return;
				mutation.mutate({ maxIterations: n });
			} else {
				mutation.mutate({ [field]: value });
			}
		},
		[mutation],
	);

	const { theme, setTheme } = useThemeStore();

	return (
		<SettingsPage>
			<SettingsHeader title="Preferences" description="Tune the way JAI looks, feels, and thinks while you work." />

			<SettingsGroup title="Appearance">
				<SettingsRow
					icon={PaintBoardIcon}
					title="Theme"
					description="Match the system or pin a preferred mode."
					control={<ThemeSegmented value={theme} onChange={setTheme} />}
				/>
			</SettingsGroup>

			<SettingsGroup title="Assistant">
				<SettingsRow
					icon={SparklesIcon}
					title="Default model"
					description="Used whenever you start a new chat without picking a model."
					control={
						<Select value={config?.model ?? ""} onValueChange={handleModelChange}>
							<SelectTrigger className="min-w-[220px] max-w-[260px] h-9 bg-background">
								<SelectValue placeholder="Select a model">
									{config?.model ? <SelectedModelPreview modelId={config.model} /> : null}
								</SelectValue>
							</SelectTrigger>
							<SelectContent align="end">
								{models.length > 0 ? (
									models.map((m) => (
										<SelectItem key={m.id} value={m.id}>
											<ModelOptionRow option={m} />
										</SelectItem>
									))
								) : (
									<div className="px-3 py-6 text-center text-[12.5px] text-muted-foreground/60">
										Configure a provider first
									</div>
								)}
							</SelectContent>
						</Select>
					}
				/>
				<SettingsRow
					icon={LanguageSquareIcon}
					title="Reply language"
					description="Preferred language for assistant responses."
					control={
						<Input
							defaultValue={config?.language ?? ""}
							placeholder="zh-CN"
							onBlur={(e) => handleFieldBlur("language", e.target.value)}
							className="h-9 w-[160px] text-[13px]"
						/>
					}
				/>
				<SettingsRow
					icon={RepeatIcon}
					title="Max tool iterations"
					description="How many agent loop turns can run before JAI stops and asks you."
					control={
						<Input
							type="number"
							defaultValue={config?.maxIterations ?? 25}
							min={1}
							placeholder="25"
							onBlur={(e) => handleFieldBlur("maxIterations", e.target.value)}
							className="h-9 w-[88px] text-[13px] tabular-nums text-right"
						/>
					}
				/>
			</SettingsGroup>
		</SettingsPage>
	);
}

function SelectedModelPreview({ modelId }: { modelId: string }) {
	const [provider, ...rest] = modelId.split("/");
	const name = rest.length ? rest.join("/") : modelId;
	const icon = resolveModelIcon(modelId)?.icon ?? resolveProviderIcon(provider)?.icon ?? null;
	return (
		<span className="flex items-center gap-2 min-w-0">
			<BrandAvatar icon={icon} size={14} />
			<span className="truncate text-[13px] text-foreground">{name}</span>
		</span>
	);
}

function ModelOptionRow({ option }: { option: ModelOption }) {
	const icon = resolveModelIcon(option.id)?.icon ?? resolveProviderIcon(option.provider)?.icon ?? null;
	return (
		<span className="flex items-center gap-2 min-w-0">
			<BrandAvatar icon={icon} size={14} />
			<span className="truncate text-[13px]">{option.label}</span>
			<span className="ml-2 shrink-0 text-[11px] text-muted-foreground/55">{option.provider}</span>
		</span>
	);
}

const THEME_OPTIONS = [
	{ value: "light", label: "Light", icon: Sun03Icon },
	{ value: "dark", label: "Dark", icon: Moon02Icon },
	{ value: "system", label: "System", icon: ComputerIcon },
] as const;

function ThemeSegmented({
	value,
	onChange,
}: {
	value: "light" | "dark" | "system";
	onChange: (v: "light" | "dark" | "system") => void;
}) {
	return (
		<fieldset className="inline-flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5 ring-1 ring-border/45">
			<legend className="sr-only">Theme</legend>
			{THEME_OPTIONS.map(({ value: v, label, icon }) => {
				const active = value === v;
				return (
					<label
						key={v}
						className={cn(
							"inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-all duration-150",
							active
								? "bg-background text-foreground ring-1 ring-border/50"
								: "text-muted-foreground/70 hover:text-foreground",
						)}
					>
						<input
							type="radio"
							name="theme"
							value={v}
							checked={active}
							onChange={() => onChange(v)}
							className="sr-only"
						/>
						<HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
						<span>{label}</span>
					</label>
				);
			})}
		</fieldset>
	);
}
