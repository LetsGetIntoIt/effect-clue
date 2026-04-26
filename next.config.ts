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
    // Pin Turbopack's workspace root to this directory. Without it,
    // Next 16 walks up looking for a `pnpm-lock.yaml` and may pick the
    // parent repo's lockfile instead of the worktree's — harmless
    // today, but it could resolve deps from the wrong `node_modules`
    // and mask bugs. `__dirname` resolves to the worktree root because
    // this file lives at the repo root.
    turbopack: { root: __dirname },
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
