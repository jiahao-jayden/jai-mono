import { describe, expect, test } from "bun:test";
import { CodingAttachmentRun } from "../src/attachments";

const message = {
	role: "user" as const,
	content: "inspect this image",
	metadata: {
		messageAttachments: [
			{ id: "image-1", filename: "photo.png", mimeType: "image/png", size: 3 },
		],
	},
	timestamp: 1,
};

describe("CodingAttachmentRun", () => {
	test("projects an image attachment as ImageContent", async () => {
		const run = new CodingAttachmentRun();
		let reads = 0;

		const projected = await run.invoke(
			[
				{
					id: "image-1",
					filename: "photo.png",
					mimeType: "image/png",
					size: 3,
					sourcePath: "/tmp/photo.png",
					image: async () => {
						reads += 1;
						return { type: "image", image: "YWJj", mimeType: "image/png" };
					},
				},
			],
			async () => run.project([message]),
		);

		expect(reads).toBe(1);
		expect(projected?.[0]?.content).toContainEqual({ type: "image", image: "YWJj", mimeType: "image/png" });
	});
});
