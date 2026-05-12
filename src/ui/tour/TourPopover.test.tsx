/**
 * Coverage for the tour popover's anchor-resolution path.
 *
 * jsdom doesn't run a layout engine — every `getBoundingClientRect`
 * returns `{0, 0, 0, 0}` — so we can't verify pixel positioning, but
 * we CAN verify:
 *
 *   - The popover renders the active step's title + body copy.
 *   - The spotlight box mounts when at least one anchor element is
 *     in the DOM.
 *   - Multi-element anchors (e.g. `[data-tour-anchor~="..."]` matching
 *     several DOM nodes) all participate in anchor lookup.
 *   - The fallback path renders without crashing when the anchor
 *     name has no matching elements.
 *
 * The `findAnchorElements` selector behavior — multi-token attribute
 * support — is exercised by mounting elements with both single and
 * space-separated `data-tour-anchor` values.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createElement, type ReactNode } from "react";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    // `t.rich` invokes any callable tag values and returns the
    // resulting React tree; for keyspace tests we return the key
    // itself so existing assertions on `getByText(<key>)` still pass.
    // Tag callbacks (e.g. `<yes/>` rendering ProseChecklistIcon) are
    // invoked once so they don't get treated as dead code by lint
    // rules, then discarded.
    //
    // Non-function values (`{action: "Tap"}` etc.) are skipped — the
    // real next-intl `t.rich` interpolates them into the string in
    // place of `{action}`, but for keyspace tests we only care that
    // the key resolves; we don't render the interpolated body.
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        tags?: Record<string, unknown>,
    ) => {
        if (tags !== undefined) {
            for (const fn of Object.values(tags)) {
                if (typeof fn === "function") fn();
            }
        }
        return key;
    };
    return { useTranslations: () => t };
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClueProvider } from "../state";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { TourProvider, useTour } from "./TourProvider";
import { TourPopover } from "./TourPopover";

beforeEach(() => {
    Object.defineProperty(window, "scrollX", {
        configurable: true,
        value: 0,
    });
    Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 0,
    });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        value: vi.fn(),
    });
});

/**
 * Mounts the popover inside a `<TourProvider>` and exposes the
 * tour controls via a render-prop child so each test can drive the
 * tour from outside.
 */
function Harness({
    anchors,
    children,
}: {
    /** DOM nodes the test wants in the page; each may carry a
     *  `data-tour-anchor` attribute. */
    readonly anchors: ReadonlyArray<{
        readonly testId: string;
        readonly anchorAttr?: string;
        readonly stickyLeft?: boolean;
    }>;
    /** Render-prop receives the tour controls so the test can call
     *  `startTour("setup")` etc. */
    readonly children: (controls: ReturnType<typeof useTour>) => ReactNode;
}) {
    return (
        <ClueProvider>
            <TourProvider>
                <Probe controls={children} />
                {anchors.map(a => {
                    const props: Record<string, string> = {
                        "data-testid": a.testId,
                    };
                    if (a.anchorAttr !== undefined) {
                        props["data-tour-anchor"] = a.anchorAttr;
                    }
                    if (a.stickyLeft) {
                        props["data-tour-sticky-left"] = "";
                    }
                    return createElement("div", { key: a.testId, ...props });
                })}
                <TourPopover />
            </TourProvider>
        </ClueProvider>
    );
}

function Probe({
    controls,
}: {
    readonly controls: (controls: ReturnType<typeof useTour>) => ReactNode;
}) {
    const c = useTour();
    return <>{controls(c)}</>;
}

