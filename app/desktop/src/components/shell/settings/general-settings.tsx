import type { ReactNode } from "react";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";

interface GeneralSettingsProps {
	readonly language: string;
	readonly maxIterations: string;
	readonly reasoningEffort: string;
	readonly onLanguageChange: (value: string) => void;
	readonly onMaxIterationsChange: (value: string) => void;
	readonly onReasoningEffortChange: (value: string) => void;
}

export function GeneralSettings({
	language,
	maxIterations,
	reasoningEffort,
	onLanguageChange,
	onMaxIterationsChange,
	onReasoningEffortChange,
}: GeneralSettingsProps) {
	return (
		<div className="px-8 py-6">
			<h2 className="text-base font-semibold">Agent Defaults</h2>

			<div className="mt-5 flex flex-col gap-5">
				<SettingsRow label="Response language">
					<Input
						value={language}
						onChange={(event) => onLanguageChange(event.target.value)}
						placeholder="zh-CN"
						aria-label="Response language"
						autoComplete="off"
					/>
				</SettingsRow>

				<SettingsRow label="Max iterations">
					<Input
						type="number"
						min={1}
						value={maxIterations}
						onChange={(event) => onMaxIterationsChange(event.target.value)}
						placeholder="Unlimited"
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

function SettingsRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="text-[13.5px] font-medium">{label}</span>
			<div className="w-48 shrink-0">{children}</div>
		</div>
	);
}
