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
}

/**
 * Tour registry. Four screens — `setup`, `checklistSuggest`, and
 * placeholder entries `account` / `shareImport` reserved for M7 / M9.
 *
 * The combined `checklistSuggest` tour walks first across the
 * checklist (2 steps) then across the suggest pane (2 steps).
 * `requiredUiMode` flags the suggest-pane steps so the mobile
 * driver flips to the right pane before each.
 */
export const TOURS: Record<ScreenKey, ReadonlyArray<TourStep>> = {
    setup: [
        {
            anchor: "setup-card-pack",
            titleKey: "setup.cardPack.title",
            bodyKey: "setup.cardPack.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "setup-player-column",
            titleKey: "setup.players.title",
            bodyKey: "setup.players.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "setup-hand-size",
            titleKey: "setup.handSize.title",
            bodyKey: "setup.handSize.body",
            side: "bottom",
            align: "center",
        },
        {
            // Spotlight unions every cell in the first player column
            // (header + body cells). Popover anchors to the column
            // HEADER only — pinning to the full column would put the
            // popover off-screen on narrow viewports because Radix
            // tries to anchor against a tall rect.
            anchor: "setup-known-cell",
            popoverAnchor: "setup-known-cell-header",
            titleKey: "setup.knownCard.title",
            bodyKey: "setup.knownCard.body",
            // Per-viewport positioning:
            //   - desktop: sit to the RIGHT of the column header so
            //     the entire column stays visible. The setup table
            //     is wide enough on desktop that there's room.
            //   - mobile: sit BELOW the header (popover hangs into
            //     the column body, covering the top 2-3 rows). Side
            //     "right" doesn't fit on mobile because the column
            //     pushes near the right edge.
            side: "bottom",
            align: "center",
            sideByViewport: {
                desktop: { side: "right", align: "start" },
                mobile: { side: "bottom", align: "center" },
            },
        },
        {
            anchor: "overflow-menu",
            titleKey: "setup.overflow.title",
            bodyKey: "setup.overflow.body",
            // The trigger is in DOM order before the portaled menu
            // content; `last-visible` resolves to the OPEN dropdown
            // when it's present (which it is during this step, via
            // forceOpen). The popover lands beside the dropdown,
            // leaving both the trigger AND the menu items unobscured.
            //
            // The popover is too wide (~360px) to fit in the gap on
            // either SIDE of the menu on mobile (where the menu fills
            // most of the right column), so the side flips per
            // viewport:
            //   - desktop: menu opens DOWN from a TOP-right trigger;
            //     plenty of room to the LEFT → side:"left".
            //   - mobile: menu opens UP from a BOTTOM-right trigger;
            //     plenty of room ABOVE → side:"top", align:"end" so
            //     the popover hugs the menu's right edge and stays
            //     in-viewport on a 375 px viewport.
            popoverAnchorPriority: "last-visible",
            side: "left",
            align: "start",
            sideByViewport: {
                mobile: { side: "top", align: "end" },
                desktop: { side: "left", align: "start" },
            },
        },
        {
            anchor: "setup-start-playing",
            titleKey: "setup.start.title",
            bodyKey: "setup.start.body",
            // This CTA sits near the top of Setup. Keeping the
            // popover below the button avoids top-edge clipping when
            // the tour scrolls back up from a deeper table step,
            // especially on mobile where the header consumes a
            // meaningful chunk of the viewport.
            side: "bottom",
            align: "end",
        },
    ],
    checklistSuggest: [
        {
            // M10 — swap-discoverability intro. Establish the "two
            // halves" mental model before drilling into either side.
            // Mobile spotlight points at the BottomNav Checklist tab
            // (the swap target the user is currently on); desktop
            // spotlight covers the entire Checklist column. The
            // popover anchor falls back to a small element at the
            // top of the column on desktop (so the popover doesn't
            // get pushed off-screen against a wide column) — same
            // pattern as `firstSuggestion`.
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
            anchor: "checklist-cell",
            titleKey: "checklist.cell.title",
            bodyKey: "checklist.cell.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            // M10 — swap-discoverability second half. Mirror of the
            // intro step but spotlights the Suggest side. Mobile
            // anchor is the BottomNav Suggest tab (still visible
            // while the user is on checklist mode); desktop anchor
            // covers the sticky right column. Popover anchor on
            // desktop is the suggest form header — small element
            // at the top of the column for stable popover placement.
            //
            // Replaces the older mobile-only `gotoSuggest` wayfinding
            // step. The auto-swap to suggest pane still happens on
            // the NEXT step's `requiredUiMode: "suggest"` transition.
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
            // The user sees the suggestion log BEFORE we point at
            // the form to add the first one. Order matters —
            // landing on the form last lets the wrap-up step's
            // "Add the first suggestion of the game" CTA dovetail
            // straight into doing it.
            anchor: "suggest-prior-log",
            titleKey: "suggest.priorLog.title",
            bodyKey: "suggest.priorLog.body",
            side: "top",
            align: "start",
            requiredUiMode: "suggest",
        },
        {
            // Wrap-up step doubles as the call-to-action: "add the
            // first suggestion of the game". The `finishLabelKey`
            // override flips the next-button copy from generic
            // "Finish" to "Start playing" so the user reads it as
            // a continuation, not a chore.
            //
            // Spotlight + popover both anchor to the whole form so
            // the spotlight rings the user's target while the
            // popover stays OUTSIDE that target. On desktop the
            // form sits high in the right column so popover goes
            // above it; on mobile the form sits at the top of the
            // pane, so popover goes below it. Either way the
            // spotlight + popover don't overlap.
            anchor: "suggest-add-form",
            titleKey: "suggest.addForm.title",
            bodyKey: "suggest.addForm.body",
            side: "top",
            align: "end",
            sideByViewport: {
                desktop: { side: "top", align: "end" },
                mobile: { side: "bottom", align: "center" },
            },
            requiredUiMode: "suggest",
            finishLabelKey: "startPlaying",
        },
    ],
    /**
     * One-step popover that fires the first time the user logs a
     * suggestion in any game.
     *
     * Spotlight (`anchorByViewport`):
     *   - mobile: the BottomNav Checklist tab. The user is on the
     *     suggest pane post-submit; spotlight + popover prompt them
     *     to tap over to the checklist.
     *   - desktop: the WHOLE deduction grid wrapper
     *     (`desktop-checklist-area`). Both panes are visible; the
     *     spotlight rings the entire area where the user's
     *     attention should land. The exact details inside the grid
     *     don't matter — the user just needs a "look here" cue.
     *
     * Popover (`popoverAnchor`):
     *   - desktop: anchored to the case-file summary box
     *     (`checklist-case-file`) — small + well-positioned at the
     *     top of the checklist, so the popover sits below it
     *     comfortably. The popover lives INSIDE the spotlight area
     *     which is fine: nothing important is being obscured (the
     *     summary itself remains visible above the popover).
     *   - mobile: `checklist-case-file` doesn't exist on mobile
     *     (the checklist pane isn't mounted), so the popover falls
     *     back to the spotlight anchor — the BottomNav tab. Popover
     *     sits above the tab.
     *
     * Same 4-week re-engage cadence as the other tours via
     * `useTourGate`.
     */
    firstSuggestion: [
        {
            // `anchor` is a fallback for SSR + tests where matchMedia
            // hasn't run yet; `anchorByViewport` wins on the client.
            anchor: "first-suggestion-checklist",
            anchorByViewport: {
                mobile: "bottom-nav-checklist",
                desktop: "desktop-checklist-area",
            },
            // Popover anchors to the case-file summary on desktop
            // (small, top of the checklist). On mobile this token
            // resolves to no element, so the popover falls back to
            // the spotlight anchor (the BottomNav tab) via
            // `popoverMeasure`'s fallback path.
            popoverAnchor: "checklist-case-file",
            titleKey: "firstSuggestion.checklist.title",
            bodyKey: "firstSuggestion.checklist.body",
            side: "top",
            align: "center",
            sideByViewport: {
                mobile: { side: "top", align: "center" },
                desktop: { side: "bottom", align: "start" },
            },
            // Single-step tour ends with a "Got it" CTA — no
            // back-button context, just an acknowledgement.
            finishLabelKey: "gotIt",
            // Desktop: the popover sits INSIDE the wide checklist
            // spotlight, so the arrow has nothing meaningful to
            // point at — hide it. Mobile: the popover sits ABOVE
            // the BottomNav Checklist tab (outside the small
            // spotlight on the tab), so the arrow IS pointing at
            // something useful — keep it.
            hideArrow: { desktop: true },
        },
    ],
    /**
     * Follow-up tour that calls out the three ways to share. Fires on
     * the user's *next* visit to the Setup pane after they've already
     * dismissed the setup AND checklistSuggest tours — by then they
     * understand the app well enough to care about the share
     * affordances. See `TOUR_PREREQUISITES` below.
     *
     * Doesn't redirect: per `StartupCoordinator`'s `decideTourDispatch`
     * rule, only the setup tour pulls the user off their current
     * screen. If a returning user lands on /play?view=checklist, the
     * sharing tour waits for them to navigate to setup themselves.
     */
    sharing: [
        {
            // Anchored at the share button on the FIRST pack pill (Classic
            // by default). Popover phrases as "any pack" so the user
            // generalizes from the example to their custom packs.
            anchor: "setup-share-pack-pill",
            titleKey: "sharing.pack.title",
            bodyKey: "sharing.pack.body",
            side: "bottom",
            align: "start",
        },
        {
            // The "Invite a player" link beside Start playing in the
            // Game-setup intro card.
            anchor: "setup-invite-player",
            titleKey: "sharing.invite.title",
            bodyKey: "sharing.invite.body",
            side: "bottom",
            align: "end",
        },
        {
            // Same overflow-menu anchor + forceOpen wiring as the setup
            // tour's overflow step — Toolbar / BottomNav both observe
            // `currentStep?.anchor === "overflow-menu"` and open the
            // menu programmatically while this step is active.
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
