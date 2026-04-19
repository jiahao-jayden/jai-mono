import z from "zod";

/**
 * 极简权限设置：
 *   - 只有 auto 一种模式（不暴露开关）
 *   - 用户唯一可调的是 `dangerousPaths`：追加额外的"敏感路径 glob"，命中即弹窗
 */
export const PermissionSettingsSchema = z
	.object({
		dangerousPaths: z.array(z.string()).default([]),
	})
	.default({ dangerousPaths: [] });

export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;
