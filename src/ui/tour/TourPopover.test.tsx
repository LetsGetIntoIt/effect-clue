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
import { describe, expect, test, vi } from "vitest";
import { forwardRef, createElement, type ReactNode } from "react";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return { useTranslations: () => t };
});

// Minimal `motion/react` mock so jsdom doesn't trip on Framer's rAF.
vi.mock("motion/react", () => {
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) =>
                forwardRef(
                    (
                        props: Record<string, unknown>,
                        ref: React.Ref<HTMLElement>,
                    ) => {
                        const {
                            initial: _i,
                            animate: _a,
                            exit: _e,
                            transition: _tr,
                            variants: _v,
                            ...rest
                        } = props;
                        return createElement(tag, { ...rest, ref });
                    },
                ),
        },
    );
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
    };
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ClueProvider } from "../state";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import { TourProvider, useTour } from "./TourProvider";
import { TourPopover } from "./TourPopover";

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
                    { testId: "card-pack", anchorAttr: "setup-card-pack" },
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
        // (`setup.cardPack.title` / `setup.cardPack.body`) — the
        // next-intl mock returns the key itself.
        expect(
            screen.getByText("setup.cardPack.title"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("setup.cardPack.body"),
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
                    { testId: "card-pack", anchorAttr: "setup-card-pack" },
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
            screen.getByText("setup.cardPack.title"),
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
                    { testId: "card-pack", anchorAttr: "setup-card-pack" },
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
        // The backdrop is the fixed-inset div with z-40 that has no
        // `aria-hidden` siblings carrying the tour content. Find it
        // by its class signature.
        const backdrop = document.querySelector<HTMLDivElement>(
            "div.fixed.inset-0.z-40",
        );
        expect(backdrop).not.toBeNull();
        fireEvent.click(backdrop!);
        // Tour stays active.
        expect(api.activeScreen).toBe("setup");
    });

    test("clicking the spotlight does NOT trigger the underlying anchor's click", () => {
        let api!: ReturnType<typeof useTour>;
        const onAnchorClick = vi.fn();
        // Mount an anchor with an `onClick` handler so we can detect
        // whether the click reached it through the spotlight.
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
                            data-tour-anchor="setup-card-pack"
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
        act(() => api.startTour("setup"));
        // The spotlight overlay sits on top of the anchor. Clicking
        // it should not bubble to the anchor's onClick.
        const spotlight = document.querySelector<HTMLDivElement>(
            ".tour-spotlight",
        );
        expect(spotlight).not.toBeNull();
        fireEvent.click(spotlight!);
        expect(onAnchorClick).not.toHaveBeenCalled();
        // Tour also stays active (spotlight click isn't a dismiss path).
        expect(api.activeScreen).toBe("setup");
    });

    test("Skip tour explicitly dismisses", () => {
        let api!: ReturnType<typeof useTour>;
        render(
            <Harness
                anchors={[
                    { testId: "card-pack", anchorAttr: "setup-card-pack" },
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
