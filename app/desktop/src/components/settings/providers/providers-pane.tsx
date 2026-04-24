import type { ConfigResponse } from "@jayden/jai-gateway";
import { useState } from "react";
import { SettingsHeader } from "../common/settings-layout";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderDetail } from "./provider-detail";
import { ProviderList } from "./provider-list";
import { BUILTIN_PROVIDERS } from "./provider-registry";

export function ProvidersPane({ config }: { config?: ConfigResponse }) {
	const [selectedId, setSelectedId] = useState<string>(BUILTIN_PROVIDERS[0].id);
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 px-8">
				<SettingsHeader
					title="Providers"
					description="Connect model providers and pick which models you want visible to JAI."
				/>
			</div>

			<div className="flex min-h-0 flex-1">
				<ProviderList
					config={config}
					selectedId={selectedId}
					onSelect={setSelectedId}
					onAddCustom={() => setDialogOpen(true)}
				/>
				<ProviderDetail key={selectedId} providerId={selectedId} config={config} />
			</div>

			<AddProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(id) => setSelectedId(id)} />
		</div>
	);
}
