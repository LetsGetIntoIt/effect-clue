# Sharing and sync — UX, server, and DB end-to-end

> **Read this first** if you're touching anything in `src/ui/share/`,
> `src/server/actions/shares.ts`, `src/logic/ShareCodec.ts`, any
> `shares` DB column, or the card-pack sync pipeline
> (`src/data/cardPacksSync.tsx`, `src/data/customCardPacks.ts`,
> `src/server/actions/packs.ts`, `src/logic/CustomCardSets.ts`,
> `src/logic/CardPackTombstones.ts`). Three load-bearing rules drive
> the sharing design — see *Universal sign-in*, *Kind-based wire
> contract*, and *Effect-Schema-validated wire format* below. The
> card-pack sync architecture has its own deep-dive in
> [card-pack-sync.md](./card-pack-sync.md) — start there if you're
> touching mutation hooks, the reconcile loop, the logout flush,
> tombstones, or the unsynced-changes warning.
>
> Sharing and sync share infrastructure: both are auth-gated, both
> use `useSession` / `requireSignedInUser` plumbing, and both touch
> the same `card_packs` server-side rows when a transferred game's
> card pack happens to also be in the sender's synced library. Where
> they differ is the wire shape and the lifecycle — sharing emits
> ephemeral one-shot snapshots that the receiver imports; sync
> maintains a continuously-reconciled mirror of the user's library
> across every device they sign in on.

## What sharing is

A user copies a `https://winclue.vercel.app/share/{id}` link and sends
it to someone (often themselves). Game/setup links replace the
recipient's local Clue Solver game state with the sender's snapshot.
Card-pack-only links are additive: they save the shared pack to the
recipient's card-pack library and mark it as recently used without
changing the current game.

There are three sender flows, all written by the same modal
([src/ui/share/ShareCreateModal.tsx](../src/ui/share/ShareCreateModal.tsx))
parameterised by a `variant` prop. The receiver doesn't see flow
variants — the receive page
([src/ui/share/ShareImportPage.tsx](../src/ui/share/ShareImportPage.tsx))
just summarises what's in the link.

## The three sender flows

| Variant | Entry points | What ships | Notes |
|---|---|---|---|
| `pack` | Card-pack row in Setup ("Share this pack" button), per-pack share icon in the "All card packs" picker | Card pack only | Picker entry passes `forcedCardPack` so the share contains the *picked* pack rather than the live setup pack |
| `invite` | Setup pane near the Start playing CTA, overflow menu ("Invite a player") | Card pack + players + hand sizes + `firstDealtPlayerId`; optional checkbox adds suggestions + accusations together when at least one of either has been logged | Checkbox is hidden when neither suggestions nor accusations exist. Label adapts to what's there: "Include all N prior suggestions and M failed accusations", "Include all N prior suggestions", or "Include all M prior failed accusations". `firstDealtPlayerId` rides every invite — it's publicly known game state, every player at the physical table heard it called out. **No hypotheses, no `selfPlayerId`, no `dismissedInsights`** — those are personal scratch notes / identity; another player shouldn't see them. |
| `transfer` | Overflow menu only ("Continue on another device") | Everything: card pack + players + hand sizes + known cards + suggestions + accusations + **hypotheses + `selfPlayerId` + `firstDealtPlayerId` + `dismissedInsights` + `hypothesisOrder`** | Renders a prominent privacy warning above the CTA — this link discloses your hand AND your in-progress hunches. Restores identity + dismissed insights + hypothesis ordering on the receiving device so the user lands back exactly where they left off (no "Who are you?" re-prompt). |

