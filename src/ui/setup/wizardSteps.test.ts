import { describe, expect, test } from "vitest";
import type { ClueState } from "../../logic/ClueState";
import { CardSet } from "../../logic/CardSet";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P, GameSetup } from "../../logic/GameSetup";
import { emptyHypotheses } from "../../logic/Hypothesis";
import { PlayerSet } from "../../logic/PlayerSet";
import {
    isStepDataComplete,
    stepIsSkippable,
    stepValidationLevel,
    visibleSteps,
} from "./wizardSteps";

const baseState: ClueState = {
    setup: CLASSIC_SETUP_3P,
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

describe("visibleSteps", () => {
    test("hides myCards when selfPlayerId is null", () => {
        const visible = visibleSteps(baseState);
        expect(visible).not.toContain("myCards");
        expect(visible).toContain("players");
        expect(visible).toContain("identity");
    });

    test("includes myCards when selfPlayerId is set", () => {
        const visible = visibleSteps({
            ...baseState,
            selfPlayerId: Player("Anisha"),
        });
        expect(visible).toContain("myCards");
    });

    test("preserves canonical step order", () => {
        const visible = visibleSteps({
            ...baseState,
            selfPlayerId: Player("Anisha"),
        });
        expect(visible).toEqual([
            "cardPack",
            "players",
            "identity",
            "handSizes",
            "myCards",
            "knownCards",
            "inviteOtherPlayers",
        ]);
    });

    test("inviteOtherPlayers is the last step in both visible-step orderings", () => {
        const withSelf = visibleSteps({
            ...baseState,
            selfPlayerId: Player("Anisha"),
        });
        expect(withSelf[withSelf.length - 1]).toBe("inviteOtherPlayers");
        const withoutSelf = visibleSteps(baseState);
        expect(withoutSelf[withoutSelf.length - 1]).toBe("inviteOtherPlayers");
    });
});

describe("inviteOtherPlayers step", () => {
    test("is skippable", () => {
        expect(stepIsSkippable("inviteOtherPlayers")).toBe(true);
    });

    test("validation is always valid (no data to gate on)", () => {
        expect(stepValidationLevel("inviteOtherPlayers", baseState)).toBe(
            "valid",
        );
    });

    test("isStepDataComplete is always true (no required data)", () => {
        expect(isStepDataComplete("inviteOtherPlayers", baseState)).toBe(true);
    });
});

describe("isStepDataComplete", () => {
    test("players: requires at least 2", () => {
        const empty = GameSetup({
            cardSet: CardSet({ categories: [] }),
            playerSet: PlayerSet({ players: [] }),
        });
        expect(
            isStepDataComplete("players", { ...baseState, setup: empty }),
        ).toBe(false);
        expect(isStepDataComplete("players", baseState)).toBe(true);
    });

    test("identity: complete when selfPlayerId is set", () => {
        expect(isStepDataComplete("identity", baseState)).toBe(false);
        expect(
            isStepDataComplete("identity", {
                ...baseState,
                selfPlayerId: Player("Anisha"),
            }),
        ).toBe(true);
    });

    test("handSizes: complete when any hand size is set", () => {
        expect(isStepDataComplete("handSizes", baseState)).toBe(false);
        expect(
            isStepDataComplete("handSizes", {
                ...baseState,
                handSizes: [[Player("Anisha"), 6]],
            }),
        ).toBe(true);
    });

    test("myCards: hidden when selfPlayerId is null (independent of cards)", () => {
        expect(
            isStepDataComplete("myCards", {
                ...baseState,
                selfPlayerId: null,
            }),
        ).toBe(false);
    });

    test("myCards: complete only when selfPlayerId is set AND owns a card", () => {
        const anisha = Player("Anisha");
        // Self set, no cards → false.
        expect(
            isStepDataComplete("myCards", {
                ...baseState,
                selfPlayerId: anisha,
            }),
        ).toBe(false);
        // Self set + owns a card → true.
        const anyKnownCard = { player: anisha } as ClueState["knownCards"][number];
        expect(
            isStepDataComplete("myCards", {
                ...baseState,
                selfPlayerId: anisha,
                knownCards: [anyKnownCard],
            }),
        ).toBe(true);
    });
});
