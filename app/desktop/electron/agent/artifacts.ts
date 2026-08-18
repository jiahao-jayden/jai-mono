import type { DesktopArtifact } from "../../shared/desktop-rpc";

export function sortArtifacts(artifacts: Iterable<DesktopArtifact>): DesktopArtifact[] {
	return [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt);
}
