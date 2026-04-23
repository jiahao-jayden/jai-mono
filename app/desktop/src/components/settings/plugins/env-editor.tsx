import type { PluginEnvEntry } from "@jayden/jai-gateway";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

interface EnvEditorProps {
	pluginName: string;
	env: Record<string, PluginEnvEntry>;
}

const SENSITIVE_SUFFIX = /_(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)$/;

function isSensitive(key: string): boolean {
	return SENSITIVE_SUFFIX.test(key);
}

export function EnvEditor({ env }: EnvEditorProps) {
	const qc = useQueryClient();
	const { data: config } = useQuery({
		queryKey: ["config"],
		queryFn: () => gateway.config.get(),
	});
	const mutation = useMutation({
		mutationFn: gateway.config.update,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["plugins"] });
		},
	});

	const currentEnv = config?.env ?? {};
	const entries = Object.entries(env);

	const handleSave = (key: string, value: string) => {
		const trimmed = value.trim();
		const existing = currentEnv[key] ?? "";
		if (trimmed === existing) return;
		mutation.mutate({ env: { [key]: trimmed } });
	};

	return (
		<div className="space-y-3">
			<SectionHeading>Environment</SectionHeading>
			<div className="space-y-4">
				{entries.map(([key, entry]) => (
					<EnvField
						key={key}
						name={key}
						entry={entry}
						initialValue={currentEnv[key] ?? ""}
						onSave={(v) => handleSave(key, v)}
					/>
				))}
			</div>
		</div>
	);
}

function EnvField({
	name,
	entry,
	initialValue,
	onSave,
}: {
	name: string;
	entry: PluginEnvEntry;
	initialValue: string;
	onSave: (value: string) => void;
}) {
	const [value, setValue] = useState(initialValue);
	const [reveal, setReveal] = useState(false);
	const sensitive = isSensitive(name);

	useEffect(() => {
		setValue(initialValue);
	}, [initialValue]);

	return (
		<div className="space-y-1.5">
			<div className="flex items-baseline gap-2">
				<label className="font-mono text-[11.5px] text-foreground/80" htmlFor={`env-${name}`}>
					{name}
				</label>
				{entry.required && <span className="text-[10px] uppercase tracking-wider text-primary/80">required</span>}
			</div>
			<div className="relative">
				<Input
					id={`env-${name}`}
					type={sensitive && !reveal ? "password" : "text"}
					autoComplete="off"
					spellCheck={false}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onBlur={() => onSave(value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							(e.target as HTMLInputElement).blur();
						}
					}}
					placeholder={sensitive ? "未设置" : (entry.description ?? "未设置")}
					className={cn("font-mono text-[12.5px] pr-9", sensitive && "tracking-[0.08em]")}
				/>
				{sensitive && (
					<button
						type="button"
						onClick={() => setReveal((v) => !v)}
						className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/60 hover:text-foreground/80 transition-colors"
						aria-label={reveal ? "Hide value" : "Show value"}
					>
						{reveal ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
					</button>
				)}
			</div>
			{entry.description && (
				<p className="text-[11.5px] text-muted-foreground/60 leading-relaxed">{entry.description}</p>
			)}
		</div>
	);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
	return (
		<h3 className="text-[10.5px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">{children}</h3>
	);
}
