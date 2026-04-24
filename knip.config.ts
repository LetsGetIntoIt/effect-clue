import type { KnipConfig } from "knip";

const config: KnipConfig = {
	// Tests live alongside source files; include them so test-only exports
	// (e.g. preset fixtures) are counted as used.
	entry: ["src/**/*.test.{ts,tsx}"],
	project: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
	ignore: ["src/logic/test-utils/**"],
	ignoreDependencies: [
		// tailwindcss is pulled in as a peer of @tailwindcss/postcss (which
		// is what we actually configure in postcss.config.ts). Having it at
		// the top level keeps CSS tooling and editor integrations happy,
		// even though nothing imports it directly.
		"tailwindcss",
	],
};

export default config;
