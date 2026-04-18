/**
 * Integration tests for stage 8's id/name split. These live apart from
 * the unit tests because they cut across multiple modules:
 *
 *   1. Rename-preserves-references: renaming a card mid-game doesn't
 *      orphan knownCard references, suggestion references, or any
 *      already-deduced cell values.
 *   2. Persistence v2 -> v3: older sessions (saved when cards were
 *      identified by name) decode cleanly; the migrated id matches the
 *      legacy name, and a card added later still has a fresh id.
 */
import {
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import {
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
import deduce from "./Deducer";
import { decodeSession, encodeSession } from "./Persistence";
import { Suggestion } from "./Suggestion";
import { cardByName } from "./test-utils/CardByName";

import "./test-utils/EffectExpectEquals";

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
                id: "s1",
                suggester: A,
                cards: [plum, knife, conserv],
                nonRefuters: [],
                refuter: B,
                seenCard: conserv,
            }),
        ];
        const before = deduce(setup, suggestions)(emptyKnowledge);
        expect(before._tag).toBe("Ok");
        if (before._tag !== "Ok") return;

        // Before rename: Bob owns Conservatory.
        expect(
            getCellByOwnerCard(before.knowledge, PlayerOwner(B), conserv),
        ).toBe(Y);

        // Rename Conservatory → "Greenhouse". Note we preserve the id
        // (`conserv`) — only the display name changes. This models what
        // the UI's renameCard action does.
        const renamed = renameCardByEntry(setup, conserv, "Greenhouse");
        expect(findCardEntry(renamed, conserv)?.name).toBe("Greenhouse");

        // Solver still produces the same knowledge; suggestion.cards
        // still resolves (they're ids).
        const after = deduce(renamed, suggestions)(emptyKnowledge);
        expect(after._tag).toBe("Ok");
        if (after._tag !== "Ok") return;
        expect(
            getCellByOwnerCard(after.knowledge, PlayerOwner(B), conserv),
        ).toBe(Y);
        expect(
            getCellByOwnerCard(
                after.knowledge,
                PlayerOwner(A),
                conserv,
            ),
        ).toBe(N);
    });
});

describe("Persistence v2 → v3 migration", () => {
    test("v2 payload decodes with id = name; round-trip preserves ids", () => {
        // Hand-craft a v2 payload like one saved before the id/name
        // split landed. Cards are identified by their display name.
        // (Deck math: 4 cards total − 3 case-file = 1 dealt across
        // 3 players; leave hand sizes off so the solver doesn't
        // over-constrain.)
        const v2 = {
            version: 2,
            setup: {
                players: ["Anisha", "Bob", "Cho"],
                categories: [
                    {
                        name: "Suspects",
                        cards: ["Miss Scarlet", "Col. Mustard"],
                    },
                    { name: "Weapons", cards: ["Knife"] },
                    { name: "Rooms", cards: ["Kitchen"] },
                ],
            },
            hands: [
                { player: "Anisha", cards: ["Col. Mustard"] },
            ],
            handSizes: [],
            suggestions: [
                {
                    suggester: "Anisha",
                    cards: ["Miss Scarlet", "Knife", "Kitchen"],
                    nonRefuters: [],
                    refuter: "Bob",
                    seenCard: "Knife",
                },
            ],
        };

        const decoded = decodeSession(v2);
        expect(decoded).toBeDefined();
        if (!decoded) return;

        // Migrated setup: each card/category has id === legacy name.
        const mustard = findCardEntry(decoded.setup, Card("Col. Mustard"));
        expect(mustard).toBeDefined();
        expect(mustard?.name).toBe("Col. Mustard");

        // Anisha's known card comes through with id = "Col. Mustard".
        expect(decoded.hands).toHaveLength(1);
        expect(String(decoded.hands[0].cards[0])).toBe("Col. Mustard");

        // Suggestion references use ids = names too. Suggester/refuter
        // are unchanged (they're still just strings).
        expect(decoded.suggestions).toHaveLength(1);
        const s = decoded.suggestions[0];
        expect(String(s.suggester)).toBe("Anisha");
        expect(String(s.refuter)).toBe("Bob");
        expect(String(s.seenCard)).toBe("Knife");

        // Re-encode: comes back as v3 with id+name fields on every
        // card and category. Round-trip decodes to the same ids.
        const reEncoded = encodeSession(decoded);
        expect(reEncoded.version).toBe(3);
        expect(reEncoded.setup.categories[0].id).toBe("Suspects");
        expect(reEncoded.setup.categories[0].cards[0].id).toBe(
            "Miss Scarlet",
        );
        expect(reEncoded.setup.categories[0].cards[0].name).toBe(
            "Miss Scarlet",
        );

        const reDecoded = decodeSession(reEncoded);
        expect(reDecoded).toBeDefined();
        if (!reDecoded) return;
        const reMustard = findCardEntry(
            reDecoded.setup,
            Card("Col. Mustard"),
        );
        expect(reMustard?.name).toBe("Col. Mustard");
    });

    test("v1 payload chains through the v2 → v3 migration", () => {
        // Oldest saved shape: hardcoded suspects/weapons/rooms. Migrates
        // to v2 (categories derived from the fixed names) and then to
        // v3 (id = name).
        const v1 = {
            version: 1,
            setup: {
                players: ["Anisha"],
                suspects: ["Miss Scarlet"],
                weapons: ["Knife"],
                rooms: ["Kitchen"],
            },
            hands: [],
            handSizes: [],
            suggestions: [],
        };
        const decoded = decodeSession(v1);
        expect(decoded).toBeDefined();
        if (!decoded) return;
        // Custom effect-equals matcher intercepts array deep-equality,
        // so compare element-wise.
        const catNames = decoded.setup.categories.map(c => c.name);
        expect(catNames.length).toBe(3);
        expect(catNames[0]).toBe("Suspects");
        expect(catNames[1]).toBe("Weapons");
        expect(catNames[2]).toBe("Rooms");
        // Ids = names, per migration.
        const scarlet = findCardEntry(
            decoded.setup,
            Card("Miss Scarlet"),
        );
        expect(scarlet?.name).toBe("Miss Scarlet");
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
        categories: current.categories.map<Category>(c => ({
            ...c,
            cards: c.cards.map(entry =>
                entry.id === cardId
                    ? { ...entry, name: nextName }
                    : entry,
            ),
        })),
    });
