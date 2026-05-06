import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccusationId } from "../../logic/Accusation";
import { Cell } from "../../logic/Knowledge";
import {
    CardCategory,
    CaseFileOwner,
    Player,
    PlayerOwner,
} from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { DraftAccusation, DraftSuggestion } from "../../logic/ClueState";
import { SuggestionId } from "../../logic/Suggestion";
import type { ContradictionTrace } from "../../logic/Deducer";
import type { ContradictionKind } from "../../logic/ContradictionKind";
import {
    emptyHypotheses,
    type HypothesisMap,
    type HypothesisValue,
} from "../../logic/Hypothesis";

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

const accusationDraft = (
    overrides: Partial<DraftAccusation> = {},
): DraftAccusation => ({
    id: AccusationId("test-accusation"),
    accuser: A,
    cards: [PLUM, KNIFE, KITCHEN],
    ...overrides,
});

const mockClueState: {
    setup: typeof setup;
    suggestions: ReadonlyArray<DraftSuggestion>;
    accusations: ReadonlyArray<DraftAccusation>;
    knownCards: ReadonlyArray<unknown>;
    handSizes: ReadonlyArray<unknown>;
    uiMode: "suggest";
    hypotheses: HypothesisMap;
} = {
    setup,
    suggestions: [draft()],
    accusations: [],
    knownCards: [],
    handSizes: [],
    uiMode: "suggest",
    hypotheses: emptyHypotheses,
};

const mockDispatch = vi.fn();

