import { act, renderHook } from "@testing-library/react";
import { HashMap } from "effect";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Player } from "../logic/GameObjects";
import { CLASSIC_SETUP_3P, DEFAULT_SETUP } from "../logic/GameSetup";
import { KnownCard } from "../logic/InitialKnowledge";
import type { GameSession } from "../logic/Persistence";
import { CaseFileOwner } from "../logic/GameObjects";
import { Cell, getCell, N as N_VAL, Y as Y_VAL } from "../logic/Knowledge";
import { Result } from "effect";
import {
    AccusationId,
    newAccusationId,
} from "../logic/Accusation";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
} from "../logic/Suggestion";
import { cardByName } from "../logic/test-utils/CardByName";
import { ClueProvider, useClue } from "./state";

// -----------------------------------------------------------------------
// The `reducer` and `initialState` are module-private in state.tsx — the
// whole machine is intentionally only observable through <ClueProvider>
// + useClue(). Tests drive it end-to-end via `renderHook` and `act`; the
// hook surface is what real callers use, so this is also the most
// faithful coverage.
// -----------------------------------------------------------------------

const wrapper = ({ children }: { children: ReactNode }) => (
    <ClueProvider>{children}</ClueProvider>
);

const renderClue = () => renderHook(() => useClue(), { wrapper });

// mutes noisy "not wrapped in act(...)" and other async warnings from
// the hydration effect firing inside the initial render. The tests
// care about dispatch behavior, not the timing of the one-shot
// hydration path.
const silenceConsoleError = () => vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
    window.localStorage.clear();
});

describe("useClue — context wiring", () => {
    test("throws when used outside <ClueProvider>", () => {
        const restore = silenceConsoleError();
        expect(() => renderHook(() => useClue())).toThrow(
            /useClue must be used inside <ClueProvider>/,
        );
        restore.mockRestore();
    });

    test("initial state matches DEFAULT_SETUP with empty collections and `setup` mode", () => {
        const { result } = renderClue();
        expect(result.current.state.setup).toBe(DEFAULT_SETUP);
        expect(result.current.state.knownCards).toEqual([]);
        expect(result.current.state.handSizes).toEqual([]);
        expect(result.current.state.suggestions).toEqual([]);
        expect(result.current.state.uiMode).toBe("setup");
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });
});

