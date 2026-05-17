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
        // The Tier 1 rationale key must render — proves the rationale
        // <p> dispatches through KEY_RATIONALE_ALREADY_SHOWN_TO_SUGGESTER.
        // (Matches the strictness the Tier 4 tests use.)
        expect(text).toContain("rationaleAlreadyShownToSuggester");
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
        // The Tier 3 rationale key must render — proves the rationale
        // <p> dispatches through KEY_RATIONALE_ALREADY_SHOWN_TO_OTHER.
        // (Matches the strictness the Tier 4 tests use.)
        expect(text).toContain("rationaleAlreadyShownToOther");
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

    test("Tier 2 row renders the rationaleSuggesterCanDeduceSummary in the rationale paragraph", async () => {
        const RefuteAdvicePanel = await importPanel();
        // Same Tier 2 fixture as the disclosure test: Bob holds Plum +
        // Knife; Cho suggests {Plum, Knife, Conservatory}; A refutes
        // with Conservatory (Cho sees it, Bob does not). B's
        // perspective pins Cell(A, Conservatory) = Y via slice rules.
        // Pending is Bob, A holds Conservatory.
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
        const row = findRows()[0]!;
        expect(row.getAttribute("data-tier")).toBe("suggesterCanDeduce");
        // The disclosure test only checks the <details> summary label.
        // This one asserts the rationale <p> ALSO rendered — that's
        // the user-visible summary text above the disclosure ("Bob
        // can already deduce that you have Conservatory from public
        // moves so far…"). Without this assertion the rationale could
        // silently regress while the disclosure label still passes.
        expect(row.textContent ?? "").toContain(
            "rationaleSuggesterCanDeduceSummary",
        );
    });

    test("every leak level renders side-by-side in a 3-candidate scenario", async () => {
        const RefuteAdvicePanel = await importPanel();
        // A holds Plum, Knife, Conservatory.
        // Earlier B suggested {Plum, Knife, Scarlet}, A refuted with
        // Plum → Tier 1 for Plum (prior reveal to pending suggester).
        // Earlier C suggested {Conservatory, Scarlet, Wrench}, A
        // refuted with Conservatory → Tier 3 for Conservatory (prior
        // reveal to a different suggester).
        // Knife: never shown to anyone; we deliberately don't set up
        // a perspective scenario that would deduce it → Tier 4 for
        // Knife (fresh leak).
        // Pending: B suggests {Plum, Knife, Conservatory}. All three
        // candidates surface together, one per leak level the user
        // can see.
        mockState.knownCards = [
            KnownCard({ player: A, card: PLUM }),
            KnownCard({ player: A, card: KNIFE }),
            KnownCard({ player: A, card: CONSERV }),
        ];
        mockState.suggestions = [
            logEntry({
                suggester: B,
                cards: [PLUM, KNIFE, SCARLET],
                refuter: A,
                seenCard: PLUM,
            }),
            logEntry({
                suggester: C,
                cards: [CONSERV, SCARLET, WRENCH],
                refuter: A,
                seenCard: CONSERV,
            }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<RefuteAdvicePanel />);
        const rows = Array.from(findRows());
        expect(rows).toHaveLength(3);
        // Rows render in `handCandidates` order, which is filter-
        // preserved from `pendingSuggestion.cards` (Plum, Knife,
        // Conservatory). Find by data-tier to avoid substring
        // collisions in textContent (Tier 1 rationale embeds the
        // prior triple, which can contain the names of OTHER cards
        // in this fixture).
        const tierOf = (r: HTMLElement) => r.getAttribute("data-tier");
        const plumRow = rows.find(r => tierOf(r) === "alreadyShownToSuggester")!;
        const knifeRow = rows.find(r => tierOf(r) === "freshLeak")!;
        const conservRow = rows.find(r => tierOf(r) === "alreadyShownToOther")!;
        // Every leak level the user can see is present, side by side.
        expect(plumRow).toBeDefined();
        expect(knifeRow).toBeDefined();
        expect(conservRow).toBeDefined();
        // Only the best (lowest-leak) tier — Tier 1 — is recommended.
        expect(plumRow.getAttribute("data-recommended")).toBe("true");
        expect(knifeRow.getAttribute("data-recommended")).toBe("false");
        expect(conservRow.getAttribute("data-recommended")).toBe("false");
        // Each row's rationale key renders.
        expect(plumRow.textContent ?? "").toContain(
            "rationaleAlreadyShownToSuggester",
        );
        expect(knifeRow.textContent ?? "").toContain("rationaleFreshLeak");
        expect(conservRow.textContent ?? "").toContain(
            "rationaleAlreadyShownToOther",
        );
        // Multi-candidate Tier 4: standard rationale, not the sole
        // variant. The sole variant is reserved for the
        // exactly-one-matching-card forced case.
        expect(knifeRow.textContent ?? "").not.toContain(
            "rationaleFreshLeakSole",
        );
    });

    test("sole non-Tier-4 candidate uses the standard rationale and hides the Recommended badge", async () => {
        const RefuteAdvicePanel = await importPanel();
        // A holds exactly one matching card (Plum). Earlier B
        // suggested {Plum, Scarlet, Conservatory} and A refuted with
        // Plum → Tier 1. Pending: B suggests {Plum, Knife, …} again.
        // Only Plum matches A's hand, so it's the sole candidate.
        // Two invariants this pins:
        //   (1) the sole-candidate badge suppression is GENERIC
        //       (applies to every tier, not just Tier 4) — Plum is
        //       data-recommended="true" but the visible badge is
        //       hidden because there's no other choice.
        //   (2) only Tier 4 has a "sole" rationale variant
        //       (rationaleFreshLeakSole). Tier 1's sole case reuses
        //       the standard rationaleAlreadyShownToSuggester copy.
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
        expect(row.getAttribute("data-recommended")).toBe("true");
        const text = row.textContent ?? "";
        // Standard Tier 1 rationale — NOT a sole variant.
        expect(text).toContain("rationaleAlreadyShownToSuggester");
        expect(text).not.toContain("rationaleFreshLeakSole");
        // Sole-candidate badge suppression applies generically.
        expect(text).not.toContain("recommendedBadge");
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
    test("non-teach-mode + canRefute + expanded: panel renders, banner does NOT (collapse redundancy)", async () => {
        // Import the real SuggestionBanner (with no panel-mock) so
        // the integration covers the actual wiring inside its
        // KIND_CAN_REFUTE non-teaser branch. Both render through the
        // same mocked useClue + next-intl above; the panel-mock used
        // in SuggestionBanner.test.tsx is scoped to that test file.
        const { SuggestionBanner } = await import("./SuggestionBanner");
        mockState.teachMode = false;
        mockState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<SuggestionBanner />);
        // The advice panel renders (carries the "BEST CARD TO SHOW"
        // title + bolded card-name rows — same information the banner
        // sentence would have carried).
        const panel = document.querySelector(
            "[data-tour-anchor='refute-advice']",
        );
        expect(panel).not.toBeNull();
        // The banner does NOT render — the panel's rows already name
        // every refute candidate, so the banner sentence would be
        // redundant.
        const banner = document.querySelector(
            "[data-tour-anchor~='my-cards-banner']",
        );
        expect(banner).toBeNull();
    });

    test("teach-mode + canRefute + expanded: neither banner nor panel renders (preserves 'no refute hint in teach-mode' contract)", async () => {
        const { SuggestionBanner } = await import("./SuggestionBanner");
        mockState.teachMode = true;
        mockState.knownCards = [
            KnownCard({ player: A, card: KNIFE }),
            KnownCard({ player: A, card: CONSERV }),
        ];
        mockState.pendingSuggestion = draftPending({
            suggester: B,
            cards: [PLUM, KNIFE, CONSERV],
        });
        render(<SuggestionBanner />);
        // The panel is gated off in teach-mode (deducer-derived
        // advice would defeat the "do the work yourself" promise).
        const panel = document.querySelector(
            "[data-tour-anchor='refute-advice']",
        );
        expect(panel).toBeNull();
        // The banner sentence is also suppressed — collapse-redundancy
        // routes the canRefute non-teaser branch through the panel,
        // which returns null in teach-mode. Net effect: SuggestionBanner
        // renders nothing for canRefute in teach-mode. Call sites
        // (`MyHandPanel`, `MyCardsFAB`) layer their own teach-mode
        // suppression as defense-in-depth.
        const banner = document.querySelector(
            "[data-tour-anchor~='my-cards-banner']",
        );
        expect(banner).toBeNull();
    });

    test("panel hidden alongside banner in KIND_CANNOT_REFUTE", async () => {
        const { SuggestionBanner } = await import("./SuggestionBanner");
        // Self has no matching cards but the draft is complete →
        // banner kind is cannotRefute and the panel never renders.
        // (The collapse-redundancy rule only applies to canRefute;
        // cannotRefute still shows the banner.)
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

