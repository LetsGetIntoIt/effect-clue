/**
 * Pure-function tests for the popover-geometry helpers. These
 * functions don't render any React or use Radix — they're the
 * deterministic config + math that Radix's positioning relies on.
 *
 * What this file catches that the manual `next-dev` walk doesn't
 * (cheaper feedback loop):
 *
 *   - `sideByViewport` typo / missing branch — would surface as a
 *     wrong popover side at one breakpoint without you noticing
 *     until you walk that breakpoint.
 *   - `popoverAnchorPriority` regression — `last-visible` accidentally
 *     resolving to first.
 *   - `unionRect` accidentally including a zero-area rect (would
 *     stretch the spotlight to the document origin).
 *   - `pickPopoverRect` accidentally returning a rect for a hidden
 *     element (would anchor the popover at 0,0).
 *
 * What it CAN'T catch (needs a real browser):
 *   - Whether the resulting popover ends up on-screen given the
 *     actual viewport + Radix's positioning. Floating UI's collision
 *     detection runs in jsdom but it needs the popover's own
 *     bounding rect, which is 0×0 in jsdom. CLAUDE.md's manual
 *     verification covers this.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
    findAnchorElements,
    isDesktopViewport,
    pickPopoverRect,
    resolveAnchorToken,
    resolveHideArrow,
    resolvePopoverAnchorToken,
    resolveSideAndAlign,
    unionRect,
} from "./popoverGeometry";
import type { TourStep } from "./tours";

const stubMatchMedia = (matches: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
        matches,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
};

const baseStep: TourStep = {
    anchor: "any-anchor",
    titleKey: "any.title",
};

beforeEach(() => {
    // Default to mobile so each test explicitly opts in to desktop
    // by stubbing matchMedia.
    stubMatchMedia(false);
});

afterEach(() => {
    document.body.innerHTML = "";
});

// ─────────────────────────────────────────────────────────────────────────
// isDesktopViewport
// ─────────────────────────────────────────────────────────────────────────

describe("isDesktopViewport", () => {
    test("matches desktop when matchMedia('(min-width: 800px)') matches", () => {
        stubMatchMedia(true);
        expect(isDesktopViewport()).toBe(true);
    });

    test("falls back to mobile when matchMedia returns false", () => {
        stubMatchMedia(false);
        expect(isDesktopViewport()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveAnchorToken
// ─────────────────────────────────────────────────────────────────────────

describe("resolveAnchorToken", () => {
    test("returns step.anchor when no anchorByViewport", () => {
        expect(resolveAnchorToken({ ...baseStep, anchor: "plain" })).toBe(
            "plain",
        );
    });

    test("desktop branch on desktop viewport", () => {
        stubMatchMedia(true);
        expect(
            resolveAnchorToken({
                ...baseStep,
                anchor: "fallback",
                anchorByViewport: { mobile: "m", desktop: "d" },
            }),
        ).toBe("d");
    });

    test("mobile branch on mobile viewport", () => {
        stubMatchMedia(false);
        expect(
            resolveAnchorToken({
                ...baseStep,
                anchor: "fallback",
                anchorByViewport: { mobile: "m", desktop: "d" },
            }),
        ).toBe("m");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// resolvePopoverAnchorToken
// ─────────────────────────────────────────────────────────────────────────

describe("resolvePopoverAnchorToken", () => {
    test("falls through to spotlight anchor when popoverAnchor is unset", () => {
        expect(
            resolvePopoverAnchorToken({ ...baseStep, anchor: "x" }),
        ).toBe("x");
    });

    test("popoverAnchor overrides regardless of viewport", () => {
        stubMatchMedia(true);
        expect(
            resolvePopoverAnchorToken({
                ...baseStep,
                anchor: "spotlight",
                popoverAnchor: "popover-only",
            }),
        ).toBe("popover-only");
    });

    test("popoverAnchor overrides even when anchorByViewport is set", () => {
        stubMatchMedia(true);
        expect(
            resolvePopoverAnchorToken({
                ...baseStep,
                anchor: "fallback",
                anchorByViewport: { mobile: "m", desktop: "d" },
                popoverAnchor: "popover-only",
            }),
        ).toBe("popover-only");
    });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveSideAndAlign
// ─────────────────────────────────────────────────────────────────────────

describe("resolveSideAndAlign", () => {
    test("Radix defaults when nothing is set", () => {
        expect(resolveSideAndAlign(baseStep)).toEqual({
            side: "bottom",
            align: "center",
        });
    });

    test("top-level side / align passes through when sideByViewport is unset", () => {
        expect(
            resolveSideAndAlign({
                ...baseStep,
                side: "top",
                align: "end",
            }),
        ).toEqual({ side: "top", align: "end" });
    });

    test("sideByViewport.desktop wins on desktop", () => {
        stubMatchMedia(true);
        expect(
            resolveSideAndAlign({
                ...baseStep,
                side: "bottom",
                align: "center",
                sideByViewport: {
                    desktop: { side: "right", align: "start" },
                    mobile: { side: "top", align: "end" },
                },
            }),
        ).toEqual({ side: "right", align: "start" });
    });

    test("sideByViewport.mobile wins on mobile", () => {
        stubMatchMedia(false);
        expect(
            resolveSideAndAlign({
                ...baseStep,
                side: "bottom",
                align: "center",
                sideByViewport: {
                    desktop: { side: "right", align: "start" },
                    mobile: { side: "top", align: "end" },
                },
            }),
        ).toEqual({ side: "top", align: "end" });
    });

    test("sideByViewport partial overrides fall back to top-level side / align", () => {
        stubMatchMedia(true);
        expect(
            resolveSideAndAlign({
                ...baseStep,
                side: "left",
                align: "end",
                sideByViewport: {
                    desktop: { side: "right" }, // align falls back to "end"
                    mobile: { align: "start" }, // side falls back to "left"
                },
            }),
        ).toEqual({ side: "right", align: "end" });
    });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveHideArrow
// ─────────────────────────────────────────────────────────────────────────

describe("resolveHideArrow", () => {
    test("default (no hideArrow): arrow is shown on both viewports", () => {
        stubMatchMedia(true);
        expect(resolveHideArrow(baseStep)).toBe(false);
        stubMatchMedia(false);
        expect(resolveHideArrow(baseStep)).toBe(false);
    });

    test("hideArrow.desktop: arrow hidden on desktop, shown on mobile", () => {
        const step: TourStep = { ...baseStep, hideArrow: { desktop: true } };
        stubMatchMedia(true);
        expect(resolveHideArrow(step)).toBe(true);
        stubMatchMedia(false);
        expect(resolveHideArrow(step)).toBe(false);
    });

    test("hideArrow.mobile: arrow hidden on mobile, shown on desktop", () => {
        const step: TourStep = { ...baseStep, hideArrow: { mobile: true } };
        stubMatchMedia(true);
        expect(resolveHideArrow(step)).toBe(false);
        stubMatchMedia(false);
        expect(resolveHideArrow(step)).toBe(true);
    });

    test("hideArrow set on both: arrow hidden everywhere", () => {
        const step: TourStep = {
            ...baseStep,
            hideArrow: { mobile: true, desktop: true },
        };
        stubMatchMedia(true);
        expect(resolveHideArrow(step)).toBe(true);
        stubMatchMedia(false);
        expect(resolveHideArrow(step)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// findAnchorElements
// ─────────────────────────────────────────────────────────────────────────

describe("findAnchorElements", () => {
    test("returns elements with matching `data-tour-anchor`", () => {
        document.body.innerHTML = `
            <div data-tour-anchor="alpha"></div>
            <div data-tour-anchor="beta"></div>
            <div data-tour-anchor="alpha"></div>
        `;
        expect(findAnchorElements("alpha")).toHaveLength(2);
        expect(findAnchorElements("beta")).toHaveLength(1);
        expect(findAnchorElements("gamma")).toHaveLength(0);
    });

    test("matches space-separated tokens via the `~=` selector", () => {
        document.body.innerHTML = `<div data-tour-anchor="alpha beta"></div>`;
        expect(findAnchorElements("alpha")).toHaveLength(1);
        expect(findAnchorElements("beta")).toHaveLength(1);
        expect(findAnchorElements("alphabeta")).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// unionRect
// ─────────────────────────────────────────────────────────────────────────

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
    new DOMRect(x, y, w, h);

describe("unionRect", () => {
    test("returns null for empty input", () => {
        expect(unionRect([])).toBeNull();
    });

    test("filters out zero-area rects (display:none siblings)", () => {
        // The hidden sibling is at (0,0) with zero size — including
        // it would extend the union all the way to the document
        // origin. The visible rect is far from origin.
        const u = unionRect([rect(0, 0, 0, 0), rect(500, 200, 100, 50)]);
        expect(u).not.toBeNull();
        expect(u!.left).toBe(500);
        expect(u!.top).toBe(200);
        expect(u!.right).toBe(600);
        expect(u!.bottom).toBe(250);
    });

    test("returns the bounding box of multiple visible rects", () => {
        const u = unionRect([
            rect(100, 100, 50, 50), // 100,100 → 150,150
            rect(300, 200, 50, 100), // 300,200 → 350,300
        ]);
        expect(u).not.toBeNull();
        expect(u!.left).toBe(100);
        expect(u!.top).toBe(100);
        expect(u!.right).toBe(350);
        expect(u!.bottom).toBe(300);
    });

    test("returns null when ALL rects are zero-area", () => {
        expect(unionRect([rect(0, 0, 0, 0), rect(100, 100, 0, 0)])).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────
// pickPopoverRect
// ─────────────────────────────────────────────────────────────────────────

const mockEl = (
    rectArgs: { x: number; y: number; w: number; h: number },
): HTMLElement => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
        new DOMRect(rectArgs.x, rectArgs.y, rectArgs.w, rectArgs.h);
    return el;
};

describe("pickPopoverRect", () => {
    test("first-visible (default): returns the first non-zero element's rect", () => {
        const els = [
            mockEl({ x: 0, y: 0, w: 0, h: 0 }), // hidden
            mockEl({ x: 100, y: 50, w: 40, h: 30 }), // visible
            mockEl({ x: 200, y: 60, w: 50, h: 25 }), // visible
        ];
        const r = pickPopoverRect(els, undefined);
        expect(r).not.toBeNull();
        expect(r!.left).toBe(100);
        expect(r!.top).toBe(50);
    });

    test('"first-visible" explicit: same as default', () => {
        const els = [
            mockEl({ x: 100, y: 50, w: 40, h: 30 }),
            mockEl({ x: 200, y: 60, w: 50, h: 25 }),
        ];
        const r = pickPopoverRect(els, "first-visible");
        expect(r!.left).toBe(100);
    });

    test('"last-visible": returns the last non-zero element\'s rect', () => {
        const els = [
            mockEl({ x: 100, y: 50, w: 40, h: 30 }), // trigger
            mockEl({ x: 200, y: 60, w: 50, h: 25 }), // open menu (later in DOM order)
        ];
        const r = pickPopoverRect(els, "last-visible");
        expect(r!.left).toBe(200);
    });

    test('"last-visible" with hidden trailing element: skips zero-area, returns last visible', () => {
        const els = [
            mockEl({ x: 100, y: 50, w: 40, h: 30 }), // visible
            mockEl({ x: 200, y: 60, w: 50, h: 25 }), // visible
            mockEl({ x: 0, y: 0, w: 0, h: 0 }), // hidden (CSS-hidden alternate)
        ];
        const r = pickPopoverRect(els, "last-visible");
        expect(r!.left).toBe(200); // last VISIBLE, not last in array
    });

    test("returns null when no element has a non-zero area", () => {
        const els = [mockEl({ x: 0, y: 0, w: 0, h: 0 })];
        expect(pickPopoverRect(els, "first-visible")).toBeNull();
        expect(pickPopoverRect(els, "last-visible")).toBeNull();
    });

    test("returns null for an empty element list", () => {
        expect(pickPopoverRect([], "first-visible")).toBeNull();
    });
});
