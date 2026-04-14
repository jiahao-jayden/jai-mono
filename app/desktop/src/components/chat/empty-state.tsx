import { motion } from "motion/react";
import panda_logo_2 from "@/assets/icons/chat-area/panda-2.svg";
import { ChatInput } from "./input/chat-input";

const spring = { type: "spring" as const, stiffness: 260, damping: 20 };

export function EmptyState() {
	return (
		<div className="flex-1 flex flex-col items-center justify-center px-4">
			<div className="flex items-center justify-center my-10 gap-4">
				<motion.img
					src={panda_logo_2}
					alt="JAI"
					className="w-20 object-contain"
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={spring}
				/>
				<motion.h1
					className="text-4xl font-bold font-serif text-primary-2"
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ ...spring, delay: 0.08 }}
				>
					OpenPanda
				</motion.h1>
			</div>
			<motion.div
				className="w-full"
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ ...spring, delay: 0.15 }}
			>
				<ChatInput className="**:data-[slot=input-group]:rounded-xl" />
			</motion.div>
		</div>
	);
}
