/**
 * User-saved card packs. A card pack is a snapshot of the `CardSet`
 * half of `GameSetup` — categories + card entries only, no players.
 * Lives in a separate localStorage key from the active game session
 * so users can accumulate personal packs across games without
 * polluting or risking collision with the session blob.
 *
 * "Card pack" is the user-facing name; code still calls it `CardSet`
 * — the domain vocabulary is centralised, the i18n copy owns the
 * user word. The on-disk localStorage key is preserved from the
 * earlier "preset" naming so existing saved packs keep loading.
 *
 * The on-disk payload goes through `Schema`: malformed blobs are
 * rejected with a structured error rather than silently ignored, and
 * branded ids (Card, CardCategory) flow through the decoder directly.
 *
 * Sync metadata: each pack carries optional `unsyncedSince` and
 * `lastSyncedSnapshot` fields used by the sign-in / continuous
 * reconcile pipeline (see [`src/data/cardPacksSync.tsx`]). They are
 * additive — old payloads without them still decode.
 */
import { DateTime, Result, Schema } from "effect";
import { CardSet } from "./CardSet";
import { Card, CardCategory } from "./GameObjects";
import { CardEntry, Category } from "./GameSetup";

const CardSchema = Schema.String.pipe(Schema.fromBrand("Card", Card));
const CardCategorySchema = Schema.String.pipe(
    Schema.fromBrand("CardCategory", CardCategory),
);

const PersistedCardEntrySchema = Schema.Struct({
    id: CardSchema,
    name: Schema.String,
});

const PersistedCategorySchema = Schema.Struct({
    id: CardCategorySchema,
    name: Schema.String,
    cards: Schema.Array(PersistedCardEntrySchema),
});

/**
 * Last-known server-side view of a pack. Set when a pull arrives or
 * a push confirms; never mutated by local edits, so it remains a
 * stable diff baseline across multiple offline edits and powers the
 * "what changed" copy in `LogoutWarningModal`.
 */
const PersistedSnapshotSchema = Schema.Struct({
    label: Schema.String,
    categories: Schema.Array(PersistedCategorySchema),
});

const PersistedCustomCardSetSchema = Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    categories: Schema.Array(PersistedCategorySchema),
    /** Epoch millis at the storage edge; `DateTime.Utc` in memory. */
    unsyncedSince: Schema.optional(Schema.Number),
    lastSyncedSnapshot: Schema.optional(PersistedSnapshotSchema),
});

/**
 * Canonical on-disk shape for the card-pack store. `version: 1` is
 * a forward-compat sentinel: if we ever need to break the shape, we
 * bump it and add a decoder for the new version — same pattern as
 * the session schema.
 */
const PersistedCustomCardSetsSchema = Schema.Struct({
    version: Schema.Literal(1),
    presets: Schema.Array(PersistedCustomCardSetSchema),
});

const decodeUnknown = Schema.decodeUnknownResult(
    PersistedCustomCardSetsSchema,
);
const encode = Schema.encodeSync(PersistedCustomCardSetsSchema);

/**
 * Snapshot of the server's last-known view of a pack. Drives the
 * "what changed" diff in the logout warning UI.
 */
export interface CardPackSnapshot {
    readonly label: string;
    readonly cardSet: CardSet;
}

/**
 * Runtime-shape card pack as consumed by the UI. Stores a `CardSet`
 * — the deck half of a game — so callers can compose a fresh
 * `GameSetup` with whatever `PlayerSet` the current game already
 * has. Card packs deliberately don't remember players.
 */
export interface CustomCardSet {
    readonly id: string;
    readonly label: string;
    readonly cardSet: CardSet;
    /**
     * Set on every local mutation while signed in; cleared by a
     * server roundtrip confirmation. Absent ⇒ pack is in sync.
     */
    readonly unsyncedSince?: DateTime.Utc | undefined;
    /**
     * Server's last-known view of this pack — set by pulls and by
     * successful pushes. Absent ⇒ the server has never acknowledged
     * this pack (a local-only creation).
     */
    readonly lastSyncedSnapshot?: CardPackSnapshot | undefined;
}

// Historical key — retains the `custom-presets` path so users who
// saved packs under the earlier naming don't lose them. Only the
// code-level names changed.
const STORAGE_KEY = "effect-clue.custom-presets.v1";

const TOMBSTONES_KEY = "effect-clue.deleted-packs.v1";
const USAGE_KEY = "effect-clue.card-pack-usage.v1";

