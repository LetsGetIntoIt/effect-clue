# effect-clue

A solver for the board game **Clue** (a.k.a. *Cluedo*) — a single-page web app that tracks suggestions and disproofs as you play and deduces what each player must, might, or cannot hold.

The app is offline-first: the deducer runs entirely in your browser and game state lives in `localStorage`. The `/play` page server-renders an empty skeleton on each request and hydrates from your local data on the client — there's no server-side game state. Server-backed features (custom card packs, accounts, shareable game links) layer on top in later milestones.

> **Production:** <https://winclue.vercel.app/>

---

## What it does

- Pick the cards and players in your game (standard Clue, plus optional expansion packs).
- Enter your hand and log every suggestion, who could disprove it, and which card was shown if you were the asker.
- An [Effect](https://effect.website/)-based constraint solver runs to a fixed point after every change, telling you for each (player, card) cell whether it's **owned**, **not owned**, or still **unknown** — and flags contradictions in your inputs.
- Walks you through *why* a deduction holds (provenance footnotes), recommends the next suggestion, and supports unlimited undo/redo.
- Works offline once loaded; everything persists across reloads.

---

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org/) App Router on Vercel (Fluid Compute). The `/play` page server-renders a skeleton; client hydrates from `localStorage`. |
| UI | React 19 + React Compiler, [Radix Primitives](https://www.radix-ui.com/), [Motion](https://motion.dev/), Tailwind CSS v4 |
| Logic | [Effect 4 (beta)](https://effect.website/) — the deducer, services, persistence schema, and rules are all Effect programs |
| i18n | [`next-intl`](https://next-intl.dev/) — single English locale today, structured for adding more |
| Tests | [Vitest 4](https://vitest.dev/) + Testing Library + jsdom |
| Errors | [Sentry](https://sentry.io/) (`@sentry/nextjs`) — JS errors, Web Vitals, Session Replay |
| Tracing | [Honeycomb](https://honeycomb.io/) via `@effect/opentelemetry` — Effect spans, metrics, logs |
| Analytics | [PostHog](https://posthog.com/) — typed event emitters in [`src/analytics/events.ts`](src/analytics/events.ts) |
| Hosting | Vercel (Fluid Compute). Server-side errors flow through `instrumentation.ts` → Sentry. |

---

## Repository layout

```
app/                    Next.js App Router entry — layout, providers, four routes.
  page.tsx              Server component; redirects / → /play.
  play/page.tsx         Renders <Clue/> + <SplashModal/>; the main game UI. SSR
                        emits a skeleton; the client hydrates from localStorage.
  about/page.tsx        Renders shared <AboutContent/> (motivation copy + YouTube embed).
  share/[id]/page.tsx   Reserved for the M9 server-stored share flow; 404 today.

instrumentation.ts      Next.js instrumentation hook — wires Sentry server SDK on cold-start.
instrumentation-client.ts  Next.js client instrumentation — wires Sentry browser SDK.
sentry.server.config.ts Server-side Sentry init pulled in by instrumentation.ts.

src/
  routes.ts             Single source of truth for in-app paths.
  logic/                Pure Effect game model (no React).
    GameSetup.ts          Players, card packs, dealt cards.
    Knowledge.ts          The (player × card) grid + cell values.
    Rules.ts              Deduction rules (saturate slices, propagate suggestions, …).
    Deducer.ts            Runs rules to a fixed point; returns Knowledge or ContradictionTrace.
    Suggestion.ts         Suggestion / disproof model.
    Recommender.ts        Suggests the next move.
    Provenance.ts         "Why does this cell have this value?" footnotes.
    Persistence.ts        localStorage round-trip via PersistenceSchema.
    SplashState.ts        localStorage timestamps for the about-app splash modal.
    services/             Effect services injected as ambient context (CardSet, PlayerSet, …).
  ui/                   React 19 client components.
    Clue.tsx              Top-level shell, mobile/desktop layout switch.
    state.tsx             ClueProvider — wraps deducer in useMemo, owns undo/redo.
    components/           Checklist, SuggestionForm, Toolbar, AboutContent,
                          SplashModal, YouTubeEmbed, …
    hooks/                useConfirm, useIsDesktop, useSplashGate, …
  i18n/                 next-intl provider + flat message map.
  analytics/            PostHog client + typed event emitters + Web Vitals.
  observability/        Effect → OpenTelemetry → Honeycomb runtime.

messages/en.json        UI strings.
scripts/check-i18n-keys.mjs   Audits orphan/missing translation keys.

.github/workflows/ci.yml   typecheck / lint / test / knip / i18n-check / build
renovate.json5             Dependency PRs.
CODEOWNERS                 Review routing.
```

Tests live next to source as `Foo.test.ts(x)` beside `Foo.ts(x)`.

---

## Getting started

### Prerequisites

- **Node** — version pinned in [.nvmrc](.nvmrc) (currently `22.22.2`). `engine-strict=true` in [.npmrc](.npmrc) means scripts will refuse to run on the wrong version.
- **pnpm** — `>= 10.32.0`. Required; `npm` / `yarn` / `bun` are not supported.
- **Docker** — only required if you want to exercise the server-backed features (custom card packs, accounts, sharing). The pure-client deducer doesn't need it.

### First-time setup

```bash
nvm use                          # picks the version from .nvmrc
pnpm install
cp env.example .env.local        # variable scaffolding + Docker DB defaults
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
# (see "Google OAuth — local dev" below for the one-time setup).
pnpm db:up                       # Postgres in Docker; safe to skip if you don't need server features
pnpm dev
```

Then open the local URL printed by Next.js. It is usually
<http://localhost:3000>, but Next will automatically pick another
available port when 3000 is already in use.

The third-party SDKs (Sentry, Honeycomb, PostHog) all no-op when their env vars are unset, so the app runs end-to-end with everything else blank in `.env.local` once the OAuth values are filled in.

#### Google OAuth — local dev

Better Auth requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` even in
local dev (`pnpm dev` exits at startup if either is empty — see
[src/server/authEnv.ts](src/server/authEnv.ts)). One-time setup per machine:

1. <https://console.cloud.google.com> → **APIs & Services →
   Credentials → Create Credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins** — add `http://localhost:3000`
   (and any other localhost ports you regularly use).
3. **Authorized redirect URIs** — add
   `http://localhost:3000/api/auth/callback/google` and matching
   entries for any other ports.
4. Copy the resulting client ID + secret into `.env.local`.

This is a localhost-scoped client — keeping the values out of any
tracked file (including `env.example`) avoids GitHub's secret-scanning
push protection and the "secrets in repo" footgun.

If you're deploying to a fully-provisioned environment, follow
[docs/setup-vercel-neon-google.md](docs/setup-vercel-neon-google.md)
to wire up Vercel + Neon. Production env vars live in the Vercel
dashboard — **do not** run `vercel env pull .env.local`, as that
overwrites the local Docker `DATABASE_URL` with the production URL
and parks a long-lived `VERCEL_OIDC_TOKEN` on disk. Local dev should
always default to the local Docker Postgres.

#### Worktrees inherit `.env.local`

Once the main checkout's `.env.local` is configured, every worktree
spun up via `git worktree add` (or via Claude / Codex agents under
`.claude/worktrees/<name>/`) can copy that file in one command:

```bash
cp "$(git rev-parse --git-common-dir)/../.env.local" .env.local
```

Don't symlink — edits to env in the worktree should not leak back
into the main checkout. See AGENTS.md "Worktree env setup" for the
agent-specific lifecycle.

### Local Postgres via Docker

`docker-compose.yml` at the repo root spins up a single Neon-aligned `postgres:17` service on `localhost:5432`. The default `DATABASE_URL` to drop into `.env.local` is committed in [env.example](env.example) — copy the local-Docker block. Set `POSTGRES_HOST_PORT` if port 5432 is already in use.

| Command | What it does |
| --- | --- |
| `pnpm db:up` | Start Postgres in the background. |
| `pnpm db:down` | Stop the container; data persists in the named volume. |
| `pnpm db:reset` | Stop + wipe the volume. Migrations re-run on next request. |
| `pnpm db:logs` | Tail the Postgres logs. |
| `pnpm db:psql` | Open a `psql` shell against the running container. |

Migrations apply automatically on the first server-side request after each cold start — the same code path runs in production against Neon and locally against Docker.

To deploy these features to a Vercel preview / production, see [docs/setup-vercel-neon-google.md](docs/setup-vercel-neon-google.md) for the Neon, better-auth, and Google OAuth wiring.

### Common scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server (Turbopack). |
| `pnpm build` | Production build (SSR, `next build`). |
| `pnpm start` | Serve the production build (`next start`). |
| `pnpm test` | Vitest, run mode. |
| `pnpm test:watch` | Vitest, watch mode. |
| `pnpm test:ui` | Vitest UI in the browser. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | ESLint (with `eslint-plugin-i18next` to catch hard-coded UI strings). |
| `pnpm knip` | Unused-exports / unused-deps audit. |
| `pnpm i18n:check` | Orphan-key audit against `messages/en.json`. |
| `pnpm db:up` / `db:down` / `db:reset` / `db:logs` / `db:psql` | Manage the local Docker Postgres for server features. |

### Pre-commit green-check set

These five must pass before every commit (CI runs them too — see [.github/workflows/ci.yml](.github/workflows/ci.yml)):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm i18n:check
```

---

## Environment variables

Copy [env.example](env.example) to `.env.local`. All third-party integrations are optional in local development.

### Observability (browser, optional)

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (browser). |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Source-map upload at build time only. |
| `NEXT_PUBLIC_HONEYCOMB_API_KEY` | Honeycomb ingest key (write-only, browser-safe). |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | PostHog project key + region host. |

### Server features (DB + auth)

| Variable | Used for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Local Docker default committed in [env.example](env.example); a Vercel-provisioned URL is wired in the Vercel dashboard for previews/production. |
| `DATABASE_URL_UNPOOLED` | Direct (non-pooler) Postgres URL. Reserved for migration runs that need a stable session. |
| `BETTER_AUTH_SECRET` | Server-only secret for session JWT signing. Generate with `openssl rand -hex 32`. |
| `BETTER_AUTH_URL` | Public URL of the deployed app. Leave blank in local dev so auth follows the actual auto-selected localhost port. |
| `BETTER_AUTH_PRODUCTION_URL` | Stable production URL the [`oAuthProxy`](https://better-auth.com/docs/plugins/oauth-proxy) plugin routes Google OAuth through, so Vercel previews don't need their own OAuth client. Set to the production URL on **both** Production and Preview (literal `https://winclue.vercel.app`, not `$VERCEL_URL`); leave blank in local dev. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client. **Required in every environment** — `pnpm dev` exits at startup if either is empty. Use a localhost-scoped client locally (see "Google OAuth — local dev" above); previews/production use a separate client in Vercel env vars. |

In CI/production, the build job needs `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` to upload source maps. Production also needs the DB and auth vars wired in Vercel — see [docs/setup-vercel-neon-google.md](docs/setup-vercel-neon-google.md).

Neon schema-diff and preview-branch cleanup workflows also need GitHub Actions access to Neon: set repository variable `NEON_PROJECT_ID` and repository secret `NEON_API_KEY`. See [docs/setup-vercel-neon-google.md](docs/setup-vercel-neon-google.md) for the API key setup.

---

## How the solver works (high level)

1. **State.** `GameSetup` (cards + players + your hand) and the suggestion log are the inputs. They serialise to `localStorage` via `PersistenceSchema`.
2. **Knowledge.** A grid of cells, one per (player, card), each in one of three states: owned, not owned, unknown.
3. **Rules.** [`src/logic/Rules.ts`](src/logic/Rules.ts) implements the deduction rules — slice saturation (a player's hand sums to its deal size, each card sums to one owner), suggestion propagation (if a player passed, they hold none of the three cards), and the case-file constraint (exactly one suspect / weapon / room is the solution).
4. **Deducer.** [`src/logic/Deducer.ts`](src/logic/Deducer.ts) runs rules to a fixed point inside an `Effect.gen`. Success returns derived `Knowledge`; failure returns a `ContradictionTrace` listing the offending cells and suggestion indices so the UI can highlight them.
5. **UI.** [`src/ui/state.tsx`](src/ui/state.tsx) wraps the deducer call in `useMemo`. Everything downstream is React Compiler–memoised. Undo/redo is a snapshot stack of the input state, not the output.

---

## Observability

Three integrations, all browser-side:

- **Sentry** — unhandled JS errors, Web Vitals, Session Replay. Auto-captures uncaught throws; breadcrumbs are added when we `Effect.logError`.
- **Honeycomb** — `@effect/opentelemetry` ships Effect spans / metrics / logs to OTLP HTTP. Wrap heavy or I/O-bound work in `Effect.fn("module.operation")` and run via `TelemetryRuntime` ([`src/observability/runtime.ts`](src/observability/runtime.ts)).
- **PostHog** — every product event is a typed function in [`src/analytics/events.ts`](src/analytics/events.ts). Never invent event names inline at the call site — adding/renaming events is a TypeScript-checked change.

Three production funnels are wired up — see the **Observability and analytics** section of [CLAUDE.md](CLAUDE.md) for the funnel definitions and the change-checklist that applies to every PR.

---

## CI / dependencies

- **CI** — [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs typecheck, lint, test, knip, i18n-check, and build in parallel on every PR and on `main`.
- **Renovate** — [`renovate.json`](renovate.json) opens dependency PRs.
- **CODEOWNERS** — [`CODEOWNERS`](CODEOWNERS) routes reviews.

---

## Contributing

See [CLAUDE.md](CLAUDE.md) for the full project conventions: package manager, Node version handling, the pre-commit green-check set, the observability change-checklist, the rebase workflow, and PR/commit message format. Highlights:

- Always open a PR; never push to `main`.
- Always merge with a **merge commit** (no squash, no rebase-merge).
- Tests live next to source. Add tests for any behaviour you add or change.
- For UI changes, verify in the `next-dev` preview before reporting done.

---

## License

UNLICENSED — private project, all rights reserved.
