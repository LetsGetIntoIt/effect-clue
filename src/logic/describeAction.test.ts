import { describeAction } from "./describeAction";
import type { ClueAction, ClueState, DraftSuggestion } from "./ClueState";
import { Card, CardCategory, Player } from "./GameObjects";
import { GameSetup, CardEntry, Category } from "./GameSetup";
import { KnownCard } from "./InitialKnowledge";
import { SuggestionId } from "./Suggestion";

// Simulates next-intl's `t(key, values)` with the real en.json templates.
// Keeps the test independent of the React provider while still validating
// that the describer passes the right variables into the right keys.
import * as fs from "node:fs";
import * as path from "node:path";

const messages = JSON.parse(
    fs.readFileSync(
        path.resolve(process.cwd(), "messages/en.json"),
        "utf8",
    ),
);

const tHistory = (key: string, values?: Record<string, string | number>): string => {
    const parts = key.split(".");
    let node: unknown = messages.history;
    for (const p of parts) {
        node = (node as Record<string, unknown>)[p];
    }
    let template = String(node);
    if (values) {
        for (const [k, v] of Object.entries(values)) {
            template = template.replace(
                new RegExp(`\\{${k}\\}`, "g"),
                String(v),
            );
        }
    }
    return template;
};

const cat = (id: string, name: string, cards: ReadonlyArray<readonly [string, string]>): Category =>
    Category({
        id: CardCategory(id),
        name,
        cards: cards.map(([cid, cname]) => CardEntry({ id: Card(cid), name: cname })),
    });

const setup = GameSetup({
    players: [Player("Player 1"), Player("Player 2")],
    categories: [
        cat("cat-suspects", "Suspects", [
            ["card-scarlet", "Miss Scarlet"],
            ["card-mustard", "Col. Mustard"],
        ]),
        cat("cat-rooms", "Rooms", [
            ["card-conservatory", "Conservatory"],
            ["card-library", "Library"],
        ]),
    ],
});

const baseState: ClueState = {
    setup,
    handSizes: [],
    knownCards: [
        KnownCard({ player: Player("Player 2"), card: Card("card-conservatory") }),
    ],
    suggestions: [],
    uiMode: "checklist",
};

const suggestionA: DraftSuggestion = {
    id: SuggestionId("sug-a"),
    suggester: Player("Player 2"),
    cards: [Card("card-scarlet"), Card("card-conservatory")],
    nonRefuters: [],
};

const describe_ = (action: ClueAction, state: ClueState = baseState): string =>
    describeAction(action, state, tHistory);

describe("describeAction — specific tooltips", () => {
    test("addPlayer names the next generated player", () => {
        expect(describe_({ type: "addPlayer" })).toBe("adding Player 3");
    });

    test("removePlayer names the player", () => {
        expect(describe_({ type: "removePlayer", player: Player("Player 2") })).toBe(
            "removing player Player 2",
        );
    });

    test("renamePlayer names old and new", () => {
        expect(
            describe_({
                type: "renamePlayer",
                oldName: Player("Player 1"),
                newName: Player("Kapil"),
            }),
        ).toBe("renaming player Player 1 to Kapil");
    });

    test("addCategory names the next generated category", () => {
        expect(describe_({ type: "addCategory" })).toBe("adding category Category 1");
    });

    test("removeCategoryById names the category", () => {
        expect(
            describe_({
                type: "removeCategoryById",
                categoryId: CardCategory("cat-rooms"),
            }),
        ).toBe("removing category Rooms");
    });

    test("addCardToCategoryById names predicted card and target category", () => {
        expect(
            describe_({
                type: "addCardToCategoryById",
                categoryId: CardCategory("cat-rooms"),
            }),
        ).toBe("adding card Card 1 to category Rooms");
    });

    test("removeCardById names the card and its category", () => {
        expect(
            describe_({
                type: "removeCardById",
                cardId: Card("card-conservatory"),
            }),
        ).toBe("removing card Conservatory from category Rooms");
    });

    test("renameCategory names old and new", () => {
        expect(
            describe_({
                type: "renameCategory",
                categoryId: CardCategory("cat-rooms"),
                name: "Locations",
            }),
        ).toBe("renaming category Rooms to Locations");
    });

    test("renameCard names old and new", () => {
        expect(
            describe_({
                type: "renameCard",
                cardId: Card("card-conservatory"),
                name: "Garden",
            }),
        ).toBe("renaming card Conservatory to Garden");
    });

    test("addKnownCard names player and card", () => {
        expect(
            describe_({
                type: "addKnownCard",
                card: KnownCard({
                    player: Player("Player 2"),
                    card: Card("card-conservatory"),
                }),
            }),
        ).toBe("marking that Player 2 owns Conservatory");
    });

    test("removeKnownCard resolves player and card via index", () => {
        expect(
            describe_({ type: "removeKnownCard", index: 0 }),
        ).toBe("unmarking that Player 2 owns Conservatory");
    });

    test("removeKnownCard falls back when index is out of range", () => {
        expect(
            describe_({ type: "removeKnownCard", index: 99 }),
        ).toBe("unmarking a known card");
    });

    test("setHandSize includes player and size", () => {
        expect(
            describe_({
                type: "setHandSize",
                player: Player("Player 2"),
                size: 3,
            }),
        ).toBe("setting Player 2's hand size to 3");
    });

    test("setHandSize cleared", () => {
        expect(
            describe_({
                type: "setHandSize",
                player: Player("Player 2"),
                size: undefined,
            }),
        ).toBe("clearing Player 2's hand size");
    });

    test("addSuggestion includes suggester and card list", () => {
        expect(
            describe_({ type: "addSuggestion", suggestion: suggestionA }),
        ).toBe("adding Player 2's suggestion of Miss Scarlet + Conservatory");
    });

    test("updateSuggestion includes number, player, and cards", () => {
        const state: ClueState = { ...baseState, suggestions: [suggestionA] };
        expect(
            describeAction(
                { type: "updateSuggestion", suggestion: suggestionA },
                state,
                tHistory,
            ),
        ).toBe(
            "editing Suggestion #1 by Player 2 (Miss Scarlet + Conservatory)",
        );
    });

    test("removeSuggestion includes number, player, and cards", () => {
        const state: ClueState = { ...baseState, suggestions: [suggestionA] };
        expect(
            describeAction(
                { type: "removeSuggestion", id: suggestionA.id },
                state,
                tHistory,
            ),
        ).toBe(
            "removing Suggestion #1 by Player 2 (Miss Scarlet + Conservatory)",
        );
    });

    test("removeSuggestion falls back when id not found", () => {
        expect(
            describe_({ type: "removeSuggestion", id: SuggestionId("gone") }),
        ).toBe("removing a suggestion");
    });

    test("loadCardSet uses the provided label", () => {
        expect(
            describe_({
                type: "loadCardSet",
                cardSet: setup.cardSet,
                label: "Classic",
            }),
        ).toBe('loading card pack "Classic"');
    });

    test("newGame", () => {
        expect(describe_({ type: "newGame" })).toBe("starting a new game");
    });
});