interface PersistedCategoryShape {
    readonly id: CardCategory;
    readonly name: string;
    readonly cards: ReadonlyArray<{
        readonly id: Card;
        readonly name: string;
    }>;
}

const decodePersistedCategories = (
    cats: ReadonlyArray<PersistedCategoryShape>,
): CardSet =>
    CardSet({
        categories: cats.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    });

const encodePersistedCategories = (
    cardSet: CardSet,
): ReadonlyArray<PersistedCategoryShape> =>
    cardSet.categories.map(c => ({
        id: c.id,
        name: c.name,
        cards: c.cards.map(card => ({
            id: card.id,
            name: card.name,
        })),
    }));

/**
 * Collapse `packs` to one entry per `id`, preserving input order.
 *
 * Why this exists: localStorage state has been observed in the wild
 * with multiple `CustomCardSet` entries sharing one server-minted id
 * (e.g. three rows all stamped `q7xao88qw0hobmp43aa5s0r8`, all
 * labelled "Sync test (PENDING)"). The server-side schema rules out
 * a matching shape on disk (`card_packs.id` is `PRIMARY KEY`,
 * `(owner_id, client_generated_id)` is `UNIQUE` — verified against
 * a live DB with zero collisions), so the corruption is purely
 * local. Provenance unclear; most likely a stale state from earlier
 * code paths that have since been cleaned up plus possibly a
 * hand-edit on the affected user's machine.
 *
 * The user-facing symptom is React's "Encountered two children with
 * the same key" warning in `<SetupStepCardPack>`'s pill row (which
 * keys on `pack.id`) and one of the duplicates silently disappearing
 * from the rendered list — so users couldn't reliably select or
 * delete the affected pack.
 *
 * The fix is applied at three boundaries to fully close the loop:
 *
 *   - Read (`loadCustomCardSets`): dedupes whatever's on disk
 *     before returning, so even the very first render against a
 *     corrupt blob doesn't trip React. `useCustomCardPacks` seeds its
 *     React Query with `loadCustomCardSets()` as `initialData`, so
 *     this is the only fix that catches the bug pre-reconcile.
 *   - Write (`writeAll`): dedupes whatever's about to be persisted,
 *     so any path that flushes packs (`saveCustomCardSet`,
 *     `markPackSynced`, `replaceCustomCardSets`, …) self-heals the
 *     on-disk blob.
 *   - Reconcile (`reconcileCardPacks` in `src/data/cardPacksSync.tsx`):
 *     dedupes the merged output of the local-vs-server merge, so
 *     the in-memory shape we pass to `replaceCustomCardSets` and
 *     `setQueryData` never has dupes either.
 */
const dedupePacksById = (
    packs: ReadonlyArray<CustomCardSet>,
): ReadonlyArray<CustomCardSet> => {
    const seen = new Set<string>();
    const out: Array<CustomCardSet> = [];
    for (const pack of packs) {
        if (seen.has(pack.id)) continue;
        seen.add(pack.id);
        out.push(pack);
    }
    return out;
};

/**
 * Read all user-saved card packs from localStorage. Returns an
 * empty array if the key is missing or the payload doesn't decode.
 *
 * Returned packs are deduped by id (see `dedupePacksById`) so the
 * UI never sees collisions even if the on-disk blob is corrupt.
 */
export const loadCustomCardSets = (): ReadonlyArray<CustomCardSet> => {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return [];
        const decodedPacks: ReadonlyArray<CustomCardSet> =
            decoded.success.presets.map(p => ({
                id: p.id,
                label: p.label,
                cardSet: decodePersistedCategories(p.categories),
                unsyncedSince: p.unsyncedSince !== undefined
                    ? DateTime.makeUnsafe(p.unsyncedSince)
                    : undefined,
                lastSyncedSnapshot: p.lastSyncedSnapshot !== undefined
                    ? {
                        label: p.lastSyncedSnapshot.label,
                        cardSet: decodePersistedCategories(
                            p.lastSyncedSnapshot.categories,
                        ),
                    }
                    : undefined,
            }));
        return dedupePacksById(decodedPacks);
    } catch {
        return [];
    }
};

