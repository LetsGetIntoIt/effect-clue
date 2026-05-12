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
            // Single welcome step. Anchored to the wizard header (the
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
            finishLabelKey: "gotIt",
        },
    ],
    checklistSuggest: [
        {
            // Intro: establish the two-halves mental model. Mobile
            // spotlight points at the BottomNav Checklist tab; desktop
            // spotlight covers the entire Checklist column. The popover
            // anchors to a small element (the Case file summary) so
            // it doesn't get pushed off-screen against a wide column.
            anchor: "desktop-checklist-area",
            anchorByViewport: {
                mobile: "bottom-nav-checklist",
                desktop: "desktop-checklist-area",
            },
            popoverAnchor: "checklist-case-file",
            titleKey: "checklist.intro.title",
            bodyKey: "checklist.intro.body",
            side: "bottom",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "center" },
                desktop: { side: "bottom", align: "start" },
            },
            requiredUiMode: "checklist",
        },
        {
            // DEDUCTIONS — the first of three sections inside the
            // cell-explanation panel. The Checklist component reacts
            // to this anchor by programmatically opening a
            // deterministic cell (first player column, first card of
            // the first category), so the panel is on screen for the
            // popover to land against. The same cell stays open
            // through the LEADS and HYPOTHESIS steps, and closes when
            // the tour advances to the case-file step.
            //
            // Popover side: bottom on both viewports — DEDUCTIONS
            // sits at the top of the explanation row (full-width on
            // desktop, top of the vertical stack on mobile), so the
            // popover goes BELOW the section and the user can read
            // the section + popover in reading order. Tuned during
            // verification.
            anchor: "cell-explanation-deductions",
            titleKey: "checklist.deductions.title",
            bodyKey: "checklist.deductions.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            // LEADS — second section. Cell stays open from the
            // previous step. On mobile the section sits in the middle
            // of the vertical stack; on desktop it's the bottom-left
            // of a 2-column row. Popover defaults to side: bottom.
            anchor: "cell-explanation-leads",
            titleKey: "checklist.leads.title",
            bodyKey: "checklist.leads.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            // HYPOTHESIS — third section. Cell stays open. Last
            // section in the stack (mobile) / bottom-right of the
            // 2-column row (desktop). Popover side: bottom — the
            // auto-scroll centers the section in the viewport, so a
            // popover below has room. A side: top popover ran off the
            // viewport top in testing because the auto-scroll
            // positioned HYPOTHESIS near the top edge.
            anchor: "cell-explanation-hypothesis",
            titleKey: "checklist.hypothesis.title",
            bodyKey: "checklist.hypothesis.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // Case file — the cell auto-closes once the tour leaves
            // the explanation-section anchors (see
            // `tourWantsCellOpen` in Checklist.tsx). The Case file
            // column header is short + at the top-right of the
            // checklist on desktop and at the top of the visible
            // column on mobile, so a `side: "bottom"` popover stays
            // on screen.
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // Suggest pane intro. Mobile anchor = BottomNav Suggest
            // tab; desktop anchor = the sticky right column. Popover
            // anchored to the form header to keep placement stable
            // against a tall column.
            anchor: "desktop-suggest-area",
            anchorByViewport: {
                mobile: "bottom-nav-suggest",
                desktop: "desktop-suggest-area",
            },
            popoverAnchor: "suggest-add-form-header",
            titleKey: "suggest.intro.title",
            bodyKey: "suggest.intro.body",
            side: "top",
            align: "center",
            sideByViewport: {
                mobile: { side: "top", align: "center" },
                desktop: { side: "bottom", align: "end" },
            },
            requiredUiMode: "checklist",
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
            // Wrap-up + CTA. Spotlight rings the whole add form so
            // the user sees what they're about to interact with.
            // Popover anchors to the small form *header* (`suggest-
            // add-form-header`) rather than the form itself — the
            // form is taller than the available room above OR below
            // it on both viewports (~400-500px tall vs ~150px of
            // padding to the viewport edge), so an external popover
            // can't fit. Anchoring to the small header at the top of
            // the form with side: "bottom" parks the popover inside
            // the spotlight area, below the header, overlapping the
            // form's pills. Trade-off: the popover covers part of
            // the spotlight (rule #2 violation per CLAUDE.md) but
            // stays fully on-screen (rule #1 — hard requirement).
            // The user reads the popover, clicks "Start playing" to
            // dismiss and dive into the form.
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
     * Follow-up tour for sharing affordances on the Setup pane. Fires
     * on the next Setup visit after both setup and checklistSuggest
     * have been dismissed (see `TOUR_PREREQUISITES`). Non-blocking so
     * the user can scroll the wizard while the callouts walk.
     */
    sharing: [
        {
            // Share button on the FIRST pack pill (Classic by
            // default). Copy generalizes to "any pack" so the user
            // applies the lesson to their custom packs.
            anchor: "setup-share-pack-pill",
            titleKey: "sharing.pack.title",
            bodyKey: "sharing.pack.body",
            side: "bottom",
            align: "start",
            nonBlocking: true,
        },
        {
            // "Invite a player" link in the Game-setup intro card.
            anchor: "setup-invite-player",
            titleKey: "sharing.invite.title",
            bodyKey: "sharing.invite.body",
            side: "bottom",
            align: "end",
            nonBlocking: true,
        },
        {
            // Overflow menu — Toolbar / BottomNav force-open the
            // menu while this step is active
            // (`currentStep?.anchor === "overflow-menu"`).
            anchor: "overflow-menu",
            titleKey: "sharing.overflow.title",
            bodyKey: "sharing.overflow.body",
            popoverAnchorPriority: "last-visible",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
            finishLabelKey: "gotIt",
            nonBlocking: true,
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
