# Card-pack sync — architecture deep dive

> **Read this first** if you're touching anything in:
>
> - `src/data/cardPacksSync.tsx` — reconcile, flush, sign-in/out
> - `src/data/customCardPacks.ts` — mutation hooks
> - `src/data/cardPacksInFlight.ts` — in-flight Promise registry
> - `src/data/serverPackCodec.ts` — wire decode helper
> - `src/logic/CustomCardSets.ts` — localStorage layer + metadata
> - `src/logic/CardPackTombstones.ts` — soft-delete tracking
> - `src/server/actions/packs.ts` — server actions
> - `src/ui/account/AccountProvider.tsx` — sign-out chokepoint
> - `src/ui/account/LogoutWarningModal.tsx` — unsynced-changes UI
> - `src/ui/components/cardPackActions.ts` — share/rename/delete
>
> The companion doc [shares-and-sync.md](./shares-and-sync.md)
> covers the sharing UX and where sync intersects with it. Read that
> first if your change is share-shaped; come here for the sync
> internals.

## TL;DR — the mental model

> *"Once I'm logged into a device, those card packs are tied to my
> account. They should stay synced to localStorage so that offline
> access still works, and all the synchronization of card packs can
> happen once I log on again."*
>
> — the user's words, [docs/shares-and-sync.md](./shares-and-sync.md)
> rule

Card-pack sync is **local-first with the server as source of truth
once signed in**:

1. localStorage is the live store the UI reads from. It works offline.
2. When the user is signed in, every save / delete also mirrors to
   the server. The mirror is best-effort — UI never blocks on it.
3. Every signed-in mount, focus, or reconnect pulls the server's
   view back and reconciles. Local-only packs (unsynced) survive
   the merge; offline edits to synced packs win locally.
4. Logout is a chokepoint: if everything's clean, the device's
   localStorage is wiped (packs are tied to the account, not the
   device) and the user is signed out. If anything is unsynced
   (offline edits, failed pushes), the user gets a structured
   warning describing what would be lost, with a "Stay logged in",
   "Try again", or "Sign out anyway" choice.

## The components, top-down

```
            ┌─────────────────────────────────────────────────────┐
            │  AccountProvider                                    │
            │  ─ provides `requestSignOut()` via context          │
            │  ─ mounts <CardPacksSync /> + <LogoutWarningModal />│
            └─────────────────────┬───────────────────────────────┘
                                  │
              ┌───────────────────┴────────────────┐
              │                                    │
   ┌──────────▼──────────┐         ┌───────────────▼──────────┐
   │  CardPacksSync      │         │  LogoutWarningModal      │
   │  (renders nothing)  │         │  (Radix AlertDialog)     │
   │                     │         │                          │
   │  ─ React Query for  │         │  ─ Lists created /       │
   │    getMyCardPacks   │         │    modified / deleted    │
   │  ─ sign-in push     │         │    sections from         │
   │  ─ applyServerSnapshot│       │    UnsyncedSummary       │
   └──────────┬──────────┘         └──────────────────────────┘
              │
     ┌────────┴──────────┐
     │  reconcile + flush│
     │  (cardPacksSync)  │
     └────────┬──────────┘
              │
   ┌──────────▼──────────────────────────┐
   │  in-flight registry                 │
   │  cardPacksInFlight.ts               │
   │  ─ trackInFlight, drainInFlight     │
   └──────────┬──────────────────────────┘
              │
   ┌──────────▼──────────────┐    ┌──────────────────────────┐
   │  Mutation hooks         │    │  Server actions          │
   │  customCardPacks.ts     │───▶│  packs.ts                │
   │  ─ useSaveCardPack      │    │  ─ getMyCardPacks        │
   │  ─ useDeleteCardPack    │    │  ─ saveCardPack          │
   │  ─ useSaveCardPackOnServer  │  ─ deleteCardPack         │
   │  ─ useDeleteCardPackOnServer│  ─ pushLocalPacksOnSignIn │
   └──────────┬──────────────┘    └──────────────────────────┘
              │
   ┌──────────▼──────────────┐    ┌──────────────────────────┐
   │  localStorage layer     │    │  Tombstones              │
   │  CustomCardSets.ts      │    │  CardPackTombstones.ts   │
   │  ─ load / save / delete │    │  ─ effect-clue.deleted-  │
   │  ─ markPackUnsynced     │    │    packs.v1              │
   │  ─ markPackSynced       │    │  ─ load / add / clear    │
   │  ─ replaceCustomCardSets│    │                          │
   │  ─ clearAccountTied…    │    │                          │
   └─────────────────────────┘    └──────────────────────────┘
```