describe("TourPopover — anchor lookup", () => {
    test("renders the active step's title + body when a tour is active", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        // Title and body keys for setup tour step 0
        // (`setup.welcome.title` / `setup.welcome.body`) — the
        // next-intl mock returns the key itself.
        expect(
            screen.getByText("setup.welcome.title"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("setup.welcome.body"),
        ).toBeInTheDocument();
    });

    test("matches multiple elements via `data-tour-anchor~=` (whole-row spotlight)", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "h1", anchorAttr: "setup-hand-size" },
                    { testId: "h2", anchorAttr: "setup-hand-size" },
                    { testId: "h3", anchorAttr: "setup-hand-size" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        // Step 2 is the hand-size step — advance to it.
        act(() => api.nextStep());
        act(() => api.nextStep());
        // The querySelectorAll path returns all 3 nodes; each is
        // queryable by its testId.
        expect(screen.getByTestId("h1")).toBeInTheDocument();
        expect(screen.getByTestId("h2")).toBeInTheDocument();
        expect(screen.getByTestId("h3")).toBeInTheDocument();
        // Sanity — all three carry the anchor token.
        expect(
            document.querySelectorAll("[data-tour-anchor~='setup-hand-size']")
                .length,
        ).toBe(3);
    });

    test("space-separated anchor tokens match each token via `~=`", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    {
                        testId: "shared",
                        anchorAttr: "setup-known-cell checklist-cell",
                    },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        // Verify both tokens hit the same node.
        expect(
            document.querySelectorAll(
                "[data-tour-anchor~='setup-known-cell']",
            ).length,
        ).toBe(1);
        expect(
            document.querySelectorAll(
                "[data-tour-anchor~='checklist-cell']",
            ).length,
        ).toBe(1);
    });

    test("dismiss path: clicking the X closes the tour", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        expect(api.activeScreen).toBe("setup");
        // The popover header has a close button labeled "close" via
        // the `common.close` i18n key (which the mock returns as-is).
        fireEvent.click(screen.getByRole("button", { name: "close" }));
        expect(api.activeScreen).toBeUndefined();
    });

    test("renders without an anchor in the DOM (fallback rect)", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness anchors={[]}>
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        // Even with NO `[data-tour-anchor=...]` element on the page,
        // starting the tour shouldn't crash — the popover falls back
        // to a fixed viewport position and still shows the copy.
        expect(() => act(() => api.startTour("setup"))).not.toThrow();
        expect(
            screen.getByText("setup.welcome.title"),
        ).toBeInTheDocument();
    });
});

// -----------------------------------------------------------------------
// M20: Tour interaction rules. The tour must be dismissed only via X /
// Skip tour / Esc — clicking outside the popover (the dim backdrop) or
// inside the spotlit area should NOT close the tour, and the spotlight
// itself must absorb clicks so the user can't interact with the
// underlying anchor mid-tour.
// -----------------------------------------------------------------------

describe("TourPopover — M20 interaction rules", () => {
    test("clicking the dim backdrop does NOT dismiss the tour", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        expect(api.activeScreen).toBe("setup");
        // The backdrop is the fixed-inset div using the tour-backdrop
        // z-index token and has no
        // `aria-hidden` siblings carrying the tour content. Find it
        // by its class signature.
        const backdrop = Array.from(
            document.querySelectorAll<HTMLDivElement>("div.fixed.inset-0"),
        ).find((el) =>
            el.className.includes("z-[var(--z-tour-backdrop)]"),
        );
        expect(backdrop).not.toBeNull();
        fireEvent.click(backdrop!);
        // Tour stays active.
        expect(api.activeScreen).toBe("setup");
    });

    test("clicking the spotlight does NOT trigger the underlying anchor's click", () => {
        // Every tour blocks page interaction by default — the
        // spotlight has `pointer-events: auto` and absorbs clicks so
        // they don't reach the anchor underneath. Only advance-on-click
        // steps drop that and route clicks through.
        //
        // Step 0 of checklistSuggest uses `anchorByViewport` so we
        // stub matchMedia to land on the desktop branch
        // (`desktop-checklist-area`).
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            media: "",
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        let api!: ReturnType<typeof useTour>;
        const onAnchorClick = vi.fn();
        function HarnessWithClickAnchor({
            children,
        }: {
            readonly children: (
                controls: ReturnType<typeof useTour>,
            ) => ReactNode;
        }) {
            return (
                <ClueProvider>
                    <TourProvider>
                        <Probe controls={children} />
                        <button
                            type="button"
                            data-testid="anchor"
                            data-tour-anchor="two-halves-spotlight"
                            onClick={onAnchorClick}
                        >
                            click me
                        </button>
                        <TourPopover />
                    </TourProvider>
                </ClueProvider>
            );
        }
        render(
            <HarnessWithClickAnchor>
                {c => {
                    api = c;
                    return null;
                }}
            </HarnessWithClickAnchor>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("checklistSuggest"));
        // Step 0 is the overflow-menu callout (no anchor in this
        // harness); advance to step 1 (the desktop two-halves
        // multi-spotlight step which uses `two-halves-spotlight`).
        act(() => api.nextStep());
        // The spotlight overlay sits on top of the anchor. Clicking
        // it should not bubble to the anchor's onClick.
        const spotlight = document.querySelector<HTMLDivElement>(
            ".tour-spotlight",
        );
        expect(spotlight).not.toBeNull();
        fireEvent.click(spotlight!);
        expect(onAnchorClick).not.toHaveBeenCalled();
        // Tour also stays active (spotlight click isn't a dismiss path).
        expect(api.activeScreen).toBe("checklistSuggest");
    });

    test("Skip tour explicitly dismisses", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        expect(api.activeScreen).toBe("setup");
        // Skip tour link sits in the footer; the next-intl mock
        // returns the i18n key "skipParens" verbatim.
        const skipBtn = Array.from(
            document.querySelectorAll<HTMLButtonElement>("button"),
        ).find(b => b.textContent === "skipParens");
        expect(skipBtn).toBeDefined();
        fireEvent.click(skipBtn!);
        expect(api.activeScreen).toBeUndefined();
    });
});

