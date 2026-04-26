# effect-clue

A solver for the board game **Clue** (a.k.a. *Cluedo*) — a single-page web app that tracks suggestions and disproofs as you play and deduces what each player must, might, or cannot hold.

The app is a client-only static SPA. There is no server, no API, and no account: state lives in `localStorage` and the deducer runs in your browser.

> **Production:** _TBD — fill in deployment URL_

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
| Framework | [Next.js 16](https://nextjs.org/) with `output: "export"` (static SPA, no SSR, no API routes) |
| UI | React 19 + React Compiler, [Radix Primitives](https://www.radix-ui.com/), [Motion](https://motion.dev/), Tailwind CSS v4 |
| Logic | [Effect 4 (beta)](https://effect.website/) — the deducer, services, persistence schema, and rules are all Effect programs |
| i18n | [`next-intl`](https://next-intl.dev/) — single English locale today, structured for adding more |
| Tests | [Vitest 4](https://vitest.dev/) + Testing Library + jsdom |
| Errors | [Sentry](https://sentry.io/) (`@sentry/nextjs`) — JS errors, Web Vitals, Session Replay |
| Tracing | [Honeycomb](https://honeycomb.io/) via `@effect/opentelemetry` — Effect spans, metrics, logs |
| Analytics | [PostHog](https://posthog.com/) — typed event emitters in [`src/analytics/events.ts`](src/analytics/events.ts) |
| Hosting | Static export — deployable to Vercel or any static host |

---

## Repository layout

```
app/                    Next.js App Router entry — layout, providers, single page.
  page.tsx              Renders <Clue/>; the entire app is one client boundary.

src/
  logic/                Pure Effect game model (no React).
    GameSetup.ts          Players, card packs, dealt cards.
    Knowledge.ts          The (player × card) grid + cell values.
    Rules.ts              Deduction rules (saturate slices, propagate suggestions, …).
    Deducer.ts            Runs rules to a fixed point; returns Knowledge or ContradictionTrace.
    Suggestion.ts         Suggestion / disproof model.
    Recommender.ts        Suggests the next move.
    Provenance.ts         "Why does this cell have this value?" footnotes.
    Persistence.ts        localStorage round-trip via PersistenceSchema.
    services/             Effect services injected as ambient context (CardSet, PlayerSet, …).
  ui/                   React 19 client components.
    Clue.tsx              Top-level shell, mobile/desktop layout switch.
    state.tsx             ClueProvider — wraps deducer in useMemo, owns undo/redo.
    components/           Checklist, SuggestionForm, Toolbar, Tooltip, …
    hooks/                useConfirm, useIsDesktop, …
  i18n/                 next-intl provider + flat message map.
  analytics/            PostHog client + typed event emitters + Web Vitals.
  observability/        Effect → OpenTelemetry → Honeycomb runtime.

messages/en.json        UI strings.
scripts/check-i18n-keys.mjs   Audits orphan/missing translation keys.

.github/workflows/ci.yml   typecheck / lint / test / knip / i18n-check / build
renovate.json              Dependency PRs.
CODEOWNERS                 Review routing.
```

Tests live next to source as `Foo.test.ts(x)` beside `Foo.ts(x)`.

---

## Getting started

### Prerequisites

- **Node** — version pinned in [.nvmrc](.nvmrc) (currently `22.22.2`). `engine-strict=true` in [.npmrc](.npmrc) means scripts will refuse to run on the wrong version.
- **pnpm** — `>= 10.32.0`. Required; `npm` / `yarn` / `bun` are not supported.

### First-time setup

```bash
nvm use            # picks the version from .nvmrc
pnpm install
cp .env.example .env.local   # only needed if you want Sentry/Honeycomb/PostHog locally
pnpm dev
```

Then open <http://localhost:3000>.

The third-party SDKs (Sentry, Honeycomb, PostHog) all no-op when their env vars are unset, so the app runs end-to-end with an empty `.env.local`.

### Common scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server (Turbopack). |
| `pnpm build` | Static export (`next build` with `output: "export"`). |
| `pnpm start` | Serve the built static export. |
| `pnpm test` | Vitest, run mode. |
| `pnpm test:watch` | Vitest, watch mode. |
| `pnpm test:ui` | Vitest UI in the browser. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | ESLint (with `eslint-plugin-i18next` to catch hard-coded UI strings). |
| `pnpm knip` | Unused-exports / unused-deps audit. |
| `pnpm i18n:check` | Orphan-key audit against `messages/en.json`. |

### Pre-commit green-check set

These five must pass before every commit (CI runs them too — see [.github/workflows/ci.yml](.github/workflows/ci.yml)):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm i18n:check
```

---

## Environment variables

Copy [.env.example](.env.example) to `.env.local`. All three integrations are optional in development.

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (browser). |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Source-map upload at build time only. |
| `NEXT_PUBLIC_HONEYCOMB_API_KEY` | Honeycomb ingest key (write-only, browser-safe). |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | PostHog project key + region host. |

In CI/production, the build job needs `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` to upload source maps; everything else is read at runtime in the browser.

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
