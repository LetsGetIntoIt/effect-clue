import type { Player } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";

/**
 * Compute the per-player default hand size for a `firstDealt` pin.
 *
 * The dealer hands one card to each player in turn, starting with the
 * first-dealt player. With an uneven deck, the first few players in
 * the dealing order get one extra card. `firstDealtPlayer === null`
 * means "default to first in turn order" — equivalent to dealing from
 * `players[0]`.
 *
 * Centralized here (per the plan) so consumers don't inline the math:
 * - Step 4 (Hand sizes) renders these as the default for each row.
 * - The "Adjust dealing" affordance dispatches `setFirstDealtPlayer`
 *   and re-runs this helper for the new defaults.
 *
 * The math:
 * 1. `dealt = totalCards - categoryCount` (the case file holds one of
 *    each category, so the rest is dealt out).
 * 2. `base = floor(dealt / playerCount)` — every player gets at least
 *    this many.
 * 3. `extras = dealt - base * playerCount` — the first `extras`
 *    players in the dealing order each get one more.
 * 4. The dealing order starts at `firstDealtPlayer` and wraps around
 *    the player list; equivalent to rotating the player array so the
 *    pinned player sits at index 0.
 */
export function firstDealtHandSizes(
    setup: GameSetup,
    firstDealtPlayer: Player | null,
): ReadonlyArray<readonly [Player, number]> {
    const players = setup.playerSet.players;
    const n = players.length;
    if (n === 0) return [];

    const totalCards = setup.cardSet.categories.reduce(
        (acc, c) => acc + c.cards.length,
        0,
    );
    const dealt = totalCards - setup.cardSet.categories.length;
    if (dealt <= 0) {
        return players.map(p => [p, 0] as const);
    }

    const base = Math.floor(dealt / n);
    const extras = dealt - base * n;

    const startIdx =
        firstDealtPlayer === null
            ? 0
            : Math.max(
                  0,
                  players.findIndex(p => p === firstDealtPlayer),
              );

    return players.map((player, i) => {
        // Distance from the first-dealt position in the dealing order.
        const dealingIdx = (i - startIdx + n) % n;
        const size = base + (dealingIdx < extras ? 1 : 0);
        return [player, size] as const;
    });
}