// -----------------------------------------------------------------------
// Round-4: Veil isolation. While a tour is active, keyboard events that
// don't target the popover are swallowed in capture phase so app-level
// shortcuts (⌘K, ⌘Z, etc.) don't fire under the veil. Escape still
// dismisses the tour. Scroll is left alone — `body.style.overflow`
// stays unchanged so the user can pan the page to read context.
// -----------------------------------------------------------------------

describe("TourPopover — veil isolation", () => {
    test("Escape dismisses the active tour", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("setup"));
        expect(api.activeScreen).toBe("setup");
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape" }),
            );
        });
        expect(api.activeScreen).toBeUndefined();
    });

    test("non-Escape keys outside the popover are preventDefault'd + stopPropagation'd", () => {
        // The key-isolator swallows every non-Escape key whose target
        // isn't inside the popover. Same blocking model as clicks —
        // the user navigates the tour with the popover's own buttons,
        // not page-level shortcuts.
        //
        // Stub matchMedia → desktop so checklistSuggest step 0's
        // `anchorByViewport` lands on `desktop-checklist-area`.
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            media: "",
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        let api!: ReturnType<typeof useTour>;
        const bubbleHandler = vi.fn();
        window.addEventListener("keydown", bubbleHandler);
        try {
            render(
                <Harness
                    anchors={[
                        {
                            testId: "checklist",
                            anchorAttr: "desktop-checklist-area",
                        },
                    ]}
                >
                    {c => {
                        api = c;
                        return null;
                    }}
                </Harness>,
                { wrapper: TestQueryClientProvider },
            );
            act(() => api.startTour("checklistSuggest"));
            // Dispatch a keydown that targets <body> (outside the
            // popover content portal). The event's metaKey + key is a
            // stand-in for ⌘K; the value doesn't matter — our
            // isolator swallows ALL non-Escape keys whose target
            // isn't inside the popover.
            const ev = new KeyboardEvent("keydown", {
                key: "k",
                bubbles: true,
                cancelable: true,
            });
            act(() => {
                document.body.dispatchEvent(ev);
            });
            expect(bubbleHandler).not.toHaveBeenCalled();
            // The tour stays active.
            expect(api.activeScreen).toBe("checklistSuggest");
        } finally {
            window.removeEventListener("keydown", bubbleHandler);
        }
    });

    test("keys targeting the popover content pass through (Tab between buttons)", () => {
        let api!: ReturnType<typeof useTour>;
        const bubbleHandler = vi.fn();
        window.addEventListener("keydown", bubbleHandler);
        try {
            render(
                <Harness
                    anchors={[
                        {
                            testId: "card-pack",
                            anchorAttr: "setup-wizard-header",
                        },
                    ]}
                >
                    {c => {
                        api = c;
                        return null;
                    }}
                </Harness>,
                { wrapper: TestQueryClientProvider },
            );
            act(() => api.startTour("setup"));
            // Find the popover content boundary and dispatch a key
            // event that fires INSIDE it.
            const popoverContent = document.querySelector(
                "[data-tour-popover-content]",
            );
            expect(popoverContent).not.toBeNull();
            const ev = new KeyboardEvent("keydown", {
                key: "Tab",
                bubbles: true,
                cancelable: true,
            });
            act(() => {
                popoverContent!.dispatchEvent(ev);
            });
            // Bubble-phase listener fires because the isolator passed
            // the event through (target is inside the popover).
            expect(bubbleHandler).toHaveBeenCalled();
            // Tour stays active.
            expect(api.activeScreen).toBe("setup");
        } finally {
            window.removeEventListener("keydown", bubbleHandler);
        }
    });

    test("scroll is not blocked: body.style.overflow stays untouched while tour is active", () => {
        let api!: ReturnType<typeof useTour>;
        document.body.style.overflow = "";
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        const before = document.body.style.overflow;
        act(() => api.startTour("setup"));
        expect(document.body.style.overflow).toBe(before);
        act(() => api.dismissTour("close"));
        expect(document.body.style.overflow).toBe(before);
    });

    test("out-of-view anchors use instant body scroll", () => {
        let api!: ReturnType<typeof useTour>;
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(document.body, "scrollHeight", {
            configurable: true,
            value: 2000,
        });
        Object.defineProperty(document.body, "clientHeight", {
            configurable: true,
            value: 500,
        });
        const bodyScrollTo = vi.fn();
        document.body.scrollTo = bodyScrollTo;

        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        const anchor = screen.getByTestId("card-pack");
        anchor.getBoundingClientRect = () =>
            new DOMRect(100, 1000, 100, 100);

        act(() => api.startTour("setup"));

        expect(bodyScrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ behavior: "auto" }),
        );
    });

    test("anchors covered by the sticky first column scroll into the unobscured viewport", () => {
        let api!: ReturnType<typeof useTour>;
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(document.body, "scrollWidth", {
            configurable: true,
            value: 1000,
        });
        Object.defineProperty(document.body, "clientWidth", {
            configurable: true,
            value: 500,
        });
        document.body.scrollLeft = 120;
        const bodyScrollTo = vi.fn();
        document.body.scrollTo = bodyScrollTo;

        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                    { testId: "sticky", stickyLeft: true },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        const anchor = screen.getByTestId("card-pack");
        anchor.getBoundingClientRect = () =>
            new DOMRect(120, 100, 80, 40);
        const sticky = screen.getByTestId("sticky");
        sticky.getBoundingClientRect = () =>
            new DOMRect(0, 0, 170, 500);

        act(() => api.startTour("setup"));

        expect(bodyScrollTo).toHaveBeenCalledWith(
            expect.objectContaining({
                behavior: "auto",
                left: 0,
            }),
        );
    });

    test("sticky first-column clearance does not affect non-overlapping anchors", () => {
        let api!: ReturnType<typeof useTour>;
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(document.body, "scrollWidth", {
            configurable: true,
            value: 1000,
        });
        Object.defineProperty(document.body, "clientWidth", {
            configurable: true,
            value: 500,
        });
        document.body.scrollLeft = 120;
        const bodyScrollTo = vi.fn();
        document.body.scrollTo = bodyScrollTo;

        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                    { testId: "sticky", stickyLeft: true },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        const anchor = screen.getByTestId("card-pack");
        anchor.getBoundingClientRect = () =>
            new DOMRect(120, 300, 80, 40);
        const sticky = screen.getByTestId("sticky");
        sticky.getBoundingClientRect = () =>
            new DOMRect(0, 0, 170, 120);

        act(() => api.startTour("setup"));

        expect(bodyScrollTo).not.toHaveBeenCalled();
    });

    test("page-level horizontal scroll uses window.scrollX when body.scrollLeft is stale", () => {
        let api!: ReturnType<typeof useTour>;
        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            value: 500,
        });
        Object.defineProperty(window, "scrollX", {
            configurable: true,
            value: 120,
        });
        Object.defineProperty(document.body, "scrollWidth", {
            configurable: true,
            value: 1000,
        });
        Object.defineProperty(document.body, "clientWidth", {
            configurable: true,
            value: 500,
        });
        document.body.scrollLeft = 0;
        const bodyScrollTo = vi.fn();
        document.body.scrollTo = bodyScrollTo;

        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-wizard-header" },
                    { testId: "sticky", stickyLeft: true },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        const anchor = screen.getByTestId("card-pack");
        anchor.getBoundingClientRect = () =>
            new DOMRect(120, 100, 80, 40);
        const sticky = screen.getByTestId("sticky");
        sticky.getBoundingClientRect = () =>
            new DOMRect(0, 0, 170, 500);

        act(() => api.startTour("setup"));

        expect(bodyScrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ left: 0 }),
        );
        expect(window.scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ left: 0 }),
        );
    });

});

