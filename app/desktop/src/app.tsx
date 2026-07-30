import { Titlebar } from "@/components/shell/titlebar";

export default function App() {
	return (
		<div className="flex min-h-screen flex-col">
			<Titlebar />
			<main className="flex flex-1 items-center justify-center">
				<h1>Hello World</h1>
			</main>
		</div>
	);
}
