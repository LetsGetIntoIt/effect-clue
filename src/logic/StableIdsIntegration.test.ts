/**
 * Integration test for stage 8's id/name split: renaming a card
 * mid-game doesn't orphan knownCard references, suggestion references,
 * or any already-deduced cell values. Lives apart from the unit tests
 * because it cuts across multiple modules.
 */
import { describe, expect, test } from "vitest";
import { Result } from "effect";
import {
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
    CardEntry,
    Category,
    CLASSIC_SETUP_3P,
    findCardEntry,
    GameSetup,
} from "./GameSetup";
import {
    emptyKnowledge,
    getCellByOwnerCard,
    N,
    Y,
} from "./Knowledge";
import { Suggestion, SuggestionId } from "./Suggestion";
import { cardByName } from "./test-utils/CardByName";
import { runDeduce } from "./test-utils/RunDeduce";

const setup = CLASSIC_SETUP_3P;
const A = Player("Anisha");
const B = Player("Bob");

describe("rename preserves references", () => {
    test("renaming a card doesn't change the solver's deductions", () => {
        // Deduce against a suggestion that names Prof. Plum / Knife /
        // Conservatory, with Bob refuting and showing the Conservatory.
        const plum = cardByName(setup, "Prof. Plum");
        const knife = cardByName(setup, "Knife");
        const conserv = cardByName(setup, "Conservatory");

        const suggestions = [
            Suggestion({
                id: SuggestionId("s1"),
                suggester: A,
                cards: [plum, knife, conserv],
                nonRefuters: [],
                refuter: B,
                seenCard: conserv,
            }),
        ];
        const before = runDeduce(setup, suggestions, emptyKnowledge);
        expect(Result.isSuccess(before)).toBe(true);
        if (!Result.isSuccess(before)) return;

        // Before rename: Bob owns Conservatory.
        expect(
            getCellByOwnerCard(before.success, PlayerOwner(B), conserv),
        ).toBe(Y);

        // Rename Conservatory → "Greenhouse". Note we preserve the id
        // (`conserv`) — only the display name changes. This models what
        // the UI's renameCard action does.
        const renamed = renameCardByEntry(setup, conserv, "Greenhouse");
        expect(findCardEntry(renamed, conserv)?.name).toBe("Greenhouse");

        // Solver still produces the same knowledge; suggestion.cards
        // still resolves (they're ids).
        const after = runDeduce(renamed, suggestions, emptyKnowledge);
        expect(Result.isSuccess(after)).toBe(true);
        if (!Result.isSuccess(after)) return;
        expect(
            getCellByOwnerCard(after.success, PlayerOwner(B), conserv),
        ).toBe(Y);
        expect(
            getCellByOwnerCard(
                after.success,
                PlayerOwner(A),
                conserv,
            ),
        ).toBe(N);
    });
});

/**
 * Mimics the UI's renameCard reducer action: find the entry by id,
 * substitute the new name, preserve everything else. Kept inline here
 * rather than pulled from state.tsx so the logic tests don't depend on
 * the UI layer.
 */
const renameCardByEntry = (
    current: GameSetup,
    cardId: Card,
    nextName: string,
): GameSetup =>
    GameSetup({
        players: current.players,
        categories: current.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(entry =>
                entry.id === cardId
                    ? CardEntry({ id: entry.id, name: nextName })
                    : entry,
            ),
        })),
    });
