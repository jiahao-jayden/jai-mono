export type SkillFrontmatter = {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	"user-invocable"?: boolean;
	"argument-hint"?: string;
};

export type SkillInfo = {
	name: string;
	description: string;
	path: string;
	body: string;
	frontmatter: SkillFrontmatter;
	/** Which scan directory this skill came from (for priority dedup). */
	source: "project-jai" | "project-agents" | "global-jai" | "global-agents";
};

export type InvokedSkillInfo = {
	skillName: string;
	skillPath: string;
	content: string;
	invokedAt: number;
};
