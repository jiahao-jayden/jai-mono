import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { gateway } from "@/services/gateway";
import { useThemeStore } from "@/stores/theme";

function getAllModels(config: ConfigResponse): { id: string; label: string; provider: string }[] {
	const items: { id: string; label: string; provider: string }[] = [];
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

	const handleModelChange = useCallback(
		(value: string) => {
			mutation.mutate({ model: value });
		},
		[mutation],
	);

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
		<section className="space-y-6">
			<h2 className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">General</h2>

			<div className="space-y-5">
				<div className="space-y-2">
					<Label className="text-[13px] text-muted-foreground">Theme</Label>
					<Select value={theme} onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="light">
								<SunIcon className="size-3.5 mr-2 inline-block" />
								Light
							</SelectItem>
							<SelectItem value="dark">
								<MoonIcon className="size-3.5 mr-2 inline-block" />
								Dark
							</SelectItem>
							<SelectItem value="system">
								<MonitorIcon className="size-3.5 mr-2 inline-block" />
								System
							</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label className="text-[13px] text-muted-foreground">Default Model</Label>
					<Select value={config?.model ?? ""} onValueChange={handleModelChange}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a model" />
						</SelectTrigger>
						<SelectContent>
							{models.map((m) => (
								<SelectItem key={m.id} value={m.id}>
									<span>{m.label}</span>
									<span className="text-muted-foreground/40 text-xs ml-2">{m.provider}</span>
								</SelectItem>
							))}
							{models.length === 0 && (
								<div className="px-3 py-4 text-center text-sm text-muted-foreground/50">
									Configure a provider first
								</div>
							)}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-2">
					<Label className="text-[13px] text-muted-foreground">Language</Label>
					<Input
						defaultValue={config?.language ?? ""}
						placeholder="zh-CN"
						onBlur={(e) => handleFieldBlur("language", e.target.value)}
					/>
				</div>

				<div className="space-y-2">
					<Label className="text-[13px] text-muted-foreground">Max Iterations</Label>
					<Input
						type="number"
						defaultValue={config?.maxIterations ?? 25}
						min={1}
						placeholder="25"
						onBlur={(e) => handleFieldBlur("maxIterations", e.target.value)}
					/>
					<p className="text-[11px] text-muted-foreground/40">Maximum agent loop iterations per turn</p>
				</div>
			</div>
		</section>
	);
}
