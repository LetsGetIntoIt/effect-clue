# Vercel + Neon + Google OAuth setup

Manual one-time wiring needed to deploy the server-backed features
(custom card packs, accounts, sharing) to a Vercel preview or
production. Local development against `pnpm db:up` (Docker) does NOT
need any of this — see [README.md](../README.md) "Local development"
for that flow.

Reference this doc from the PR description when shipping a milestone
that depends on any of the steps below, instead of re-listing them
inline.

## 1. Vercel project link

```bash
pnpm add -g vercel@latest
vercel link
```

Pick the existing `winclue` Vercel project. All `vercel env pull`
calls below depend on this link.

## 2. Neon Postgres (DB)

Vercel dashboard → **Storage → Browse Marketplace → Neon → Add
Integration**.

- Pick the `winclue` project.
- Accept the auto-created env vars: `DATABASE_URL`,
  `DATABASE_URL_UNPOOLED`, plus the `POSTGRES_*` aliases.
- Pick a region close to your function region.

After it provisions:

```bash
vercel env pull .env.development.local
```

Verify `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are present.
`.env.development.local` is git-ignored — never commit it.

Vercel + Neon auto-creates a Neon **branch per Vercel preview**, which
isolates each preview's migrations. Confirm in the Neon dashboard.

### GitHub Actions for Neon branch workflows

The schema-diff and preview-branch cleanup workflows authenticate to
Neon's API directly. The Vercel integration populates database
connection strings for the app, but it does not provide a GitHub
Actions API token.

Add these under GitHub repo **Settings → Secrets and variables →
Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Repository variable | `NEON_PROJECT_ID` | The Neon project ID. |
| Repository secret | `NEON_API_KEY` | A Neon API key. |

Prefer a Neon **project-scoped API key** if the project is
organization-owned: Neon Console → Organization Settings → API keys →
Create new → Project-scoped → choose the Clue project. Project-scoped
keys are limited to one project and cannot delete the associated
project.

If project-scoped keys are unavailable, create a personal API key:
Neon Console → Account settings → API keys → Create new. Neon only
shows the token once; copy it immediately and store it as the
`NEON_API_KEY` repository secret.

### Neon free-tier auto-suspend

Free-tier compute idles after a short window, adding cold-start
latency to the first request after idle. Bump the suspend timeout in
the Neon dashboard if user-facing latency is unacceptable, or move to
Pro to remove the suspend entirely.

## 3. Better-auth secret

```bash
openssl rand -hex 32
```

Take the value and add it as `BETTER_AUTH_SECRET` to all three Vercel
envs (Production / Preview / Development). Treat as a production
secret — never commit, never log.

## 4. `BETTER_AUTH_URL`

Per environment:

| Environment | Value |
| --- | --- |
| Production | `https://winclue.vercel.app` |
| Preview | `https://$VERCEL_URL` (Vercel system var — set the value literally to `https://$VERCEL_URL` in the dashboard; Vercel substitutes at runtime) |
| Development | Leave blank unless you need to force a fixed local OAuth callback URL |

better-auth uses this to build the OAuth callback URLs.
In local development, leaving it blank lets Better Auth derive the
actual `localhost` host and port from the incoming request, so Next's
automatic port fallback keeps working when 3000 is already occupied.

## 5. Google OAuth client

Required in every environment — `pnpm dev` exits at startup if either
`GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is missing (see
`src/server/authEnv.ts`). The committed `env.example` intentionally
leaves both blank: GitHub secret scanning rejects pushed values, and
keeping localhost-only credentials out of the repo avoids the "secrets
in tracked files" footgun. The README's "Google OAuth — local dev"
section walks through creating a localhost-scoped client and seeding
`.env.local` once per machine; subsequent worktrees inherit it via
`cp "$(git rev-parse --git-common-dir)/../.env.local" .env.local`.

The values below configure the **production / preview** OAuth client,
which is separate from your dev one and lives in Vercel env vars.
Production and Vercel previews fail fast on the same missing-value
check, which keeps OAuth misconfiguration from surfacing later as a
confusing missing-provider error. The dev credential path tree-shakes
out of production bundles, see CI assertion below.

1. <https://console.cloud.google.com> → **APIs & Services →
   Credentials → Create Credentials → OAuth client ID → Web
   application**.
2. **OAuth consent screen** — configure first if not already.
   - Type: External.
   - App name: "Clue Solver" (or similar).
   - Add your email + any other testers as test users.
3. **Authorized JavaScript origins** — add:
   - `https://winclue.vercel.app`
   - Any localhost ports you use for local Google OAuth, e.g.
     `http://localhost:3000`
   - Specific Vercel preview URLs as needed (Google may reject
     wildcards).
