import type { KnipConfig } from "knip";

const config: KnipConfig = {
	// Tests live alongside source files; include them so test-only exports
	// (e.g. preset fixtures) are counted as used.
	//
	// `src/analytics/events.ts` is an "intentional public API" surface —
	// every exported emitter is documented in the production-deployment
	// plan as part of the target event taxonomy and gets wired into call
	// sites incrementally as features land. Treating it as an entry point
	// keeps knip from flagging the not-yet-wired emitters as unused.
	entry: ["src/**/*.test.{ts,tsx}", "src/analytics/events.ts"],
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