## Per-pack metadata (the core data shape)

Each `CustomCardSet` in `effect-clue.custom-presets.v1` carries
three optional sync-related fields. They're **additive** to the
schema — old payloads decode unchanged — and they're the foundation
for every state machine in this doc.

| Field | Type | Meaning |
|---|---|---|
| `unsyncedSince` | `DateTime.Utc \| undefined` | Set on every local mutation while signed in. Cleared by a successful server roundtrip. Absent ⇒ pack is in sync (or pre-dates sync entirely). |
| `lastSyncedSnapshot` | `{ label, cardSet } \| undefined` | The server's last-known view of this pack. Set by pulls and successful pushes. **Never mutated by local edits**, so it stays a stable diff baseline across multiple offline edits. Absent ⇒ the server has never acknowledged this pack. |
| `id` | `string` | The canonical identifier the UI keys on. Equals the server's cuid2 once the pack has been pushed (or pulled); a `custom-…` ephemeral id otherwise. |

The discriminator that drives most decisions:

```ts
isSynced(p) := p.unsyncedSince === undefined
            && p.lastSyncedSnapshot !== undefined
```

Anything else needs to flush. The four cases:

|   | `unsyncedSince` set | `unsyncedSince` unset |
|---|---|---|
| **`lastSyncedSnapshot` set** | offline edit to a previously-synced pack | synced |
| **`lastSyncedSnapshot` unset** | local create, server hasn't acknowledged | local-only (anonymous-era OR new + push pending) |

## Tombstones (`effect-clue.deleted-packs.v1`)

When a signed-in user deletes a pack, the local entry is removed
immediately *and* a tombstone is written:

```ts
{ id: string; label: string; deletedAt: number /* epoch ms */ }
```

The server delete fires in parallel. On success, the tombstone is
cleared. On failure (offline / 5xx), the tombstone survives and gets
two follow-up jobs:

1. **Reconcile filter.** `reconcileCardPacks` drops any server pack
   whose `id` or `clientGeneratedId` is in the tombstone set. This
   is what stops a still-unconfirmed delete from being undone by the
   next pull.
2. **Logout warning.** `LogoutWarningModal` reads tombstones into
   the "Deleted" section so the user knows a pending delete would
   be lost on sign-out-anyway.

Tombstones for packs the server never had (e.g. a `create-then-
delete-offline` cycle) are also written; the server delete is
idempotent (DELETE WHERE owner_id AND (id OR client_generated_id))
so a no-op succeeds and the tombstone clears immediately. The brief
existence of the tombstone is acceptable.

## The mutation hooks

```
src/data/customCardPacks.ts exports four hooks
  ─ useSaveCardPack            ← unified: local + server-when-signed-in
  ─ useDeleteCardPack          ← unified: local + tombstone + server-when-signed-in
  ─ useSaveCardPackOnServer    ← server-only fallback (rare)
  ─ useDeleteCardPackOnServer  ← server-only fallback (rare)
```

The two **unified hooks** are what `CardPackRow.tsx` (the Setup
pane), `useCardPackActions` (rename / delete buttons), and any
future pack-mutating UI use. They:

- Always write to localStorage first (so the UI snaps).
- Stamp `unsyncedSince` if signed in.
- Fire the server action in parallel (idempotent on
  `(owner_id, client_generated_id)`).