describe("setup-side actions", () => {
    test("newGame produces a fresh setup and empties collections", () => {
        const { result } = renderClue();
        // Start with some data so the reset is observable.
        act(() => {
            result.current.dispatch({ type: "addPlayer" });
            result.current.dispatch({
                type: "addKnownCard",
                card: KnownCard({
                    player: Player("Player 1"),
                    card: cardByName(CLASSIC_SETUP_3P, "Knife"),
                }),
            });
        });
        act(() => result.current.dispatch({ type: "newGame" }));
        expect(result.current.state.knownCards).toEqual([]);
        expect(result.current.state.handSizes).toEqual([]);
        expect(result.current.state.suggestions).toEqual([]);
        // newGameSetup() mints fresh ids, so the setup isn't DEFAULT_SETUP
        // by reference — but it has the same shape (3 categories for the
        // classic deck).
        expect(result.current.state.setup.categories).toHaveLength(3);
    });

    test("setUiMode changes uiMode and bypasses the undo history", () => {
        const { result } = renderClue();
        expect(result.current.state.uiMode).toBe("setup");
        expect(result.current.canUndo).toBe(false);

        act(() => result.current.dispatch({ type: "setUiMode", mode: "checklist" }));
        expect(result.current.state.uiMode).toBe("checklist");
        // Purely presentational — doesn't register in the past stack.
        expect(result.current.canUndo).toBe(false);
    });

    test("addCategory appends a numbered `Category N` that doesn't collide", () => {
        const { result } = renderClue();
        const before = result.current.state.setup.categories.length;
        act(() => result.current.dispatch({ type: "addCategory" }));
        const after = result.current.state.setup.categories;
        expect(after.length).toBe(before + 1);
        // DEFAULT_SETUP categories are Suspect / Weapon / Room — none
        // start with "Category ", so the new one is "Category 1".
        expect(after[after.length - 1]?.name).toBe("Category 1");
    });

    test("two consecutive addCategory calls disambiguate to Category 1 and Category 2", () => {
        const { result } = renderClue();
        act(() => {
            result.current.dispatch({ type: "addCategory" });
            result.current.dispatch({ type: "addCategory" });
        });
        const names = result.current.state.setup.categories.map(c => c.name);
        expect(names).toContain("Category 1");
        expect(names).toContain("Category 2");
    });

    test("removeCategoryById refuses when only one category remains", () => {
        const { result } = renderClue();
        // Capture ids up front — per-iteration `act` lets
        // `result.current` re-read the post-dispatch state each loop.
        const initialIds = result.current.state.setup.categories.map(c => c.id);
        for (const id of initialIds.slice(0, -1)) {
            act(() => result.current.dispatch({ type: "removeCategoryById", categoryId: id }));
        }
        expect(result.current.state.setup.categories).toHaveLength(1);
        const onlyId = result.current.state.setup.categories[0]!.id;
        act(() => result.current.dispatch({ type: "removeCategoryById", categoryId: onlyId }));
        expect(result.current.state.setup.categories).toHaveLength(1);
    });

    test("addCardToCategoryById appends `Card N` to the target category", () => {
        const { result } = renderClue();
        const weaponId = result.current.state.setup.categories.find(c => c.name === "Weapon")!.id;
        const before = result.current.state.setup.categories.find(c => c.id === weaponId)!.cards.length;
        act(() => result.current.dispatch({ type: "addCardToCategoryById", categoryId: weaponId }));
        const after = result.current.state.setup.categories.find(c => c.id === weaponId)!.cards;
        expect(after.length).toBe(before + 1);
        expect(after[after.length - 1]?.name).toBe("Card 1");
    });

    test("removeCardById refuses to drop the last card in a category", () => {
        const { result } = renderClue();
        const weaponCat = result.current.state.setup.categories.find(c => c.name === "Weapon")!;
        // Snapshot the weapon-category card ids up front so each
        // per-iteration `act` re-reads the post-dispatch state.
        const cardIdsToRemove = weaponCat.cards.slice(0, -1).map(e => e.id);
        for (const cardId of cardIdsToRemove) {
            act(() => result.current.dispatch({ type: "removeCardById", cardId }));
        }
        const lastCardId = result.current.state.setup.categories
            .find(c => c.id === weaponCat.id)!.cards[0]!.id;
        act(() => result.current.dispatch({ type: "removeCardById", cardId: lastCardId }));
        expect(result.current.state.setup.categories.find(c => c.id === weaponCat.id)!.cards)
            .toHaveLength(1);
    });

    test("renameCategory applies trim and disambiguates against siblings", () => {
        const { result } = renderClue();
        const weaponCat = result.current.state.setup.categories.find(c => c.name === "Weapon")!;
        const suspectCat = result.current.state.setup.categories.find(c => c.name === "Suspect")!;

        // Trim whitespace around a valid name.
        act(() => result.current.dispatch({
            type: "renameCategory",
            categoryId: weaponCat.id,
            name: "  Gadget  ",
        }));
        expect(
            result.current.state.setup.categories.find(c => c.id === weaponCat.id)?.name,
        ).toBe("Gadget");

        // Trying to collide with "Suspect" disambiguates to "Suspect 2".
        act(() => result.current.dispatch({
            type: "renameCategory",
            categoryId: weaponCat.id,
            name: "Suspect",
        }));
        expect(
            result.current.state.setup.categories.find(c => c.id === weaponCat.id)?.name,
        ).toMatch(/^Suspect/);
        expect(
            result.current.state.setup.categories.find(c => c.id === suspectCat.id)?.name,
        ).toBe("Suspect");
    });

    test("renameCategory is a no-op when the proposed name is empty after trim", () => {
        const { result } = renderClue();
        const weaponCat = result.current.state.setup.categories.find(c => c.name === "Weapon")!;
        const before = result.current.state;
        act(() => result.current.dispatch({
            type: "renameCategory",
            categoryId: weaponCat.id,
            name: "   ",
        }));
        expect(result.current.state).toBe(before);
    });

    test("renameCategory is a no-op when the name is unchanged", () => {
        const { result } = renderClue();
        const weaponCat = result.current.state.setup.categories.find(c => c.name === "Weapon")!;
        const before = result.current.state;
        act(() => result.current.dispatch({
            type: "renameCategory",
            categoryId: weaponCat.id,
            name: "Weapon",
        }));
        expect(result.current.state).toBe(before);
    });

    test("renameCard applies trim and disambiguates", () => {
        const { result } = renderClue();
        const cardEntry = result.current.state.setup.categories
            .flatMap(c => c.cards)
            .find(e => e.name === "Knife")!;
        act(() => result.current.dispatch({
            type: "renameCard",
            cardId: cardEntry.id,
            name: "  Dagger  ",
        }));
        expect(
            result.current.state.setup.categories
                .flatMap(c => c.cards)
                .find(e => e.id === cardEntry.id)?.name,
        ).toBe("Dagger");
    });
});

