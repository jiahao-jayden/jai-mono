import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { Conversation, ConversationContent } from "../ai-elements/conversation";
import { ChatHeader } from "./chat-header";
import { EmptyState } from "./empty-state";
import { ChatInput } from "./input/chat-input";
import { MessageList } from "./message-list";

export function ChatArea() {
	const { messages, status, sessionId } = useChatStore();
	const showEmpty = messages.length === 0 && !sessionId;

	return (
		<main className={cn("flex-1 flex flex-col h-full relative overflow-hidden ")}>
			<ChatHeader />

			<AnimatePresence mode="wait">
				{showEmpty ? (
					<motion.div
						key="empty"
						className="flex-1 flex flex-col"
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.15 }}
					>
						<EmptyState />
					</motion.div>
				) : (
					<motion.div
						key="conversation"
						className="flex-1 flex flex-col min-h-0"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ type: "spring", stiffness: 300, damping: 24 }}
					>
						<Conversation className="flex-1">
							<ConversationContent className="max-w-3xl mx-auto w-full pb-1 gap-1">
								<MessageList messages={messages} status={status} />
							</ConversationContent>
						</Conversation>

						<div className="px-4 pb-4">
							<ChatInput className="**:data-[slot=input-group]:rounded-2xl" />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</main>
	);
}