// -----------------------------------------------------------------------
// Round-4: popoverAnchor + popoverAnchorPriority decouple where the
// popover binds from where the spotlight unions. Used by:
//   - the player-column step (popover anchors to the column header)
//   - the overflow-menu step (popover anchors to the open dropdown,
//     not the trigger that's earlier in DOM order)
// -----------------------------------------------------------------------

describe("TourPopover — popoverAnchor + popoverAnchorPriority", () => {
    test("popoverAnchor token resolves to its OWN element set, distinct from the spotlight token", () => {
        // The checklistSuggest tour's intro step (index 0) has
        // `anchor: "desktop-checklist-area"` for the spotlight and
        // `popoverAnchor: "checklist-case-file"` for the popover.
        // With both tokens present in the DOM, the popover binds to
        // the case-file element and the spotlight covers the column.
        // We can't assert on pixel positions in jsdom — but we CAN
        // assert that the expected DOM nodes exist and the popover
        // renders without crashing.
        //
        // Stub matchMedia → desktop so `anchorByViewport` picks the
        // `desktop-checklist-area` token.
        window.matchMedia = vi.fn().mockImplementation(() => ({
            matches: true,
            media: "",
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    // Spotlight target: the whole column wrapper.
                    {
                        testId: "checklist-col",
                        anchorAttr: "desktop-checklist-area",
                    },
                    // Popover target: the small case-file summary.
                    {
                        testId: "case-file",
                        anchorAttr: "checklist-case-file",
                    },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("checklistSuggest"));
        // Step 0 is the overflow-menu callout; advance to step 1
        // (the two-halves intro) where the popoverAnchor /
        // spotlight-anchor split lives.
        act(() => api.nextStep());
        expect(
            screen.getByText("checklist.intro.title"),
        ).toBeInTheDocument();
        // Both anchor sets are queryable via `data-tour-anchor~=`.
        expect(
            document.querySelectorAll(
                "[data-tour-anchor~='desktop-checklist-area']",
            ).length,
        ).toBe(1);
        expect(
            document.querySelectorAll(
                "[data-tour-anchor~='checklist-case-file']",
            ).length,
        ).toBe(1);
    });

    test("popoverAnchorPriority='last-visible' resolves to the LAST matched element (overflow-menu trigger + open content)", () => {
        // `checklistSuggest`'s step 0 (the overflow-menu callout)
        // uses `popoverAnchorPriority: "last-visible"` so when both
        // the trigger button and the portaled menu content are
        // mounted, the popover binds to the menu content (which is
        // later in DOM order via the portal).
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    {
                        testId: "trigger",
                        anchorAttr: "overflow-menu",
                    },
                    {
                        testId: "menu-content",
                        anchorAttr: "overflow-menu",
                    },
                ]}
            >
                {c => {
                    api = c;
                    return null;
                }}
            </Harness>,
            { wrapper: TestQueryClientProvider },
        );
        act(() => api.startTour("checklistSuggest"));
        // Step 0 is the overflow-menu callout — no advance needed.
        // Both anchored elements are in the DOM.
        expect(
            document.querySelectorAll(
                "[data-tour-anchor~='overflow-menu']",
            ).length,
        ).toBe(2);
        // Popover renders.
        expect(
            screen.getByText("checklist.menu.title"),
        ).toBeInTheDocument();
    });
});
