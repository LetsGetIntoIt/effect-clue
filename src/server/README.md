# `src/server/`

Server-only Effect runtime. Server actions and Next.js API route
handlers all flow through here so they share one Postgres pool, one
migrator, and (later) one auth context per process.

## Layout

| Module | Provides |
| --- | --- |
| [`runtime.ts`](./runtime.ts) | `ServerRuntime` — singleton `ManagedRuntime` carrying the Pg pool + migrator. |
| [`withServerAction.ts`](./withServerAction.ts) | Wrapper for handlers: `withServerAction(Effect.gen(...))` returns `Promise<A>`. |
| [`migrations/`](./migrations) | Numbered TypeScript migrations + an `index.ts` registry the migrator walks at startup. |
| [`actions/`](./actions) | Server-only Effect functions invoked via `withServerAction`. M7 / M8 / M9 add real ones; `health.ts` is the sanity-check. |
| [`models/`](./models) | Effect Schema + `@effect/sql` `Model.Class` definitions for each persisted shape. Empty until M8 adds `CardPack`. |

## Conventions

- **Server-only.** Nothing in this directory imports React or
  anything from `src/ui/`. Conversely, client code never imports
  from here directly — server actions are reached through
  `withServerAction`-wrapped functions exposed under
  `src/server/actions/`, which Next.js's "use server" boundary
  takes care of marshalling across the client / server line.
- **One runtime, one pool.** The Pg pool from `PgClient.layerConfig`
  sits inside `ServerRuntime`. Every action shares it through the
  same `ManagedRuntime` instance. Don't make a second Pg layer; if a
  feature needs a different connection (e.g. a long-running batch),
  add a separately-named layer to `runtime.ts` and document why.
- **Server-mints all IDs.** Tables that have a client-side lifecycle
  before they reach the server (custom card packs are the canonical
  case — created in localStorage, optionally pushed up on sign-in)
  carry a `client_generated_id` column so the client can locate
  "its" rows after sync. Tables that are server-created on demand
  (shares) skip `client_generated_id`.
- **Migrations are TypeScript modules.** `Migrator.fromRecord(...)`
  walks `migrations/index.ts`'s static record at startup; no
  filesystem reads at runtime. Each migration is an
  `Effect<unknown, unknown, SqlClient>` that runs SQL.

## Two-pool note

Once M7 lands, the app holds **two** Postgres pools at runtime:

- `@effect/sql-pg`'s `PgClient` (this directory).
- `better-auth`'s built-in `pg` pool (in `src/server/auth.ts`).

This is acceptable for our load. The two pools talk to the same
database, but they don't coordinate transactions — never mix a
better-auth write with an `@effect/sql-pg` transaction. They share
no state apart from the DB itself.

## Migrations

See the [Database migrations] section of the repo-level
[CLAUDE.md](../../CLAUDE.md). The short version:

- **Forward-only adds.** New tables, nullable columns, new indexes.
- **No drops, no renames.** A breaking change ships as a separate
  migration-only commit, AFTER the dependent application code has
  rolled out and stabilised long enough to be confident no rollback
  will need the old shape.
- **`NOT NULL` requires a multi-step rollout.** Add the column
  nullable-with-default first, backfill, deploy app code that always
  writes the column, THEN tighten to `NOT NULL` in a follow-up
  migration.

Migrations run via `MigratorLive` on the first request after a
cold-start. The migrator's advisory lock means concurrent cold-starts
can't race; the per-request cost after the first is one cheap SELECT
against the migrator's metadata table.

## Local development

The committed [`docker-compose.yml`](../../docker-compose.yml) at the
repo root spins up a `postgres:16-alpine` service on
`localhost:5432`. The same `MigratorLive` code path that runs against
Neon in production runs against this Docker container locally, so
"works on Docker" implies "works on Vercel" for migrations.

```bash
pnpm db:up         # start postgres
pnpm db:psql       # open a psql shell
pnpm db:reset      # wipe the volume; migrations re-run on next request
```

Drop the local `DATABASE_URL` from
[`.env.example`](../../.env.example) into your `.env.local` —
nothing else needs to change to switch between Docker and Neon.

## Env vars

`runtime.ts` reads `DATABASE_URL` via `Config.redacted` so the value
never accidentally lands in a log. Pull the production-shaped vars
locally with `vercel env pull .env.development.local`, or use the
local Docker block in [`.env.example`](../../.env.example) and skip
Vercel entirely for local work.

| Variable | Owner | Used for |
| --- | --- | --- |
| `DATABASE_URL` | Neon / Vercel Marketplace | Pooled Postgres connection string. |
| `DATABASE_URL_UNPOOLED` | Neon / Vercel Marketplace | Direct (non-pooler) URL. Reserved for migration runs that need a stable session. |

M7 will add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. M8 + M9 don't add new
env vars.
