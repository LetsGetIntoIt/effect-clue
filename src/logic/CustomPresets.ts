/**
 * User-saved card pack presets. A preset is a snapshot of the
 * `CardSet` half of `GameSetup` — categories + card entries only,
 * no players. It lives in a separate localStorage key from the
 * active game session so users can accumulate personal packs across
 * games without polluting or risking collision with the session blob.
 *
 * The on-disk payload goes through `Schema`: malformed blobs are
 * rejected with a structured error rather than silently ignored, and
 * branded ids (Card, CardCategory) flow through the decoder directly.
 */
import { Result, Schema } from "effect";
import { CardSet } from "./CardSet";
import { Card, CardCategory } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";

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

const PersistedCustomPresetSchema = Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    categories: Schema.Array(PersistedCategorySchema),
});

/**
 * Canonical on-disk shape for the preset store. `version: 1` is a
 * forward-compat sentinel: if we ever need to break the shape, we
 * bump it and add a decoder for the new version — same pattern as
 * the session schema.
 */
const PersistedCustomPresetsSchema = Schema.Struct({
    version: Schema.Literal(1),
    presets: Schema.Array(PersistedCustomPresetSchema),
});

const decodePresetsUnknown = Schema.decodeUnknownResult(
    PersistedCustomPresetsSchema,
);
const encodePresets = Schema.encodeSync(PersistedCustomPresetsSchema);

/**
 * Runtime-shape preset as consumed by the UI. Stores a `CardSet` —
 * the deck half of a game — so callers can compose a fresh
 * `GameSetup` with whatever `PlayerSet` the current game already
 * has. Presets deliberately don't remember players.
 */
export interface CustomPreset {
    readonly id: string;
    readonly label: string;
    readonly cardSet: CardSet;
}

const STORAGE_KEY = "effect-clue.custom-presets.v1";

/**
 * Read all user-saved presets from localStorage. Returns an empty
 * array if the key is missing or the payload doesn't decode.
 */
export const loadCustomPresets = (): ReadonlyArray<CustomPreset> => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const decoded = decodePresetsUnknown(JSON.parse(raw));
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

const writeAll = (presets: ReadonlyArray<CustomPreset>): void => {
    try {
        const encoded = encodePresets({
            version: 1,
            presets: presets.map(p => ({
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
 * Snapshot the current `setup.cardSet` as a new preset. Generates a
 * random preset id so renames of the active setup's category/card ids
 * don't collide with preset ids across sessions.
 */
export const saveCustomPreset = (
    label: string,
    setup: GameSetup,
): CustomPreset => {
    const presets = loadCustomPresets();
    const id = `custom-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
    const newPreset: CustomPreset = {
        id,
        label,
        cardSet: setup.cardSet,
    };
    writeAll([...presets, newPreset]);
    return newPreset;
};

export const deleteCustomPreset = (id: string): void => {
    const presets = loadCustomPresets();
    writeAll(presets.filter(p => p.id !== id));
};