describe("knownCards", () => {
    test("addKnownCard appends to the list", () => {
        const { result } = renderClue();
        const card = cardByName(CLASSIC_SETUP_3P, "Knife");
        act(() => result.current.dispatch({
            type: "addKnownCard",
            card: KnownCard({ player: Player("Player 1"), card }),
        }));
        expect(result.current.state.knownCards).toHaveLength(1);
        expect(result.current.state.knownCards[0]?.card).toBe(card);
    });

    test("removeKnownCard removes by index", () => {
        const { result } = renderClue();
        const c1 = cardByName(CLASSIC_SETUP_3P, "Knife");
        const c2 = cardByName(CLASSIC_SETUP_3P, "Rope");
        act(() => {
            result.current.dispatch({
                type: "addKnownCard",
                card: KnownCard({ player: Player("Player 1"), card: c1 }),
            });
            result.current.dispatch({
                type: "addKnownCard",
                card: KnownCard({ player: Player("Player 1"), card: c2 }),
            });
        });
        act(() => result.current.dispatch({ type: "removeKnownCard", index: 0 }));
        expect(result.current.state.knownCards).toHaveLength(1);
        expect(result.current.state.knownCards[0]?.card).toBe(c2);
    });
});

describe("setHandSize", () => {
    test("sets a numeric size for a player", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({
            type: "setHandSize",
            player: Player("Player 1"),
            size: 5,
        }));
        const entry = result.current.state.handSizes.find(
            ([p]) => String(p) === "Player 1",
        );
        expect(entry?.[1]).toBe(5);
    });

    test("overwrites an existing size for the same player", () => {
        const { result } = renderClue();
        act(() => {
            result.current.dispatch({
                type: "setHandSize",
                player: Player("Player 1"),
                size: 5,
            });
            result.current.dispatch({
                type: "setHandSize",
                player: Player("Player 1"),
                size: 3,
            });
        });
        const entries = result.current.state.handSizes.filter(
            ([p]) => String(p) === "Player 1",
        );
        expect(entries).toHaveLength(1);
        expect(entries[0]?.[1]).toBe(3);
    });

    test("removes the entry when size is undefined", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({
            type: "setHandSize",
            player: Player("Player 1"),
            size: 5,
        }));
        act(() => result.current.dispatch({
            type: "setHandSize",
            player: Player("Player 1"),
            size: undefined,
        }));
        expect(
            result.current.state.handSizes.find(([p]) => String(p) === "Player 1"),
        ).toBeUndefined();
    });
});