- On success, swap the localStorage `id` for the server's cuid2
  (when different), set `lastSyncedSnapshot`, clear `unsyncedSince`,
  and remap usage entries via `remapCardPackUsageIds`.
- On failure, log via `Effect.logError` and leave local state alone.
  The next reconcile retries.

The two **server-only hooks** exist for one corner case:
`useCardPackActions` decides which to call by reading both query
caches. When the user has just signed in and the modal is open
*before* `applyServerSnapshot` has run, the pack might exist only in
`myCardPacksQueryKey(userId)` (the server cache) without a matching
entry in `customCardPacksQueryKey` (the local cache). Calling the
unified hook in that case would create a duplicate localStorage
entry with a fresh client id. The server-only hooks dodge that.

## The reconcile loop

`<CardPacksSync />` mounts a React Query for `getMyCardPacks` keyed
by the signed-in user id, with `refetchOnMount`,
`refetchOnWindowFocus`, and `refetchOnReconnect` all on. The
`staleTime` is `Duration.toMillis(Duration.seconds(30))` — enough
to debounce rapid focus oscillations, short enough that a real
cross-device update lands quickly.

Every successful settle triggers `applyServerSnapshot`:

```
1. await drainInFlight()           // let in-flight saves/deletes settle
2. flush tombstones                 // retry pending deletes; clear on success
3. re-read localStorage             // post-mutation source of truth
4. reconcileCardPacks(local, server, tombstoneIds)
5. replaceCustomCardSets(merged)    // write merged list back
6. remapCardPackUsageIds(idMap)     // recency map points at new ids
7. setQueryData(customCardPacksQueryKey, merged)
8. invalidate(cardPackUsageQueryKey)
```

### `reconcileCardPacks` rules (in order)

1. **Tombstones win.** Any server pack whose `id` or `clientGeneratedId`
   is in `tombstoneIds` is dropped. Any local pack whose `id` is in
   `tombstoneIds` is dropped (defensive — already gone from
   localStorage, but belt-and-braces).
