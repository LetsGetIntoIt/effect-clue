/**
 * Static tour content registry.
 *
 * Each per-screen tour is a list of `TourStep`s the user walks
 * through with Next / Back / Skip. Anchors are CSS-attribute
 * selectors so any component can mark itself as a target with
 * `data-tour-anchor="..."` without threading refs through props.
 *
 * Tour copy lives in `messages/en.json` under the `onboarding`
 * namespace — `<i18n key>` entries here are looked up by the
 * `TourPopover` at render time. Author the copy and add new steps
 * here; the wiring picks up new steps for free.
 */
import { Duration } from "effect";
import type { UiMode } from "../../logic/ClueState";
import type { ScreenKey } from "./TourState";

/**
 * How long after dismissal a per-screen tour stays dormant before
 * it's eligible to fire again. Kept here (alongside the tour
 * registry) so both `useTourGate` and the coordinator's eligibility
 * check can read the same constant without dragging React imports
 * across module boundaries.
 */
export const TOUR_RE_ENGAGE_DURATION = Duration.weeks(4);

/**
 * A single step in a tour. The `anchor` resolves to
 * `document.querySelector(`[data-tour-anchor~="${anchor}"]`)` at the
 * moment the step becomes active. Missing anchors auto-skip — the
 * tour advances to the next step or dismisses if there's no next.
 *
 * Both `titleKey` and `bodyKey` are next-intl keys under the
 * `onboarding` namespace. They're allowed to be missing in
 * messages — that surfaces a hard error in i18n:check, which is the
 * right discipline.
 *
 * `requiredUiMode` is consulted by the tour driver before rendering
 * a step: on mobile, `checklist` and `suggest` modes route to
 * different panes, so a step targeting the prior-log needs the
 * `suggest` pane mounted. Desktop renders both panes simultaneously
 * so the dispatch is a no-op.
 */
