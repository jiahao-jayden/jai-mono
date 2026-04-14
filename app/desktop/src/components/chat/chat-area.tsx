import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { Conversation, ConversationContent } from "../ai-elements/conversation";
import { ChatHeader } from "./chat-header";
import { EmptyState } from "./empty-state";
import { ChatInput } from "./input/chat-input";
import { MessageList } from "./message-list";

export function ChatArea() {
	const { messages, status } = useChatStore();

	return (
		<main className={cn("flex-1 flex flex-col h-full relative overflow-hidden border border-border/50")}>
			<ChatHeader />

			{messages.length === 0 ? (
				<EmptyState />
			) : (
				<>
					<Conversation className="flex-1">
						<ConversationContent className="max-w-3xl mx-auto w-full pb-1 gap-1">
							<MessageList messages={messages} status={status} />
						</ConversationContent>
					</Conversation>

					<div className="px-4 pb-4">
						<ChatInput className="**:data-[slot=input-group]:rounded-2xl" />
					</div>
				</>
			)}
		</main>
	);
}