describe("suggestions", () => {
    const suspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
    const weapon = cardByName(CLASSIC_SETUP_3P, "Knife");
    const room = cardByName(CLASSIC_SETUP_3P, "Kitchen");

    test("addSuggestion appends a draft to the log", () => {
        const { result } = renderClue();
        const id = newSuggestionId();
        act(() => result.current.dispatch({
            type: "addSuggestion",
            suggestion: {
                id,
                suggester: Player("Player 1"),
                cards: [suspect, weapon, room],
                nonRefuters: [],
            },
        }));
        expect(result.current.state.suggestions).toHaveLength(1);
        expect(result.current.state.suggestions[0]?.id).toBe(id);
    });

    test("updateSuggestion replaces the entry with the matching id", () => {
        const { result } = renderClue();
        const id = newSuggestionId();
        act(() => result.current.dispatch({
            type: "addSuggestion",
            suggestion: {
                id,
                suggester: Player("Player 1"),
                cards: [suspect, weapon, room],
                nonRefuters: [],
            },
        }));
        act(() => result.current.dispatch({
            type: "updateSuggestion",
            suggestion: {
                id,
                suggester: Player("Player 2"),
                cards: [suspect, weapon, room],
                nonRefuters: [],
                refuter: Player("Player 3"),
            },
        }));
        const s = result.current.state.suggestions[0];
        expect(s?.suggester).toBe(Player("Player 2"));
        expect(s?.refuter).toBe(Player("Player 3"));
    });

    test("removeSuggestion drops the entry with the matching id", () => {
        const { result } = renderClue();
        const idA = newSuggestionId();
        const idB = newSuggestionId();
        act(() => {
            result.current.dispatch({
                type: "addSuggestion",
                suggestion: {
                    id: idA,
                    suggester: Player("Player 1"),
                    cards: [suspect, weapon, room],
                    nonRefuters: [],
                },
            });
            result.current.dispatch({
                type: "addSuggestion",
                suggestion: {
                    id: idB,
                    suggester: Player("Player 2"),
                    cards: [suspect, weapon, room],
                    nonRefuters: [],
                },
            });
        });
        act(() => result.current.dispatch({ type: "removeSuggestion", id: idA }));
        expect(result.current.state.suggestions.map(s => s.id)).toEqual([idB]);
    });
});