export interface TourStep {
    /**
     * Identifier matching a `data-tour-anchor="..."` attribute on the
     * target element. Module-internal — choose a stable name and use
     * the same string everywhere.
     *
     * For viewport-conditional anchors (e.g. "the Checklist tab" lands
     * on the BottomNav on mobile and on the desktop deduction grid on
     * desktop), use `anchorByViewport` instead and leave `anchor` as
     * a fallback used by the SSR / test paths.
     */
    readonly anchor: string;
    /**
     * When set, takes precedence over `anchor` once the client knows
     * which breakpoint is active. The TourPopover resolves to the
     * `mobile` or `desktop` token based on `window.matchMedia`. Both
     * tokens still need a `data-tour-anchor` attribute mounted in the
     * DOM at the time of step display.
     */
    readonly anchorByViewport?: {
        readonly mobile: string;
        readonly desktop: string;
    };
    /** next-intl key under `onboarding.<screenKey>`. */
    readonly titleKey: string;
    /**
     * Optional next-intl key under `onboarding.<screenKey>`. When
     * omitted, the popover renders just the title — useful for
     * short call-to-action steps where no extra body copy is needed.
     */
    readonly bodyKey?: string;
    /**
     * Preferred side relative to the anchor. Radix may flip this if
     * there's not enough room. Defaults to `"bottom"`.
     */
    readonly side?: "top" | "right" | "bottom" | "left";
    /** Defaults to `"center"`. */
    readonly align?: "start" | "center" | "end";
    /**
     * Viewport-conditional override for `side` + `align`. Like
     * `anchorByViewport` (which selects a different anchor *element*
     * per breakpoint), this picks a different side/align per
     * breakpoint when the natural anchor sits in different parts of
     * the layout on mobile vs desktop. Used by the `overflow-menu`
     * step where the menu opens DOWN on desktop and UP on mobile.
     *
     * When set, takes precedence over `side` + `align` once the
     * client knows which breakpoint is active (`window.matchMedia
     * ("(min-width: 800px)")`). On SSR / tests where matchMedia
     * isn't available, falls back to the top-level `side` / `align`.
     */
    readonly sideByViewport?: {
        readonly mobile: {
            readonly side?: "top" | "right" | "bottom" | "left";
            readonly align?: "start" | "center" | "end";
        };
        readonly desktop: {
            readonly side?: "top" | "right" | "bottom" | "left";
            readonly align?: "start" | "center" | "end";
        };
    };
    /**
     * If set, the driver dispatches `setUiMode` to this mode before
     * the step renders so the anchor is mounted in the visible pane.
     */
    readonly requiredUiMode?: UiMode;
    /**
     * Optional next-intl key (under the `onboarding` namespace) used
     * for the "next" button on the LAST step. Defaults to
     * `onboarding.finish` ("Finish"). Use this on a closing step to
     * customize the call-to-action — e.g. "Start playing" for the
     * Checklist & Suggest tour's wrap-up step.
     */
    readonly finishLabelKey?: string;
    /**
     * When set, the popover anchors to elements matching THIS token
     * instead of `anchor`. The spotlight still resolves `anchor` (so
     * the highlight region is unchanged) — only the popover binding
     * moves. Useful when the spotlight covers a tall / wide region
     * (e.g. an entire column) and anchoring the popover to the first
     * cell would push it off-screen on narrow viewports.
     */
    readonly popoverAnchor?: string;
    /**
     * Among matched elements, which one drives popover position.
     * Defaults to `"first-visible"` — the natural "anchor to the first
     * visible element" rule that handles ordinary single-element
     * anchors and same-token-on-multiple-breakpoints (Toolbar +
     * BottomNav both carrying the same token; we pick the visible
     * one).
     *
     * `"last-visible"` is needed for portaled overlays — the overflow
     * menu's portaled content appears AFTER the trigger button in
     * DOM order, so picking the LAST visible element resolves to the
     * open dropdown when present, falling back to the trigger when
     * not.
     */
    readonly popoverAnchorPriority?: "first-visible" | "last-visible";
    /**
     * Limits this step to a single viewport breakpoint. Steps with a
     * non-matching `viewport` value are FILTERED OUT of the tour
     * before it starts — the step counter ("3 of 5") and the
     * `tour_started.stepCount` analytics property both reflect the
     * post-filter list. Use this for steps that only make sense on
     * one layout (e.g. "Tap the Suggest tab" makes no sense on
     * desktop where both panes are side-by-side).
     *
     * Defaults to `"both"` — step renders on every viewport.
     */
    readonly viewport?: "mobile" | "desktop" | "both";
    /**
     * Suppress the popover's pointer arrow per breakpoint. Useful
     * when the popover sits INSIDE the spotlit area on one
     * viewport but BESIDE it on another — the arrow's job is
     * "this popover is talking about that element over there", so
     * it only makes sense when the popover is outside the
     * spotlight. The `firstSuggestion` step is the example: on
     * desktop the popover sits inside the wide checklist
     * spotlight, so the arrow has nothing meaningful to point at;
     * on mobile the popover sits above the BottomNav Checklist
     * tab, so the arrow IS pointing at something useful.
     *
     * Defaults to `{ mobile: false, desktop: false }` — arrow
     * shown on both viewports. Either key is independently
     * optional.
     */
    readonly hideArrow?: {
        readonly mobile?: boolean;
        readonly desktop?: boolean;
    };
    /**
     * When `true`, the tour step lets the user keep interacting with
     * the page beneath it. Implementation: the dim backdrop drops its
     * `pointer-events`, the spotlight drops its click-absorbing
     * `pointer-events: auto` and its `0 0 0 9999px rgba(0,0,0,0.45)`
     * darkening shadow (just the accent ring stays), and the
     * keyboard-isolation effect skips its `stopPropagation +
     * preventDefault` branch so the page's own keyboard handlers run.
     *
     * Use for "informational" steps that don't actively orchestrate
     * page state — the Setup welcome, the sharing-tour callouts, the
     * `firstSuggestion` post-event acknowledgement. Do NOT use for the
     * checklist-cell walkthrough: the tour programmatically opens the
     * cell, and a misclick into the page would close it.
     *
     * Esc still dismisses the tour regardless of this flag — the
     * Escape key path runs above the gate.
     */
    readonly nonBlocking?: boolean;
    /**
     * When set, the popover hides its "Next" / "Finish" button and
     * waits for the user to perform `event` on an element matching
     * `anchor`. Once that event fires, the tour advances to the next
     * step. The spotlight on `anchor` is also rendered with
     * `pointer-events: none` so the click reaches the underlying
     * element — the user's click triggers the element's native
     * behavior (selecting a tab, opening a cell) AND advances the
     * tour at the same time.
     *
     * Used for steps where the tour explicitly wants the user to
     * exercise an affordance ("tap Checklist to switch panes", "click
     * a cell to see the breakdown") rather than passively read.
     */
    readonly advanceOn?: {
        readonly event: "click";
        readonly anchor: string;
    };
    /**
     * When `true`, the Toolbar's overflow menu (desktop) and the
     * BottomNav's overflow menu (mobile) both force-open while this
     * step is active. Decouples "show the menu open" from
     * `anchor === "overflow-menu"`, which only worked when the
     * spotlight was on the menu itself — useful for steps that
     * spotlight a SPECIFIC menu item (e.g. "Invite a player") while
     * keeping the surrounding menu open.
     */
    readonly forceOpenOverflowMenu?: boolean;
}

