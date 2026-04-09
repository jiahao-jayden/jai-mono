import type { ConfigResponse } from "@jayden/jai-gateway";
import { useState } from "react";
import { AddProviderDialog } from "./add-provider-dialog";
import { ProviderDetail } from "./provider-detail";
import { ProviderList } from "./provider-list";
import { BUILTIN_PROVIDERS } from "./provider-registry";

export function ProvidersPane({ config }: { config?: ConfigResponse }) {
	const [selectedId, setSelectedId] = useState<string>(BUILTIN_PROVIDERS[0].id);
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<div className="flex h-full">
			<ProviderList
				config={config}
				selectedId={selectedId}
				onSelect={setSelectedId}
				onAddCustom={() => setDialogOpen(true)}
			/>
			<ProviderDetail key={selectedId} providerId={selectedId} config={config} />
			<AddProviderDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onCreated={(id) => setSelectedId(id)}
			/>
		</div>
	);
}
