interface ShapeClasses {
	item: string;
	bg: string;
	focusRing: string;
	mergedBg: string;
	container: string;
	button: string;
	input: string;
	// Numeric counterparts of `bg` / `mergedBg`, in px. Needed where individual
	// corners are animated (e.g. the selected-background merge/split animation),
	// which requires per-corner numeric border-radii rather than a class.
	bgRadius: number;
	mergedRadius: number;
}

// Aside DNA: controls and form inputs share squircle `radius-lg` (shadcn
// base-nova default). Only the chat composer is a 20px pill, set inline there.
const shape: ShapeClasses = {
	item: "rounded-lg",
	bg: "rounded-lg",
	focusRing: "rounded-lg",
	mergedBg: "rounded-lg",
	container: "rounded-xl",
	button: "rounded-lg",
	input: "rounded-lg",
	bgRadius: 11,
	mergedRadius: 11,
};

const shapeMap = { rounded: shape };

function useShape(): ShapeClasses {
	return shape;
}

export type { ShapeClasses };
export { shapeMap, useShape };
