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
 *   - The "Pick a card pack" callout drifting off the
 *     `setup-wizard-step-cardPack` anchor emitted by SetupStepPanel.
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
    test("is a 3-step tour: welcome → overflow menu callout → card pack", () => {
        // The wizard itself is largely self-explanatory (accordion +
        // sticky-footer + per-step validation banner) so we don't walk
        // every wizard step. Three short steps:
        //   1. Welcome — orient brand-new visitors.
        //   2. Overflow menu — show the user where Game setup lives
        //      so they have a concrete "come back here later"
        //      affordance. The same callout fires on step 1 of
        //      `checklistSuggest` too; teaching it from both
        //      directions is intentional repetition.
        //   3. Card pack — closer pointing at the first wizard
        //      section so the user has a concrete first move after
        //      the orientation lands.
        expect(TOURS.setup.map(s => s.anchor)).toEqual([
            "setup-wizard-header",
            "overflow-menu",
            "setup-wizard-step-cardPack",
        ]);
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

    test("overflow-menu step uses last-visible + force-opens the menu via the `overflow-menu` anchor", () => {
        const step = TOURS.setup[1]!;
        expect(step.anchor).toBe("overflow-menu");
        expect(step.popoverAnchorPriority).toBe("last-visible");
        expect(step.titleKey).toBe("setup.menu.title");
        // Mobile menu opens UP from the BottomNav → popover above
        // (side: "top"). Desktop menu opens DOWN from the top-right
        // Toolbar trigger → popover to the LEFT (side: "left").
        expect(step.sideByViewport?.mobile).toEqual({
            side: "top",
            align: "end",
        });
        expect(step.sideByViewport?.desktop).toEqual({
            side: "left",
            align: "start",
        });
    });

    test("card-pack step closes the tour with a 'Got it' CTA + targets the cardPack panel", () => {
        const step = TOURS.setup[2]!;
        expect(step.anchor).toBe("setup-wizard-step-cardPack");
        expect(step.titleKey).toBe("setup.cardPack.title");
        expect(step.bodyKey).toBe("setup.cardPack.body");
        // Final step wraps up with a "Got it" CTA.
        expect(step.finishLabelKey).toBe("gotIt");
    });
});

