import { HashRouter } from "react-router";
import { AppShell } from "@/components/shell/app-shell";

export default function App() {
	return (
		<HashRouter>
			<AppShell />
		</HashRouter>
	);
}
