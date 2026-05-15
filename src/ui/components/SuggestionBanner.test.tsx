import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import { Player } from "../../logic/GameObjects";
import { CLASSIC_SETUP_3P } from "../../logic/GameSetup";
import { KnownCard } from "../../logic/InitialKnowledge";
import { cardByName } from "../../logic/test-utils/CardByName";
import type { PendingSuggestionDraft } from "../../logic/ClueState";

// next-intl mock — echoes back `${namespace}.${key}:${values}` for `t()`,
// and for `t.rich()` returns a React-node array that includes the
// key + every value/tag-callback so tests can assert on textContent
// regardless of whether the call site uses interpolation or rich tags.
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
                    // Tag callback — invoke with no chunks. The
                    // wrapping element (e.g. <strong/>) still
                    // renders, so its contents are absent here but
                    // the value-based version above already includes
                    // the readable text via `[chunkName=value]`.
                    out.push((val as () => unknown)());
                } else {
                    out.push(`[${chunkName}=${String(val)}]`);
                }
            }
            return out;
        };
        return t;
    },
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

const myCardsBannerShownMock = vi.fn();
const myCardsBannerDismissedMock = vi.fn();
vi.mock("../../analytics/events", async () => {
    const actual = await vi.importActual<
        typeof import("../../analytics/events")
    >("../../analytics/events");
    return {
        ...actual,
        myCardsBannerShown: (props: unknown) => myCardsBannerShownMock(props),
        myCardsBannerDismissed: (props: unknown) =>
            myCardsBannerDismissedMock(props),
    };
});

const importBanner = async () => {
    const mod = await import("./SuggestionBanner");
    return mod.SuggestionBanner;
};

beforeEach(() => {
    mockClueState.setup = setup;
    mockClueState.selfPlayerId = A;
    mockClueState.knownCards = [];
    mockClueState.pendingSuggestion = null;
    myCardsBannerShownMock.mockReset();
    myCardsBannerDismissedMock.mockReset();
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

describe("SuggestionBanner — analytics lifecycle", () => {
    test("emits banner_shown on first visible render with the kind + surface", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        render(<SuggestionBanner surface="section" />);
        expect(myCardsBannerShownMock).toHaveBeenCalledTimes(1);
        expect(myCardsBannerShownMock).toHaveBeenCalledWith({
            kind: "canRefute",
            surface: "section",
        });
    });

    test("does NOT emit banner_shown when the banner has no content", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: PLUM })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null], // not in hand → no banner
        });
        render(<SuggestionBanner surface="section" />);
        expect(myCardsBannerShownMock).not.toHaveBeenCalled();
        expect(myCardsBannerDismissedMock).not.toHaveBeenCalled();
    });

    test("emits banner_dismissed with expandedDuringDisplay=false when unmounted while parent was collapsed", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        const { unmount } = render(
            <SuggestionBanner surface="section" expanded={false} />,
        );
        expect(myCardsBannerShownMock).toHaveBeenCalledTimes(1);
        unmount();
        expect(myCardsBannerDismissedMock).toHaveBeenCalledTimes(1);
        expect(myCardsBannerDismissedMock).toHaveBeenCalledWith({
            kind: "canRefute",
            surface: "section",
            expandedDuringDisplay: false,
        });
    });

    test("emits banner_dismissed with expandedDuringDisplay=true when expanded is set on mount", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        const { unmount } = render(
            <SuggestionBanner surface="section" expanded={true} />,
        );
        unmount();
        expect(myCardsBannerDismissedMock).toHaveBeenCalledWith({
            kind: "canRefute",
            surface: "section",
            expandedDuringDisplay: true,
        });
    });

    test("captures expansion that happens mid-visibility-window", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        const { rerender, unmount } = render(
            <SuggestionBanner surface="section" expanded={false} />,
        );
        // Parent surface expanded mid-life — should latch true.
        rerender(<SuggestionBanner surface="section" expanded={true} />);
        // Then collapsed again — still latched true.
        rerender(<SuggestionBanner surface="section" expanded={false} />);
        unmount();
        expect(myCardsBannerDismissedMock).toHaveBeenCalledWith({
            kind: "canRefute",
            surface: "section",
            expandedDuringDisplay: true,
        });
    });

    test("surface prop flows through both shown and dismissed events", async () => {
        const SuggestionBanner = await importBanner();
        mockClueState.knownCards = [KnownCard({ player: A, card: MS_WHITE })];
        mockClueState.pendingSuggestion = draft({
            suggester: B,
            cards: [MS_WHITE, null, null],
        });
        const { unmount } = render(<SuggestionBanner surface="fab" />);
        expect(myCardsBannerShownMock).toHaveBeenCalledWith(
            expect.objectContaining({ surface: "fab" }),
        );
        unmount();
        expect(myCardsBannerDismissedMock).toHaveBeenCalledWith(
            expect.objectContaining({ surface: "fab" }),
        );
    });
});