describe("TOURS — checklistSuggest tour", () => {
    test("registry holds 17 entries: two-halves pair + suggest-pane pair + My Cards pair (desktop + mobile) + shared steps", () => {
        // The two-halves intro is split three ways: a desktop multi-
        // spotlight on the pane columns, a mobile multi-spotlight on
        // the BottomNav tabs, and a mobile-only tap-Checklist step
        // that follows the mobile multi-spotlight to teach the
        // gesture. Project 3 added a viewport-locked My Cards pair
        // (desktop section + mobile FAB) between the case-file step
        // and the suggest-pane intro. The suggest-pane intro is
        // another viewport-locked pair (desktop info / mobile
        // tap-Suggest). The unfiltered registry holds 17 entries;
        // each viewport sees 13 (desktop) / 14 (mobile) after the
        // filter.
        expect(TOURS.checklistSuggest).toHaveLength(17);
    });

    test("registry anchors in order, including viewport-locked pairs", () => {
        // Pinned in declaration order:
        //   1. overflow-menu (both)
        //   2. two-halves-spotlight (desktop)
        //   3. bottom-nav-two-halves (mobile, multi-spotlight)
        //   4. bottom-nav-checklist (mobile, tap-to-advance)
        //   5. checklist-cell (both — advance-on-click, OPEN)
        //   6. cell-explanation-panel (both — whole-panel intro)
        //   7-9. cell-explanation-{deductions,leads,hypothesis} (both)
        //  10. checklist-cell-close (both — advance-on-click, CLOSE)
        //  11. checklist-case-file (both — panel already dismissed)
        //  12. my-cards-section (desktop — Project 3)
        //  13. my-cards-fab (mobile — Project 3)
        //  14. desktop-suggest-area (desktop)
        //  15. bottom-nav-suggest (mobile)
        //  16. suggest-prior-log (both)
        //  17. suggest-add-form (both)
        expect(TOURS.checklistSuggest.map(s => s.anchor)).toEqual([
            "overflow-menu",
            "two-halves-spotlight",
            "bottom-nav-two-halves",
            "bottom-nav-checklist",
            "checklist-cell",
            "cell-explanation-panel",
            "cell-explanation-deductions",
            "cell-explanation-leads",
            "cell-explanation-hypothesis",
            "checklist-cell-close",
            "checklist-case-file",
            "my-cards-section",
            "my-cards-fab",
            "desktop-suggest-area",
            "bottom-nav-suggest",
            "suggest-prior-log",
            "suggest-add-form",
        ]);
    });

    test("opens the overflow menu on step 1 via force-open + last-visible popover priority", () => {
        const step = TOURS.checklistSuggest[0]!;
        expect(step.anchor).toBe("overflow-menu");
        expect(step.popoverAnchorPriority).toBe("last-visible");
        expect(step.forceOpenOverflowMenu).toBe(true);
    });

    test("desktop two-halves step uses multi-spotlight + a divider popover anchor at the gap", () => {
        const step = findStep(
            TOURS.checklistSuggest,
            "two-halves-spotlight",
        );
        // `two-halves-spotlight` is attached to BOTH the Checklist
        // and SuggestionLog column wrappers, so the spotlight renderer
        // paints two separate rings. The popover anchors to
        // `two-halves-divider`, a 0-sized sentinel sitting in the gap
        // between the two columns, so the popover centers
        // horizontally on the visual border between the halves.
        expect(step.popoverAnchor).toBe("two-halves-divider");
        expect(step.viewport).toBe("desktop");
        expect(step.requiredUiMode).toBe("checklist");
    });

    test("mobile two-halves step is a multi-spotlight on both BottomNav tabs, reusing the desktop intro copy", () => {
        const step = findStep(
            TOURS.checklistSuggest,
            "bottom-nav-two-halves",
        );
        // Mobile mirror of the desktop `two-halves-spotlight` step.
        // `bottom-nav-two-halves` is attached to BOTH NavTabItem
        // buttons; the spotlight renderer paints two separate rings.
        // The popover anchors to `bottom-nav-two-halves-divider`, a
        // 1×1 sentinel sitting between the two tabs, so the popover
        // centers above the visual border between the halves.
        expect(step.viewport).toBe("mobile");
        expect(step.multiSpotlight).toBe(true);
        expect(step.popoverAnchor).toBe("bottom-nav-two-halves-divider");
        // No `advanceOn`: the step is informational and the user
        // advances via Next. The window-level click filter blocks
        // taps on the underlying tabs.
        expect(step.advanceOn).toBeUndefined();
        // Copy is reused from the desktop two-halves step — same
        // two-column body lays out under the title on both
        // viewports.
        expect(step.titleKey).toBe("checklist.intro.title");
        expect(step.bodyKey).toBe("checklist.intro.body");
        expect(step.requiredUiMode).toBe("checklist");
    });

    test("mobile tap-Checklist step follows the two-halves intro (advance-on-click)", () => {
        // After the mobile multi-spotlight introduces the two halves
        // in the abstract, this step spotlights the Checklist tab
        // alone and asks the user to tap it — teaching the BottomNav
        // gesture they'll need at the Suggest transition later.
        const step = findStep(TOURS.checklistSuggest, "bottom-nav-checklist");
        expect(step.viewport).toBe("mobile");
        expect(step.advanceOn).toEqual({
            event: "click",
            anchor: "bottom-nav-checklist",
        });
    });

    test("checklist-cell intro is advance-on-click — user clicks the cell to open the explanation", () => {
        const step = findStep(TOURS.checklistSuggest, "checklist-cell");
        expect(step.advanceOn).toEqual({
            event: "click",
            anchor: "checklist-cell",
        });
        expect(step.requiredUiMode).toBe("checklist");
        expect(step.titleKey).toBe("checklist.cellIntro.title");
    });

    test("desktop suggest-intro is a normal Next step; mobile counterpart asks the user to tap Suggest", () => {
        const desktopIntro = findStep(
            TOURS.checklistSuggest,
            "desktop-suggest-area",
        );
        expect(desktopIntro.viewport).toBe("desktop");
        // Popover anchors to the column wrapper itself with
        // side:left/align:center so the popover sits to the LEFT of
        // the suggest log, clear of every form control inside it.
        expect(desktopIntro.popoverAnchor).toBe("desktop-suggest-area");
        expect(desktopIntro.side).toBe("left");
        expect(desktopIntro.align).toBe("center");
        expect(desktopIntro.advanceOn).toBeUndefined();

        const mobileIntro = findStep(
            TOURS.checklistSuggest,
            "bottom-nav-suggest",
        );
        expect(mobileIntro.viewport).toBe("mobile");
        expect(mobileIntro.advanceOn).toEqual({
            event: "click",
            anchor: "bottom-nav-suggest",
        });
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

    test("suggest-add-form: popoverAnchor + side/align are viewport-conditional", () => {
        const step = findStep(TOURS.checklistSuggest, "suggest-add-form");
        // The wrap-up step splits behavior by breakpoint.
        //
        // Desktop: popover anchors to the FIRST INPUT in the form
        // (`suggest-first-pill` — the Suggester pill) and sits to the
        // LEFT (`side: "left"`, `align: "center"`) so it doesn't
        // occlude any form control.
        //
        // Mobile: popover anchors to the small form header and sits
        // BELOW it (`side: "bottom"`, `align: "center"`), INSIDE the
        // form's spotlight — the phone-height viewport doesn't have
        // room for an external popover so we park it inside.
        expect(step.popoverAnchorByViewport?.desktop).toBe("suggest-first-pill");
        expect(step.popoverAnchorByViewport?.mobile).toBe("suggest-add-form-header");
        expect(step.sideByViewport?.desktop).toEqual({
            side: "left",
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

});

describe("TOURS — firstSuggestion tour", () => {
    test("registry holds 2 entries: a mobile-only tap-Checklist step + the shared see-updates step", () => {
        // The user just submitted their first suggestion. On mobile
        // they're on the Suggest pane and can't see the Checklist
        // update without navigating; step 1 (mobile-only) prompts
        // them to tap the Checklist tab. Step 2 fires on both
        // viewports and points at the case-file where the update
        // is most visible. Desktop sees just step 2 (1 step total);
        // mobile sees both (2 steps total).
        expect(TOURS.firstSuggestion).toHaveLength(2);
    });

    test("mobile step 1 prompts the user to tap the Checklist tab (advance-on-click, mobile-only)", () => {
        const step = TOURS.firstSuggestion[0]!;
        expect(step.viewport).toBe("mobile");
        expect(step.anchor).toBe("bottom-nav-checklist");
        expect(step.advanceOn).toEqual({
            event: "click",
            anchor: "bottom-nav-checklist",
        });
        expect(step.titleKey).toBe("firstSuggestion.tapChecklist.title");
        expect(step.bodyKey).toBe("firstSuggestion.tapChecklist.body");
    });

    test("see-updates step spotlights the case-file on mobile / the whole checklist column on desktop", () => {
        const step = TOURS.firstSuggestion[1]!;
        // Mobile: the user is on the Checklist pane post step 1, so
        // the spotlight lands on the case-file where a first
        // suggestion typically produces visible updates.
        expect(step.anchorByViewport?.mobile).toBe("checklist-case-file");
        // Desktop: both panes are side-by-side; the spotlight covers
        // the entire Checklist column.
        expect(step.anchorByViewport?.desktop).toBe("desktop-checklist-area");
    });

    test("see-updates step anchors its popover at the case-file summary on both viewports", () => {
        const step = TOURS.firstSuggestion[1]!;
        expect(step.popoverAnchor).toBe("checklist-case-file");
    });

    test("see-updates step pins desktop=bottom (below case-file), mobile=top (above case-file)", () => {
        const step = TOURS.firstSuggestion[1]!;
        expect(step.sideByViewport?.desktop).toEqual({
            side: "bottom",
            align: "start",
        });
        expect(step.sideByViewport?.mobile).toEqual({
            side: "top",
            align: "center",
        });
    });

    test("see-updates step locks the Checklist pane via requiredUiMode (mobile guard for Back nav)", () => {
        // Step 1 only fires on mobile; if a mobile user uses Back
        // from step 2 → step 1 → forward, they need to land back on
        // the Checklist pane before step 2 anchors against the case
        // file. requiredUiMode handles that.
        const step = TOURS.firstSuggestion[1]!;
        expect(step.requiredUiMode).toBe("checklist");
    });

    test("see-updates step hides arrow on desktop only (popover sits inside the spotlight)", () => {
        const step = TOURS.firstSuggestion[1]!;
        expect(step.hideArrow?.desktop).toBe(true);
        expect(step.hideArrow?.mobile).toBeUndefined();
    });

    test("see-updates step closes the tour with a 'Got it' CTA", () => {
        const step = TOURS.firstSuggestion[1]!;
        expect(step.finishLabelKey).toBe("gotIt");
    });

});

describe("TOURS — sharing follow-up tour", () => {
    test("walks the three sharing menu items: invite → transfer → my-card-packs", () => {
        // The M22 rework moved the share-a-pack icon out of the
        // setup wizard into the CardPackPicker dropdown + Account
        // modal, and consolidated the other share affordances inside
        // the overflow menu. The new sharing tour opens that menu
        // and walks the three menu items in turn.
        expect(TOURS.sharing.map((s) => s.anchor)).toEqual([
            "menu-item-invite-player",
            "menu-item-transfer-device",
            "menu-item-my-card-packs",
        ]);
    });

    test("every step force-opens the overflow menu", () => {
        for (const step of TOURS.sharing) {
            expect(step.forceOpenOverflowMenu).toBe(true);
        }
    });

    test("every step uses the same sideByViewport (menu opens UP on mobile / DOWN on desktop)", () => {
        for (const step of TOURS.sharing) {
            expect(step.sideByViewport?.mobile).toEqual({
                side: "top",
                align: "end",
            });
            expect(step.sideByViewport?.desktop).toEqual({
                side: "left",
                align: "start",
            });
        }
    });

    test("closing step uses 'gotIt' finish label", () => {
        const last = TOURS.sharing[TOURS.sharing.length - 1]!;
        expect(last.finishLabelKey).toBe("gotIt");
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

describe("TOURS — account tour (event-triggered, My card packs modal)", () => {
    test("has two steps in declaration order: intro → pack actions", () => {
        // Sync now is deliberately NOT called out — syncing is
        // automatic and the button is just a manual fail-safe.
        // Share / Rename / Delete are folded into one combined
        // "actions you can take" step so the user gets the full
        // mental model without three separate popovers.
        expect(TOURS.account.map(s => s.anchor)).toEqual([
            "account-my-card-packs",
            "account-pack-actions",
        ]);
    });

    test("closing step uses 'gotIt' finish label", () => {
        const last = TOURS.account[TOURS.account.length - 1]!;
        expect(last.finishLabelKey).toBe("gotIt");
    });

    test("no step is advance-on-click — passive Next-button callouts only", () => {
        for (const step of TOURS.account) {
            expect(step.advanceOn).toBeUndefined();
        }
    });

    test("titleKey + bodyKey point at onboarding.account.* keys", () => {
        const tags = ["myCardPacks", "packActions"];
        TOURS.account.forEach((step, i) => {
            const tag = tags[i]!;
            expect(step.titleKey).toBe(`account.${tag}.title`);
            expect(step.bodyKey).toBe(`account.${tag}.body`);
        });
    });
});

describe("TOUR_PREREQUISITES (account)", () => {
    test("account tour has no prerequisites (event-triggered, like firstSuggestion)", () => {
        expect(TOUR_PREREQUISITES.account).toBeUndefined();
    });
});

describe("TOURS — placeholder tours", () => {
    test("shareImport is reserved (empty step list)", () => {
        expect(TOURS.shareImport).toEqual([]);
    });
});