describe("player roster", () => {
    test("addPlayer appends a numbered `Player N` that doesn't collide", () => {
        const { result } = renderClue();
        // DEFAULT_SETUP starts with Player 1..4; addPlayer picks Player 5.
        act(() => result.current.dispatch({ type: "addPlayer" }));
        const names = result.current.state.setup.players.map(p => String(p));
        expect(names).toContain("Player 5");
    });

    test("removePlayer also removes hands, known cards, and suggestions referencing them", () => {
        const { result } = renderClue();
        const p1 = Player("Player 1");
        const p2 = Player("Player 2");
        const knife = cardByName(CLASSIC_SETUP_3P, "Knife");
        const suspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
        const room = cardByName(CLASSIC_SETUP_3P, "Kitchen");
        act(() => {
            result.current.dispatch({
                type: "addKnownCard",
                card: KnownCard({ player: p1, card: knife }),
            });
            result.current.dispatch({
                type: "setHandSize",
                player: p1,
                size: 5,
            });
            result.current.dispatch({
                type: "addSuggestion",
                suggestion: {
                    id: newSuggestionId(),
                    suggester: p1,
                    cards: [suspect, knife, room],
                    nonRefuters: [p2],
                    refuter: p1,
                },
            });
        });
        act(() => result.current.dispatch({ type: "removePlayer", player: p1 }));
        expect(result.current.state.setup.players).not.toContain(p1);
        // knownCards referencing p1 are dropped.
        expect(result.current.state.knownCards).toHaveLength(0);
        // handSize for p1 is dropped.
        expect(
            result.current.state.handSizes.find(([p]) => p === p1),
        ).toBeUndefined();
        // Suggestions where p1 was the suggester are dropped entirely.
        expect(result.current.state.suggestions).toHaveLength(0);
    });

    test("removePlayer clears refuter on suggestions where the removed player was the refuter", () => {
        const { result } = renderClue();
        const p1 = Player("Player 1");
        const p2 = Player("Player 2");
        const suspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
        const knife = cardByName(CLASSIC_SETUP_3P, "Knife");
        const room = cardByName(CLASSIC_SETUP_3P, "Kitchen");
        act(() => result.current.dispatch({
            type: "addSuggestion",
            suggestion: {
                id: newSuggestionId(),
                suggester: p1,
                cards: [suspect, knife, room],
                nonRefuters: [],
                refuter: p2,
            },
        }));
        act(() => result.current.dispatch({ type: "removePlayer", player: p2 }));
        // Suggestion is kept (suggester p1 is still around) but its
        // refuter reference is cleared.
        expect(result.current.state.suggestions).toHaveLength(1);
        expect(result.current.state.suggestions[0]?.refuter).toBeUndefined();
    });

    test("renamePlayer propagates the new name across roster, hands, and suggestions", () => {
        const { result } = renderClue();
        const oldName = Player("Player 1");
        const newName = Player("Anisha");
        const knife = cardByName(CLASSIC_SETUP_3P, "Knife");
        const suspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
        const room = cardByName(CLASSIC_SETUP_3P, "Kitchen");
        act(() => {
            result.current.dispatch({
                type: "addKnownCard",
                card: KnownCard({ player: oldName, card: knife }),
            });
            result.current.dispatch({
                type: "setHandSize",
                player: oldName,
                size: 5,
            });
            result.current.dispatch({
                type: "addSuggestion",
                suggestion: {
                    id: newSuggestionId(),
                    suggester: oldName,
                    cards: [suspect, knife, room],
                    nonRefuters: [],
                    refuter: oldName,
                },
            });
        });
        act(() => result.current.dispatch({ type: "renamePlayer", oldName, newName }));
        const names = result.current.state.setup.players.map(p => String(p));
        expect(names).toContain("Anisha");
        expect(names).not.toContain("Player 1");
        expect(result.current.state.knownCards[0]?.player).toBe(newName);
        expect(result.current.state.handSizes[0]?.[0]).toBe(newName);
        expect(result.current.state.suggestions[0]?.suggester).toBe(newName);
        expect(result.current.state.suggestions[0]?.refuter).toBe(newName);
    });

    test("renamePlayer is a no-op when old and new names are identical", () => {
        const { result } = renderClue();
        const before = result.current.state;
        act(() => result.current.dispatch({
            type: "renamePlayer",
            oldName: Player("Player 1"),
            newName: Player("Player 1"),
        }));
        expect(result.current.state).toBe(before);
    });
});

describe("replaceSession", () => {
    test("replaces the entire session and mints fresh ids for empty-id suggestions", () => {
        const { result } = renderClue();
        const hasSuspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
        const hasKnife = cardByName(CLASSIC_SETUP_3P, "Knife");
        const hasRoom = cardByName(CLASSIC_SETUP_3P, "Kitchen");
        const session: GameSession = {
            setup: CLASSIC_SETUP_3P,
            hands: [{ player: Player("Anisha"), cards: [hasKnife] }],
            handSizes: [{ player: Player("Anisha"), size: 6 }],
            suggestions: [
                Suggestion({
                    // Empty sentinel — the reducer should regenerate a real id.
                    id: SuggestionId(""),
                    suggester: Player("Anisha"),
                    cards: [hasSuspect, hasKnife, hasRoom],
                    nonRefuters: [],
                }),
            ],
            accusations: [],
        };
        act(() => result.current.dispatch({ type: "replaceSession", session }));
        expect(result.current.state.setup).toBe(CLASSIC_SETUP_3P);
        expect(result.current.state.knownCards).toHaveLength(1);
        expect(result.current.state.handSizes).toHaveLength(1);
        const replacedId = result.current.state.suggestions[0]?.id;
        expect(replacedId).toBeDefined();
        expect(replacedId).not.toBe(SuggestionId(""));
        expect(String(replacedId)).toMatch(/^suggestion-/);
    });

    test("replaceSession does not enter the undo history", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({
            type: "replaceSession",
            session: {
                setup: CLASSIC_SETUP_3P,
                hands: [],
                handSizes: [],
                suggestions: [],
                accusations: [],
            },
        }));
        // Even though state changed, canUndo remains false for the
        // replaceSession bypass.
        expect(result.current.canUndo).toBe(false);
    });
});

