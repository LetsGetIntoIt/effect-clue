import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
    DraftAccusation,
    DraftSuggestion,
    PendingSuggestionDraft,
} from "../../logic/ClueState";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { emptyHypotheses } from "../../logic/Hypothesis";
import { KnownCard } from "../../logic/InitialKnowledge";
import {
    buildPerspective,
    type PerspectiveResult,
} from "../../logic/Perspective";
import { newSuggestionId, Suggestion } from "../../logic/Suggestion";
import { cardByName } from "../../logic/test-utils/CardByName";

// next-intl mock — echoes `${namespace}.${key}:${values}` so the
// tests can assert on text content regardless of which key resolves.
// `t.rich` returns a React-node array that includes both the key
// and every value/tag-callback result, so the rendered output still
// contains the underlying card name / suggester name even when the
// string includes `<bold>` placeholders.
vi.mock("next-intl", () => ({
    useTranslations: (ns?: string) => {
        const t = (key: string, values?: Record<string, unknown>) => {
            const full = ns ? `${ns}.${key}` : key;
            return values ? `${full}:${JSON.stringify(values)}` : full;
        };
        (t as unknown as { rich: unknown }).rich = (
            key: string,
            values?: Record<string, unknown>,
        ): unknown => {
            const full = ns ? `${ns}.${key}` : key;
            if (values === undefined) return full;
            const out: Array<unknown> = [`${full}:`];
            for (const [chunkName, val] of Object.entries(values)) {
                if (typeof val === "function") {
                    out.push((val as (chunks?: unknown) => unknown)(chunkName));
                } else {
                    out.push(`[${chunkName}=${String(val)}]`);
                }
            }
            return out;
        };
        return t;
    },
}));

const setup = CLASSIC_SETUP_3P;
const KNIFE = cardByName(setup, "Knife");
const PLUM = cardByName(setup, "Prof. Plum");
const WRENCH = cardByName(setup, "Wrench");
const CONSERV = cardByName(setup, "Conservatory");
const SCARLET = cardByName(setup, "Miss Scarlet");
const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const draftPending = (
    overrides: Partial<PendingSuggestionDraft> = {},
): PendingSuggestionDraft => ({
    id: "test-draft",
    suggester: B,
    cards: [null, null, null],
    nonRefuters: null,
    refuter: null,
    seenCard: null,
    ...overrides,
});

const logEntry = (input: {
    readonly suggester: Player;
    readonly cards: ReadonlyArray<ReturnType<typeof cardByName>>;
    readonly refuter?: Player;
    readonly seenCard?: ReturnType<typeof cardByName>;
}): DraftSuggestion => ({
    id: newSuggestionId(),
    suggester: input.suggester,
    cards: input.cards,
    nonRefuters: [],
    refuter: input.refuter,
    seenCard: input.seenCard,
});

const toDomainSuggestion = (s: DraftSuggestion) =>
    Suggestion({
        id: s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter,
        seenCard: s.seenCard,
        loggedAt: s.loggedAt ?? 0,
    });

interface MockState {
    setup: typeof setup;
    selfPlayerId: Player | null;
    knownCards: ReadonlyArray<KnownCard>;
    pendingSuggestion: PendingSuggestionDraft | null;
    suggestions: ReadonlyArray<DraftSuggestion>;
    accusations: ReadonlyArray<DraftAccusation>;
    handSizes: ReadonlyArray<readonly [Player, number]>;
    teachMode: boolean;
    hypotheses: typeof emptyHypotheses;
}

const mockState: MockState = {
    setup,
    selfPlayerId: A,
    knownCards: [],
    pendingSuggestion: null,
    suggestions: [],
    accusations: [],
    handSizes: [],
    teachMode: false,
    hypotheses: emptyHypotheses,
};

const mockDerived = () => {
    const suggestionsAsData = mockState.suggestions.map(toDomainSuggestion);
    const accusationsAsData = mockState.accusations.map(a => a);
    const perspectives = new Map<Player, PerspectiveResult>();
    for (const v of mockState.setup.players) {
        if (v === mockState.selfPlayerId) continue;
        perspectives.set(
            v,
            buildPerspective({
                viewer: v,
                setup: mockState.setup,
                handSizes: mockState.handSizes,
                knownCards: mockState.knownCards,
                suggestions: suggestionsAsData,
                accusations: [],
            }),
        );
    }
    return {
        suggestionsAsData,
        accusationsAsData,
        perspectives,
    };
};

