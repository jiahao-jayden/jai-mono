import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { gateway } from "@/services/gateway";
import { API_FORMAT_OPTIONS, type ProviderFormat } from "./provider-registry";

interface AddProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (id: string) => void;
}

export function AddProviderDialog({ open, onOpenChange, onCreated }: AddProviderDialogProps) {
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [apiFormat, setApiFormat] = useState<ProviderFormat>("openai-compatible");

	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: () => {
			const id = name.trim().toLowerCase().replace(/\s+/g, "-");
			return gateway.config.putProvider(id, {
				enabled: true,
				api_base: baseUrl.trim(),
				api_format: apiFormat,
				api_key: apiKey.trim() || undefined,
				models: [],
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["config"] });
			const id = name.trim().toLowerCase().replace(/\s+/g, "-");
			onCreated?.(id);
			resetForm();
			onOpenChange(false);
		},
	});

	const resetForm = () => {
		setName("");
		setBaseUrl("");
		setApiKey("");
		setApiFormat("openai-compatible");
	};

	const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Custom Provider</DialogTitle>
					<DialogDescription>Configure a custom API endpoint for your models.</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label className="text-[13px]">Provider Name</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Custom Provider"
						/>
					</div>

					<div className="space-y-2">
						<Label className="text-[13px]">Base URL</Label>
						<Input
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
							placeholder="https://api.example.com/v1"
							className="font-mono text-[13px]"
						/>
					</div>

					<div className="space-y-2">
						<Label className="text-[13px]">
							API Key <span className="text-muted-foreground/40">(Optional)</span>
						</Label>
						<Input
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="sk-..."
							className="font-mono text-[13px]"
						/>
					</div>

					<div className="space-y-2">
						<Label className="text-[13px]">API Format</Label>
						<Select value={apiFormat} onValueChange={(v) => setApiFormat(v as ProviderFormat)}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{API_FORMAT_OPTIONS.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										{opt.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
						{mutation.isPending ? "Adding..." : "Add Provider"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