const writeAll = (packs: ReadonlyArray<CustomCardSet>): void => {
    if (typeof window === "undefined") return;
    try {
        const deduped = dedupePacksById(packs);
        const encoded = encode({
            version: 1,
            presets: deduped.map(p => ({
                id: p.id,
                label: p.label,
                categories: encodePersistedCategories(p.cardSet),
                unsyncedSince: p.unsyncedSince !== undefined
                    ? DateTime.toEpochMillis(p.unsyncedSince)
                    : undefined,
                lastSyncedSnapshot: p.lastSyncedSnapshot !== undefined
                    ? {
                        label: p.lastSyncedSnapshot.label,
                        categories: encodePersistedCategories(
                            p.lastSyncedSnapshot.cardSet,
                        ),
                    }
                    : undefined,
            })),
        });
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

/**
 * Snapshot a `CardSet` as a user card pack. With no `existingId`,
 * generates a fresh random id and inserts a new pack. With
 * `existingId` matching a saved pack, replaces that pack's `cardSet`
 * (and optionally its `label`) in place — id is preserved so the
 * recency map and any other id-based references stay valid. If
 * `existingId` doesn't match any saved pack, falls back to insert
 * (so a stale id from an evicted pack still produces a save).
 *
 * Returns the persisted pack with sync metadata preserved when
 * updating in place — caller decides whether to mark it unsynced via
 * [`markPackUnsynced`] after the fact.
 */
export const saveCustomCardSet = (
    label: string,
    cardSet: CardSet,
    existingId?: string,
): CustomCardSet => {
    const packs = loadCustomCardSets();
    if (existingId !== undefined) {
        const matchIdx = packs.findIndex(p => p.id === existingId);
        if (matchIdx !== -1) {
            const previous = packs[matchIdx]!;
            const updated: CustomCardSet = {
                id: existingId,
                label,
                cardSet,
                unsyncedSince: previous.unsyncedSince,
                lastSyncedSnapshot: previous.lastSyncedSnapshot,
            };
            const next = [...packs];
            next[matchIdx] = updated;
            writeAll(next);
            return updated;
        }
    }
    const id = `custom-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
    const newPack: CustomCardSet = { id, label, cardSet };
    writeAll([...packs, newPack]);
    return newPack;
};

export const deleteCustomCardSet = (id: string): void => {
    const packs = loadCustomCardSets();
    writeAll(packs.filter(p => p.id !== id));
};

/**
 * Replace the whole saved-pack library. Used by sign-in
 * reconciliation after the server and local libraries have been
 * de-duplicated into one canonical list.
 */
export const replaceCustomCardSets = (
    packs: ReadonlyArray<CustomCardSet>,
): void => {
    writeAll(packs);
};

/**
 * Mark a pack as having local changes the server hasn't seen yet.
 * Stamps `unsyncedSince` with the current `DateTime.now`. No-op if
 * the pack id isn't found.
 */
export const markPackUnsynced = (id: string): void => {
    const packs = loadCustomCardSets();
    const idx = packs.findIndex(p => p.id === id);
    if (idx === -1) return;
    const next = [...packs];
    next[idx] = {
        ...packs[idx]!,
        unsyncedSince: DateTime.nowUnsafe(),
    };
    writeAll(next);
};

/**
 * Confirm a server roundtrip for a pack. Swaps the local id for the
 * server's canonical id (if different), refreshes the
 * `lastSyncedSnapshot` to the server's view, and clears
 * `unsyncedSince`. Returns the updated pack, or `undefined` if no
 * pack matched `localId`.
 *
 * Caller is responsible for `remapCardPackUsageIds` when the id
 * changes.
 */
export const markPackSynced = (
    localId: string,
    serverRow: {
        readonly id: string;
        readonly label: string;
        readonly cardSet: CardSet;
    },
): CustomCardSet | undefined => {
    const packs = loadCustomCardSets();
    const idx = packs.findIndex(p => p.id === localId);
    if (idx === -1) return undefined;
    const previous = packs[idx]!;
    const updated: CustomCardSet = {
        id: serverRow.id,
        label: previous.label,
        cardSet: previous.cardSet,
        unsyncedSince: undefined,
        lastSyncedSnapshot: {
            label: serverRow.label,
            cardSet: serverRow.cardSet,
        },
    };
    const next = [...packs];
    next[idx] = updated;
    writeAll(next);
    return updated;
};

/**
 * Clear every account-tied localStorage key. Called as part of
 * [`requestSignOut`] once a sign-out is committed (either because
 * sync confirmed everything or because the user chose
 * "sign out anyway"). Deliberately scoped: tour state, splash state,
 * install-prompt state, in-progress game state are NOT account-tied
 * and remain untouched.
 */
export const clearAccountTiedLocalState = (): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(TOMBSTONES_KEY);
        window.localStorage.removeItem(USAGE_KEY);
    } catch {
        // Private mode, quota — non-fatal.
    }
};