4. **Authorized redirect URIs** — add the exact callback URL for each
   environment:
   - `https://winclue.vercel.app/api/auth/callback/google`
   - The exact localhost callback URL for any local Google OAuth port
     you use, e.g. `http://localhost:3000/api/auth/callback/google`.
     Next may auto-select another port when 3000 is occupied; either
     add that exact callback too, or free/pin port 3000 before testing
     Google OAuth locally.
   - Specific preview-deploy URLs as they come up. Wildcards are not
     supported here.
5. Capture `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Add both to
   all three Vercel envs.

Re-pull locally:

```bash
vercel env pull .env.development.local
```

For local OAuth debugging, set `AUTH_DEBUG=1` before starting the dev
server. That raises Better Auth's server logger to debug level; omit
it (or set anything else) for the default warn-level logs.

## 6. Cron secret (M17 — share cleanup)

```bash
openssl rand -hex 32
```

Add as `CRON_SECRET` to all three Vercel envs. The
`app/api/crons/cleanup-shares` route refuses anything without
`Authorization: Bearer ${CRON_SECRET}`. Vercel's cron runner
auto-attaches this when invoking the route on the configured schedule
(see `vercel.ts`).

## 7. Sentry server-side init

Should already be wired from M1's `instrumentation.ts`. Confirm in
the Sentry dashboard → Project → Settings that **both** browser and
Node.js platforms are enabled. No new env vars at this milestone —
the existing `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`
cover both sides.

## 8. CI assertion: dev-auth must not leak

The `pnpm assert:no-dev-auth` step (post-build grep over
`.next/static/chunks/*.js`) fails the build if any dev-only auth
identifier — `DevSignInForm`, `signInWithDevCredentials`,
`/sign-up/email`, `/sign-in/email` — appears in the production
bundle. This is wired into `.github/workflows/ci.yml` after `pnpm
build`. If it ever fails, the dev guards regressed and the fix is to
re-tighten the layered checks in `src/server/auth.ts` /
`app/api/auth/[...all]/route.ts` / `src/ui/account/AccountModal.tsx`
— never to suppress the assertion.

## 9. PostHog dashboards (post-deploy)

After events fire at least once on a deployed environment, configure
the funnels in the PostHog UI:

| Funnel | Steps |
| --- | --- |
| Tour engagement (per `screenKey`) | `tour_started → tour_step_advanced → tour_completed` |
| PWA install | `install_prompted → install_accepted → install_completed` |
| Sign-in | `account_modal_opened (state=anon) → sign_in_started → sign_in_completed` |
| Share creation | `share_create_started → share_created → share_link_copied` |
| Share import | `share_opened → share_import_started → share_imported` |

The existing **Onboarding**
(`game_setup_started → player_added → cards_dealt → game_started`)
funnel is unchanged but is now wrapped by the setup tour — verify
completion rate doesn't regress when the tour goes live.

## 10. Honeycomb queries (post-deploy)

Save board queries:

- "Server action latency by name":
  `name like server.action.* | group by name | p50, p95`.
- "Migration apply duration":
  `name = migrations.apply | p99`.
- "Auth flow funnel": trace view filtered by `auth.*` span names.
- "Tour engagement":
  `name like tour.* | group by screenKey, status`.

## 11. Sentry alert rules

- `MigrationError` → page on-call.
- `DatabaseError` → email if rate exceeds N per hour.
- `AuthError` → log only (some are expected).
