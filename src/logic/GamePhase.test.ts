import { describe, expect, test } from "vitest";
import type {
    ClueState,
    DraftAccusation,
    DraftSuggestion,
} from "./ClueState";
import {
    CARD_SETS,
    CLASSIC_SETUP_3P,
    DEFAULT_SETUP,
    GameSetup,
} from "./GameSetup";
import { Player } from "./GameObjects";
import {
    getGamePhase,
    hasCardInformation,
    phaseAtLeast,
} from "./GamePhase";
import { emptyHypotheses } from "./Hypothesis";
import { KnownCard } from "./InitialKnowledge";
import { newSuggestionId } from "./Suggestion";
import { newAccusationId } from "./Accusation";
import { cardByName } from "./test-utils/CardByName";

// Base state: matches state.tsx's `initialState`. Every test starts
// from this and mutates only the fields it cares about. Phase: "new".
const baseState: ClueState = {
    setup: DEFAULT_SETUP,
    handSizes: [],
    knownCards: [],
    suggestions: [],
    accusations: [],
    uiMode: "setup",
    hypotheses: emptyHypotheses,
    hypothesisOrder: [],
    pendingSuggestion: null,
    selfPlayerId: null,
    firstDealtPlayerId: null,
    dismissedInsights: new Map(),
};

// Fixture state with a card pack + 3 players + every player's hand
// size set — the minimum bar for "setupCompleted".
const setupCompletedSetup = CLASSIC_SETUP_3P;
const [SC_P1, SC_P2, SC_P3] = setupCompletedSetup.players;
const setupCompletedState: ClueState = {
    ...baseState,
    setup: setupCompletedSetup,
    handSizes: [
        [SC_P1!, 6],
        [SC_P2!, 6],
        [SC_P3!, 6],
    ],
};

const PLUM = cardByName(setupCompletedSetup, "Prof. Plum");
const PIPE = cardByName(setupCompletedSetup, "Lead pipe");
const STUDY = cardByName(setupCompletedSetup, "Study");

const draftSuggestion = (suggester: Player): DraftSuggestion => ({
    id: newSuggestionId(),
    suggester,
    cards: [PLUM, PIPE, STUDY],
    nonRefuters: [],
});

const draftAccusation = (accuser: Player): DraftAccusation => ({
    id: newAccusationId(),
    accuser,
    cards: [PLUM, PIPE, STUDY],
});

describe("getGamePhase", () => {
    test("returns 'new' on a fresh default state", () => {
        expect(getGamePhase(baseState)).toBe("new");
    });

    test("returns 'dirty' when a non-default player roster is entered", () => {
        const state: ClueState = {
            ...baseState,
            setup: GameSetup({
                players: [Player("Alice"), Player("Bob")],
                categories: DEFAULT_SETUP.categories,
            }),
        };
        expect(getGamePhase(state)).toBe("dirty");
    });

    test("returns 'dirty' when selfPlayerId is set on default roster", () => {
        const state: ClueState = {
            ...baseState,
            selfPlayerId: DEFAULT_SETUP.players[0]!,
        };
        expect(getGamePhase(state)).toBe("dirty");
    });

    test("returns 'dirty' when handSizes are partial (only one player)", () => {
        // Card pack is default (categories present), default roster has
        // ≥2 players, so the only thing preventing setupCompleted is the
        // partial handSizes set. Phase falls back to dirty because the
        // handSizes-only-for-one-player is a user touch.
        const state: ClueState = {
            ...baseState,
            handSizes: [[DEFAULT_SETUP.players[0]!, 5]],
        };
        expect(getGamePhase(state)).toBe("dirty");
    });

    test("returns 'setupCompleted' once card pack + ≥2 players + all hand sizes are set", () => {
        expect(getGamePhase(setupCompletedState)).toBe("setupCompleted");
    });

    test("returns 'setupCompleted' even when knownCards alone exist (knownCards don't count as gameStarted)", () => {
        const stateWithKnownCards: ClueState = {
            ...setupCompletedState,
            knownCards: [KnownCard({ player: SC_P1!, card: PLUM })],
        };
        expect(getGamePhase(stateWithKnownCards)).toBe("setupCompleted");
    });

    test("returns 'gameStarted' on the first logged suggestion", () => {
        const stateWithSuggestion: ClueState = {
            ...setupCompletedState,
            suggestions: [draftSuggestion(SC_P1!)],
        };
        expect(getGamePhase(stateWithSuggestion)).toBe("gameStarted");
    });

    test("returns 'gameStarted' on a logged accusation even with no suggestions", () => {
        const stateWithAccusation: ClueState = {
            ...setupCompletedState,
            accusations: [draftAccusation(SC_P1!)],
        };
        expect(getGamePhase(stateWithAccusation)).toBe("gameStarted");
    });

    test("returns 'dirty' when the user picked a non-default pack but hasn't set hand sizes", () => {
        const alternativePack = CARD_SETS.find(
            (cs) => cs.id !== CARD_SETS[0]?.id,
        );
        if (alternativePack === undefined) {
            // No alternate pack defined; skip.
            return;
        }
        const state: ClueState = {
            ...baseState,
            setup: GameSetup({
                cardSet: alternativePack.cardSet,
                playerSet: DEFAULT_SETUP.playerSet,
            }),
        };
        expect(getGamePhase(state)).toBe("dirty");
    });
});

describe("phaseAtLeast", () => {
    test("orders phases correctly", () => {
        expect(phaseAtLeast("gameStarted", "setupCompleted")).toBe(true);
        expect(phaseAtLeast("setupCompleted", "setupCompleted")).toBe(true);
        expect(phaseAtLeast("dirty", "setupCompleted")).toBe(false);
        expect(phaseAtLeast("new", "dirty")).toBe(false);
        expect(phaseAtLeast("dirty", "new")).toBe(true);
        expect(phaseAtLeast("gameStarted", "new")).toBe(true);
    });
});

describe("hasCardInformation", () => {
    test("false on a pristine state", () => {
        expect(hasCardInformation(baseState)).toBe(false);
    });

    test("true when knownCards exist (the key distinction from gameStarted)", () => {
        const state: ClueState = {
            ...setupCompletedState,
            knownCards: [KnownCard({ player: SC_P1!, card: PLUM })],
        };
        expect(hasCardInformation(state)).toBe(true);
        // knownCards alone DON'T elevate the phase to gameStarted, but
        // DO count as engagement.
        expect(getGamePhase(state)).toBe("setupCompleted");
    });

    test("true when suggestions exist", () => {
        const state: ClueState = {
            ...setupCompletedState,
            suggestions: [draftSuggestion(SC_P1!)],
        };
        expect(hasCardInformation(state)).toBe(true);
    });

    test("matches the legacy inline check (suggestions ∪ accusations ∪ knownCards)", () => {
        const stateOnlyKnown: ClueState = {
            ...setupCompletedState,
            knownCards: [KnownCard({ player: SC_P1!, card: PLUM })],
        };
        const stateOnlySugg: ClueState = {
            ...setupCompletedState,
            suggestions: [draftSuggestion(SC_P1!)],
        };
        const stateOnlyAccu: ClueState = {
            ...setupCompletedState,
            accusations: [draftAccusation(SC_P1!)],
        };
        expect(hasCardInformation(stateOnlyKnown)).toBe(true);
        expect(hasCardInformation(stateOnlySugg)).toBe(true);
        expect(hasCardInformation(stateOnlyAccu)).toBe(true);
        expect(hasCardInformation(baseState)).toBe(false);
    });
});
