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
import type { BaseURLConfig } from "better-auth";
import { anonymous, oAuthProxy } from "better-auth/plugins";
import { Pool } from "pg";
import { googleProviderConfig } from "./authEnv";
import { LOCAL_DATABASE_URL } from "./localDatabase";

const isDev = process.env["NODE_ENV"] === "development";
const isLocalRuntime = process.env["NODE_ENV"] !== "production";
const AUTH_DEBUG_ON = "1";
const LOCAL_AUTH_PROTOCOL = "http" as const;
const LOGGER_LEVEL_DEBUG = "debug" as const;
const LOGGER_LEVEL_WARN = "warn" as const;
const FIELD_ACCOUNT_ID = "account_id" as const;
const FIELD_ACCESS_TOKEN = "access_token" as const;
const FIELD_ACCESS_TOKEN_EXPIRES_AT =
    "access_token_expires_at" as const;
const FIELD_CREATED_AT = "created_at" as const;
const FIELD_EMAIL_VERIFIED = "email_verified" as const;
const FIELD_EXPIRES_AT = "expires_at" as const;
const FIELD_ID_TOKEN = "id_token" as const;
const FIELD_IP_ADDRESS = "ip_address" as const;
const FIELD_IS_ANONYMOUS = "is_anonymous" as const;
const FIELD_PROVIDER_ID = "provider_id" as const;
const FIELD_REFRESH_TOKEN = "refresh_token" as const;
const FIELD_REFRESH_TOKEN_EXPIRES_AT =
    "refresh_token_expires_at" as const;
const FIELD_UPDATED_AT = "updated_at" as const;
const FIELD_USER_AGENT = "user_agent" as const;
const FIELD_USER_ID = "user_id" as const;

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

const optionalEnv = (name: string): string | undefined => {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") return undefined;
    return value;
};

const requiredBaseURL = (): BaseURLConfig => {
    const value = optionalEnv("BETTER_AUTH_URL");
    if (value !== undefined) return value;
    if (isLocalRuntime) {
        return {
            allowedHosts: ["localhost:*", "127.*:*", "[::1]:*"],
            protocol: LOCAL_AUTH_PROTOCOL,
        };
    }
    throw new Error(
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing configuration error.
        "BETTER_AUTH_URL is required outside local development.",
    );
};

const requiredDatabaseUrl = (): string => {
    const value = optionalEnv("DATABASE_URL");
    if (value !== undefined) return value;
    if (isLocalRuntime) return LOCAL_DATABASE_URL;
    throw new Error(
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing configuration error.
        "DATABASE_URL is required outside local development.",
    );
};

const databaseUrl = requiredDatabaseUrl();
const baseURL = requiredBaseURL();
const secret = process.env["BETTER_AUTH_SECRET"] ?? "";
const socialProviders = googleProviderConfig();
// Stable production URL used by the OAuth proxy plugin: every Vercel
// preview deployment routes its OAuth round-trip through this URL so
// only the production callback needs to be registered with Google.
// Optional in local dev — the plugin is a no-op when `productionURL`
// is undefined or matches `baseURL`.
const productionURL = optionalEnv("BETTER_AUTH_PRODUCTION_URL");

/**
 * Origins (preview hosts, localhost) that production accepts as valid
 * redirect targets when handing the encrypted OAuth profile back from
 * the proxy hop. Better Auth supports glob wildcards for the host
 * portion since 1.5 — patterns are matched against the full origin.
 *
 * Vercel preview hostnames for this project follow the pattern
 * `effect-clue-{branch-or-hash}-lets-get-into-it.vercel.app` (the
 * project name is `effect-clue`; `winclue.vercel.app` is just the
 * production alias). The wildcard below matches both the
 * git-branch and the deployment-hash variants.
 *
 * Keep this list in sync with the Vercel project's actual URLs. If
 * the team slug ever changes, update the wildcard accordingly —
 * production will start returning "Invalid origin" 403s on previews
 * the moment a preview URL stops matching.
 */
const trustedOrigins: Array<string> = [
    "https://winclue.vercel.app",
    "https://effect-clue.vercel.app",
    "https://effect-clue-*-lets-get-into-it.vercel.app",
    "http://localhost:*",
];

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
    trustedOrigins,
    emailAndPassword: {
        enabled: isDev,
    },
    user: {
        fields: {
            emailVerified: FIELD_EMAIL_VERIFIED,
            createdAt: FIELD_CREATED_AT,
            updatedAt: FIELD_UPDATED_AT,
        },
    },
    session: {
        fields: {
            userId: FIELD_USER_ID,
            expiresAt: FIELD_EXPIRES_AT,
            ipAddress: FIELD_IP_ADDRESS,
            userAgent: FIELD_USER_AGENT,
            createdAt: FIELD_CREATED_AT,
            updatedAt: FIELD_UPDATED_AT,
        },
    },
    account: {
        fields: {
            userId: FIELD_USER_ID,
            accountId: FIELD_ACCOUNT_ID,
            providerId: FIELD_PROVIDER_ID,
            accessToken: FIELD_ACCESS_TOKEN,
            refreshToken: FIELD_REFRESH_TOKEN,
            idToken: FIELD_ID_TOKEN,
            accessTokenExpiresAt: FIELD_ACCESS_TOKEN_EXPIRES_AT,
            refreshTokenExpiresAt: FIELD_REFRESH_TOKEN_EXPIRES_AT,
            createdAt: FIELD_CREATED_AT,
            updatedAt: FIELD_UPDATED_AT,
        },
    },
    verification: {
        fields: {
            expiresAt: FIELD_EXPIRES_AT,
            createdAt: FIELD_CREATED_AT,
            updatedAt: FIELD_UPDATED_AT,
        },
    },
    socialProviders,
    logger: {
        level:
            process.env["AUTH_DEBUG"] === AUTH_DEBUG_ON
                ? LOGGER_LEVEL_DEBUG
                : LOGGER_LEVEL_WARN,
    },
    plugins: [
        anonymous({
            schema: {
                user: {
                    fields: {
                        isAnonymous: FIELD_IS_ANONYMOUS,
                    },
                },
            },
        }),
        // Vercel preview deploys can't register a stable OAuth
        // callback URL with Google (preview hosts are dynamic per
        // branch / per deploy). The proxy plugin pivots OAuth
        // callbacks through `productionURL` — Google calls back to
        // production, production encrypts the profile with
        // `BETTER_AUTH_SECRET` and redirects the encrypted blob to
        // the preview, the preview decrypts and writes the session
        // to its own DB. The plugin is a no-op when `currentURL`
        // (auto-derived from the request / `VERCEL_URL`) matches
        // `productionURL`, so production behaviour is unchanged.
        // See `docs/setup-vercel-neon-google.md` for the per-env
        // env-var setup that makes this work end-to-end.
        oAuthProxy({
            ...(productionURL !== undefined ? { productionURL } : {}),
        }),
    ],
});
