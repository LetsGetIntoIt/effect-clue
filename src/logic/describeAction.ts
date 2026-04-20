import { cardName, categoryName, findCardEntry } from "./GameSetup";
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
        case "loadPreset":
            return t("actions.loadPreset");
        case "addPlayer":
            return t("actions.addPlayer");
        case "removePlayer":
            return t("actions.removePlayer", { player: String(action.player) });
        case "renamePlayer":
            return t("actions.renamePlayer", {
                oldName: String(action.oldName),
                newName: String(action.newName),
            });
        case "addCategory":
            return t("actions.addCategory");
        case "removeCategoryById":
            return t("actions.removeCategoryById", {
                name: categoryName(setup, action.categoryId),
            });
        case "addCardToCategoryById":
            return t("actions.addCardToCategoryById", {
                category: categoryName(setup, action.categoryId),
            });
        case "removeCardById":
            return t("actions.removeCardById", {
                name: cardName(setup, action.cardId),
            });
        case "renameCategory":
            return t("actions.renameCategory", { name: action.name });
        case "renameCard":
            return t("actions.renameCard", { name: action.name });
        case "addKnownCard":
            return t("actions.addKnownCard", {
                player: String(action.card.player),
                card:
                    findCardEntry(setup, action.card.card)?.name ??
                    String(action.card.card),
            });
        case "removeKnownCard":
            return t("actions.removeKnownCard");
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
            });
        case "updateSuggestion":
            return t("actions.updateSuggestion");
        case "removeSuggestion":
            return t("actions.removeSuggestion");
        // Non-undoable actions — should never reach the describer
        // because the history reducer bypasses them.
        case "setSetup":
        case "setUiMode":
        case "replaceSession":
            return t("unknownAction");
    }
};