vi.mock("../state", () => ({
    useClue: () => ({
        state: mockState,
        derived: mockDerived(),
    }),
}));

const importPanel = async () => {
    const mod = await import("./RefuteAdvicePanel");
    return mod.RefuteAdvicePanel;
};

const findPanel = (): HTMLElement | null =>
    document.querySelector("[data-tour-anchor='refute-advice']");

const findRows = (): NodeListOf<HTMLElement> =>
    document.querySelectorAll("[data-tour-anchor='refute-advice'] li[data-tier]");

beforeEach(() => {
    mockState.setup = setup;
    mockState.selfPlayerId = A;
    mockState.knownCards = [];
    mockState.pendingSuggestion = null;
    mockState.suggestions = [];
    mockState.accusations = [];
    mockState.handSizes = [];
    mockState.teachMode = false;
    mockState.hypotheses = emptyHypotheses;
});

describe("RefuteAdvicePanel — visibility gates", () => {
    test("hidden when teach mode is on", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.teachMode = true;
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when selfPlayerId is null", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.selfPlayerId = null;
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when no pending suggestion", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = null;
        render(<RefuteAdvicePanel />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when self is the pending suggester", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            suggester: A,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when no matching cards in self's hand", async () => {
        const RefuteAdvicePanel = await importPanel();
        // Self has Wrench, but the suggestion's cards are
        // {Plum, Knife, Conservatory} — no overlap.
        mockState.knownCards = [KnownCard({ player: A, card: WRENCH })];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when teaser=true", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel teaser={true} />);
        expect(findPanel()).toBeNull();
    });

    test("hidden when variant='stacked'", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel variant="stacked" />);
        expect(findPanel()).toBeNull();
    });
});

