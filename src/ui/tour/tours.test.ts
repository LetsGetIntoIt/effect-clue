/**
 * Config-drift tests for the tour registry. The values pinned here
 * MUST match what the manual `next-dev` walk verified for every
 * positioning fix — when those values drift (someone removes
 * `sideByViewport` from a step, or a tour gains a step without a
 * `viewport` flag where it should have one), this catches it before
 * the change ships.
 *
 * What this file does NOT test:
 *
 *   - Whether the resulting popover ends up on-screen (jsdom can't
 *     run Radix's positioning math on a portaled element). Walk the
 *     `next-dev` preview for that — see the Tour-popover verification
 *     section in CLAUDE.md.
 *   - Whether the spotlight visually rings the right element. Same
 *     reason — DOM positioning is a layout concern.
 *
 * What it DOES catch (cheap & deterministic):
 *
 *   - A step's `popoverAnchor` getting silently dropped.
 *   - The mobile-only Suggest-tab step losing its `viewport: "mobile"`
 *     flag (which would make it render on desktop too).
 *   - `sideByViewport` keys flipped (mobile config landing on
 *     desktop).
 *   - The `firstSuggestion` step's `desktop` anchor being changed
 *     back to a tall element (which previously caused the off-top
 *     popover bug).
 */
import { describe, expect, test } from "vitest";
import { TOURS, type TourStep } from "./tours";

const findStep = (
    tour: ReadonlyArray<TourStep>,
    anchor: string,
): TourStep => {
    const step = tour.find(s => s.anchor === anchor);
    if (!step) {
        throw new Error(`No step with anchor "${anchor}" in this tour`);
    }
    return step;
};

describe("TOURS — setup tour", () => {
    test("has 6 steps in declaration order", () => {
        expect(TOURS.setup.map(s => s.anchor)).toEqual([
            "setup-card-pack",
            "setup-player-column",
            "setup-hand-size",
            "setup-known-cell",
            "overflow-menu",
            "setup-start-playing",
        ]);
    });

    test("setup-known-cell uses popoverAnchor + sideByViewport", () => {
        const step = findStep(TOURS.setup, "setup-known-cell");
        // Spotlight covers all body cells; popover anchors to the
        // header so it doesn't pin against an 800-px-tall column.
        expect(step.popoverAnchor).toBe("setup-known-cell-header");
        // Desktop: popover sits to the RIGHT (column visible).
        // Mobile: side: bottom; column too narrow horizontally for
        // a side popover.
        expect(step.sideByViewport?.desktop).toEqual({
            side: "right",
            align: "start",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "bottom",
            align: "center",
        });
    });

    test("overflow-menu uses popoverAnchorPriority + sideByViewport", () => {
        const step = findStep(TOURS.setup, "overflow-menu");
        // Trigger is in DOM order before the portaled menu content;
        // last-visible resolves to the open dropdown.
        expect(step.popoverAnchorPriority).toBe("last-visible");
        // Desktop: popover left of menu (menu opens DOWN from
        // top-right trigger). Mobile: popover above menu (menu opens
        // UP from bottom-right trigger).
        expect(step.sideByViewport?.desktop.side).toBe("left");
        expect(step.sideByViewport?.mobile.side).toBe("top");
    });
});

describe("TOURS — checklistSuggest tour", () => {
    test("has the expected step list including the mobile-only Suggest-tab step", () => {
        expect(TOURS.checklistSuggest.map(s => s.anchor)).toEqual([
            "checklist-cell",
            "checklist-case-file",
            "bottom-nav-suggest", // mobile-only — `viewport: "mobile"` filters it on desktop
            "suggest-prior-log",
            "suggest-add-form",
        ]);
    });

    test("bottom-nav-suggest is mobile-only (filtered out on desktop)", () => {
        const step = findStep(TOURS.checklistSuggest, "bottom-nav-suggest");
        expect(step.viewport).toBe("mobile");
        // The step requires `checklist` uiMode so the BottomNav's
        // Suggest tab is the natural CTA — switching to suggest is
        // the user's next action.
        expect(step.requiredUiMode).toBe("checklist");
    });

    test("no other step is viewport-locked", () => {
        // Only the Suggest-tab step is viewport-conditional today.
        // If you add another viewport-locked step, update this
        // assertion AND walk both breakpoints.
        const lockedSteps = TOURS.checklistSuggest.filter(
            s => s.viewport !== undefined && s.viewport !== "both",
        );
        expect(lockedSteps.map(s => s.anchor)).toEqual(["bottom-nav-suggest"]);
    });

    test("suggest-add-form spotlight covers the whole form, popover sits outside via sideByViewport", () => {
        const step = findStep(TOURS.checklistSuggest, "suggest-add-form");
        // The wrap-up step: spotlight covers the whole form (header
        // + tabs + pill row); popover sits ABOVE on desktop and
        // BELOW on mobile to avoid covering the form.
        expect(step.popoverAnchor).toBeUndefined(); // popover anchors to the same wide form
        expect(step.sideByViewport?.desktop).toEqual({
            side: "top",
            align: "end",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "bottom",
            align: "center",
        });
        expect(step.finishLabelKey).toBe("startPlaying");
    });

    test("every step except the mobile-only one has a requiredUiMode", () => {
        // The driver dispatches `setUiMode` to land on the right pane
        // before each step renders on mobile (since panes don't
        // co-exist on mobile). The mobile-only Suggest-tab step
        // explicitly stays on the checklist pane (the user is about
        // to switch panes themselves).
        for (const step of TOURS.checklistSuggest) {
            expect(step.requiredUiMode).toBeDefined();
        }
    });
});

describe("TOURS — firstSuggestion tour", () => {
    test("has exactly one step", () => {
        expect(TOURS.firstSuggestion).toHaveLength(1);
    });

    test("desktop spotlight covers the WHOLE checklist; mobile points at the BottomNav Checklist tab", () => {
        // The exact details inside the deduction grid don't matter
        // for this step — the user just needs a "look here after
        // dismissing" cue. Spotlight covers the whole grid on
        // desktop; popover anchors to a smaller element so it
        // actually fits.
        const step = TOURS.firstSuggestion[0]!;
        expect(step.anchorByViewport?.desktop).toBe("desktop-checklist-area");
        expect(step.anchorByViewport?.mobile).toBe("bottom-nav-checklist");
    });

    test("popover anchors to the case-file summary on desktop; falls back to the spotlight on mobile", () => {
        // The popoverAnchor token resolves to an element on desktop
        // (the case-file summary box at the top of the checklist)
        // but to nothing on mobile (the checklist pane isn't
        // mounted in the suggest viewport). The popover-measurement
        // fallback in TourPopover.tsx handles that by reverting to
        // the spotlight elements (`bottom-nav-checklist`).
        const step = TOURS.firstSuggestion[0]!;
        expect(step.popoverAnchor).toBe("checklist-case-file");
    });

    test("sideByViewport pins desktop=bottom (below case-file box), mobile=top (above BottomNav tab)", () => {
        const step = TOURS.firstSuggestion[0]!;
        expect(step.sideByViewport?.desktop).toEqual({
            side: "bottom",
            align: "start",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "top",
            align: "center",
        });
    });
});

describe("TOURS — placeholder tours", () => {
    test("account is reserved (empty step list)", () => {
        expect(TOURS.account).toEqual([]);
    });

    test("shareImport is reserved (empty step list)", () => {
        expect(TOURS.shareImport).toEqual([]);
    });
});