2. **Pair match (clientGeneratedId).** When a local pack's `id`
   equals a server pack's `clientGeneratedId`:
   - If content matches, merge with server's `id`, clear
     `unsyncedSince`, set `lastSyncedSnapshot` to the server view.
   - If content differs and `unsyncedSince` is set on the local
     pack: **local wins** (the user's offline edit is newer).
     Preserve local label/cardSet, retain `unsyncedSince`, refresh
     the snapshot to the latest server view.
   - If content differs and `unsyncedSince` is *not* set: **server
     wins** (rename-on-push, other-device update).
3. **Exact-content duplicate.** Server pack with no
   clientGeneratedId pair-match BUT same label + cardSet as a local
   pack: server wins (already canonical), idMap remaps.
4. **Server-only.** Pulled in. Increments `countPulled`.
5. **Local-only.** Preserved with all metadata intact.

## The sign-in transition

When `useSession` flips a user from `isAnonymous: true` to a real
account, `<CardPacksSync />`'s `useEffect` fires once per `userId`:

```
1. read all localStorage packs
2. pushLocalPacksOnSignIn({ packs })   // server upserts; rename-on-collision
3. invalidateQueries(myCardPacksQueryKey(userId))
4. (the React Query refetch triggers applyServerSnapshot)
```

The push is idempotent — re-running it for the same packs (e.g.
sign-out then sign-in again on the same device) is a no-op apart
from a `updated_at` bump. Errors are logged and swallowed; the
React Query refetch doesn't depend on the push succeeding.

## The logout flow

Both `Toolbar` and `BottomNav` route their "Sign out" buttons
through `requestSignOut` (provided by `AccountProvider`'s context).
This single chokepoint runs:

```
1. flushPendingChanges()
   ─ drainInFlight
   ─ if navigator.onLine === false: return { ok: false, reason: "offline", unsynced }
   ─ retry every tombstone (deleteCardPack)
   ─ retry every pack with unsyncedSince OR no lastSyncedSnapshot (saveCardPack)
   ─ if anything still pending: return { ok: false, reason: "serverError", unsynced }
   ─ else return { ok: true }

2a. on { ok: true }: commitSignOut → clearAccountTiedLocalState → authClient.signOut
2b. on { ok: false }: open <LogoutWarningModal /> with the summary
```

`clearAccountTiedLocalState` removes exactly three keys:
`effect-clue.custom-presets.v1`, `effect-clue.deleted-packs.v1`,
`effect-clue.card-pack-usage.v1`. Game state, splash state, tour
state, and install-prompt state are deliberately **not** account-
tied and survive sign-out.

## Life of a card pack — four timelines

These walk the full state machine for the four scenarios that drive
the design. Read at least one to get a feel for how the pieces fit.

### Timeline 1: Sign-in is followed by another device's sign-in

> *Flow 1 in the original spec — "create on Device A while signed
> in, then sign in to Device B → pack should appear."*

```
T=0    Device A, signed in
       User: "+ Save as card pack" with label "Office".
       useSaveCardPack runs:
         1. saveCustomCardSet("Office", cardSet) → localStorage gets
            { id: "custom-abc", label: "Office", cardSet, ... }
         2. markPackUnsynced("custom-abc") → unsyncedSince stamped
         3. saveCardPackServer({ clientGeneratedId: "custom-abc",
            label: "Office", cardSet }) fires
       Device A's localStorage state:
         { id: "custom-abc", label: "Office",
           unsyncedSince: T0, lastSyncedSnapshot: undefined }

T+50ms Server returns row { id: "srv-xyz", clientGeneratedId:
       "custom-abc", label: "Office", cardSetData: ... }
       useSaveCardPack onSuccess:
         1. markPackSynced("custom-abc", row) → swaps id to "srv-xyz",
            sets lastSyncedSnapshot = { label: "Office", cardSet },
            clears unsyncedSince
         2. remapCardPackUsageIds("custom-abc" → "srv-xyz")
         3. clearTombstones(["custom-abc", "srv-xyz"])
       Device A's localStorage state:
         { id: "srv-xyz", label: "Office",
           unsyncedSince: undefined,
           lastSyncedSnapshot: { label: "Office", cardSet } }

T+5min User picks up Device B and signs in for the first time.
       <CardPacksSync /> mounts.
       Sign-in transition useEffect fires:
         1. localBefore = loadCustomCardSets() → [] (Device B fresh)
         2. pushLocalPacksOnSignIn({ packs: [] }) → no-op
         3. invalidateQueries(myCardPacksQueryKey(userId))
       React Query refetches getMyCardPacks → returns [{ id: "srv-xyz",
       clientGeneratedId: "custom-abc", label: "Office", ... }]
       applyServerSnapshot runs:
         1. drainInFlight (nothing to drain)
         2. tombstone flush (no tombstones)
         3. reconcileCardPacks([], [server's "Office"]) →
            countPulled=1, packs=[{ id: "srv-xyz", label: "Office",
            lastSyncedSnapshot: { ... } }]
         4. replaceCustomCardSets → Device B's localStorage now has it
       Device B's UI renders the new pack.
```

### Timeline 2: Anonymous create → sign-in

> *Flow 2 — "create while not logged in, then sign in. Then sign in
> on Device B → pack should appear."*

```
T=0    Device A, anonymous (no user, or isAnonymous: true)
       User: "+ Save as card pack" with label "Mansion".
       useSaveCardPack runs. userId === undefined (anon) — skip the
       server mirror.
       Device A's localStorage state:
         { id: "custom-abc", label: "Mansion",
           unsyncedSince: undefined, lastSyncedSnapshot: undefined }

T+10s  User clicks "Sign in with Google". Better Auth completes;
       useSession flips to { isAnonymous: false, id: "alice" }.
       <CardPacksSync />'s sign-in transition useEffect fires:
         1. localBefore = [{ id: "custom-abc", label: "Mansion", ... }]
         2. pushLocalPacksOnSignIn({ packs: [{
              clientGeneratedId: "custom-abc", label: "Mansion",
              cardSet }] })
            → server creates row with id "srv-xyz",
              clientGeneratedId "custom-abc", label "Mansion".
         3. invalidateQueries(myCardPacksQueryKey("alice"))
       React Query refetches → [{ id: "srv-xyz", clientGeneratedId:
       "custom-abc", label: "Mansion", cardSetData: ... }]
       applyServerSnapshot:
         1. drainInFlight (nothing)
         2. tombstone flush (none)
         3. reconcileCardPacks([anon-era pack], [server's pack]) →
            Phase 1 finds clientGeneratedId match. Content matches.
            Merge with server's id; lastSyncedSnapshot = server view.
         4. localStorage now: { id: "srv-xyz", label: "Mansion",
            unsyncedSince: undefined,
            lastSyncedSnapshot: { label: "Mansion", cardSet } }

T+5min Device B signs in. (Same as Timeline 1's T+5min.) The pack
       arrives via the standard pull → reconcile path.
```

**Robustness note.** If `pushLocalPacksOnSignIn` fails (offline,
5xx), the localStorage entry stays as an anonymous-era pack with
no metadata. The next `applyServerSnapshot` won't fix it (push
isn't part of reconcile). But the next time the user does *anything*
that triggers a save (rename, edit, etc.), the unified hook will
push it. And `flushPendingChanges` (called from logout) treats any
pack with `lastSyncedSnapshot === undefined` as needing a push, so
even an idle user gets retry on logout.

### Timeline 3: Two devices sign in around the same time

> *Flow 3 — "save packs on both A and B (signed out), sign in to
> both, all packs should sync."*

```
T=0    Device A signed-out. Local: pack "Hall" (custom-aaa).
       Device B signed-out. Local: pack "Library" (custom-bbb).

T+1s   Device A signs in. Sign-in push uploads "Hall".
       Server now has:  [{srv-1, custom-aaa, "Hall"}]
       Reconcile: localStorage = [{srv-1, "Hall", snapshot}]

T+2s   Device B signs in (race — A's push has already landed).
       Sign-in push uploads "Library".
       Server now has: [{srv-1, custom-aaa, "Hall"},
                        {srv-2, custom-bbb, "Library"}]
       Device B reconcile: pull both, paired with custom-bbb,
       new pull for "Hall". Device B's localStorage:
       [{srv-1, "Hall"}, {srv-2, "Library"}]

T+10s  Device A's window regains focus. React Query refetches:
       refetchOnWindowFocus is on. Returns both packs from server.
       Device A reconcile: pulls "Library". Device A's localStorage:
       [{srv-1, "Hall"}, {srv-2, "Library"}]
```

If Device B signs in *before* Device A's push completes (faster
race), Device B initially sees only its own pack. Device A's push
lands shortly after. Device B's next refetch (on focus, on
reconnect, or after staleTime expires) pulls both. The same end
state — both devices have both packs — just on a slightly longer
timeline.

