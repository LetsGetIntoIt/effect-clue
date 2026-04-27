import {
    allCardEntries,
    cardName,
    categoryName,
    categoryOfCard,
    findCardEntry,
} from "./GameSetup";
import type { Card } from "./GameObjects";
import type { GameSetup } from "./GameSetup";
import type { ClueAction, ClueState } from "./ClueState";

/**
 * Translator function the describer asks for copy. Matches the return
 * shape of `useTranslations("history")` from next-intl — whichever
 * `values` the describer passes get interpolated into the message
 * template. Kept abstract so the describer stays pure: tests can pass
 * an identity / mock translator without booting the React provider.
 */
type HistoryTranslator = (
    key: string,
    values?: Record<string, string | number>,
) => string;

const joinCardNames = (
    setup: GameSetup,
    cards: ReadonlyArray<Card>,
): string => cards.map(id => cardName(setup, id)).join(" + ");

// Mirror the reducer's "Player N" / "Category N" / "Card N" naming
// scheme (see state.tsx) so the Undo tooltip can name the entity that
// *will be* generated, before the action fires.
const nextNumbered = (
    prefix: string,
    existing: ReadonlyArray<string>,
): string => {
    const taken = new Set(existing);
    let n = 1;
    while (taken.has(`${prefix} ${n}`)) n++;
    return `${prefix} ${n}`;
};

/**
 * Convert a dispatched `ClueAction` into a single-sentence natural-
 * language description, suitable for a tooltip on the Undo / Redo
 * buttons. `previousState.setup` is the setup as it was when the
 * action fired, which is where we resolve ids (card / category) to
 * human-readable names — the post-action setup might have a different
 * view (e.g. if the action is the rename itself, the post-action name
 * is already the new one).
 */
export const describeAction = (
    action: ClueAction,
    previousState: ClueState,
    t: HistoryTranslator,
): string => {
    const setup = previousState.setup;
    switch (action.type) {
        case "newGame":
            return t("actions.newGame");
        case "loadCardSet":
            return t("actions.loadCardSet", { name: action.label });
        case "addPlayer":
            return t("actions.addPlayer", {
                player: nextNumbered(
                    "Player",
                    setup.players.map(p => String(p)),
                ),
            });
        case "removePlayer":
            return t("actions.removePlayer", { player: String(action.player) });
        case "renamePlayer":
            return t("actions.renamePlayer", {
                oldName: String(action.oldName),
                newName: String(action.newName),
            });
        case "addCategory":
            return t("actions.addCategory", {
                name: nextNumbered(
                    "Category",
                    setup.categories.map(c => c.name),
                ),
            });
        case "removeCategoryById":
            return t("actions.removeCategoryById", {
                name: categoryName(setup, action.categoryId),
            });
        case "addCardToCategoryById":
            return t("actions.addCardToCategoryById", {
                card: nextNumbered(
                    "Card",
                    allCardEntries(setup).map(c => c.name),
                ),
                category: categoryName(setup, action.categoryId),
            });
        case "removeCardById": {
            const parent = categoryOfCard(setup, action.cardId);
            return t("actions.removeCardById", {
                name: cardName(setup, action.cardId),
                category: parent ? categoryName(setup, parent) : "",
            });
        }
        case "renameCategory":
            return t("actions.renameCategory", {
                oldName: categoryName(setup, action.categoryId),
                newName: action.name,
            });
        case "renameCard":
            return t("actions.renameCard", {
                oldName: cardName(setup, action.cardId),
                newName: action.name,
            });
        case "addKnownCard":
            return t("actions.addKnownCard", {
                player: String(action.card.player),
                card:
                    findCardEntry(setup, action.card.card)?.name ??
                    String(action.card.card),
            });
        case "removeKnownCard": {
            const entry = previousState.knownCards[action.index];
            if (!entry) return t("actions.removeKnownCardUnknown");
            return t("actions.removeKnownCard", {
                player: String(entry.player),
                card:
                    findCardEntry(setup, entry.card)?.name ?? String(entry.card),
            });
        }
        case "setHandSize":
            return action.size === undefined
                ? t("actions.setHandSizeCleared", {
                      player: String(action.player),
                  })
                : t("actions.setHandSize", {
                      player: String(action.player),
                      size: action.size,
                  });
        case "addSuggestion":
            return t("actions.addSuggestion", {
                player: String(action.suggestion.suggester),
                cards: joinCardNames(setup, action.suggestion.cards),
            });
        case "updateSuggestion": {
            const idx = previousState.suggestions.findIndex(
                s => s.id === action.suggestion.id,
            );
            if (idx < 0) return t("actions.updateSuggestionUnknown");
            const prior = previousState.suggestions[idx]!;
            return t("actions.updateSuggestion", {
                number: idx + 1,
                player: String(prior.suggester),
                cards: joinCardNames(setup, prior.cards),
            });
        }
        case "removeSuggestion": {
            const idx = previousState.suggestions.findIndex(
                s => s.id === action.id,
            );
            if (idx < 0) return t("actions.removeSuggestionUnknown");
            const prior = previousState.suggestions[idx]!;
            return t("actions.removeSuggestion", {
                number: idx + 1,
                player: String(prior.suggester),
                cards: joinCardNames(setup, prior.cards),
            });
        }
        case "addAccusation":
            return t("actions.addAccusation", {
                player: String(action.accusation.accuser),
                cards: joinCardNames(setup, action.accusation.cards),
            });
        case "updateAccusation": {
            const idx = previousState.accusations.findIndex(
                a => a.id === action.accusation.id,
            );
            if (idx < 0) return t("actions.updateAccusationUnknown");
            const prior = previousState.accusations[idx]!;
            return t("actions.updateAccusation", {
                number: idx + 1,
                player: String(prior.accuser),
                cards: joinCardNames(setup, prior.cards),
            });
        }
        case "removeAccusation": {
            const idx = previousState.accusations.findIndex(
                a => a.id === action.id,
            );
            if (idx < 0) return t("actions.removeAccusationUnknown");
            const prior = previousState.accusations[idx]!;
            return t("actions.removeAccusation", {
                number: idx + 1,
                player: String(prior.accuser),
                cards: joinCardNames(setup, prior.cards),
            });
        }
        // Non-undoable actions — should never reach the describer
        // because the history reducer bypasses them.
        case "setSetup":
        case "setUiMode":
        case "replaceSession":
            return t("unknownAction");
    }
};
