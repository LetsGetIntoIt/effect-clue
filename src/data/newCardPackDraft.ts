/**
 * Local-only draft slot for the "+ New card pack" entry-point's
 * in-progress edits. The draft persists indefinitely — there's no
 * TTL — until the user either:
 *
 *   - successfully saves the pack (the editor calls
 *     `clearNewCardPackDraft()` on save), or
 *   - explicitly discards via the editor's "Start over" button
 *     (confirm-gated; same call).
 *
 * Cancel and X just close the editor without touching the draft, so
 * re-opening "+ New card pack" picks up where the user left off
 * regardless of how long it's been.
 *
 * Only ONE draft is supported. The slot is exclusive to the new-pack
 * flow — edits to existing packs (My Card Packs row's edit button,
 * setup step 1's Customize) never touch this key. That's deliberate:
 * the request was "we only store a single in progress draft for a
 * new card pack (don't save edits, and don't save multiple new card
 * packs)."
 */
import { Result, Schema } from "effect";
import { CardEntry, CardSet, Category } from "../logic/CardSet";
import { Card, CardCategory } from "../logic/GameObjects";

export const NEW_CARD_PACK_DRAFT_KEY = "effect-clue.new-card-pack-draft.v1";

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
const PersistedDraftSchema = Schema.Struct({
    version: Schema.Literal(1),
    label: Schema.String,
    categories: Schema.Array(PersistedCategorySchema),
});

const decodeUnknown = Schema.decodeUnknownResult(PersistedDraftSchema);
const encode = Schema.encodeSync(PersistedDraftSchema);

export interface NewCardPackDraft {
    readonly label: string;
    readonly cardSet: CardSet;
}

/**
 * Read the saved draft. Returns `undefined` when the key is missing,
 * the payload is malformed JSON, or the schema decode fails. Defensive
 * behavior: on decode failure the corrupt blob is wiped so a future
 * "+ New card pack" press can't trip on the same garbage indefinitely.
 */
export const loadNewCardPackDraft = (): NewCardPackDraft | undefined => {
    if (typeof window === "undefined") return undefined;
    let raw: string | null;
    try {
        raw = window.localStorage.getItem(NEW_CARD_PACK_DRAFT_KEY);
    } catch {
        return undefined;
    }
    if (!raw) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        clearNewCardPackDraft();
        return undefined;
    }
    const decoded = decodeUnknown(parsed);
    if (Result.isFailure(decoded)) {
        clearNewCardPackDraft();
        return undefined;
    }
    return {
        label: decoded.success.label,
        cardSet: CardSet({
            categories: decoded.success.categories.map((c) =>
                Category({
                    id: c.id,
                    name: c.name,
                    cards: c.cards.map((e) =>
                        CardEntry({ id: e.id, name: e.name }),
                    ),
                }),
            ),
        }),
    };
};

export const saveNewCardPackDraft = (draft: NewCardPackDraft): void => {
    if (typeof window === "undefined") return;
    try {
        const encoded = encode({
            version: 1,
            label: draft.label,
            categories: draft.cardSet.categories.map((c) => ({
                id: c.id,
                name: c.name,
                cards: c.cards.map((e) => ({ id: e.id, name: e.name })),
            })),
        });
        window.localStorage.setItem(
            NEW_CARD_PACK_DRAFT_KEY,
            JSON.stringify(encoded),
        );
    } catch {
        // Quota-exceeded / private-mode / unavailable storage — the
        // draft is a quality-of-life nicety, not load-bearing. Drop
        // silently rather than throwing into the editor's render path.
    }
};

export const clearNewCardPackDraft = (): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(NEW_CARD_PACK_DRAFT_KEY);
    } catch {
        // non-fatal
    }
};
