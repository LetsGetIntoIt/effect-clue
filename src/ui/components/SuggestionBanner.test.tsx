import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { KnownCard } from "../../logic/InitialKnowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { PendingSuggestionDraft } from "../../logic/ClueState";

// next-intl mock — echoes back `${namespace}.${key}:${values}` so we can
// assert which template + arguments the banner picked.
vi.mock("next-intl", () => ({
    useTranslations: (ns?: string) =>
        Object.assign(
            (key: string, values?: Record<string, unknown>) => {
                const full = ns ? `${ns}.${key}` : key;
                return values ? `${full}:${JSON.stringify(values)}` : full;
            },
            { rich: (key: string) => (ns ? `${ns}.${key}` : key) },
        ),
}));

const A = Player("Anisha");
const B = Player("Bob");
const setup = CLASSIC_SETUP_3P;
const MS_WHITE = cardByName(setup, "Mrs. White");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");

const PLUM = cardByName(setup, "Prof. Plum");

const draft = (
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

const mockClueState: {
    setup: typeof setup;
    selfPlayerId: Player | null;
    knownCards: ReadonlyArray<KnownCard>;
    pendingSuggestion: PendingSuggestionDraft | null;
} = {
    setup,
    selfPlayerId: A,
    knownCards: [],
    pendingSuggestion: null,
};

vi.mock("../state", () => ({
    useClue: () => ({ state: mockClueState }),
}));

const importBanner = async () => {
    const mod = await import("./SuggestionBanner");
    return mod.SuggestionBanner;
};

beforeEach(() => {
    mockClueState.setup = setup;
    mockClueState.selfPlayerId = A;
    mockClueState.knownCards = [];
    mockClueState.pendingSuggestion = null;
});

const findBanner = (): HTMLElement | null =>
    document.querySelector("[data-tour-anchor~='my-cards-banner']");

describe("SuggestionBanner — gating", () => {
    test("returns null when selfPlayerId is null", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.selfPlayerId = null;
        mockClueState.pendingSuggestion = draft({
            cards: [MS_WHITE, KNIFE, KITCHEN],
        });
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });

    test("returns null when there is no draft", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.pendingSuggestion = null;
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });

    test("returns null when draft is open but no slot is filled", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.pendingSuggestion = draft({ cards: [null, null, null] });
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });
});

describe("SuggestionBanner — non-self suggester", () => {
    test("partial draft with a matching card → 'can refute' shows", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner />);
        const el = findBanner();
        expect(el).not.toBeNull();
        expect(el?.getAttribute("data-banner-kind")).toBe("canRefute");
        expect(el?.textContent).toContain("refuteHint.canRefute");
    });

    test("partial draft with NO matching card → banner hidden", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });

    test("complete draft with NO matching card → 'cannot refute' shows", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, KNIFE, KITCHEN],
        });
        render(<SuggestionBanner />);
        const el = findBanner();
        expect(el?.getAttribute("data-banner-kind")).toBe("cannotRefute");
        expect(el?.textContent).toContain("refuteHint.cannotRefute");
    });

    test("complete draft with a matching card → 'can refute' shows", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [
            KnownCard({ player: A, card: KNIFE }),
            KnownCard({ player: A, card: KITCHEN }),
        ];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, KNIFE, KITCHEN],
        });
        render(<SuggestionBanner />);
        const el = findBanner();
        expect(el?.getAttribute("data-banner-kind")).toBe("canRefute");
        // Banner copy should include the matching cards' names (rendered
        // by cardName via the cardSet); the mocked template echoes the
        // values payload.
        expect(el?.textContent ?? "").toContain("Knife");
        expect(el?.textContent ?? "").toContain("Kitchen");
    });
});

describe("SuggestionBanner — self suggester", () => {
    test("self suggester with a matching card → 'self suggesting' shows", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: A,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner />);
        const el = findBanner();
        expect(el?.getAttribute("data-banner-kind")).toBe("self");
        expect(el?.textContent).toContain("refuteHint.selfSuggesting");
    });

    test("self suggester with NO matching card (partial) → banner hidden", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockClueState.pendingSuggestion = draft({
            suggester: A,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });

    test("self suggester with NO matching card (complete) → banner hidden", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockClueState.pendingSuggestion = draft({
            suggester: A,
            cards: [MS_WHITE, KNIFE, KITCHEN],
        });
        render(<SuggestionBanner />);
        expect(findBanner()).toBeNull();
    });
});

describe("SuggestionBanner — device-aware reveal hint", () => {
    const stubMatchMedia = (hasKeyboard: boolean) => {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            configurable: true,
            value: (query: string): MediaQueryList =>
                ({
                    matches:
                        query === "(hover: hover) and (pointer: fine)"
                            ? hasKeyboard
                            : false,
                    media: query,
                    onchange: null,
                    addListener: () => {},
                    removeListener: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    dispatchEvent: () => false,
                }) as unknown as MediaQueryList,
        });
    };

    test("teaser shows 'click to reveal' i18n key on keyboard/mouse devices", async () => {
        stubMatchMedia(true);
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner teaser />);
        const el = findBanner();
        expect(el?.textContent).toContain("refuteHint.revealHintMouse");
        expect(el?.textContent).not.toContain("refuteHint.revealHintTouch");
    });

    test("teaser shows 'tap to reveal' i18n key on touch devices", async () => {
        stubMatchMedia(false);
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner teaser />);
        const el = findBanner();
        expect(el?.textContent).toContain("refuteHint.revealHintTouch");
        expect(el?.textContent).not.toContain("refuteHint.revealHintMouse");
    });

    test("self-suggester teaser also branches on device", async () => {
        stubMatchMedia(false);
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: A,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner teaser />);
        const el = findBanner();
        expect(el?.textContent).toContain("refuteHint.revealHintTouch");
    });
});