vi.mock("../state", () => ({
    useClue: () => ({
        state: mockClueState,
        dispatch: mockDispatch,
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

describe("ContradictionBanner — FailedAccusation rows", () => {
    test("renders the accusation row with the failed-accusation copy and a remove button", async () => {
        // Seed an accusation and target it via offendingAccusationIndices.
        mockClueState.accusations = [accusationDraft()];
        mockDispatch.mockReset();

        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace(
                    { _tag: "FailedAccusation", accusationIndex: 0 },
                    {
                        offendingSuggestionIndices: [],
                        offendingAccusationIndices: [0],
                        offendingCells: [
                            Cell(CaseFileOwner(), PLUM),
                            Cell(CaseFileOwner(), KNIFE),
                            Cell(CaseFileOwner(), KITCHEN),
                        ],
                    },
                )}
            />,
        );

        // The accusation row's heading uses the accusationLabel template.
        expect(screen.getByText("accusationLabel")).toBeInTheDocument();
        // The "what went wrong" sentence uses the new copy template.
        expect(
            screen.getByText("conflictFailedAccusationAllPinned"),
        ).toBeInTheDocument();
        // The cards line picks up the accusationCardsLine template.
        expect(screen.getByText("accusationCardsLine")).toBeInTheDocument();
        // The Remove button is present and dispatches removeAccusation
        // when clicked.
        const removeBtn = screen.getByRole("button", {
            name: "removeAccusation",
        });
        fireEvent.click(removeBtn);
        expect(mockDispatch).toHaveBeenCalledWith({
            type: "removeAccusation",
            id: accusationDraft().id,
        });
    });

    test("missing accusation entry (stale index) renders the no-player heading and no remove button", async () => {
        // Empty accusations array but non-empty offending indices —
        // the row should fall back to the "no player" heading and
        // omit the Remove button.
        mockClueState.accusations = [];
        mockDispatch.mockReset();

        const ContradictionBanner = await importBanner();
        render(
            <ContradictionBanner
                trace={trace(
                    { _tag: "FailedAccusation", accusationIndex: 0 },
                    {
                        offendingSuggestionIndices: [],
                        offendingAccusationIndices: [0],
                        offendingCells: [],
                    },
                )}
            />,
        );

        expect(
            screen.getByText("accusationLabelNoPlayer"),
        ).toBeInTheDocument();
        // No remove button when the accusation isn't in the list.
        expect(
            screen.queryByRole("button", { name: "removeAccusation" }),
        ).toBeNull();
    });
});

describe("JointHypothesisContradictionBanner", () => {
    const importJointBanner = async () => {
        const mod = await import("./ContradictionBanner");
        return mod.JointHypothesisContradictionBanner;
    };

    type ConflictKind = "directly-contradicted" | "jointly-conflicting";
    const conflict = (
        kind: ConflictKind,
        entries: ReadonlyArray<{
            readonly cell: ReturnType<typeof Cell>;
            readonly value: HypothesisValue;
        }>,
    ) => ({ kind, entries });

    test("jointly-conflicting variant renders the joint title/help and one row per entry", async () => {
        const cellA = Cell(PlayerOwner(A), MS_WHITE);
        const cellB = Cell(PlayerOwner(B), KNIFE);
        mockDispatch.mockReset();

        const JointBanner = await importJointBanner();
        const { container } = render(
            <JointBanner
                conflict={conflict("jointly-conflicting", [
                    { cell: cellA, value: "Y" },
                    { cell: cellB, value: "N" },
                ])}
            />,
        );

        expect(screen.getByText("jointBannerTitle")).toBeInTheDocument();
        expect(screen.getByText("jointBannerHelp")).toBeInTheDocument();
        // Joint variant should NOT render the direct copy.
        expect(screen.queryByText("directBannerTitle")).toBeNull();
        // One li per entry.
        const items = container.querySelectorAll("ul > li");
        expect(items.length).toBe(2);
        const buttons = screen.getAllByRole("button", {
            name: "jointHypothesisTurnOff",
        });
        expect(buttons.length).toBe(2);
    });

    test("directly-contradicted variant renders the direct title/help", async () => {
        const cellA = Cell(PlayerOwner(A), MS_WHITE);
        mockDispatch.mockReset();

        const JointBanner = await importJointBanner();
        const { container } = render(
            <JointBanner
                conflict={conflict("directly-contradicted", [
                    { cell: cellA, value: "Y" },
                ])}
            />,
        );

        expect(screen.getByText("directBannerTitle")).toBeInTheDocument();
        expect(screen.getByText("directBannerHelp")).toBeInTheDocument();
        // Direct variant should NOT render the joint copy.
        expect(screen.queryByText("jointBannerTitle")).toBeNull();
        // Single row → single button.
        const items = container.querySelectorAll("ul > li");
        expect(items.length).toBe(1);
    });

    test("Turn off dispatches clearHypothesis for the row's cell", async () => {
        const cellA = Cell(PlayerOwner(A), MS_WHITE);
        mockDispatch.mockReset();

        const JointBanner = await importJointBanner();
        render(
            <JointBanner
                conflict={conflict("jointly-conflicting", [
                    { cell: cellA, value: "Y" },
                ])}
            />,
        );

        const button = screen.getByRole("button", {
            name: "jointHypothesisTurnOff",
        });
        fireEvent.click(button);
        expect(mockDispatch).toHaveBeenCalledWith({
            type: "clearHypothesis",
            cell: cellA,
        });
    });

    test("rows render in stable (owner, card) sort order", async () => {
        // A is "Anisha", B is "Bob"; alphabetic owner order is A, A, B.
        // Within A, cards sort: Knife < Mrs. White.
        const cellBMsWhite = Cell(PlayerOwner(B), MS_WHITE);
        const cellAKnife = Cell(PlayerOwner(A), KNIFE);
        const cellAMsWhite = Cell(PlayerOwner(A), MS_WHITE);
        mockDispatch.mockReset();

        const JointBanner = await importJointBanner();
        // Pass in reverse-of-expected order; banner sorts internally.
        render(
            <JointBanner
                conflict={conflict("jointly-conflicting", [
                    { cell: cellBMsWhite, value: "Y" },
                    { cell: cellAMsWhite, value: "Y" },
                    { cell: cellAKnife, value: "N" },
                ])}
            />,
        );

        const buttons = screen.getAllByRole("button", {
            name: "jointHypothesisTurnOff",
        });
        expect(buttons.length).toBe(3);
        // Click each button in DOM order; the dispatched `cell` arg
        // proves the row order: A/Knife → A/Mrs.White → B/Mrs.White.
        fireEvent.click(buttons[0]!);
        fireEvent.click(buttons[1]!);
        fireEvent.click(buttons[2]!);
        expect(mockDispatch).toHaveBeenNthCalledWith(1, {
            type: "clearHypothesis",
            cell: cellAKnife,
        });
        expect(mockDispatch).toHaveBeenNthCalledWith(2, {
            type: "clearHypothesis",
            cell: cellAMsWhite,
        });
        expect(mockDispatch).toHaveBeenNthCalledWith(3, {
            type: "clearHypothesis",
            cell: cellBMsWhite,
        });
    });
});
