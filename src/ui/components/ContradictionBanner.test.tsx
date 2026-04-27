import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Cell } from "../../logic/Knowledge";
import { CardCategory, Player, PlayerOwner } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { DraftSuggestion } from "../../logic/ClueState";
import { SuggestionId } from "../../logic/Suggestion";
import type { ContradictionTrace } from "../../logic/Deducer";
import type { ContradictionKind } from "../../logic/ContradictionKind";

// next-intl mock that handles both `t(key, …)` and `t.rich(key, …)`.
// Both echo the template key so tests can assert which template the
// banner picked. Renderer-side `<strong>` callbacks are ignored —
// fine, we're testing dispatch, not formatting.
vi.mock("next-intl", () => ({
    useTranslations: () =>
        Object.assign((key: string) => key, {
            rich: (key: string) => key,
        }),
}));

// ContradictionBanner reads useClue() for the suggestions / known cards
// list and useSelection() for setSelectedSuggestion. Mock both so the
// banner renders without a real <ClueProvider> surrounding it.
const A = Player("Anisha");
const B = Player("Bob");
const setup = CLASSIC_SETUP_3P;
const PLUM = cardByName(setup, "Prof. Plum");
const KNIFE = cardByName(setup, "Knife");
const MS_WHITE = cardByName(setup, "Mrs. White");
const KITCHEN = cardByName(setup, "Kitchen");

const draft = (
    overrides: Partial<DraftSuggestion> = {},
): DraftSuggestion => ({
    id: SuggestionId("test-suggestion"),
    suggester: A,
    cards: [MS_WHITE, KNIFE, KITCHEN],
    nonRefuters: [B],
    refuter: undefined,
    seenCard: undefined,
    ...overrides,
});

const mockClueState = {
    setup,
    suggestions: [draft()] as ReadonlyArray<DraftSuggestion>,
    knownCards: [],
    handSizes: [],
    uiMode: "suggest" as const,
};

vi.mock("../state", () => ({
    useClue: () => ({
        state: mockClueState,
        dispatch: vi.fn(),
    }),
}));

vi.mock("../SelectionContext", () => ({
    useSelection: () => ({ setSelectedSuggestion: vi.fn() }),
}));

const importBanner = async () => {
    const mod = await import("./ContradictionBanner");
    return mod.ContradictionBanner;
};

const trace = (
    contradictionKind: ContradictionKind,
    overrides: Partial<ContradictionTrace> = {},
): ContradictionTrace => ({
    reason: "fake reason",
    offendingCells: [Cell(PlayerOwner(B), MS_WHITE)],
    offendingSuggestionIndices: [0],
    offendingAccusationIndices: [],
    sliceLabel: undefined,
    contradictionKind,
    ...overrides,
});

describe("ContradictionBanner — kind-driven explanations", () => {
    test("NonRefuters → conflictNonRefuterAlreadyOwns", async () => {
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace({ _tag: "NonRefuters", suggestionIndex: 0 })}
            />,
        );
        expect(
            screen.getByText("conflictNonRefuterAlreadyOwns"),
        ).toBeInTheDocument();
    });

    test("RefuterShowed → conflictRefuterShowedButCantOwn", async () => {
        const ContradictionBanner = await importBanner();
        // Override the suggestion so the row carries a refuter + seenCard
        // — the dispatch needs both to render the RefuterShowed copy.
        mockClueState.suggestions = [
            draft({ nonRefuters: [], refuter: B, seenCard: MS_WHITE }),
        ];
        render(
            <ContradictionBanner
                trace={trace({ _tag: "RefuterShowed", suggestionIndex: 0 })}
            />,
        );
        expect(
            screen.getByText("conflictRefuterShowedButCantOwn"),
        ).toBeInTheDocument();
        // Restore for subsequent tests.
        mockClueState.suggestions = [draft()];
    });

    test("RefuterOwnsOneOf → conflictRefuterOwnsOneOfImpossible", async () => {
        const ContradictionBanner = await importBanner();
        mockClueState.suggestions = [
            draft({ nonRefuters: [], refuter: B, seenCard: undefined }),
        ];
        render(
            <ContradictionBanner
                trace={trace({ _tag: "RefuterOwnsOneOf", suggestionIndex: 0 })}
            />,
        );
        expect(
            screen.getByText("conflictRefuterOwnsOneOfImpossible"),
        ).toBeInTheDocument();
        mockClueState.suggestions = [draft()];
    });

    test("SliceCardOwnership / over → conflictCardHasOtherOwner", async () => {
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SliceCardOwnership",
                    card: PLUM,
                    direction: "over",
                })}
            />,
        );
        expect(
            screen.getByText("conflictCardHasOtherOwner"),
        ).toBeInTheDocument();
    });

    test("SliceCardOwnership / under → conflictCardNoPossibleOwner", async () => {
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SliceCardOwnership",
                    card: PLUM,
                    direction: "under",
                })}
            />,
        );
        expect(
            screen.getByText("conflictCardNoPossibleOwner"),
        ).toBeInTheDocument();
    });

    test("SlicePlayerHand / over → conflictHandSizeOverflow", async () => {
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SlicePlayerHand",
                    player: A,
                    handSize: 3,
                    direction: "over",
                })}
            />,
        );
        expect(
            screen.getByText("conflictHandSizeOverflow"),
        ).toBeInTheDocument();
    });

    test("SlicePlayerHand / under → conflictHandSizeUnderflow", async () => {
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SlicePlayerHand",
                    player: A,
                    handSize: 3,
                    direction: "under",
                })}
            />,
        );
        expect(
            screen.getByText("conflictHandSizeUnderflow"),
        ).toBeInTheDocument();
    });

    test("SliceCaseFileCategory / over → conflictCaseFileCategoryConflict", async () => {
        const ContradictionBanner = await importBanner();
        const suspectsCategoryId = setup.categories[0]!.id as CardCategory;
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SliceCaseFileCategory",
                    category: suspectsCategoryId,
                    direction: "over",
                })}
            />,
        );
        expect(
            screen.getByText("conflictCaseFileCategoryConflict"),
        ).toBeInTheDocument();
    });

    test("SliceCaseFileCategory / under → conflictCaseFileCategoryNoOption", async () => {
        const ContradictionBanner = await importBanner();
        const suspectsCategoryId = setup.categories[0]!.id as CardCategory;
        render(
            <ContradictionBanner
                trace={trace({
                    _tag: "SliceCaseFileCategory",
                    category: suspectsCategoryId,
                    direction: "under",
                })}
            />,
        );
        expect(
            screen.getByText("conflictCaseFileCategoryNoOption"),
        ).toBeInTheDocument();
    });

    test("DirectCell + cell-conflict reason → legacy conflictAlreadyOwns", async () => {
        // No contradictionKind → falls back to the regex parse on
        // `reason`. The "already Y" branch maps to conflictAlreadyOwns.
        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace(
                    { _tag: "DirectCell" },
                    {
                        reason: `tried to set ${B}/${MS_WHITE} to N but it is already Y`,
                    },
                )}
            />,
        );
        expect(
            screen.getByText("conflictAlreadyOwns"),
        ).toBeInTheDocument();
    });
});
