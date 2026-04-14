import panda_logo_2 from "@/assets/icons/chat-area/panda-2.svg";
import { ChatInput } from "./input/chat-input";

export function EmptyState() {
	return (
		<div className="flex-1 flex flex-col items-center justify-center px-4">
			<div className="flex items-center justify-center my-10 gap-4">
				<img src={panda_logo_2} alt="JAI" className="w-20 object-contain" />
				<h1 className="text-4xl font-bold font-serif text-primary-2">OpenPanda</h1>
			</div>
			<ChatInput className="**:data-[slot=input-group]:rounded-xl" />
		</div>
	);
}