### Timeline 4: Offline edits → logout

> *The "warn before discarding" logout flow.*

```
T=0    User signed in. localStorage: [{ id: "srv-1", label: "Office",
       unsyncedSince: undefined, lastSyncedSnapshot: { ... } }]

T+1m   User goes offline (DevTools throttle, plane mode).
       User renames "Office" → "Office Edition" via the modal.
       useCardPackActions.renamePack:
         findLocal("srv-1") → found
         saveLocal.mutate({ existingId: "srv-1", label: "Office Edition", cardSet })
       useSaveCardPack:
         1. saveCustomCardSet writes localStorage with new label.
            Existing pack found, label updated, snapshot retained.
         2. markPackUnsynced("srv-1") → stamps unsyncedSince
         3. saveCardPackServer({ ... }) fires → fetch fails (offline)
         4. Effect.logError → Honeycomb gets a record. mutationFn
            returns the unsynced local pack (no rethrow).
       localStorage: { id: "srv-1", label: "Office Edition",
                       unsyncedSince: T+1m,
                       lastSyncedSnapshot: { label: "Office", ... } }

T+2m   User clicks Sign out.
       requestSignOut → flushPendingChanges:
         1. drainInFlight (nothing left in flight)
         2. navigator.onLine === false → return { ok: false,
            reason: "offline", unsynced: { modified: [{ id, label,
            labelChanged: true, cardsChanged: false }], ... } }
       AccountProvider opens <LogoutWarningModal />.
       Modal renders:
         "1 edited card pack — Office Edition [renamed]"
         [Stay logged in] [Sign out anyway]

T+2m+5s
   User clicks "Stay logged in".
       Modal closes. localStorage state unchanged. Pack still
       `unsyncedSince`-stamped. User re-enables network.

T+3m   The next React Query focus fires. applyServerSnapshot runs.
       Inside it, the in-flight registry is empty AND the pack is
       still in localStorage (unsynced). Reconcile sees the pack
       paired with no server match (server still has the old
       "Office") — actually it pairs by clientGeneratedId since the
       server has it. Conflict resolution: unsyncedSince is set,
       local wins. Merged pack keeps "Office Edition" with the
       refreshed snapshot. unsyncedSince retained because content
       differs from snapshot.

       Actually we WANT the push to happen now so the server
       catches up. The reconcile alone doesn't push. So:

       At T+3m, the user's next save / delete OR the next logout
       attempt's flushPendingChanges will push it. Since this is
       the ambient background, the user typically triggers it by
       clicking sign-out again — flushPendingChanges retries the
       save, server accepts, lastSyncedSnapshot refreshes, flush
       returns { ok: true }, sign-out commits.

       (Future improvement: have applyServerSnapshot also push
       any pack with `unsyncedSince` set OR no `lastSyncedSnapshot`,
       not just retry tombstones. The flush already does this; the
       reconcile loop could.)
```

