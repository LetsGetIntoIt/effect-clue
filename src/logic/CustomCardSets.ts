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
 */
import { Result, Schema } from "effect";
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

const PersistedCustomCardSetSchema = Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    categories: Schema.Array(PersistedCategorySchema),
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
 * Runtime-shape card pack as consumed by the UI. Stores a `CardSet`
 * — the deck half of a game — so callers can compose a fresh
 * `GameSetup` with whatever `PlayerSet` the current game already
 * has. Card packs deliberately don't remember players.
 */
export interface CustomCardSet {
    readonly id: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

// Historical key — retains the `custom-presets` path so users who
// saved packs under the earlier naming don't lose them. Only the
// code-level names changed.
const STORAGE_KEY = "effect-clue.custom-presets.v1";

/**
 * Read all user-saved card packs from localStorage. Returns an
 * empty array if the key is missing or the payload doesn't decode.
 */
export const loadCustomCardSets = (): ReadonlyArray<CustomCardSet> => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return [];
        return decoded.success.presets.map(p => ({
            id: p.id,
            label: p.label,
            cardSet: CardSet({
                categories: p.categories.map(c => Category({
                    id: c.id,
                    name: c.name,
                    cards: c.cards.map(card => CardEntry({
                        id: card.id,
                        name: card.name,
                    })),
                })),
            }),
        }));
    } catch {
        return [];
    }
};

const writeAll = (packs: ReadonlyArray<CustomCardSet>): void => {
    try {
        const encoded = encode({
            version: 1,
            presets: packs.map(p => ({
                id: p.id,
                label: p.label,
                categories: p.cardSet.categories.map(c => ({
                    id: c.id,
                    name: c.name,
                    cards: c.cards.map(card => ({
                        id: card.id,
                        name: card.name,
                    })),
                })),
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
            const updated: CustomCardSet = { id: existingId, label, cardSet };
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