describe("RefuteAdvicePanel — row rendering", () => {
    test("renders one row per matching candidate", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [
            KnownCard({ player: A, card: PLUM }),
            KnownCard({ player: A, card: KNIFE }),
        ];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = findRows();
        expect(rows).toHaveLength(2);
    });

    test("Tier 4 row marks recommended=true on the data attribute", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [
            KnownCard({ player: A, card: PLUM }),
            KnownCard({ player: A, card: KNIFE }),
        ];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        for (const row of rows) {
            expect(row.getAttribute("data-tier")).toBe("freshLeak");
            expect(row.getAttribute("data-recommended")).toBe("true");
        }
    });

    test("Tier 1 rationale mentions suggester name and the prior triple", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.suggestions = [
            logEntry({
                suggester: B,
                cards: [PLUM, SCARLET, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.getAttribute("data-tier")).toBe("alreadyShownToSuggester");
        // The mock t.rich emits values inline; we should see Bob's
        // name and the comma-joined prior triple.
        const text = row.textContent ?? "";
        expect(text).toContain("Bob");
        expect(text).toContain("Prof. Plum");
        expect(text).toContain("Miss Scarlet");
        expect(text).toContain("Conservatory");
    });

    test("Tier 3 rationale mentions the other player names", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.suggestions = [
            logEntry({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const row = findRows()[0]!;
        expect(row.getAttribute("data-tier")).toBe("alreadyShownToOther");
        const text = row.textContent ?? "";
        expect(text).toContain("Cho");
    });

    test("Tier 4 single-candidate uses freshLeakSole + omits Recommended badge", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const row = findRows()[0]!;
        expect(row.getAttribute("data-tier")).toBe("freshLeak");
        const text = row.textContent ?? "";
        expect(text).toContain("rationaleFreshLeakSole");
        expect(text).not.toContain("recommendedBadge");
    });

    test("Tier 4 multi-candidate uses freshLeak (non-sole) and shows Recommended on each", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [
            KnownCard({ player: A, card: PLUM }),
            KnownCard({ player: A, card: KNIFE }),
        ];
        mockState.pendingSuggestion = draftPending({
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        for (const row of rows) {
            expect(row.getAttribute("data-tier")).toBe("freshLeak");
            const text = row.textContent ?? "";
            expect(text).toContain("rationaleFreshLeak");
            expect(text).not.toContain("rationaleFreshLeakSole");
            expect(text).toContain("recommendedBadge");
        }
    });

    test("Tier 1 + Tier 4 → only Tier 1 row gets Recommended badge", async () => {
        const RefuteAdvicePanel = await importPanel();
        mockState.knownCards = [
            KnownCard({ player: A, card: PLUM }),
            KnownCard({ player: A, card: KNIFE }),
        ];
        mockState.suggestions = [
            logEntry({
                suggester: B,
                cards: [PLUM, SCARLET, CONSERV],
                refuter: A,
                seenCard: PLUM,
            }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        const plumRow = rows.find(
            r => r.getAttribute("data-tier") === "alreadyShownToSuggester",
        )!;
        const knifeRow = rows.find(
            r => r.getAttribute("data-tier") === "freshLeak",
        )!;
        expect(plumRow.getAttribute("data-recommended")).toBe("true");
        expect(knifeRow.getAttribute("data-recommended")).toBe("false");
        // Recommended badge only on the Tier 1 row (and not the
        // sole-candidate degenerate case).
        expect(plumRow.textContent ?? "").toContain("recommendedBadge");
        expect(knifeRow.textContent ?? "").not.toContain("recommendedBadge");
    });
});

describe("RefuteAdvicePanel — Tier 2 disclosure", () => {
    test("renders the 'Why does {suggester} know?' disclosure", async () => {
        const RefuteAdvicePanel = await importPanel();
        // Tier 2 fixture: Bob holds Plum + Knife in his hand. Cho
        // suggests {Plum, Knife, Conservatory} and Anisha refutes
        // with Conservatory (Cho sees it, but Bob does not — only
        // hears the act). From Bob's perspective the slice rules
        // pin Cell(A, Conservatory) = Y. Pending suggester is Bob
        // and Anisha has Conservatory.
        mockState.knownCards = [
            KnownCard({ player: A, card: CONSERV }),
            KnownCard({ player: B, card: PLUM }),
            KnownCard({ player: B, card: KNIFE }),
        ];
        mockState.suggestions = [
            logEntry({
                suggester: C,
                cards: [PLUM, KNIFE, CONSERV],
                refuter: A,
                seenCard: CONSERV,
            }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [CONSERV, SCARLET, PLUM],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        // Conservatory is the only matching candidate for Anisha.
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        expect(row.getAttribute("data-tier")).toBe("suggesterCanDeduce");
        const summary = row.querySelector("details summary");
        expect(summary).not.toBeNull();
        // The disclosure label includes the suggester name.
        expect(summary?.textContent ?? "").toContain("Bob");
    });
});

describe("RefuteAdvicePanel — wired into SuggestionBanner", () => {
    test("panel renders below the banner in the KIND_CAN_REFUTE branch", async () => {
        // Import the real SuggestionBanner (with no panel-mock) so
        // the integration covers the actual wiring inside its
        // KIND_CAN_REFUTE branch. Both render through the same
        // mocked useClue + next-intl above; the panel-mock used in
        // SuggestionBanner.test.tsx is scoped to that test file.
        const { SuggestionBanner } = await import("./SuggestionBanner");
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<SuggestionBanner />);
        // The banner mounts at the my-cards-banner anchor.
        const banner = document.querySelector(
            "[data-tour-anchor~='my-cards-banner']",
        );
        expect(banner).not.toBeNull();
        // The panel mounts at refute-advice. Its presence here is
        // proof that the banner's canRefute return path renders the
        // fragment containing both.
        const panel = document.querySelector(
            "[data-tour-anchor='refute-advice']",
        );
        expect(panel).not.toBeNull();
    });

    test("panel hidden alongside banner in KIND_CANNOT_REFUTE", async () => {
        const { SuggestionBanner } = await import("./SuggestionBanner");
        // Self has no matching cards but the draft is complete →
        // banner kind is cannotRefute and the panel never renders.
        mockState.knownCards = [KnownCard({ player: A, card: WRENCH })];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<SuggestionBanner />);
        // The banner is rendered (cannotRefute branch) …
        const banner = document.querySelector(
            "[data-tour-anchor~='my-cards-banner']",
        );
        expect(banner).not.toBeNull();
        // … but the panel is NOT — it only ships from the
        // canRefute branch.
        const panel = document.querySelector(
            "[data-tour-anchor='refute-advice']",
        );
        expect(panel).toBeNull();
    });
});

