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
     * Viewport-conditional override for `popoverAnchor`. Like
     * `anchorByViewport` (which selects a different spotlight anchor
     * per breakpoint), this picks a different popover anchor per
     * breakpoint when the natural target differs across layouts.
     * Used by the M3 closer step where the desktop popover anchors
     * to the first suggestion pill (popover sits to the left, clear
     * of the form) while the mobile popover anchors to the form
     * header (popover sits below it, inside the form spotlight).
     *
     * Resolution order: `popoverAnchorByViewport[viewport]` →
     * `popoverAnchor` → spotlight `anchor`. SSR / test paths fall
     * back to `popoverAnchor` (then `anchor`) when matchMedia
     * isn't available.
     */
    readonly popoverAnchorByViewport?: {
        readonly mobile?: string;
        readonly desktop?: string;
    };
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
    /**
     * When `true`, multi-element anchors render as SEPARATE rings —
     * one per matched DOM node — instead of a single union rect.
     * Used for the desktop "Two halves work together" step where the
     * spotlight needs to call out two distinct columns; without this
     * opt-in, the default behavior unions matched elements into one
     * rect (so e.g. the overflow-menu step's trigger + portaled menu
     * read as one cohesive shape, and its dim veil paints normally).
     *
     * Multi-spotlight steps skip the dim veil — the box-shadow
     * "outer-darkening" approach can't cut multiple holes out of the
     * surrounding darkness, so we accept ring-only rendering and let
     * the popover carry the user's attention.
     */
    readonly multiSpotlight?: boolean;
}

