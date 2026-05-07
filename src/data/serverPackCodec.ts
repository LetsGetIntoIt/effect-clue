/**
 * Decoder for the server's `PersistedCardPack` wire format. The
 * `cardSetData` column is a JSON-encoded `CardSet` produced by
 * `JSON.stringify` inside `saveCardPack`; this module deserialises
 * the whole row into the domain `CustomCardSet` shape used
 * throughout the UI.
 *
 * Lives in its own file so the reconcile pipeline
 * ([`cardPacksSync.tsx`]), the mutation hooks
 * ([`customCardPacks.ts`]), and the AccountModal preview can all
 * decode without duplicating the defensive shape-checking. Returns
 * `null` on a malformed payload — the calling site falls back to
 * whatever it already has (e.g. the input cardSet for a save)
 * rather than throwing.
 */
import { CardSet } from "../logic/CardSet";
import type { CustomCardSet } from "../logic/CustomCardSets";
import { Card, CardCategory } from "../logic/GameObjects";
import { CardEntry, Category } from "../logic/GameSetup";
import type { PersistedCardPack } from "../server/actions/packs";

const decodeCardSet = (raw: string): CardSet | null => {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("categories" in parsed) ||
            !Array.isArray(parsed.categories)
        ) {
            return null;
        }
        const categories: Array<Category> = [];
        for (const category of parsed.categories) {
            if (
                typeof category !== "object" ||
                category === null ||
                !("id" in category) ||
                typeof category.id !== "string" ||
                !("name" in category) ||
                typeof category.name !== "string" ||
                !("cards" in category) ||
                !Array.isArray(category.cards)
            ) {
                return null;
            }
            const cards: Array<CardEntry> = [];
            for (const card of category.cards) {
                if (
                    typeof card !== "object" ||
                    card === null ||
                    !("id" in card) ||
                    typeof card.id !== "string" ||
                    !("name" in card) ||
                    typeof card.name !== "string"
                ) {
                    return null;
                }
                cards.push(
                    CardEntry({
                        id: Card(card.id),
                        name: card.name,
                    }),
                );
            }
            categories.push(
                Category({
                    id: CardCategory(category.id),
                    name: category.name,
                    cards,
                }),
            );
        }
        return CardSet({ categories });
    } catch {
        return null;
    }
};

/**
 * Decode a server-side `PersistedCardPack` into a domain
 * `CustomCardSet`. Drops the wire-format-only `clientGeneratedId` —
 * callers that need it pluck it from the original `PersistedCardPack`
 * they already had access to.
 */
export const decodeServerPack = (
    pack: PersistedCardPack,
): CustomCardSet | null => {
    const cardSet = decodeCardSet(pack.cardSetData);
    if (cardSet === null) return null;
    return {
        id: pack.id,
        label: pack.label,
        cardSet,
    };
};
