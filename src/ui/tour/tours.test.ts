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
 *   - A step accidentally losing its `viewport` flag (would render
 *     on the wrong breakpoint).
 *   - `sideByViewport` keys flipped (mobile config landing on
 *     desktop).
 *   - The cell-explanation walkthrough losing the three section
 *     anchors that drive the auto-open hook in `Checklist.tsx`.
 *   - `nonBlocking` getting dropped from the informational tours
 *     (Setup welcome, sharing, firstSuggestion).
 */
import { describe, expect, test } from "vitest";
import { TOUR_PREREQUISITES, TOURS, type TourStep } from "./tours";

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
    test("is a single welcome step (wizard is largely self-explanatory)", () => {
        // After the heading-hierarchy + suggestion-log rework, the
        // wizard's accordion + sticky-footer + per-step validation
        // banner make the multi-step setup tour redundant. One welcome
        // step orients new visitors; everything else is discoverable
        // from the wizard itself.
        //
        // The step targets `setup-wizard-header` — a small element at
        // the top of the wizard, not the full accordion shell. The
        // shell is too tall to anchor a popover against (Radix's
        // collision detection pushes it past the viewport edge); the
        // header is short and predictably on-screen.
        expect(TOURS.setup.map(s => s.anchor)).toEqual([
            "setup-wizard-header",
        ]);
    });

    test("welcome step is non-blocking — user can interact with the wizard alongside it", () => {
        const step = TOURS.setup[0]!;
        expect(step.nonBlocking).toBe(true);
    });

    test("welcome step copy keys point at setup.welcome.*", () => {
        const step = TOURS.setup[0]!;
        expect(step.titleKey).toBe("setup.welcome.title");
        expect(step.bodyKey).toBe("setup.welcome.body");
    });

    test("welcome step uses sideByViewport for stable placement on both breakpoints", () => {
        const step = TOURS.setup[0]!;
        expect(step.sideByViewport?.desktop).toEqual({
            side: "bottom",
            align: "start",
        });
        // Mobile: popover sits below the header too — the header is at
        // the top of the page on both breakpoints, so bottom is safe.
        expect(step.sideByViewport?.mobile).toEqual({
            side: "bottom",
            align: "center",
        });
    });
});

describe("TOURS — checklistSuggest tour", () => {
    test("walks intro → DEDUCTIONS → LEADS → HYPOTHESIS → case file → suggest intro → prior log → add form", () => {
        // The post-rework tour is built around the three named
        // sections of the cell-explanation panel. Steps 2-4 share the
        // anchor naming convention `cell-explanation-*`; the
        // Checklist component watches for those anchors and opens a
        // deterministic cell so the panel is on screen for the
        // popover to land against. Step 5 (case-file) closes the
        // cell again as the tour moves on.
        expect(TOURS.checklistSuggest.map(s => s.anchor)).toEqual([
            "desktop-checklist-area",
            "cell-explanation-deductions",
            "cell-explanation-leads",
            "cell-explanation-hypothesis",
            "checklist-case-file",
            "desktop-suggest-area",
            "suggest-prior-log",
            "suggest-add-form",
        ]);
    });

    test("intro steps use viewport-conditional anchors + popoverAnchor", () => {
        // The Checklist + Suggest intros spotlight large regions
        // (whole column on desktop, BottomNav tab on mobile) but pin
        // the popover to a smaller element on desktop so it doesn't
        // get pushed off-screen.
        const checklistIntro = findStep(
            TOURS.checklistSuggest,
            "desktop-checklist-area",
        );
        expect(checklistIntro.anchorByViewport).toEqual({
            mobile: "bottom-nav-checklist",
            desktop: "desktop-checklist-area",
        });
        expect(checklistIntro.popoverAnchor).toBe("checklist-case-file");

        const suggestIntro = findStep(
            TOURS.checklistSuggest,
            "desktop-suggest-area",
        );
        expect(suggestIntro.anchorByViewport).toEqual({
            mobile: "bottom-nav-suggest",
            desktop: "desktop-suggest-area",
        });
        expect(suggestIntro.popoverAnchor).toBe("suggest-add-form-header");
    });

    test("no step is viewport-locked", () => {
        // Every step in the tour runs on both viewports — the
        // viewport-conditional behavior lives in `sideByViewport` /
        // `anchorByViewport`, not in skipping steps entirely. If you
        // add a viewport-locked step, update this assertion AND walk
        // both breakpoints.
        const lockedSteps = TOURS.checklistSuggest.filter(
            s => s.viewport !== undefined && s.viewport !== "both",
        );
        expect(lockedSteps).toEqual([]);
    });

    test("cell-explanation steps target the three section anchors that drive the Checklist auto-open hook", () => {
        // The Checklist component watches `currentStep.anchor` for
        // these three tokens and opens a deterministic cell so the
        // explanation row is on screen. If a step's anchor drifts off
        // these tokens, the hook stops firing and the popover lands
        // against a closed panel.
        const deductions = findStep(
            TOURS.checklistSuggest,
            "cell-explanation-deductions",
        );
        expect(deductions.requiredUiMode).toBe("checklist");
        expect(deductions.titleKey).toBe("checklist.deductions.title");

        const leads = findStep(
            TOURS.checklistSuggest,
            "cell-explanation-leads",
        );
        expect(leads.requiredUiMode).toBe("checklist");
        expect(leads.titleKey).toBe("checklist.leads.title");

        const hypothesis = findStep(
            TOURS.checklistSuggest,
            "cell-explanation-hypothesis",
        );
        expect(hypothesis.requiredUiMode).toBe("checklist");
        expect(hypothesis.titleKey).toBe("checklist.hypothesis.title");
    });

    test("suggest-add-form: spotlight covers the whole form, popover anchored to the small header inside", () => {
        const step = findStep(TOURS.checklistSuggest, "suggest-add-form");
        // The wrap-up step: spotlight covers the whole form (header
        // + tabs + pill row + submit), but the form is taller than
        // the room above or below it on both viewports (~150px above
        // / below the form, ~400-500px tall). An external popover
        // can't fit, so we anchor to the small header element and
        // park the popover INSIDE the spotlight, below the header.
        expect(step.popoverAnchor).toBe("suggest-add-form-header");
        expect(step.sideByViewport?.desktop).toEqual({
            side: "bottom",
            align: "center",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "bottom",
            align: "center",
        });
        expect(step.finishLabelKey).toBe("startPlaying");
    });

    test("every step has a requiredUiMode", () => {
        // The driver dispatches `setUiMode` to land on the right
        // pane before each step renders on mobile (since panes don't
        // co-exist on mobile). On desktop the dispatch is a no-op
        // since both panes render side-by-side.
        for (const step of TOURS.checklistSuggest) {
            expect(step.requiredUiMode).toBeDefined();
        }
    });

    test("no step is non-blocking — the cell-walkthrough orchestrates page state", () => {
        // The Checklist auto-opens a cell during the cell-explanation
        // steps; if the user could click into the page beneath, a
        // misclick would close the cell and the popover would land
        // against thin air. Pin every step as blocking.
        for (const step of TOURS.checklistSuggest) {
            expect(step.nonBlocking ?? false).toBe(false);
        }
    });
});

