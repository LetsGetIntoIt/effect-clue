# Sharing — UX, server, and DB end-to-end

> **Read this first** if you're touching anything in `src/ui/share/`,
> `src/server/actions/shares.ts`, `src/logic/ShareCodec.ts`, or any
> `shares` DB column. Three load-bearing rules drive the whole
> design — see *Universal sign-in*, *Kind-based wire contract*, and
> *Effect-Schema-validated wire format* below.

## What sharing is

A user copies a `https://winclue.vercel.app/share/{id}` link, sends
it to someone (often themselves), and that recipient's local Clue
Solver game state is replaced with the sender's snapshot when they
click "Add to my game".

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
| `invite` | Setup pane near the Start playing CTA, overflow menu ("Invite a player") | Card pack + players + hand sizes; optional checkbox adds suggestions + accusations when ≥1 has been logged | The optional checkbox is conditionally rendered — gone if no suggestions exist yet |
| `transfer` | Overflow menu only ("Continue on another device") | Everything: card pack + players + hand sizes + known cards + suggestions + accusations | Renders a prominent privacy warning above the CTA — this link discloses your hand |

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
- Signed-in non-anonymous → CTA reads "Copy link" and clicking it
  fires `createShare` immediately.

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
      suggestionsData?; accusationsData? }     // pair both or neither
  | { kind: "transfer"; cardPackData; playersData; handSizesData;
      knownCardsData; suggestionsData; accusationsData };
```

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

All six wire fields round-trip through Effect `Schema` codecs in
[src/logic/ShareCodec.ts](../src/logic/ShareCodec.ts):

```ts
export const cardPackCodec    = Schema.fromJsonString(CardSetSchema);
export const playersCodec     = Schema.fromJsonString(...);
export const handSizesCodec   = Schema.fromJsonString(...);
export const knownCardsCodec  = Schema.fromJsonString(...);
export const suggestionsCodec = Schema.fromJsonString(...);
export const accusationsCodec = Schema.fromJsonString(...);
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
4. `ShareImportPage` renders a modal:
   - "A friend shared a Clue Solver game" title.
   - "Shared by {name}" line, only when `ownerName !== null`
     (server collapses to null for anonymous-plugin owners).
   - "This share includes:" header + a bulleted list — one bullet
     per non-null snapshot slice, with values:
     `Card pack: Master Detective` or `Card pack: My Office (custom)`,
     `Players (4): Alice, Bob, Carol, Dana`,
     `Hand sizes`,
     `Known cards (12)`, etc.
   - One CTA — `Add to my game`.
5. Click → `useApplyShareSnapshot()` decodes each wire field via
   the codec, builds a `GameSession`, dispatches `replaceSession`.
   The existing `<ClueProvider>` mirror-effect writes the new state
   to `localStorage` + the `["game-session"]` RQ cache.
6. Router pushes to `/play`.

**Hydration semantics:** the share is the new game. Sections present
in the snapshot replace the matching slice; sections absent are
blanked (because they may reference cards from the receiver's old
pack). Defensive empty-share branch (no card pack — unreachable
from the new sender flows but possible for legacy / direct API
calls) renders an empty-state message and disables Import.

## DB representation

Migration history:
- [0004_shares.ts](../src/server/migrations/0004_shares.ts) — initial
  table with the six nullable snapshot columns + nullable `owner_id`.
- [0005_share_expiry_backfill.ts](../src/server/migrations/0005_share_expiry_backfill.ts)
  — sets `expires_at` on legacy rows that pre-dated TTL, plus an
  index for the cron cleanup.
- [0006_shares_owner_required.ts](../src/server/migrations/0006_shares_owner_required.ts)
  — tightens `owner_id` to `NOT NULL` (M22 universal sign-in).

Schema (post-0006):

```sql
shares (
  id                          TEXT PRIMARY KEY,
  owner_id                    TEXT NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,
  snapshot_card_pack_data     TEXT,         -- JSON-encoded CardSetSchema
  snapshot_players_data       TEXT,         -- JSON-encoded Schema.Array(PlayerSchema)
  snapshot_hand_sizes_data    TEXT,
  snapshot_known_cards_data   TEXT,
  snapshot_suggestions_data   TEXT,
  snapshot_accusations_data   TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                  TIMESTAMPTZ,  -- NOW() + SHARE_TTL on insert
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
| `ERR_SIGN_IN_REQUIRED` | `sign_in_required_to_share` | Caller is anonymous (no session OR isAnonymous=true). Modal catches and slides into the inline sign-in step. |
| `ERR_MALFORMED_INPUT` | `share_malformed_input[:<detail>]` | Input shape didn't validate — wrong kind, missing required field, extraneous field, bad codec, or suggestion/accusation pairing violation. The optional `:<detail>` suffix names which check failed. |
| `ERR_SHARE_NOT_FOUND` | `share_not_found` | `getShare` couldn't find a row for the id (or it has expired). Receive page renders a 404. |
