import { Card } from "../GameObjects";
import { allCardEntries, GameSetup } from "../GameSetup";

/**
 * Test helper: look up a card's id by its display name in the given
 * setup. Throws if missing — tests should fail loudly, not silently
 * treat a typo as a new card.
 */
export const cardByName = (setup: GameSetup, name: string): Card => {
    const hit = allCardEntries(setup).find(c => c.name === name);
    if (!hit) {
        throw new Error(
            `cardByName: "${name}" not in setup. Available: ${allCardEntries(
                setup,
            )
                .map(c => c.name)
                .join(", ")}`,
        );
    }
    return hit.id;
};