/**
 * Tour registry.
 *
 * - `setup`: a single non-blocking welcome popover. The setup wizard
 *   is largely self-explanatory after the recent rework
 *   (accordion + sticky footer + per-step validation banners), so the
 *   tour's job is just to orient a brand-new visitor and tell them
 *   the menu is the way back later. The user can interact with the
 *   wizard at the same time.
 * - `checklistSuggest`: the heart of the tour system. Walks the user
 *   through the two-halves layout (deduction grid + suggestion log),
 *   *opens a cell* programmatically so the explanation panel is on
 *   screen, calls out each of its three named sections — DEDUCTIONS,
 *   LEADS, HYPOTHESIS — then closes the cell to introduce the case
 *   file column, and finally walks the Suggest pane (prior log +
 *   add form). The cell-open is driven by `Checklist.tsx` watching
 *   `useTour().currentStep.anchor` for one of the explanation-section
 *   tokens; it auto-closes when the tour moves on.
 * - `firstSuggestion`: single-step acknowledgement after the user
 *   logs their first suggestion. Non-blocking so they keep their
 *   flow.
 * - `sharing`: three callouts for share affordances on the Setup
 *   pane. Non-blocking so the user can scroll setup alongside.
 *
 * `account` and `shareImport` remain reserved placeholders.
 */