## Edge cases worth knowing

- **Share-receive feeds the local registry.** When a user accepts an
  invite/transfer share (or "Start new game with this pack" from a
  pack-only share), `useApplyShareSnapshot.applyShareSnapshotToLocalStorage`
  calls `saveOrRecognisePack` after writing the GameSession. Built-in
  packs are recognised (just `recordCardPackUse(builtIn.id)`);
  existing custom packs whose contents structurally match (per
  `cardSetEquals`) are also recognised — receiving the same shared
  deck twice doesn't accumulate duplicates in the library; only
  genuinely new decks are appended to `customCardSets` and stamped
  MRU. Sign-in is required to receive any share, so the user is
  signed in by the time the pack lands locally — `CardPacksSync`'s
  post-`/play` mount picks it up and pushes to the server like any
  other local create.
- **Race: save in flight at sign-out.** `flushPendingChanges` calls
  `drainInFlight()` first. The in-flight save settles (either
  clearing `unsyncedSince` on success or retaining it on failure),
  *then* the flush evaluates state. No false negatives.
- **Race: create-then-delete offline.** A pack with no
  `lastSyncedSnapshot` is still tombstoned on delete. The server
  delete is a no-op (server never had it). Tombstone clears
  immediately. Briefly visible in the logout warning if the user
  signs out between the delete and the tombstone clear, but
  expected — they did just delete a pack.
- **Race: concurrent edit on another device.** Device A edits a
  pack while offline. Device B edits the same pack and pushes. When
  A reconnects, the next pull's reconcile finds the
  clientGeneratedId pair-match with differing content. A's local
  has `unsyncedSince` set → **local wins**. The server's view
  becomes the new `lastSyncedSnapshot`. A's next push (next save or
  next flush) overwrites the server's version. B picks up the change
  on its next refetch.
- **First sign-in then immediate logout.** The sign-in push
  populates `lastSyncedSnapshot` via the post-push reconcile. So a
  brand-new sign-in followed by an immediate sign-out doesn't
  trigger the warning. **However**, if the sign-in push *fails*,
  packs stay metadata-less. `flushPendingChanges` treats those as
  needing a push (the `lastSyncedSnapshot === undefined` path) and
  retries. The warning fires only if the retry *also* fails.
