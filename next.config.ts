import type { NextConfig } from "next";

/**
 * Effect Clue is a client-only SPA — no API routes, no server
 * rendering. `output: "export"` emits a static site Vercel can serve
 * directly.
 *
 * React Compiler is enabled so the component tree is auto-memoized;
 * we only need to hand-roll useMemo for the heavy deducer at the
 * state root.
 */
const nextConfig: NextConfig = {
    output: "export",
    reactCompiler: true,
    // Disable React Strict Mode's double-mount so localStorage
    // hydration runs once on mount, not twice. We still opt into
    // React 19's other strictness via `strict: true` in tsconfig.
    reactStrictMode: false,
    images: {
        // Next/Image would error on `output: "export"` without a loader;
        // we don't use it, but disable it defensively.
        unoptimized: true,
    },
};

export default nextConfig;
