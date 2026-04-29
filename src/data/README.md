# `src/data/`

Application-wide data layer. Exposes React Query hooks for every
read- or write-side concern that crosses a persistence boundary
(localStorage today, server actions starting in M8). Co-located test
files cover the cache-behaviour surface that `src/logic/`'s direct
unit tests don't reach.

## Modules

| Module | Provides |
| --- | --- |
| [`QueryClientProvider.tsx`](./QueryClientProvider.tsx) | Top-level `QueryClient` + `localStorage` persister. Mounted once at `app/Providers.tsx`. |
| [`customCardPacks.ts`](./customCardPacks.ts) | `useCustomCardPacks`, `useSaveCardPack`, `useDeleteCardPack`. Wraps the pure `src/logic/CustomCardSets.ts` localStorage layer. |
| [`cardPackUsage.ts`](./cardPackUsage.ts) | `useCardPackUsage`, `useRecordCardPackUse`, `useForgetCardPackUse`. Wraps `src/logic/CardPackUsage.ts`. |

## Conventions

- **Hooks, not helpers.** Every cross-component piece of state goes
  through `useQuery` / `useMutation`. Don't sprinkle bare
  `loadCustomCardSets()` / `saveCustomCardSet()` calls in components
  — components should always read through the hooks so a single
  cache invalidation re-renders every consumer.
- **`initialData`, not `placeholderData`.** Every localStorage-backed
  query reads from disk synchronously via `initialData` so the value
  is on `data` from the very first render — no loading flicker, no
  hydration mismatch. SSR returns the empty value (`[]` /
  `new Map()`); the client picks up the localStorage snapshot on
  mount and the persister rehydrates on top of that.
- **`staleTime: Infinity`.** localStorage is the source of truth and
  doesn't change without our explicit involvement. Never refetch
  automatically; mutations call `setQueryData` directly to keep the
  cache aligned. (Once we have server queries, they'll override this
  per-query.)
- **One span per operation.** Every read and every mutation runs
  inside an `Effect.fn("rq.<module>.<verb>")` so Honeycomb sees a
  span. The TelemetryRuntime is `Layer.empty` without a Honeycomb
  key, so this is free in dev and zero-overhead in tests.
- **Query keys are module-internal until a downstream caller needs
  them.** `customCardPacksQueryKey` and `cardPackUsageQueryKey` live
  as `const` inside their respective modules. When a future feature
  (e.g. M8's sign-in flow needing to invalidate the custom-packs
  cache) imports the key, promote it to an export at that time
  rather than exporting speculatively.

## Persister cache version key

The localStorage key the React Query persister writes to is
`effect-clue.rq-cache.v1`, declared in
[`QueryClientProvider.tsx`](./QueryClientProvider.tsx).

**Bump the version suffix (`v1` → `v2`) whenever any cached query
payload changes shape in a way that would mis-decode an older entry.**
The persister doesn't introspect the cached value — it just writes
JSON and reads JSON — so a stale-shaped entry will silently feed a
newer hook a value that doesn't match its expected type. Consequences
range from "subtle render glitch" to "runtime TypeError on the first
property access."

When to bump:

- Renaming a query key (the key is part of the cached entry).
- Adding a non-optional field to a returned shape (old caches won't
  have it).
- Removing a field that the consuming hook still references.
- Changing the runtime type of a field (e.g. `string` → branded
  `Card`).
- Switching the underlying logic that produces the value in a way
  that changes its observable shape.

When NOT to bump:

- Adding optional fields that consumers handle as `undefined`.
- Adding new query keys (existing entries are unaffected).
- Internal refactors that don't change the cached value.

The version bump simply orphans every old cache entry — every user
gets a fresh re-fetch on next load. There is no migration path; we
trade a one-time refetch for the simplicity of a clean cache.