- **`navigator.onLine` lying.** Captive portals / DNS issues report
  `online: true` but block requests. We try anyway and treat any
  network failure as `reason: "serverError"`. The user sees the
  same warning UI with a "Try again" button.
- **Two browser tabs, same user.** No broadcast channel; each tab's
  reconcile is independent and idempotent. Worst case both push;
  the server upserts on `(owner_id, client_generated_id)` and
  dedups.
- **Anonymous → signed-in transition with already-existing
  localStorage.** Those anonymous-era packs are pushed in the sign-in
  transition. They become "synced" via the post-push reconcile. The
  eventual sign-out clears them off the device (per the "packs are
  tied to the account" rule).

## Common change scenarios

### Adding a new field to the persisted pack shape

1. Add the field to `PersistedCustomCardSetSchema` in
   `src/logic/CustomCardSets.ts`. Use `Schema.optional` so old
   payloads still decode.
2. Map it through `loadCustomCardSets` (decode) and `writeAll`
   (encode). Wire in the `DateTime`/`Duration` conversions at the
   storage edge.
3. Surface it on the `CustomCardSet` interface with an explicit
   `| undefined` (the project's `exactOptionalPropertyTypes` is on).
4. If the field affects sync decisions, update the discriminator
   logic in `summarizeUnsynced` and the flush's `needsPush` check.
5. Add unit tests for the round-trip and any state-transition logic.

### Adding a new mutation that should sync

1. Decide whether to hang it off the existing unified hook or add a
   new one. If it's a cardSet-shape mutation (rename, edit cards,
   etc.), `useSaveCardPack` already handles it via `existingId`.
2. If it's a different shape (e.g. archive a pack), follow the same
   pattern: local-first, then server mirror via `Effect.fn` +
   `trackInFlight`. On success use `markPackSynced` (or a new
   marker). On failure log via `Effect.logError` and leave local
   state alone.
3. If the mutation introduces a new "unsynced" state, extend
   `summarizeUnsynced` so the logout warning describes it.
4. Update this doc with a new timeline if the state machine got
   more complex.

### Adding a new account-tied localStorage key

1. Add the key constant.
2. Add it to `clearAccountTiedLocalState` in
   `src/logic/CustomCardSets.ts`.
3. Update the `clearAccountTiedLocalState` test in
   `src/logic/CustomCardSets.test.ts` so the assertion lists the
   new key.
4. Update the [Logout flow](#the-logout-flow) section above.

## Storage keys (canonical list)

| Key | Owner | Cleared on logout? | Notes |
|---|---|---|---|
| `effect-clue.custom-presets.v1` | `CustomCardSets.ts` | ✅ | The pack library, with sync metadata. |
| `effect-clue.deleted-packs.v1` | `CardPackTombstones.ts` | ✅ | Soft-delete tracking for unconfirmed server deletes. |
| `effect-clue.card-pack-usage.v1` | `CardPackUsage.ts` | ✅ | Per-pack last-used timestamps. |
| `effect-clue.session.v7` | `state.tsx` | ❌ | In-progress game state. Not account-tied. |
| `effect-clue.splash.v1` | `useSplashGate.tsx` | ❌ | Welcome modal dismissal. Not account-tied. |
| `effect-clue.tour.*` | `tour/*` | ❌ | Per-screen tour gates. Not account-tied. |
| `effect-clue.install-prompt.v1` | `useInstallPrompt.tsx` | ❌ | PWA install nag suppression. Not account-tied. |

## Updating this doc

This file is the authoritative source for the sync architecture.
**Per [CLAUDE.md → Sharing and sync docs](../CLAUDE.md), any change
that touches the files listed at the top of this doc must also
update this file.** That includes:

- Renaming a hook, splitting one into many, merging two.
- Adding a new sync metadata field.
- Changing the conflict-resolution rules in `reconcileCardPacks`.
- Changing what `clearAccountTiedLocalState` clears.
- Adding a new error path or wire shape.

If you can't articulate the change in terms of one of the timelines
above, the change probably warrants a new timeline.
