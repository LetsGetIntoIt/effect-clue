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
	//
	// `app/sw.ts` is the Serwist service-worker source. It's compiled to
	// `public/sw.js` at build time by the `@serwist/next` plugin (wired
	// up in `next.config.ts`); no consumer file imports it directly, so
	// without an explicit entry-points line knip flags both the file and
	// its sibling `serwist` runtime as unused.
	entry: [
		"src/**/*.test.{ts,tsx}",
		"src/analytics/events.ts",
		"app/sw.ts",
		// Dev-only sign-in defence layer 3 (`Effect.die` if reached
		// in production). Referenced from the production-bundle grep
		// in `scripts/assert-no-dev-auth.mjs`, which knip can't see.
		"src/server/actions/dev-auth.ts",
		// Server actions consumed via Next.js's "use server" boundary
		// — the M8 card-pack actions are imported by upcoming UI
		// surfaces (the Account modal's "My card packs" section) +
		// the M8b session-aware reads. Keeping them as entry points
		// while the read path is still in flight.
		"src/server/actions/packs.ts",
		// vitest alias target — referenced from `vitest.config.ts`'s
		// `resolve.alias`, which knip can't crawl.
		"src/test-utils/server-only-stub.ts",
	],
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
