/**
 * User-saved card pack presets. A preset is a snapshot of the
 * `CardSet` half of `GameSetup` — categories + card entries only,
 * no players. It lives in a separate localStorage key from the
 * active game session so users can accumulate personal packs across
 * games without polluting or risking collision with the session blob.
 *
 * Schema is versioned from day one — every migration step bumps
 * `version` so we can add fields later without breaking existing
 * preset stores.
 */
import { CardSet } from "./CardSet";
import { Card, CardCategory } from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";

/**
 * The on-disk shape of a single custom preset. Mirrors the session
 * setup subtree but without players (presets are reusable across
 * games; player rosters aren't).
 */
interface PersistedCustomPresetV1 {
    readonly id: string;
    readonly label: string;
    readonly categories: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly cards: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
        }>;
    }>;
}

interface PersistedCustomPresetsV1 {
    readonly version: 1;
    readonly presets: ReadonlyArray<PersistedCustomPresetV1>;
}

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

const decodeCategories = (
    raw: ReadonlyArray<PersistedCustomPresetV1["categories"][number]>,
): ReadonlyArray<Category> =>
    raw.map(c => Category({
        id: CardCategory(c.id),
        name: c.name,
        cards: c.cards.map(card => CardEntry({
            id: Card(card.id),
            name: card.name,
        })),
    }));

const encodeCategories = (
    cats: ReadonlyArray<Category>,
): PersistedCustomPresetV1["categories"] =>
    cats.map(c => ({
        id: String(c.id),
        name: c.name,
        cards: c.cards.map(card => ({
            id: String(card.id),
            name: card.name,
        })),
    }));

/**
 * Read all user-saved presets from localStorage. Returns an empty
 * array if the key is missing or the payload doesn't parse.
 */
export const loadCustomPresets = (): ReadonlyArray<CustomPreset> => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as Partial<PersistedCustomPresetsV1>;
        if (parsed.version !== 1 || !Array.isArray(parsed.presets)) return [];
        return parsed.presets.map(p => ({
            id: p.id,
            label: p.label,
            cardSet: CardSet({ categories: decodeCategories(p.categories) }),
        }));
    } catch {
        return [];
    }
};

const writeAll = (presets: ReadonlyArray<CustomPreset>): void => {
    const payload: PersistedCustomPresetsV1 = {
        version: 1,
        presets: presets.map(p => ({
            id: p.id,
            label: p.label,
            categories: encodeCategories(p.cardSet.categories),
        })),
    };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