describe("undo / redo", () => {
    test("addPlayer enters the past stack and undo reverses it", () => {
        const { result } = renderClue();
        expect(result.current.canUndo).toBe(false);
        act(() => result.current.dispatch({ type: "addPlayer" }));
        expect(result.current.canUndo).toBe(true);
        const priorPlayers = DEFAULT_SETUP.players.length;
        expect(result.current.state.setup.players).toHaveLength(priorPlayers + 1);

        act(() => result.current.undo());
        expect(result.current.state.setup.players).toHaveLength(priorPlayers);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(true);
    });

    test("redo reapplies the previously-undone action", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({ type: "addPlayer" }));
        act(() => result.current.undo());
        act(() => result.current.redo());
        expect(result.current.state.setup.players).toHaveLength(
            DEFAULT_SETUP.players.length + 1,
        );
        expect(result.current.canRedo).toBe(false);
    });

    test("a new action after undo clears the future stack", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({ type: "addPlayer" }));
        act(() => result.current.undo());
        expect(result.current.canRedo).toBe(true);
        act(() => result.current.dispatch({ type: "addPlayer" }));
        expect(result.current.canRedo).toBe(false);
    });

    test("setUiMode is not undoable", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({ type: "setUiMode", mode: "checklist" }));
        expect(result.current.canUndo).toBe(false);
        // An actual user action after the uiMode flip is the one that
        // enters history.
        act(() => result.current.dispatch({ type: "addPlayer" }));
        expect(result.current.canUndo).toBe(true);
        act(() => result.current.undo());
        // Undo reverts the addPlayer — the mode stays where we left it.
        expect(result.current.state.uiMode).toBe("checklist");
    });

    test("nextUndo points at the most recent action and its pre-state", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({ type: "addPlayer" }));
        const hint = result.current.nextUndo;
        expect(hint).toBeDefined();
        expect(hint?.action.type).toBe("addPlayer");
        // Pre-state's player count equals the initial roster size.
        expect(hint?.previousState.setup.players).toHaveLength(
            DEFAULT_SETUP.players.length,
        );
    });

    test("nextRedo points at the action redo would replay", () => {
        const { result } = renderClue();
        act(() => result.current.dispatch({ type: "addPlayer" }));
        act(() => result.current.undo());
        expect(result.current.nextRedo?.action.type).toBe("addPlayer");
    });
});

describe("derived values", () => {
    test("derived.suggestionsAsData mirrors the suggestion draft array", () => {
        const { result } = renderClue();
        const id = newSuggestionId();
        const suspect = cardByName(CLASSIC_SETUP_3P, "Col. Mustard");
        const knife = cardByName(CLASSIC_SETUP_3P, "Knife");
        const room = cardByName(CLASSIC_SETUP_3P, "Kitchen");
        act(() => result.current.dispatch({
            type: "addSuggestion",
            suggestion: {
                id,
                suggester: Player("Player 1"),
                cards: [suspect, knife, room],
                nonRefuters: [],
            },
        }));
        expect(result.current.derived.suggestionsAsData).toHaveLength(1);
        expect(result.current.derived.suggestionsAsData[0]?.id).toBe(id);
    });

    test("derived.initialKnowledge gains entries when a known card is recorded", () => {
        const { result } = renderClue();
        const before = HashMap.size(result.current.derived.initialKnowledge.checklist);
        const knife = cardByName(CLASSIC_SETUP_3P, "Knife");
        act(() => result.current.dispatch({
            type: "addKnownCard",
            card: KnownCard({ player: Player("Player 1"), card: knife }),
        }));
        const after = HashMap.size(result.current.derived.initialKnowledge.checklist);
        expect(after).toBeGreaterThan(before);
    });
});

