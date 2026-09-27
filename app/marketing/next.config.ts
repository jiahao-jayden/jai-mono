import type { NextConfig } from "next";

// The site is a single static page, so it ships as a pure static export served
// from Cloudflare Workers static assets (see wrangler.jsonc). There is no SSR,
// ISR or API route; adding one means switching the deploy to OpenNext.
const nextConfig: NextConfig = {
	output: "export",
	trailingSlash: true,
	// Static export has no image optimizer; images are pre-sized WebP in public/.
	images: { unoptimized: true },
};

export default nextConfig;
