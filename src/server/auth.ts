/**
 * better-auth configuration. Server-only.
 *
 * Production: Google OAuth + the anonymous-account plugin. Anonymous
 * accounts let users save custom card packs / shares before they
 * sign in; on first Google sign-in the anon row is upgraded with the
 * Google identity rather than discarded, so any data they collected
 * survives the upgrade.
 *
 * Development: also exposes an email/password sign-in path so dev
 * machines can run the full auth round-trip without leaving
 * localhost. The plan calls for defense-in-depth here: even if a
 * future better-auth bug exposes the routes in production, *six*
 * independent guards each fail closed.
 *
 *   1. (this file)             `emailAndPassword.enabled = isDev`
 *      — production builds tree-shake the email/password handlers
 *      out of the better-auth bundle.
 *   2. (`app/api/auth/.../route.ts`) Top-of-handler 404 for
 *      `/api/auth/sign-{in,up}/email` when `NODE_ENV !==
 *      "development"`.
 *   3. (`src/server/actions/dev-auth.ts`)  `Effect.die` on the
 *      bespoke dev-only action when `NODE_ENV !== "development"`.
 *   4. (`src/ui/account/DevSignInForm.tsx`) JSX-level
 *      `process.env.NODE_ENV === "development" && <DevSignInForm />`
 *      — Next inlines that to `false` for production builds, so the
 *      whole subtree is dead-code-eliminated from the prod bundle.
 *   5. (this file, top-of-module assertion) Throw at module load if
 *      `DEV_AUTH_ENABLED === "true"` slips into a production build.
 *   6. (`scripts/assert-no-dev-auth.mjs`) CI greps the production
 *      build artifacts for any of the dev-only identifiers; the
 *      `pnpm assert:no-dev-auth` script fails the build if any
 *      appear.
 *
 * Vercel preview deploys run `NODE_ENV=production`, so the dev
 * email/password path is unreachable on previews — testing on
 * previews uses the same Google OAuth round-trip as production.
 */
import "server-only";

import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { Pool } from "pg";

const isDev = process.env["NODE_ENV"] === "development";

// ─── Defense-in-depth layer 5 ──────────────────────────────────────
// If a misconfiguration ever leaks `DEV_AUTH_ENABLED=true` into a
// production build, fail loudly at module load — the rest of the
// stack will already block at runtime, but a failure here is
// faster to diagnose.
if (
    !isDev &&
    process.env["DEV_AUTH_ENABLED"] === "true"
) {
    throw new Error(
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        "DEV_AUTH_ENABLED is set on a non-development build. Refusing to start.",
    );
}

const databaseUrl = process.env["DATABASE_URL"] ?? "";
const baseURL =
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000";
const secret = process.env["BETTER_AUTH_SECRET"] ?? "";
const googleClientId = process.env["GOOGLE_CLIENT_ID"];
const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];

/**
 * The better-auth pool is a *separate* pg pool from the one
 * `@effect/sql-pg` uses for app data. They both talk to the same
 * Postgres but they don't coordinate transactions — never mix
 * better-auth writes inside an `@effect/sql-pg` transaction. See
 * `src/server/README.md`.
 */
const authPool = new Pool({
    connectionString: databaseUrl,
});

export const auth = betterAuth({
    database: authPool,
    secret,
    baseURL,
    emailAndPassword: {
        enabled: isDev,
    },
    ...(googleClientId !== undefined && googleClientSecret !== undefined
        ? {
              socialProviders: {
                  google: {
                      clientId: googleClientId,
                      clientSecret: googleClientSecret,
                  },
              },
          }
        : {}),
    plugins: [anonymous()],
});