describe("accusations end-to-end", () => {
    test("addAccusation surfaces in derived.accusationsAsData", () => {
        const { result } = renderClue();
        // Use the default setup's players — no need to swap to
        // CLASSIC_SETUP_3P for this assertion.
        const [first] = result.current.state.setup.players;
        const knife = cardByName(
            result.current.state.setup,
            // CLASSIC_SETUP_3P contains "Knife"; DEFAULT_SETUP varies
            // by build but exposes the same names.
            "Knife",
        );
        if (first === undefined || knife === undefined) {
            throw new Error("default setup is missing players or knife");
        }
        const draft = {
            id: newAccusationId(),
            accuser: first,
            cards: [knife],
        };
        act(() =>
            result.current.dispatch({
                type: "addAccusation",
                accusation: draft,
            }),
        );
        expect(result.current.derived.accusationsAsData).toHaveLength(1);
        expect(result.current.derived.accusationsAsData[0]?.accuser).toBe(
            first,
        );
    });

    test("dispatching a failed accusation triggers failedAccusationEliminate when two case-file cells are pinned", () => {
        // Replace the session with CLASSIC_SETUP_3P + a contrived
        // initial knowledge that pins PLUM and KNIFE to Y in the case
        // file (via knownCard cascades). Then dispatch a failed
        // accusation `(Plum, Knife, Conservatory)` — the rule should
        // force `Conservatory = N` for the case file.
        const { result } = renderClue();
        const setup = CLASSIC_SETUP_3P;
        const A = Player("Anisha");
        const B = Player("Bob");
        const C = Player("Cho");
        const PLUM = cardByName(setup, "Prof. Plum");
        const KNIFE = cardByName(setup, "Knife");
        const CONSERV = cardByName(setup, "Conservatory");

        // Build the suspect category so that Plum is the only
        // remaining case-file candidate: assign all 5 other suspects
        // to player A. Likewise for weapons → Knife. Hand sizes set
        // so the deducer believes A's row.
        const otherSuspects = setup.categories
            .find(c => c.name === "Suspect")!
            .cards.filter(e => e.id !== PLUM)
            .map(e => e.id);
        const otherWeapons = setup.categories
            .find(c => c.name === "Weapon")!
            .cards.filter(e => e.id !== KNIFE)
            .map(e => e.id);

        act(() =>
            result.current.dispatch({
                type: "replaceSession",
                session: {
                    setup,
                    hands: [
                        {
                            player: A,
                            cards: [...otherSuspects, ...otherWeapons],
                        },
                    ],
                    handSizes: [
                        {
                            player: A,
                            size: otherSuspects.length + otherWeapons.length,
                        },
                        // B and C carry the rest of the deck (rooms +
                        // case-file). Hand sizes are computed so the
                        // remaining 9 rooms - 1 case-file = 8 rooms
                        // distribute across B+C, totalling 8 cards.
                        // Set B = 4, C = 4 so the deducer can solve.
                        { player: B, size: 4 },
                        { player: C, size: 4 },
                    ],
                    suggestions: [],
                    accusations: [],
                },
            }),
        );

        // Sanity: deduction should have pinned Plum (suspect) and
        // Knife (weapon) into the case file via card-ownership slices.
        const ded1 = result.current.derived.deductionResult;
        if (!Result.isSuccess(ded1)) {
            throw new Error(
                `expected initial deduction to succeed, got: ${JSON.stringify(ded1)}`,
            );
        }
        expect(
            getCell(ded1.success, Cell(CaseFileOwner(), PLUM)),
        ).toBe(Y_VAL);
        expect(
            getCell(ded1.success, Cell(CaseFileOwner(), KNIFE)),
        ).toBe(Y_VAL);
        // Conservatory is not yet pinned.
        expect(
            getCell(ded1.success, Cell(CaseFileOwner(), CONSERV)),
        ).toBeUndefined();

        // Now log a failed accusation naming PLUM + KNIFE + CONSERV.
        act(() =>
            result.current.dispatch({
                type: "addAccusation",
                accusation: {
                    id: AccusationId(""),
                    accuser: A,
                    cards: [PLUM, KNIFE, CONSERV],
                },
            }),
        );

        // failedAccusationEliminate forces CONSERV = N for case file.
        const ded2 = result.current.derived.deductionResult;
        if (!Result.isSuccess(ded2)) {
            throw new Error(
                `expected deduction to remain successful, got: ${JSON.stringify(ded2)}`,
            );
        }
        expect(
            getCell(ded2.success, Cell(CaseFileOwner(), CONSERV)),
        ).toBe(N_VAL);
    });

    test("Tier 2: failed accusations covering every room force the partner weapon to N (case_S=Y, no case_W=Y yet)", () => {
        // The user's reported flow but stripped to the Tier-2-only
        // case: pin PLUM=Y in case file by assigning every other
        // suspect to a player; do NOT narrow weapons. Then file
        // failed accusations (PLUM, KNIFE, R) for every room.
        // Tier 1 alone can't fire — only one case-file Y per
        // accusation. Tier 2's pigeonhole-over-rooms must force
        // case_KNIFE = N.
        const { result } = renderClue();
        const setup = CLASSIC_SETUP_3P;
        const A = Player("Anisha");
        const B = Player("Bob");
        const C = Player("Cho");
        const PLUM = cardByName(setup, "Prof. Plum");
        const KNIFE = cardByName(setup, "Knife");

        const otherSuspects = setup.categories
            .find(c => c.name === "Suspect")!
            .cards.filter(e => e.id !== PLUM)
            .map(e => e.id);
        const rooms = setup.categories.find(c => c.name === "Room")!.cards.map(
            c => c.id,
        );

        act(() =>
            result.current.dispatch({
                type: "replaceSession",
                session: {
                    setup,
                    // Only suspects-other-than-Plum are dealt to A. No
                    // weapon assignments — case_KNIFE is genuinely
                    // unknown going in.
                    hands: [
                        {
                            player: A,
                            cards: otherSuspects,
                        },
                    ],
                    handSizes: [
                        // 5 suspects to A, rest of the deck (6 weapons
                        // - 1 case-file weapon = 5; 9 rooms - 1
                        // case-file room = 8) split across B+C+A.
                        // 21 total - 3 case file = 18 dealt; A has 5
                        // already; B+C carry 13 between them. Use 7+6.
                        { player: A, size: 5 },
                        { player: B, size: 7 },
                        { player: C, size: 6 },
                    ],
                    suggestions: [],
                    accusations: [],
                },
            }),
        );

        // Sanity: PLUM should now be pinned Y; KNIFE should still be
        // unknown in the case file.
        const ded1 = result.current.derived.deductionResult;
        if (!Result.isSuccess(ded1)) {
            throw new Error(
                `expected initial deduction to succeed, got: ${JSON.stringify(ded1)}`,
            );
        }
        expect(getCell(ded1.success, Cell(CaseFileOwner(), PLUM))).toBe(Y_VAL);
        expect(
            getCell(ded1.success, Cell(CaseFileOwner(), KNIFE)),
        ).toBeUndefined();

        // Log a failed accusation (PLUM, KNIFE, R) for every room.
        for (const roomId of rooms) {
            act(() =>
                result.current.dispatch({
                    type: "addAccusation",
                    accusation: {
                        id: AccusationId(""),
                        accuser: A,
                        cards: [PLUM, KNIFE, roomId],
                    },
                }),
            );
        }

        // Tier 2 should now force case_KNIFE = N.
        const ded2 = result.current.derived.deductionResult;
        if (!Result.isSuccess(ded2)) {
            throw new Error(
                `expected deduction to remain successful, got: ${JSON.stringify(ded2)}`,
            );
        }
        expect(getCell(ded2.success, Cell(CaseFileOwner(), KNIFE))).toBe(N_VAL);
    });
});