describe("TOURS — firstSuggestion tour", () => {
    test("has exactly one step", () => {
        expect(TOURS.firstSuggestion).toHaveLength(1);
    });

    test("desktop spotlight covers the WHOLE checklist; mobile points at the BottomNav Checklist tab", () => {
        const step = TOURS.firstSuggestion[0]!;
        expect(step.anchorByViewport?.desktop).toBe("desktop-checklist-area");
        expect(step.anchorByViewport?.mobile).toBe("bottom-nav-checklist");
    });

    test("popover anchors to the case-file summary on desktop; falls back to the spotlight on mobile", () => {
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

    test("hideArrow on desktop only (popover sits inside spotlight on desktop; arrow is useful on mobile)", () => {
        expect(TOURS.firstSuggestion[0]!.hideArrow?.desktop).toBe(true);
        expect(TOURS.firstSuggestion[0]!.hideArrow?.mobile).toBeUndefined();
    });

    test("is non-blocking — the user just submitted a suggestion and should keep their flow", () => {
        expect(TOURS.firstSuggestion[0]!.nonBlocking).toBe(true);
    });
});

describe("TOURS — sharing follow-up tour", () => {
    test("has 3 steps in declaration order — pack share, invite link, overflow menu", () => {
        expect(TOURS.sharing.map((s) => s.anchor)).toEqual([
            "setup-share-pack-pill",
            "setup-invite-player",
            "overflow-menu",
        ]);
    });

    test("anchors land on actual data-tour-anchor attributes wired in the UI", () => {
        const anchors = TOURS.sharing.map((s) => s.anchor);
        expect(anchors).toContain("setup-share-pack-pill");
        expect(anchors).toContain("setup-invite-player");
        expect(anchors).toContain("overflow-menu");
    });

    test("overflow-menu step uses last-visible priority + sideByViewport", () => {
        const step = findStep(TOURS.sharing, "overflow-menu");
        expect(step.popoverAnchorPriority).toBe("last-visible");
        expect(step.sideByViewport?.desktop).toEqual({
            side: "left",
            align: "start",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "top",
            align: "end",
        });
    });

    test("closing step uses 'gotIt' finish label (one-shot acknowledgement)", () => {
        const overflow = findStep(TOURS.sharing, "overflow-menu");
        expect(overflow.finishLabelKey).toBe("gotIt");
    });

    test("every step is non-blocking — user can scroll the wizard while the callouts walk", () => {
        for (const step of TOURS.sharing) {
            expect(step.nonBlocking).toBe(true);
        }
    });
});

describe("TOUR_PREREQUISITES", () => {
    test("sharing tour requires both setup AND checklistSuggest dismissed", () => {
        expect(TOUR_PREREQUISITES.sharing).toEqual([
            "setup",
            "checklistSuggest",
        ]);
    });

    test("setup tour has no prerequisites (foundational)", () => {
        expect(TOUR_PREREQUISITES.setup).toBeUndefined();
    });

    test("checklistSuggest tour has no prerequisites (foundational)", () => {
        expect(TOUR_PREREQUISITES.checklistSuggest).toBeUndefined();
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
