import panda_logo_2 from "@/assets/icons/chat-area/panda-2.svg";
import { ChatInput } from "./input/chat-input";

export function EmptyState() {
	return (
		<div className="flex-1 flex flex-col items-center justify-center px-4">
			<div className="flex flex-col items-center justify-center gap-4 my-10">
				<img src={panda_logo_2} alt="JAI" className="w-64 object-contain" />
				<p className="text-center text-xl">Hi! Jayden, JAI is here to help you.</p>
			</div>
			<ChatInput className="**:data-[slot=input-group]:rounded-xl" />
		</div>
	);
}
