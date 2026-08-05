import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface NextStepProps {
	readonly value: string;
	readonly className?: string;
}

export function NextStep({ value, className }: NextStepProps) {
	const reducedMotion = useReducedMotion();
	const still = { opacity: 1, y: 0, filter: "blur(0px)" };
	const enter = reducedMotion ? still : { opacity: 0, y: 4, filter: "blur(2px)" };
	const exit = reducedMotion ? still : { opacity: 0, y: -4, filter: "blur(2px)" };
	const duration = reducedMotion ? 0 : 0.15;

	return (
		<span aria-atomic="true" aria-live="polite" className={cn("inline-grid min-w-0", className)}>
			<AnimatePresence initial={false} mode="wait">
				<motion.span
					key={value}
					aria-hidden="true"
					initial={enter}
					animate={still}
					exit={exit}
					transition={{ duration, ease: "easeInOut" }}
					className="min-w-0 truncate [grid-area:1/1]"
				>
					{value}
				</motion.span>
			</AnimatePresence>
			<span className="sr-only">{value}</span>
		</span>
	);
}
