import {
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    allCards,
    defaultHandSizes,
    GameSetup,
} from "./GameSetup";
import {
    Cell,
    emptyKnowledge,
    Knowledge,
    setCell,
    setHandSize,
    Y,
} from "./Knowledge";

/**
 * A single known card held by a specific player — either the solver's
 * own hand or cards publicly revealed during play. These get folded
 * into the initial knowledge before every deduction.
 */
export interface KnownCard {
    readonly player: Player;
    readonly card: Card;
}

/**
 * Build the starting Knowledge from user-entered inputs:
 *   - `knownCards`: cells the user has explicitly flipped Y in the
 *     GameSetupPanel "known cards" grid.
 *   - `handSizes`: explicit per-player hand sizes. Players without an
 *     entry here fall back to `defaultHandSizes(setup)` — the UI
 *     renders that value as a placeholder, and this makes it actually
 *     take effect in the solver so the row-sums-to-K constraint fires
 *     for every player, not just the ones the user has manually typed
 *     into the input field.
 *
 * Cells / players that don't match the current setup (e.g. after a
 * preset change) are silently dropped rather than throwing — the UI
 * holds onto "orphaned" entries while the user is editing, and the
 * user will see them disappear cleanly on the next setup change.
 */
export const buildInitialKnowledge = (
    setup: GameSetup,
    knownCards: ReadonlyArray<KnownCard>,
    handSizes: ReadonlyArray<readonly [Player, number]>,
): Knowledge => {
    let k = emptyKnowledge;
    const deck = new Set(allCards(setup));
    for (const { player, card } of knownCards) {
        if (!setup.players.includes(player)) continue;
        if (!deck.has(card)) continue;
        try {
            k = setCell(k, Cell(PlayerOwner(player), card), Y);
        } catch {
            // Swallow duplicates — they'll show up in the deducer's
            // contradiction output instead.
        }
    }
    const explicit = new Map(handSizes);
    const defaults = new Map(defaultHandSizes(setup));
    for (const player of setup.players) {
        const size = explicit.has(player)
            ? explicit.get(player)
            : defaults.get(player);
        if (size === undefined) continue;
        k = setHandSize(k, PlayerOwner(player), size);
    }
    return k;
};
