import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

/**
 * Effect Clue runs as a Next.js App Router app deployed to Vercel
 * (Fluid Compute). The `/play` page is a client component that
 * server-renders an empty skeleton on each request and hydrates from
 * localStorage on the client — there is no server-side game state.
 * Server runtime + API routes will be wired in later milestones
 * (M6+).
 *
 * Historical: this app previously shipped as a static export
 * (`output: "export"`). That mode is incompatible with the API
 * routes, server actions, and dynamic share routes (`/share/[id]`)
 * that the upcoming milestones depend on, so the static export was
 * dropped in favour of SSR.
 *
 * React Compiler is enabled so the component tree is auto-memoized;
 * we only need to hand-roll useMemo for the heavy deducer at the
 * state root.
 */
const nextConfig: NextConfig = {
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
        // We don't use Next/Image; disable image optimization
        // defensively so a stray `<Image>` somewhere can't accidentally
        // route through the optimizer pipeline.
        unoptimized: true,
    },
};

/**
 * `withSentryConfig` only does work at build time — it injects a
 * webpack plugin that uploads source maps to Sentry. When
 * `SENTRY_AUTH_TOKEN` is unset (local dev) the plugin no-ops and
 * the build runs unchanged.
 */
const sentryOrg = process.env["SENTRY_ORG"];
const sentryProject = process.env["SENTRY_PROJECT"];
const sentryAuthToken = process.env["SENTRY_AUTH_TOKEN"];

export default withSentryConfig(nextConfig, {
    silent: true,
    widenClientFileUpload: true,
    ...(sentryOrg !== undefined && { org: sentryOrg }),
    ...(sentryProject !== undefined && { project: sentryProject }),
    ...(sentryAuthToken !== undefined && { authToken: sentryAuthToken }),
});