/**
 * Tour registry.
 *
 * - `setup`: a three-step orientation. Welcome → overflow-menu
 *   callout → "Get started by picking a card pack" (spotlights the
 *   first wizard step). Orientation lands first, then the "come back
 *   here later" affordance, then the concrete first action — the
 *   closer doubles as a nudge into the work. The wizard is largely
 *   self-explanatory after the M6 rework (accordion + sticky footer
 *   + per-step validation banners), so the tour's job is to orient a
 *   brand-new visitor and tell them the menu is the way back later.
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
 *   logs their first suggestion. Anchors to the deduction grid so
 *   the user sees what their suggestion produced.
 * - `sharing`: three callouts for share affordances inside the
 *   overflow menu (invite a player, transfer to another device, my
 *   card packs).
 * - `account`: walks the My card packs section of the Account modal.
 *   Event-triggered like `firstSuggestion` — fires on signed-in
 *   modal mount, gated by the same 4-week dormancy. The modal is
 *   pushed with `dismissOnOutsideClick: false` when the gate is
 *   fresh so a backdrop tap (or iOS ghost click) can't drop the
 *   modal out from under the walkthrough.
 *
 * Every step blocks page interaction by default — the dim veil
 * absorbs clicks and the keyboard isolator swallows non-Esc keys.
 * Steps that need the user to actively click an element on the page
 * use `advanceOn` to whitelist that one element; the rest of the
 * page stays blocked.
 *
 * `shareImport` remains a reserved placeholder.
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
            // Blocking like every other tour step: the user reads,
            // dismisses, then drives the wizard. Letting the wizard
            // accept input alongside the popover meant a stray Tab or
            // Enter could fire a wizard action mid-tour — a
            // mis-orientation the welcome step is supposed to prevent.
            anchor: "setup-wizard-header",
            titleKey: "setup.welcome.title",
            bodyKey: "setup.welcome.body",
            side: "bottom",
            align: "start",
            sideByViewport: {
                mobile: { side: "bottom", align: "center" },
                desktop: { side: "bottom", align: "start" },
            },
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
        },
        {
            // Step 3 (closer): spotlight the first wizard step (Pick a
            // card pack) so the brand-new user has a concrete starting
            // move after the orientation. The whole section gets the
            // spotlight (header + helper text + pill row) but the
            // POPOVER anchors to the small pill row inside
            // (`setup-step-cardpack-pills`), which sits in the lower
            // half of the section — that gives Radix a small element to
            // position against and leaves room for the popover above
            // the pills (popover top stays on-screen on short viewports
            // where the panel itself is taller than the visible
            // viewport).
            //
            // Anchor token is emitted by SetupStepPanel as
            // `setup-wizard-step-<stepId>`; the cardPack step's wrapper
            // section thus carries `setup-wizard-step-cardPack`.
            anchor: "setup-wizard-step-cardPack",
            popoverAnchor: "setup-step-cardpack-pills",
            titleKey: "setup.cardPack.title",
            bodyKey: "setup.cardPack.body",
            side: "bottom",
            align: "center",
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
            // `two-halves-spotlight` token is on BOTH wrappers, and
            // `multiSpotlight: true` opts this step into per-element
            // rendering (one ring per column) rather than the default
            // union behavior.
            //
            // Popover anchors to `two-halves-divider`, a 0-sized
            // sentinel sitting in the gap between the two columns
            // (added by `DesktopPlayLayout`), so the popover centers
            // horizontally on the visual border between the halves.
            // The body copy uses `<columns><left></left><right></right>`
            // tags so the two descriptions sit side-by-side beneath
            // the title — mirroring the two columns being spotlit.
            // The dim veil is skipped on multi-spotlight steps (the
            // box-shadow approach can't cut multiple cutouts), so the
            // popover carries the user's attention.
            anchor: "two-halves-spotlight",
            multiSpotlight: true,
            popoverAnchor: "two-halves-divider",
            titleKey: "checklist.intro.title",
            bodyKey: "checklist.intro.body",
            side: "bottom",
            align: "center",
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
            // Whole-panel overview. The user just tapped the cell
            // to open the explanation panel; this step zooms out to
            // introduce the panel as a whole BEFORE walking the
            // three sections inside it. Spotlight covers the entire
            // explanation row (`cell-explanation-panel` on the
            // explanation `<td>`).
            //
            // Panel must be OPEN on entry. The Checklist's tour-
            // driven effect for `checklist-cell` (cellIntro)
            // already opened it via the native click listener; this
            // step doesn't reset cell state, so the panel stays
            // open across the transition. `tourKeepsCellOpen`
            // covers this anchor too, so a stray click (ghost click
            // or backdrop tap) can't close the panel.
            anchor: "cell-explanation-panel",
            titleKey: "checklist.panelIntro.title",
            bodyKey: "checklist.panelIntro.body",
            side: "bottom",
            align: "center",
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
            // Tap the cell again to close the panel. Anchored to the
            // `checklist-cell-close` token (a sibling of
            // `checklist-cell` on the same (0,0) cell) so the
            // Checklist's tour-driven effect can differentiate
            // open-intent (cellIntro) from close-intent (this step)
            // — the entry effect opens the cell here, and installs a
            // native click listener that closes the cell on tap. The
            // tour's advance-on-click listener fires alongside.
            //
            // Ordered BEFORE caseFile so the user dismisses the
            // explanation panel here, and the case-file step shows
            // with the grid fully visible (no explanation row in the
            // way of the player columns just below the case-file
            // summary).
            //
            // tourKeepsCellOpen is INTENTIONALLY false on this anchor
            // so the cell's onClick + outside-click handler don't
            // suppress the close — we WANT the user's tap to close.
            anchor: "checklist-cell-close",
            advanceOn: { event: "click", anchor: "checklist-cell-close" },
            titleKey: "checklist.cellClose.title",
            bodyKey: "checklist.cellClose.body",
            side: "bottom",
            align: "center",
            sideByViewport: {
                mobile: { side: "bottom", align: "center" },
                desktop: { side: "right", align: "center" },
            },
            requiredUiMode: "checklist",
        },
        {
            // Case file — comes AFTER cellClose so the explanation
            // panel is dismissed by this point; the case-file
            // summary sits above the player columns and reads
            // cleanly without the explanation row spilling beneath
            // it. The copy says "section" (not "column") because
            // the case-file widget isn't a column in any layout
            // sense — it's a horizontal summary above the player
            // columns.
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // Step 9 (desktop): Suggest pane intro. The suggestion log
            // lives in the right column. Popover anchors to the column
            // wrapper itself with `side: "left", align: "center"` so
            // it sits to the LEFT of the suggest log, pointing at the
            // center of its left edge — clear of every form control
            // inside the column. The arrow on the popover's right
            // edge points back into the suggestion log.
            anchor: "desktop-suggest-area",
            popoverAnchor: "desktop-suggest-area",
            titleKey: "suggest.intro.title",
            bodyKey: "suggest.intro.body",
            side: "left",
            align: "center",
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
            // Wrap-up + CTA. Spotlight rings the whole add form.
            //
            // Desktop: popover anchors to the Suggester pill
            // (`suggest-first-pill` — the first input the user will
            // fill in) and sits to the LEFT of it so the popover
            // doesn't occlude any of the form controls. The arrow on
            // the popover's right edge points back at the first pill.
            //
            // Mobile: popover anchors to the small form header and
            // sits below the form's tab header, INSIDE the spotlight
            // — the form is taller than the room available outside it
            // on phone-height viewports, so an external popover gets
            // clipped. The arrow points into the form's tab header.
            anchor: "suggest-add-form",
            popoverAnchorByViewport: {
                desktop: "suggest-first-pill",
                mobile: "suggest-add-form-header",
            },
            titleKey: "suggest.addForm.title",
            bodyKey: "suggest.addForm.body",
            side: "bottom",
            align: "center",
            sideByViewport: {
                desktop: { side: "left", align: "center" },
                mobile: { side: "bottom", align: "center" },
            },
            requiredUiMode: "suggest",
            finishLabelKey: "startPlaying",
        },
    ],
    /**
     * Event-triggered one-step popover after the user logs their
     * first suggestion in any game. Blocking like every other tour
     * step — the post-event moment is meant to draw the user's eye
     * back to the grid; if they could keep clicking, a misclick
     * elsewhere would steal focus from what the popover is pointing at.
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
    /**
     * Event-triggered tour for the My Card Packs section of the
     * Account modal. Fires the first time a signed-in user opens the
     * modal (the trigger lives in `AccountModal.tsx` itself — modal
     * mount = "modal just opened"), then locks for 4 weeks via the
     * standard `lastDismissedAt` gate.
     *
     * Walks five callouts inside the modal:
     *   1. Intro on the My card packs section header.
     *   2. Sync now button — push local changes / pull remote ones.
     *   3-5. The Share / Rename / Delete actions on the first pack
     *        row. These rely on a pack existing; empty-state users
     *        see the auto-skip path (steps 3-5 silently drop because
     *        their anchors aren't mounted).
     *
     * All five steps are passive Next-button callouts — no
     * advance-on-click — so the native-DOM-listener gotcha for
     * touch advance-on-click doesn't apply. The modal stays open
     * across all five steps via `AccountProvider`'s
     * `dismissOnOutsideClick: false` push when the gate is fresh,
     * which is the modal analog of `tourKeepsCellOpen` in
     * Checklist.tsx — it prevents iOS ghost clicks on the backdrop
     * from collapsing the modal out from under the walkthrough.
     */
    account: [
        {
            // Intro — spotlights the whole My card packs section.
            anchor: "account-my-card-packs",
            titleKey: "account.myCardPacks.title",
            bodyKey: "account.myCardPacks.body",
            side: "bottom",
            align: "center",
        },
        {
            // Sync now button in the section header.
            anchor: "account-sync-now",
            titleKey: "account.syncNow.title",
            bodyKey: "account.syncNow.body",
            side: "bottom",
            align: "end",
        },
        {
            // Share on the first pack row. Auto-skips for empty-state
            // users (no rows = no anchor).
            anchor: "account-pack-share",
            titleKey: "account.sharePack.title",
            bodyKey: "account.sharePack.body",
            side: "bottom",
            align: "end",
        },
        {
            // Rename on the first pack row.
            anchor: "account-pack-rename",
            titleKey: "account.renamePack.title",
            bodyKey: "account.renamePack.body",
            side: "bottom",
            align: "end",
        },
        {
            // Delete on the first pack row. Wrap-up CTA.
            anchor: "account-pack-delete",
            titleKey: "account.deletePack.title",
            bodyKey: "account.deletePack.body",
            side: "bottom",
            align: "end",
            finishLabelKey: "gotIt",
        },
    ],
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
