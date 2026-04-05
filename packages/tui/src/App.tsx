import type { AgentEvent } from "@jayden/jai-agent";
import type { AgentSession } from "@jayden/jai-coding-agent";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
	role: "user" | "assistant";
	text: string;
};

export function App({ session }: { session: AgentSession }) {
	const { exit } = useApp();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [streaming, setStreaming] = useState("");
	const [loading, setLoading] = useState(false);
	const streamRef = useRef("");

	useEffect(() => {
		return session.onEvent((event: AgentEvent) => {
			if (event.type === "stream" && event.event.type === "text_delta") {
				streamRef.current += event.event.text;
				setStreaming(streamRef.current);
			}
		});
	}, [session]);

	const handleSubmit = useCallback(
		async (value: string) => {
			const trimmed = value.trim();
			if (!trimmed || loading) return;

			if (trimmed === "/exit" || trimmed === "/quit") {
				await session.close();
				exit();
				return;
			}

			setInput("");
			setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
			setLoading(true);
			streamRef.current = "";
			setStreaming("");

			try {
				await session.chat(trimmed);
				const response = streamRef.current;
				setMessages((prev) => [...prev, { role: "assistant", text: response }]);
			} catch (err) {
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				]);
			} finally {
				streamRef.current = "";
				setStreaming("");
				setLoading(false);
			}
		},
		[session, loading, exit],
	);

	return (
		<Box flexDirection="column">
			{messages.length === 0 && !streaming && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color="cyan">{`    ██╗ █████╗ ██╗     █████╗  ██████╗ ███████╗███╗   ██╗████████╗
    ██║██╔══██╗██║    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
    ██║███████║██║    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
██  ██║██╔══██║██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
╚████╔╝██║  ██║██║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
 ╚═══╝ ╚═╝  ╚═╝╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝`}</Text>
					<Text dimColor>{"\n  /exit to quit"}</Text>
				</Box>
			)}

			{messages.map((msg, i) => (
				<Box key={i} flexDirection="column" marginBottom={1}>
					<Text bold color={msg.role === "user" ? "blue" : "green"}>
						{msg.role === "user" ? "You" : "Assistant"}
					</Text>
					<Text>{msg.text}</Text>
				</Box>
			))}

			{streaming && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="green">
						Assistant
					</Text>
					<Text>{streaming}</Text>
				</Box>
			)}

			<Box>
				<Text color="cyan">{loading ? "… " : "❯ "}</Text>
				{loading ? (
					<Text dimColor>thinking...</Text>
				) : (
					<TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
				)}
			</Box>
		</Box>
	);
}