export const TOURS: Record<ScreenKey, ReadonlyArray<TourStep>> = {
    setup: [
        {
            // Welcome step. Anchored to the wizard header (the
            // "Setup wizard" h2 + subheading) so the spotlight rings a
            // small, top-of-page element and the popover has somewhere
            // to land. The whole accordion is too tall to anchor the
            // popover against — Radix's collision detection ends up
            // pushing the popover above the visible viewport.
            //
            // Non-blocking so the user can read the popover AND start
            // working the wizard (typing into name inputs, picking a
            // pack, etc.) at the same time.
            anchor: "setup-wizard-header",
            titleKey: "setup.welcome.title",
            bodyKey: "setup.welcome.body",
            side: "bottom",
            align: "start",
            sideByViewport: {
                mobile: { side: "bottom", align: "center" },
                desktop: { side: "bottom", align: "start" },
            },
            nonBlocking: true,
        },
        {
            // Step 2: open the overflow menu and show the user where
            // Game setup lives, so they have a concrete "this is how I
            // come back" cue before they start playing. The same
            // callout fires on step 1 of `checklistSuggest` too —
            // teaching it from both directions (forward from setup,
            // back from the checklist) is intentional repetition.
            //
            // `anchor: "overflow-menu"` is observed by Toolbar +
            // BottomNav, which force-open the menu while this step is
            // active. `popoverAnchorPriority: "last-visible"` binds
            // the popover to the open menu's portaled content rather
            // than the trigger button.
            anchor: "overflow-menu",
            popoverAnchorPriority: "last-visible",
            titleKey: "setup.menu.title",
            bodyKey: "setup.menu.body",
            side: "left",
            align: "start",
            sideByViewport: {
                // Mobile menu opens UP from the BottomNav, so the
                // popover sits ABOVE the menu (side: top).
                mobile: { side: "top", align: "end" },
                // Desktop menu opens DOWN from the top-right Toolbar
                // trigger, so the popover sits to the LEFT.
                desktop: { side: "left", align: "start" },
            },
            finishLabelKey: "gotIt",
        },
    ],
    checklistSuggest: [
        {
            // Step 1: open the overflow menu and call out "Game
            // setup" so the user has a concrete affordance for
            // returning to the wizard later.
            anchor: "overflow-menu",
            popoverAnchorPriority: "last-visible",
            forceOpenOverflowMenu: true,
            titleKey: "checklist.menu.title",
            bodyKey: "checklist.menu.body",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
            requiredUiMode: "checklist",
        },
        {
            // Step 2 (desktop): Two halves — multi-spotlight on the
            // checklist column AND the suggestion log column. The
            // `two-halves-spotlight` token is on BOTH wrappers, so
            // `findAnchorElements` returns 2 elements and the
            // spotlight renderer paints two separate rings (one per
            // column) instead of a single union covering the gap.
            //
            // Popover anchors to the small case-file summary so it
            // doesn't get pushed off-screen against the columns.
            anchor: "two-halves-spotlight",
            popoverAnchor: "checklist-case-file",
            titleKey: "checklist.intro.title",
            bodyKey: "checklist.intro.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
            viewport: "desktop",
        },
        {
            // Step 2 (mobile): "Tap Checklist to begin". The mobile
            // viewport only shows ONE pane at a time, so we can't
            // multi-spotlight the columns. Instead we teach the
            // BottomNav gesture — highlight the Checklist tab and
            // require the user to tap it. The same advance-on-tap
            // pattern is reused before the Suggest pane.
            //
            // The user is already on the Checklist pane (uiMode is
            // already "checklist" from the overflow-menu step's
            // requiredUiMode), so tapping the tab is a no-op
            // dispatch + tour advance. The tap teaches the gesture
            // they'll need for the Suggest transition later.
            anchor: "bottom-nav-checklist",
            advanceOn: { event: "click", anchor: "bottom-nav-checklist" },
            titleKey: "checklist.tapChecklist.title",
            bodyKey: "checklist.tapChecklist.body",
            side: "top",
            align: "center",
            requiredUiMode: "checklist",
            viewport: "mobile",
        },
        {
            // Cell intro + click prompt. Spotlights the single first
            // cell (`checklist-cell` is only on row 0, col 0 — see
            // Checklist.tsx). Body explains what a cell is and asks
            // the user to tap it. `advanceOn: click` advances the
            // tour the moment the user clicks; the cell's own click
            // handler ALSO fires, opening the explanation row that
            // the next step anchors against.
            anchor: "checklist-cell",
            advanceOn: { event: "click", anchor: "checklist-cell" },
            titleKey: "checklist.cellIntro.title",
            bodyKey: "checklist.cellIntro.body",
            side: "bottom",
            align: "center",
            sideByViewport: {
                mobile: { side: "bottom", align: "center" },
                desktop: { side: "right", align: "center" },
            },
            requiredUiMode: "checklist",
        },
        {
            // DEDUCTIONS — first of three sections inside the
            // cell-explanation panel. The user has just clicked the
            // cell to open the panel; if they somehow close it
            // before this step renders, the anchor won't resolve and
            // the popover falls back to its default position.
            //
            // Popover side: bottom — DEDUCTIONS sits at the top of
            // the explanation row (full-width on desktop, top of
            // the vertical stack on mobile), so the popover goes
            // BELOW the section and the user can read the section +
            // popover in reading order.
            anchor: "cell-explanation-deductions",
            titleKey: "checklist.deductions.title",
            bodyKey: "checklist.deductions.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            // LEADS — second section.
            anchor: "cell-explanation-leads",
            titleKey: "checklist.leads.title",
            bodyKey: "checklist.leads.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            // HYPOTHESIS — third section. Popover side: bottom
            // because the auto-scroll centers the section in the
            // viewport and there's room below. A side: top popover
            // ran off the viewport top in testing because the
            // auto-scroll positioned HYPOTHESIS near the top edge.
            anchor: "cell-explanation-hypothesis",
            titleKey: "checklist.hypothesis.title",
            bodyKey: "checklist.hypothesis.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // Case file — the explanation row may still be open from
            // the previous steps, which is fine: the case-file
            // summary sits ABOVE the cell-explanation row in the
            // page layout, so the spotlight rings it cleanly. The
            // copy says "section" (not "column") because the
            // case-file widget isn't a column in any layout sense —
            // it's a horizontal summary above the player columns.
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // Step 9 (desktop): Suggest pane intro. The suggestion
            // log lives in the right column. Popover anchors to a
            // small header element so it stays stable against the
            // tall column.
            anchor: "desktop-suggest-area",
            popoverAnchor: "suggest-add-form-header",
            titleKey: "suggest.intro.title",
            bodyKey: "suggest.intro.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
            viewport: "desktop",
        },
        {
            // Step 9 (mobile): "Tap Suggest to switch to that pane".
            // Required for mobile because the suggest pane isn't
            // visible — the user has to swap. Same advance-on-tap
            // pattern as step 2-mobile.
            //
            // requiredUiMode stays "checklist" because the user is
            // currently on the checklist pane. Tapping Suggest fires
            // both the BottomNav onClick (setUiMode "suggest") AND
            // the tour advance — the next step's requiredUiMode is
            // "suggest" and that dispatch is now a no-op.
            anchor: "bottom-nav-suggest",
            advanceOn: { event: "click", anchor: "bottom-nav-suggest" },
            titleKey: "suggest.tapSuggest.title",
            bodyKey: "suggest.tapSuggest.body",
            side: "top",
            align: "center",
            requiredUiMode: "checklist",
            viewport: "mobile",
        },
        {
            // Prior log — sits below the add form. Popover above so
            // it doesn't push off the page bottom on tall logs.
            anchor: "suggest-prior-log",
            titleKey: "suggest.priorLog.title",
            bodyKey: "suggest.priorLog.body",
            side: "top",
            align: "start",
            requiredUiMode: "suggest",
        },
        {
            // Wrap-up + CTA. Spotlight rings the whole add form;
            // popover anchors to the small form header so positioning
            // is stable. See the long comment in the previous tour
            // version for why the popover ends up INSIDE the
            // spotlight here (form taller than available external
            // space on both viewports).
            anchor: "suggest-add-form",
            popoverAnchor: "suggest-add-form-header",
            titleKey: "suggest.addForm.title",
            bodyKey: "suggest.addForm.body",
            side: "bottom",
            align: "center",
            sideByViewport: {
                desktop: { side: "bottom", align: "center" },
                mobile: { side: "bottom", align: "center" },
            },
            requiredUiMode: "suggest",
            finishLabelKey: "startPlaying",
        },
    ],
    /**
     * Event-triggered one-step popover after the user logs their
     * first suggestion in any game. Non-blocking so the post-tour
     * moment (they just submitted; the deduction grid just updated)
     * stays interactive.
     */
    firstSuggestion: [
        {
            anchor: "first-suggestion-checklist",
            anchorByViewport: {
                mobile: "bottom-nav-checklist",
                desktop: "desktop-checklist-area",
            },
            popoverAnchor: "checklist-case-file",
            titleKey: "firstSuggestion.checklist.title",
            bodyKey: "firstSuggestion.checklist.body",
            side: "top",
            align: "center",
            sideByViewport: {
                mobile: { side: "top", align: "center" },
                desktop: { side: "bottom", align: "start" },
            },
            finishLabelKey: "gotIt",
            // Desktop popover lives INSIDE the wide checklist
            // spotlight, so the arrow has nothing meaningful to
            // point at — hide it. Mobile popover sits ABOVE the
            // BottomNav tab, outside its spotlight — arrow stays.
            hideArrow: { desktop: true },
            nonBlocking: true,
        },
    ],
    /**
     * Follow-up tour for sharing affordances. The previous version
     * pointed at a per-pack pill share button + a setup invite link,
     * both of which moved during the M22 rework. The new design opens
     * the overflow menu and walks the user through the three sharing
     * affordances that live there:
     *   - Invite a player (set someone else up with their own solver)
     *   - Continue on another device (move your in-progress game)
     *   - My card packs (save + share custom decks)
     *
     * All four steps force the menu open via `forceOpenOverflowMenu`
     * and spotlight a specific menu item via the new
     * `menu-item-*` anchors emitted by `OverflowMenu`'s per-item
     * tour-anchor prop. The popover sits to the left of the menu on
     * desktop (menu opens DOWN from the top-right Toolbar trigger)
     * and ABOVE the menu on mobile (menu opens UP from the BottomNav
     * trigger).
     */
    sharing: [
        {
            // Step 1 — "Invite a player" callout.
            anchor: "menu-item-invite-player",
            forceOpenOverflowMenu: true,
            titleKey: "sharing.invite.title",
            bodyKey: "sharing.invite.body",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
        },
        {
            // Step 2 — "Continue on another device" callout.
            anchor: "menu-item-transfer-device",
            forceOpenOverflowMenu: true,
            titleKey: "sharing.transfer.title",
            bodyKey: "sharing.transfer.body",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
        },
        {
            // Step 3 — "My card packs" callout. This is the only
            // menu item that opens a modal (the Account modal),
            // where the user can save / share / rename / delete
            // custom card packs. The body copy mentions that you
            // can share packs from there too — wrapping the share
            // story into a single tour rather than threading a
            // share-a-pack callout into the checklistSuggest tour.
            anchor: "menu-item-my-card-packs",
            forceOpenOverflowMenu: true,
            titleKey: "sharing.myCardPacks.title",
            bodyKey: "sharing.myCardPacks.body",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
            finishLabelKey: "gotIt",
        },
    ],
    // Reserved for M7 / M9 — no content yet.
    account: [],
    shareImport: [],
};

/**
 * Some tours don't fire until other tours have already been seen. Each
 * key's value lists the tours whose `lastDismissedAt` must be defined
 * before this tour is eligible. Read by `StartupCoordinator` (which
 * walks `TOUR_PRECEDENCE` to pick what fires at boot) and by the
 * `TourScreenGate` (which picks which tour to gate against on each
 * uiMode).
 *
 * `sharing` waits for both `setup` and `checklistSuggest` so a brand-
 * new user gets the foundational tours first; only after they've been
 * around the app once does the share-affordances callout fire.
 */
export const TOUR_PREREQUISITES: Partial<
    Record<ScreenKey, ReadonlyArray<ScreenKey>>
> = {
    sharing: ["setup", "checklistSuggest"],
};