The flow taxonomy intentionally hides the underlying column structure
from the user. Earlier versions of the modal exposed four toggles
(`cardPack` / `players` / `knownCards` / `suggestions`) and asked
the user to model their own intent — users couldn't predict what
each toggle would do, and the dependency rules ("knownCards requires
players, players requires cardPack…") were UX debt. The variant
mapping replaces that.

## Universal sign-in rule

Every share requires an authenticated, non-anonymous user.
Anonymous-plugin sessions count as *not* signed in — they don't
provide a durable identity to associate the share with.

Enforcement lives at one place: the top of `createShare` in
[src/server/actions/shares.ts](../src/server/actions/shares.ts).

```ts
const ownerId = await realUserId();
if (ownerId === null) throw new Error(ERR_SIGN_IN_REQUIRED);
```

The previous "custom packs require sign-in, built-in packs don't"
gate was both a security gap (the client controlled
`cardPackIsCustom`, the server trusted it) and unnecessary surface.
With universal sign-in there's no client-trusted flag and the modal's
CTA logic collapses to a single rule:

- Anonymous (no session OR `isAnonymous: true`) → CTA reads
  "Sign in or create account to share" and clicking it slides into
  the inline sign-in step.
- Signed-in non-anonymous → CTA reads "Generate link" and walks the
  user through a deliberate three-click flow:
  1. **Generate link** → fires `createShare`. The URL appears inside
     the white box and a QR SVG is generated client-side via
     [lean-qr](https://github.com/davidje13/lean-qr) so the
     "Show QR code" reveal under the input is instant. The OS
     clipboard is **not** touched here.
  2. **Copy link** → writes the URL to the clipboard. Either this
     bottom CTA or the inline "Copy link" button next to the URL
     advances the modal — both run the same copy helper.
  3. **Done** → closes the modal.
  The inline button always reads "Copy link"; only its leading icon
  swaps (clipboard → check → clipboard) for ~15 seconds after the
  most recent copy. QR is one-way reveal — once shown it stays shown
  for the open modal session.

After the inline sign-in completes, `pendingRetryRef` re-fires
`createShare` automatically — the user doesn't have to click the
CTA twice.

The DB enforces the same rule structurally: the `shares.owner_id`
column is `NOT NULL` (migration
[0006_shares_owner_required.ts](../src/server/migrations/0006_shares_owner_required.ts)).
If a future bug ever lets a null owner reach the INSERT, Postgres
rejects it before any data lands.

## Kind-based wire contract

`createShare`'s public input is a discriminated union by `kind`:

```ts
type CreateShareInput =
  | { kind: "pack"; cardPackData: string }
  | { kind: "invite"; cardPackData; playersData; handSizesData;
      firstDealtPlayerIdData;                  // publicly known
      suggestionsData?; accusationsData? }     // pair both or neither
  | { kind: "transfer"; cardPackData; playersData; handSizesData;
      knownCardsData; suggestionsData; accusationsData;
      hypothesesData;                          // private scratchwork
      selfPlayerIdData;                        // sender's identity
      firstDealtPlayerIdData;                  // publicly known
      dismissedInsightsData;                   // private scratchwork
      hypothesisOrderData };                   // private scratchwork
```

Per-kind wire-field coverage:

| Wire field | `pack` | `invite` | `transfer` |
|---|---|---|---|
| `cardPackData` | yes | yes | yes |
| `playersData` | — | yes | yes |
| `handSizesData` | — | yes | yes |
| `knownCardsData` | — | — | yes |
| `suggestionsData` | — | optional (paired with accusations) | yes |
| `accusationsData` | — | optional (paired with suggestions) | yes |
| `hypothesesData` | — | — | yes |
| `firstDealtPlayerIdData` | — | yes | yes |
| `selfPlayerIdData` | — | — | yes |
| `dismissedInsightsData` | — | — | yes |
| `hypothesisOrderData` | — | — | yes |
| `teachModeData` | — | — | yes |

The `firstDealtPlayerId` field is the only identity-related slice
that crosses to a different player — it's publicly-known game state
("Player X was dealt the first card") that every player at the
physical table heard called out. The other identity / scratchwork
fields (`selfPlayerId`, `dismissedInsights`, `hypothesisOrder`, plus
`hypotheses` itself) are `transfer`-only by design: an invite share
goes to *another* player who picks their own identity and starts
with empty scratchwork.

`teachModeData` is `transfer`-only for a different reason: it's a
per-game user preference. Sending it on a transfer means the user's
destination device inherits the mode (no "did I have teach-me on?"
re-prompt). Invite shares deliberately omit it — the receiver is a
different player who may or may not want teach-me mode; the import
modal offers an optional opt-in checkbox so they pick for themselves.
The user's actual teach-me marks (`userDeductions`) are NEVER on the
wire for any share kind — they're personal scratchwork; the receiver
always starts with an empty marks board.

The server whitelists the fields each `kind` is allowed to carry.
A `kind: "pack"` request with an extraneous `playersData` is
rejected with `ERR_MALFORMED_INPUT`. A `kind: "invite"` request with
only one of `suggestionsData` / `accusationsData` is rejected with
`ERR_MALFORMED_INPUT:suggestions_pair`.

This narrows the malicious-client surface significantly. With the
old "client sends 6 independent fields + a `cardPackIsCustom` auth
flag" design, a client could selectively include private fields under
any auth condition. With the kind-discriminated design:

- A malicious client can forge `kind` — but every kind requires
  sign-in, so there's no auth-bypass to gain.
- A malicious client can ship tampered data inside an allowed kind
  — but the share is tied to *their* `owner_id` so the consequences
  are bounded.
- A malicious client can NOT smuggle `knownCardsData` through a
  `kind: "pack"` request, because the server rejects unknown fields
  per kind.

The `kind` is **not** stored in the DB — column nullability is the
discriminator on the read side. `kind: "pack"` writes only
`snapshot_card_pack_data`; everything else stays NULL. Adding a new
kind is a wire-and-server change, not a schema change.

## Effect-Schema-validated wire format

All twelve wire fields round-trip through Effect `Schema` codecs in
[src/logic/ShareCodec.ts](../src/logic/ShareCodec.ts):

```ts
export const cardPackCodec            = Schema.fromJsonString(CardSetSchema);
export const playersCodec             = Schema.fromJsonString(...);
export const handSizesCodec           = Schema.fromJsonString(...);
export const knownCardsCodec          = Schema.fromJsonString(...);
export const suggestionsCodec         = Schema.fromJsonString(...);
export const accusationsCodec         = Schema.fromJsonString(...);
export const hypothesesCodec          = Schema.fromJsonString(...);
export const selfPlayerIdCodec        = Schema.fromJsonString(...);
export const firstDealtPlayerIdCodec  = Schema.fromJsonString(...);
export const dismissedInsightsCodec   = Schema.fromJsonString(...);
export const hypothesisOrderCodec     = Schema.fromJsonString(...);
export const teachModeCodec           = Schema.fromJsonString(Schema.Boolean);
```

Each codec packages "JSON-string ↔ schema-validated object" into one
transform. The codec is the single source of truth used by:

- The sender (`ShareCreateModal.buildPackInput` /
  `buildInviteInput` / `buildTransferInput`) to encode domain values
  to JSON strings on the way out.
- The server (`createShare`'s `validateInputShape`) to round-trip-
  validate every present wire field before insert. Malformed JSON
  or wrong-shape data throws `ERR_MALFORMED_INPUT:<field-name>`.
- The receiver (`useApplyShareSnapshot.buildSessionFromSnapshot`) to
  decode each non-null wire field back into the domain shape, with
  branded ids (`Player`, `Card`) preserved through the round-trip.

The card pack wire shape carries a `name` field
([CardSetSchema](../src/logic/PersistenceSchema.ts)) that the sender
populates with the user-facing pack label when known. The receiver
falls back to a structural cardSetEquals check against `CARD_SETS`
to detect built-ins — the `name` is informational, not authoritative.

## Receiver flow

1. URL `/share/{id}` is hit.
2. The Next.js page handler at
   [app/share/[id]/page.tsx](../app/share/[id]/page.tsx) calls
   `getShare({ id })` server-side.
3. `getShare` reads the snapshot row + `LEFT JOIN "user"` for the
   sender's display name + anonymous flag, returns
   `ShareSnapshot`.
4. `ShareImportPage` renders a modal based on the snapshot contents:
   - Pack-only shares use a card-pack title and CTA. The contents
     heading names the pack when available, then lists only the pack
     categories/counts.
   - Invite/setup shares use a shared-game setup title and CTA.
   - Transfer/progress shares use a continue-game title and CTA.
   - "Shared by {name}" line, only when `ownerName !== null`
     (server collapses to null for anonymous-plugin owners).
   - A contents header + a bulleted list — one bullet
     per non-null snapshot slice, with values:
     `Card pack: Master Detective` or `Card pack: My Office (custom)`,
     `Players (4): Alice, Bob, Carol, Dana`,
     `Hand sizes`,
     `Known cards (12)`, etc.
   - One CTA matched to the inferred receive flow. **Anonymous users
     get "Sign in to import" instead** — see *Universal sign-in (receive
     side)* below.
5. Click:
   - Pack-only → decodes `cardPackData` and routes through
     `saveOrRecognisePack`. Built-in packs (matched by `cardSetEquals`
     against `CARD_SETS`) just stamp the built-in id as
     most-recently-used; existing custom packs whose contents match
     are likewise recognised (no duplicate library entry); only
     genuinely new decks are appended to the local `customCardSets`
     registry. The pack is NOT auto-loaded into the live setup;
     instead a follow-up confirm dialog asks "Card pack {label} saved.
     Would you like to start a new game with this pack?" with cancel
     "Not now" (default focus) and confirm "Start new game with this
     pack". When the receiver has a game in progress, the standard
     overwrite warning is appended to the message. "Start new game"
     calls `applyShareSnapshotToLocalStorage` with the same pack-only
     snapshot, which clears game state and uses the imported deck.
   - Invite / transfer → standard "Start a new game?" confirm fires
     first when there's persisted game data; on accept,
     `useApplyShareSnapshot()` decodes each wire field via the codec,
     builds a `GameSession`, writes the new state to `localStorage`,
     AND also routes through `saveOrRecognisePack` so the imported
     deck appears in the local registry (or recognises an existing
     match) and lights up the active pill in `CardPackRow` once the
     user lands on `/play`. For invite shares, the modal additionally
     offers an optional **identity + cards-in-hand picker** (see
     "Invite-share import-time picker" below) whose selections are
     applied as receiver-side overrides during hydration — no wire
     format change.
6. Router pushes to `/play`.

**Hydration semantics:** the share is the new game. Sections present
in the snapshot replace the matching slice; sections absent are
blanked (because they may reference cards from the receiver's old
pack). Pack-only shares stash the pack in the local registry and ask
before swapping it into the live setup. Defensive empty-share branch
(no card pack — unreachable from the new sender flows but possible
for legacy / direct API calls) renders an empty-state message and
disables Import.

**Why shipping `dismissedInsights` "just works" on receive:** the
`dismissedKey` in each behavioral insight (`BehavioralInsights.ts`)
is a deterministic string of the form
`<DetectorKind>:<Player>:<Card>` — e.g.
`"FrequentSuggester:Alice:Knife"`. All inputs to that key —
`players`, `cards`, `selfPlayerId` — already round-trip through the
wire format intact. So when the receive side runs `generateInsights()`
over the imported game, the regenerated insights produce *the same
dismissed keys*. The shipped
`dismissedInsights: Map<dismissedKey, confidence>` plugs straight
in — no key-rewriting or ID-resolution layer needed. If the
detector-kind enum or cell encoding ever changes, that's a
forward-only versioning concern for the codec (same as any other
wire field), not a new design problem.

**`hypothesisOrder` precedence on receive:** when a transfer payload
carries both `hypothesesData` and `hypothesisOrderData`, the explicit
order wins — that's what the sender saw rendered, most-recent-first.
When only `hypothesesData` is present (older transfer rows from
pre-migration shares, or future kinds that ship hypotheses without
the order column), the receive side falls back to the array iteration
order in `hypothesesData`.

## Universal sign-in (receive side)

Just like creating a share, **receiving a share requires a non-
anonymous account**. The CTA on the receive modal reads
"Sign in to import" for anonymous users; click → save a sessionStorage
intent (`effect-clue.pending-import.v1`, see
[src/ui/share/pendingImport.ts](../src/ui/share/pendingImport.ts))
keyed by the current `shareId` and a fresh epoch-millis timestamp,
then call `authClient.signIn.social({ provider, callbackURL:
window.location.pathname })`. After OAuth lands the user back on
`/share/{id}`, `ShareImportPage`'s `useEffect` consumes the intent and
auto-fires the same `performImport` path that the button would have.

The malicious-URL safety property is what justifies the auto-import:
a third party who sends a `/share/{id}` URL has no way to populate
sessionStorage on the recipient's tab, so an idle visit never
auto-imports — the modal renders normally and waits for explicit
user action. The `consumePendingImportIntent` helper enforces three
checks: (1) the stored shareId matches the current page's, (2) the
saved timestamp is within `Duration.minutes(10)` of now, and (3)
single-use — `consume` always clears the entry, so a successful
import can't be replayed by a follow-up share's auto-import path.

## Invite-share import-time picker (identity + cards in hand)

`invite` shares omit the sender's identity and the sender's hand from
the wire — those are private to the sender, and the receiver is a
different player with a different perspective. Historically the
receiver landed on `/play?view=checklist` with `selfPlayerId === null`
and had to find the setup wizard's identity step to fill it in.

The receive modal now offers two **optional** sections for
`invite` shares only (gated on `receiveFlow === RECEIVE_FLOW_INVITE`):

1. **"Which player are you?"** — a pill row of the share's roster.
   Clicking a pill toggles it active; clicking again deselects.
2. **"Which cards are in your hand?"** — reveals only after an identity
   is picked. Renders `CardSelectionGrid` in single-column mode for the
   picked player, fed by snapshot-derived `cardSet` + `handSizes` +
   `firstDealtPlayerId`. A mini-deducer (`deduceSync`) runs against the
   snapshot setup + the user's picks so the auto-fill-red-when-full
   visual mirrors the wizard.

Changing the identity discards previously-picked cards (they belong
to a different player's hand). Both sections are skippable — the Join
CTA always works regardless.

**No wire format change.** The picks are receiver-side overrides
applied during `buildSessionFromSnapshot` via a new `ApplyOverrides`
parameter. `selfPlayerId` resolution becomes
`override ?? snapshot.selfPlayerIdData ?? null`; an `undefined`
override falls back to snapshot, an explicit `null` is preserved as
"user picked nothing." `knownCards` overrides similarly group the
flat `KnownCard[]` shape into the wire's hands-per-player shape and
replace `snapshot.knownCardsData` (invite has none anyway).

**OAuth round-trip preservation.** Anonymous users see the picker
from the start. Clicking "Sign in to import" encodes the current
picks via the same `selfPlayerIdCodec` + `knownCardsCodec` from
[ShareCodec.ts](../src/logic/ShareCodec.ts) and stores them as
optional fields on the `pendingImport` intent alongside the shareId.
After OAuth returns, `consumePendingImportIntent` surfaces the
override strings; `decodeOverridesFromPendingImport` turns them back
into `ApplyOverrides` and `performImport` applies them so auto-import
proceeds without a second click. A separate `peekPendingImportIntent`
(read-without-clearing) restores picks into modal-local state when
the user navigates back from the OAuth provider before completing
sign-in — picks don't disappear mid-flow.

The `pendingImport` shape now distinguishes:
- `null` from `consume`/`peek` → no valid intent (no entry / wrong
  shareId / expired / malformed).
- `{}` from `consume`/`peek` → intent matched but carried no picks
  (pre-picker behavior, transfer/pack auto-import).
- `{ selfPlayerIdData? , knownCardsData? }` → intent matched with
  partial or full picker overrides.

Decode failures on the override strings (stale codec shape, tampered
sessionStorage) silently drop the override and fall back to the
no-override import — the same outcome as a pre-picker intent.

## DB representation

Migration history:
- [0004_shares.ts](../src/server/migrations/0004_shares.ts) — initial
  table with the six nullable snapshot columns + nullable `owner_id`.
- [0005_share_expiry_backfill.ts](../src/server/migrations/0005_share_expiry_backfill.ts)
  — sets `expires_at` on legacy rows that pre-dated TTL, plus an
  index for the cron cleanup.
- [0006_shares_owner_required.ts](../src/server/migrations/0006_shares_owner_required.ts)
  — tightens `owner_id` to `NOT NULL` (M22 universal sign-in).
- [0007_shares_hypotheses.ts](../src/server/migrations/0007_shares_hypotheses.ts)
  — adds `snapshot_hypotheses_data` for the `transfer` kind.
- [0008_shares_identity_and_scratchwork.ts](../src/server/migrations/0008_shares_identity_and_scratchwork.ts)
  — adds four nullable columns: `snapshot_self_player_id_data`,
  `snapshot_first_dealt_player_id_data`,
  `snapshot_dismissed_insights_data`, `snapshot_hypothesis_order_data`.

Schema (post-0008):

```sql
shares (
  id                                       TEXT PRIMARY KEY,
  owner_id                                 TEXT NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,
  snapshot_card_pack_data                  TEXT,         -- JSON-encoded CardSetSchema
  snapshot_players_data                    TEXT,         -- JSON-encoded Schema.Array(PlayerSchema)
  snapshot_hand_sizes_data                 TEXT,
  snapshot_known_cards_data                TEXT,
  snapshot_suggestions_data                TEXT,
  snapshot_accusations_data                TEXT,
  snapshot_hypotheses_data                 TEXT,         -- transfer-only
  snapshot_self_player_id_data             TEXT,         -- transfer-only ("which player I am")
  snapshot_first_dealt_player_id_data      TEXT,         -- invite + transfer (publicly known)
  snapshot_dismissed_insights_data         TEXT,         -- transfer-only (scratchwork)
  snapshot_hypothesis_order_data           TEXT,         -- transfer-only (UI ordering)
  created_at                               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                               TIMESTAMPTZ,  -- NOW() + SHARE_TTL on insert
  -- index: shares_owner_id_idx, shares_expires_at_idx
)
```

The `ON DELETE SET NULL` on the owner_id FK is a relic of the pre-
NOT-NULL world. With NOT NULL it effectively means a user deletion
also deletes their shares (the FK action would conflict and Postgres
errors). Acceptable — sharing is ephemeral (1-day TTL), so any
shares would have expired anyway.

## Common change scenarios

### Adding a new section to an existing kind

1. Add the codec to [src/logic/ShareCodec.ts](../src/logic/ShareCodec.ts).
2. Add the column via an additive forward-only migration (see
   [CLAUDE.md → Database migrations](../CLAUDE.md)).
3. Add the field to the relevant kind's variant in
   `CreateShareInput` (server) + the matching builder helper in
   `ShareCreateModal.tsx`.
4. Add a new bullet to `ShareImportPage`'s summary list.
5. Extend `useApplyShareSnapshot.buildSessionFromSnapshot` to decode +
   merge the new slice into the resulting `GameSession`.
6. Update tests: codec round-trip, server input validation, modal
   payload shape, receive bullet rendering, hydration builder.

### Adding a new sender-flow kind

1. Extend the `ShareVariant` union in `ShareCreateModal.tsx`.
2. Extend the `CreateShareInput` discriminated union + the server's
   `validateInputShape` allowed-keys whitelist + column-projection
   logic.
3. Add a builder helper (`buildXxxInput`) that produces the new
   kind's payload from `GameSession`.
4. Add a `ShareProvider` opener (e.g. `openYourNewKind()`).
5. Wire entry-point button(s) in the appropriate UI surface.
6. Add per-variant chrome (title key, description key, optional
   warning, optional checkbox) in the modal's variant config.
7. Add i18n keys and run `pnpm i18n:check`.
8. Walk both viewports in the `next-dev` preview.

## Error codes

Surfaced from `createShare` / `getShare`:

| Constant | Wire string | Cause |
|---|---|---|
| `ERR_SIGN_IN_REQUIRED` | `sign_in_required_to_share` | Caller is anonymous (no session OR isAnonymous=true). The create-side modal catches this and slides into the inline sign-in step; the receive side gates the import button entirely (CTA reads "Sign in to import") so this server error doesn't surface. |
| `ERR_MALFORMED_INPUT` | `share_malformed_input[:<detail>]` | Input shape didn't validate — wrong kind, missing required field, extraneous field, bad codec, or suggestion/accusation pairing violation. The optional `:<detail>` suffix names which check failed. |
| `ERR_SHARE_NOT_FOUND` | `share_not_found` | `getShare` couldn't find a row for the id (or it has expired). Receive page renders a 404. |

## Card-pack sync (separate from sharing)

Sync is the other half of "the user's data follows them across
devices." Whereas sharing is one-shot — a sender produces a snapshot
URL, a receiver imports it once — sync is **continuous**: every
mutation a signed-in user makes to their card-pack library propagates
to the server, every device's React Query refetch pulls the latest
view back, and a localStorage mirror keeps things working offline.

The sync architecture is intentionally larger than sharing's because
it has to handle:

- A signed-in mutation that has to reach every other device the user
  is logged in on.
- An anonymous-era pack that gets attached to an account on sign-in.
- Two devices each holding offline edits to the same pack at the
  same time (last-flush wins on the server; local-wins during
  reconcile when the local edit is newer than the last sync).
- Logout: the packs are tied to the account, not the device, so the
  device's localStorage is cleared. If there are unsynced edits, the
  user is warned before discarding them.
- Offline deletes (tombstones) so a deleted pack can't resurrect on
  the next pull.

**See [card-pack-sync.md](./card-pack-sync.md) for the full
architecture, the conflict-resolution rules, and the four
"life of a card pack" timelines that walk through the full state
machine.**

### Where sync and sharing intersect

- **`pack`-kind shares vs. sync.** A `pack` share is a sender-driven
  snapshot — it does not modify either user's `card_packs` rows. The
  receiver imports it via the local-only `saveCustomCardSet` flow,
  which then triggers their own sync push (via `CardPacksSync`) once
  the user is back on `/play` — sign-in is required to receive any
  share, so the user is always signed in by the time the pack lands
  in the local registry.
- **`invite` and `transfer`-kind shares vs. sync.** Both of these
  ship the sender's card pack as part of the snapshot.
  `useApplyShareSnapshot` hydrates the GameSession AND routes the
  pack through `saveOrRecognisePack`, which writes it to
  `customCardSets` (or recognises it as a built-in and skips the
  duplicate write). The same `CardPacksSync` mirror picks it up
  post-`/play` mount.
- **Auth.** Both systems share `requireSignedInUser` (server) and
  `useSignedInUserId` (client) for the gate. A user signed in via
  the anonymous plugin counts as **not** signed in for both — neither
  share-create nor card-pack-server-mirror runs.

### Updating the docs

This file is the canonical reference for both systems. **Per
[CLAUDE.md → Sharing and sync docs](../CLAUDE.md), any change that
touches code in those areas should also update this doc and (for
card-pack sync changes) [card-pack-sync.md](./card-pack-sync.md).**
The list of triggering paths is at the top of this file.
