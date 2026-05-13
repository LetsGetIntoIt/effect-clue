/**
 * Renders the active onboarding tour step as a Radix Popover anchored
 * to the DOM node(s) carrying `data-tour-anchor="<step.anchor>"`.
 *
 * The popover lives in a portal at the document root and is
 * positioned via `Popover.Anchor virtualRef={...}` — meaning we don't
 * have to thread a `ref` through every component that's a tour
 * target. Each component that wants to be anchorable just adds
 * `data-tour-anchor="..."` to a stable DOM node and the tour finds
 * it on its own.
 *
 * **Multi-element anchors.** A step can target multiple elements:
 * `findAnchorElements` returns every node in the page carrying the
 * step's anchor token (via the CSS `~=` whitespace-list selector).
 * The popover's bounding rect and the spotlight rect are both the
 * UNION of all matched elements, so highlighting "the whole hand-size
 * row" is a matter of putting `data-tour-anchor="setup-hand-size"`
 * on every cell in the row.
 *
 * **Resize / scroll tracking.** The popover and spotlight follow the
 * anchor element(s) when the page scrolls, the window resizes, or
 * any anchor element resizes (via `ResizeObserver`). Without this,
 * a window resize would leave the popover floating where it started
 * while the page reflowed underneath it.
 *
 * Visual identity is intentionally distinct from the in-game UI —
 * the parchment/oxblood `InfoPopover` and `SplashModal` palette is
 * for game state; this is meta UI guiding the user through the app.
 * Blue accent + "Tour · Step N of M" header signal "this is a
 * walkthrough, not part of your game".
 *
 * Lookup runs on mount and on every step change. If no anchor node
 * is on the page (the user navigated away mid-tour, or the step
 * targets an element that hasn't mounted yet), we fall back to a
 * fixed position in the bottom-right of the viewport so the user
 * still sees the tour copy.
 *
 * Spotlight is a `fixed` `<div>` with a giant `box-shadow` painting
 * darkness OUTSIDE the box — punches a "hole" of sorts around the
 * anchor without needing an SVG mask or clip-path.
 */
"use client";

import * as Popover from "@radix-ui/react-popover";
import { Duration } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ProseChecklistIcon } from "../components/CellGlyph";
import { XIcon } from "../components/Icons";
import { Y, N } from "../../logic/Knowledge";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { suppressNextScrollRestore } from "../scrollMemory";
import { useClue } from "../state";
import {
    findAnchorElements,
    pickPopoverRect,
    resolveAnchorToken,
    resolveHideArrow,
    resolvePopoverAnchorToken,
    resolveSideAndAlign,
    unionRect,
} from "./popoverGeometry";
import { useTour } from "./TourProvider";

/**
 * Wrapper around `getBoundingClientRect()` that satisfies the shape
 * Radix's `virtualRef` expects. Returns a "virtual" element with a
 * `getBoundingClientRect` method.
 */
type VirtualElement = {
    readonly getBoundingClientRect: () => DOMRect;
};

// `KeyboardEvent.key` value for Escape. Module-scope so the
// `i18next/no-literal-string` rule doesn't flag the comparison.
const KEY_ESCAPE = "Escape" as const;
// Analytics discriminator for tour dismissal via Esc keypress.
const DISMISS_VIA_ESC = "esc" as const;
// How long a step must be on screen before tapping the backdrop
// advances the tour. The delay prevents accidental skip-throughs on
// stray taps right after a step appears.
const BACKDROP_ADVANCE_DELAY = Duration.seconds(2);
const SCROLL_BEHAVIOR_AUTO: ScrollBehavior = "auto";
// Attribute we add to the Radix Popover.Content so the keyboard
// isolator can do an O(1) `popoverContent.contains(eventTarget)` check
// to allow keyboard events that target the popover's own buttons.
const POPOVER_CONTENT_ATTR = "data-tour-popover-content" as const;
const TOUR_VIEWPORT_MARGIN = 48;
// Bounce keyframes for the action-prompt nudge. Vertical-only so the
// layout stays stable; tail damping (-4px on the second bounce)
// reads as physical bounce-decay. Driven via the Web Animations API
// (`el.animate(...)`) instead of a CSS class because CSS class
// toggling is unreliable for "restart an animation that already
// played" — browsers cache the completed state and skip the second
// run. WAAPI always creates a fresh animation, so each click of the
// disabled Next button gets a fresh bounce.
const TOUR_ACTION_BOUNCE_KEYFRAMES: Keyframe[] = [
    { transform: "translateY(0)" },
    { transform: "translateY(-8px)", offset: 0.3 },
    { transform: "translateY(0)", offset: 0.6 },
    { transform: "translateY(-4px)", offset: 0.75 },
    { transform: "translateY(0)" },
];
const TOUR_ACTION_BOUNCE_OPTIONS: KeyframeAnimationOptions = {
    duration: 550,
    easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
};
const TOUR_STICKY_LEFT_GAP = 16;
const TOUR_STICKY_LEFT_ATTR = "data-tour-sticky-left" as const;
const SCROLL_AXIS_X = "x" as const;
const SCROLL_AXIS_Y = "y" as const;

// `findAnchorElements`, `resolveAnchorToken`, `resolvePopoverAnchorToken`,
// `resolveSideAndAlign`, `unionRect`, and `pickPopoverRect` are now in
// `./popoverGeometry` so they can be unit-tested without mounting the
// full Radix popover tree.

const fallbackVirtualRect = (): DOMRect => {
    if (typeof window === "undefined") {
        return new DOMRect(0, 0, 0, 0);
    }
    // Bottom-right area of the viewport, so the popover floats
    // above the BottomNav (mobile) and away from the main grid.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = Math.max(w - 320, 16);
    const y = Math.max(h - 240, 16);
    return new DOMRect(x, y, 1, 1);
};

const clamp = (n: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, n));

const getStickyLeftClearance = (
    viewportHeight: number,
    targetRect: DOMRect,
): number => {
    if (typeof document === "undefined") return TOUR_VIEWPORT_MARGIN;
    let stickyRight = 0;
    const stickyEls = document.querySelectorAll<HTMLElement>(
        `[${TOUR_STICKY_LEFT_ATTR}]`,
    );
    for (const el of stickyEls) {
        const rect = el.getBoundingClientRect();
        const isVisible =
            rect.width > 0
            && rect.height > 0
            && rect.left < TOUR_VIEWPORT_MARGIN
            && rect.right > 0
            && rect.top < viewportHeight
            && rect.bottom > 0
            && rect.top < targetRect.bottom
            && rect.bottom > targetRect.top;
        if (isVisible && rect.right > stickyRight) {
            stickyRight = rect.right;
        }
    }
    return stickyRight > 0
        ? Math.max(TOUR_VIEWPORT_MARGIN, stickyRight + TOUR_STICKY_LEFT_GAP)
        : TOUR_VIEWPORT_MARGIN;
};

const isPageScroller = (el: HTMLElement): boolean =>
    typeof document !== "undefined"
    && (el === document.body || el === document.documentElement);

const pageMaxScroll = (axis: "x" | "y"): number => {
    if (typeof document === "undefined" || typeof window === "undefined") {
        return 0;
    }
    const body = document.body;
    const html = document.documentElement;
    const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
    const scrollSize = axis === "x"
        ? Math.max(body.scrollWidth, html.scrollWidth)
        : Math.max(body.scrollHeight, html.scrollHeight);
    return Math.max(0, scrollSize - viewport);
};

const maxScroll = (el: HTMLElement, axis: "x" | "y"): number => {
    if (isPageScroller(el)) return pageMaxScroll(axis);
    return axis === "x"
        ? Math.max(0, el.scrollWidth - el.clientWidth)
        : Math.max(0, el.scrollHeight - el.clientHeight);
};

const currentScroll = (el: HTMLElement, axis: "x" | "y"): number => {
    if (isPageScroller(el) && typeof window !== "undefined") {
        return axis === "x"
            ? Math.max(el.scrollLeft, window.scrollX)
            : Math.max(el.scrollTop, window.scrollY);
    }
    return axis === "x" ? el.scrollLeft : el.scrollTop;
};

const scrollPage = (
    el: HTMLElement,
    opts: ScrollToOptions,
): void => {
    el.scrollTo(opts);
    if (isPageScroller(el) && typeof window !== "undefined") {
        window.scrollTo(opts);
    }
};

export function TourPopover() {
    const t = useTranslations("onboarding");
    const tCommon = useTranslations("common");
    const {
        activeScreen,
        stepIndex,
        steps,
        currentStep,
        isLastStep,
        nextStep,
        prevStep,
        dismissTour,
    } = useTour();
    const { state, dispatch } = useClue();
    // Touch vs. mouse — picks the verb (`Tap` / `Click`) in
    // advance-on-click step prompts so the copy matches what the user
    // is about to physically do.
    const hasKeyboard = useHasKeyboard();

    // The virtualRef passed into Radix Popover. Each step recomputes
    // it via the effect below.
    const virtualElementRef = useRef<VirtualElement>({
        getBoundingClientRect: fallbackVirtualRect,
    });

    // Re-render whenever the anchor element changes (or repositions
    // due to a scroll / resize / DOM mutation) so Radix recomputes
    // the popover's position. We only bump the tick when the union
    // rect actually changed — bumping on every recompute makes Radix
    // remount the Content faster than Floating UI can settle a
    // measurement, which leaves the popper at a stale position.
    const [anchorTick, setAnchorTick] = useState(0);
    const lastUnionKeyRef = useRef("");

    // Step-driven uiMode dispatch. On mobile the checklist and suggest
    // panes don't co-exist, so a step that anchors inside the suggest
    // pane needs uiMode flipped before its anchor resolves. Desktop
    // renders both panes simultaneously so the dispatch is harmless.
    useEffect(() => {
        if (!currentStep?.requiredUiMode) return;
        if (state.uiMode === currentStep.requiredUiMode) return;
        // Set the suppression BEFORE the dispatch so it's in place
        // before React re-renders with the new uiMode and the per-
        // view restore effect (`src/ui/Clue.tsx`) fires. Otherwise
        // the restore (two rAFs ≈ 32ms) would override the tour's
        // own scroll-to-anchor and the popover would anchor offscreen.
        suppressNextScrollRestore(currentStep.requiredUiMode);
        dispatch({ type: "setUiMode", mode: currentStep.requiredUiMode });
    }, [currentStep, state.uiMode, dispatch]);

    // Spotlight rects — one per matched anchor element, so multi-
    // element anchors render as multiple separate rings rather than a
    // single union rect. This is what makes the "two halves" step on
    // desktop look like TWO separate spotlights (one on the checklist
    // column, one on the suggestion log) instead of a single rect
    // unioned across the gap between them.
    //
    // For single-element anchors, this is just an array of one rect.
    // Empty array means "no anchor matched" (the fallback path renders
    // a plain dark overlay instead of any rings).
    //
    // The auto-scroll logic still computes a single union rect to
    // decide what to scroll into view — bringing the whole spotlight
    // group on-screen at once.
    const [spotlights, setSpotlights] = useState<ReadonlyArray<DOMRect>>([]);

    // We auto-scroll the page once per step to bring the anchor into
    // view — anchors that live below the fold (like the hand-size
    // row when the table is tall) wouldn't otherwise be visible. The
    // ref tracks which step we've scrolled for so subsequent
    // recomputes (from the user scrolling, resizing, etc.) DON'T
    // re-scroll and fight with manual interaction.
    const scrolledForStepRef = useRef<{
        screen: string | undefined;
        step: number;
    }>({ screen: undefined, step: -1 });

    // Anchor resolution + reposition tracking. One effect handles all
    // four signals that should re-measure the anchor:
    //
    //   1. The step changed (different anchor name).
    //   2. The window scrolled (anchor moved relative to viewport).
    //   3. The window resized (anchor reflowed).
    //   4. The anchor element itself resized (e.g. a row gained a
    //      cell because the user added a player).
    //
    // Each signal triggers `recompute()` which:
    //   - Looks up matching elements
    //   - Builds the union rect
    //   - Updates the virtualRef + spotlight state
    //   - Bumps `anchorTick` so Radix re-runs Floating UI's positioning
    useEffect(() => {
        if (!activeScreen || !currentStep) {
            virtualElementRef.current = {
                getBoundingClientRect: fallbackVirtualRect,
            };
            setSpotlights([]);
            return;
        }

        const scrollSpotlightIntoView = (rect: DOMRect): boolean => {
            if (typeof window === "undefined") return false;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const margin = TOUR_VIEWPORT_MARGIN;
            const minVisibleLeft = clamp(
                getStickyLeftClearance(vh, rect),
                margin,
                Math.max(margin, vw - margin),
            );
            const maxVisibleRight = vw - margin;
            const inViewVertical =
                rect.top >= margin && rect.bottom <= vh - margin;
            const inViewHorizontal =
                rect.left >= minVisibleLeft
                && rect.right <= maxVisibleRight;
            if (inViewVertical && inViewHorizontal) return false;
            // The page splits scroll: vertical scroll lives on the
            // body when content overflows (the `min-w-max` <main> +
            // tall checklist make body's scrollHeight > clientHeight);
            // horizontal scroll also lives on body (per globals.css's
            // `html { overflow-x: clip } body { overflow-x: auto }`).
            // We compute the delta in viewport coords and apply it
            // directly to body's scroll, plus a window.scrollTo
            // fallback when the document itself is the scroller.
            //
            // For each axis: prefer to bring the rect's NEAR edge
            // into view with a margin. For unions wider/taller than
            // the viewport (e.g. a whole row of cells stretching
            // beyond the viewport), centering would push half the
            // union off the opposite edge. Aligning to the start
            // shows the leftmost / topmost cells with the rest
            // trailing off-screen — the user can still see what's
            // highlighted starts here.
            const dy = inViewVertical
                ? 0
                : rect.height + margin * 2 < vh
                    ? rect.top + rect.height / 2 - vh / 2
                    : rect.top - margin;
            const unobscuredWidth = maxVisibleRight - minVisibleLeft;
            const dx = inViewHorizontal
                ? 0
                : rect.width < unobscuredWidth
                    ? rect.left
                        + rect.width / 2
                        - (minVisibleLeft + unobscuredWidth / 2)
                    : rect.left - minVisibleLeft;
            const behavior: ScrollBehavior = SCROLL_BEHAVIOR_AUTO;
            const body = document.body;
            const html = document.documentElement;
            // Pick whichever element is actually scrollable for each
            // axis — checking `scrollHeight > clientHeight` or
            // `scrollWidth > clientWidth`. Falling through to window
            // for either axis covers the no-overflow case where no
            // scrolling is needed.
            const verticalEl =
                body.scrollHeight > body.clientHeight ? body : html;
            const horizontalEl =
                body.scrollWidth > body.clientWidth ? body : html;
            let didScroll = false;
            if (dy !== 0) {
                const currentTop = currentScroll(verticalEl, SCROLL_AXIS_Y);
                const top = clamp(
                    currentTop + dy,
                    0,
                    maxScroll(verticalEl, SCROLL_AXIS_Y),
                );
                if (top !== currentTop) {
                    scrollPage(verticalEl, { top, behavior });
                    didScroll = true;
                }
            }
            if (dx !== 0) {
                const currentLeft = currentScroll(horizontalEl, SCROLL_AXIS_X);
                const left = clamp(
                    currentLeft + dx,
                    0,
                    maxScroll(horizontalEl, SCROLL_AXIS_X),
                );
                if (left !== currentLeft) {
                    scrollPage(horizontalEl, { left, behavior });
                    didScroll = true;
                }
            }
            return didScroll;
        };

        const recompute = (): void => {
            const els = findAnchorElements(resolveAnchorToken(currentStep));
            if (els.length === 0) {
                virtualElementRef.current = {
                    getBoundingClientRect: fallbackVirtualRect,
                };
                setSpotlights([]);
                if (lastUnionKeyRef.current !== "") {
                    lastUnionKeyRef.current = "";
                    setAnchorTick(n => n + 1);
                }
                return;
            }
            // Capture the elements in a closure so subsequent calls
            // re-measure the same nodes — avoids re-running the
            // querySelectorAll on every frame.
            //
            // Spotlight renders ONE ring per matched element rather
            // than a single union rect — so the "two halves" step on
            // desktop shows two separate rings (checklist + suggest)
            // instead of a single union covering the gap between
            // them. For single-element anchors the array has one
            // entry, which renders identically to the old behavior.
            //
            // Popover positioning still anchors to a SINGLE element
            // (not the union). Two knobs select which:
            //   - `step.popoverAnchor` overrides the token (lets a
            //     step keep the spotlight on a wide region while
            //     pinning the popover to a small one — used for the
            //     intro steps where the spotlight covers a tall
            //     column but the popover anchors to a small header).
            //   - `step.popoverAnchorPriority` picks `first-visible`
            //     (default) or `last-visible` from the matched
            //     elements (used for the overflow-menu step where
            //     the portaled menu content appears AFTER the trigger
            //     in DOM order).
            const hasPopoverAnchorOverride =
                currentStep.popoverAnchor !== undefined
                || currentStep.popoverAnchorByViewport !== undefined;
            const popoverEls = hasPopoverAnchorOverride
                ? findAnchorElements(resolvePopoverAnchorToken(currentStep))
                : els;
            const spotlightMeasureAll = (): ReadonlyArray<DOMRect> =>
                els.map(el => el.getBoundingClientRect());
            const popoverMeasure = (): DOMRect => {
                // Prefer the popover's own anchor target (when set);
                // fall back to the spotlight elements if nothing
                // matched. This is what makes a per-viewport
                // popoverAnchor work — `firstSuggestion`'s
                // `popoverAnchor: "checklist-case-file"` only
                // resolves on desktop (the checklist pane is
                // mounted); on mobile the same token finds nothing
                // and we drop back to the spotlight elements
                // (`bottom-nav-checklist`).
                const fromPopover = pickPopoverRect(
                    popoverEls,
                    currentStep.popoverAnchorPriority,
                );
                if (fromPopover !== null) return fromPopover;
                return (
                    pickPopoverRect(
                        els,
                        currentStep.popoverAnchorPriority,
                    ) ?? fallbackVirtualRect()
                );
            };
            virtualElementRef.current = {
                getBoundingClientRect: popoverMeasure,
            };
            // Per-element rects (for `multiSpotlight: true` steps)
            // or a single union rect (the default). Auto-scroll
            // always uses the union below so the whole group lands
            // in view at once.
            const perElementRects = spotlightMeasureAll();
            const unionMeasured =
                unionRect([...perElementRects]) ?? fallbackVirtualRect();
            let measuredRects: ReadonlyArray<DOMRect> =
                currentStep.multiSpotlight === true
                    ? perElementRects
                    : [unionMeasured];
            // Auto-scroll at most once per step so anchors below the
            // fold (or off to the side on a horizontally-scrolling
            // page) come into view. This is deliberately instant:
            // tour popover positioning depends on stable viewport
            // geometry, and smooth scrolling leaves the spotlight and
            // Radix popper measuring a moving target.
            const scrollTracker = scrolledForStepRef.current;
            if (
                scrollTracker.screen !== activeScreen ||
                scrollTracker.step !== stepIndex
            ) {
                scrolledForStepRef.current = {
                    screen: activeScreen,
                    step: stepIndex,
                };
                if (scrollSpotlightIntoView(unionMeasured)) {
                    const reMeasured = spotlightMeasureAll();
                    measuredRects =
                        currentStep.multiSpotlight === true
                            ? reMeasured
                            : [
                                  unionRect([...reMeasured])
                                  ?? fallbackVirtualRect(),
                              ];
                }
            }
            setSpotlights(measuredRects);
            const measured =
                unionRect([...measuredRects]) ?? fallbackVirtualRect();
            // Bump the Radix-remount key only when the union rect
            // changed enough to matter (sub-pixel jitter doesn't
            // count). Bumping on every recompute would remount
            // Radix's Content faster than Floating UI's measurement
            // pipeline can settle a position, leaving the popper at
            // stale coords.
            const unionKey = `${Math.round(measured.x)},${Math.round(measured.y)},${Math.round(measured.width)},${Math.round(measured.height)}`;
            if (unionKey !== lastUnionKeyRef.current) {
                lastUnionKeyRef.current = unionKey;
                setAnchorTick(n => n + 1);
            }
        };

        recompute();
        // Re-run after the next two animation frames + a short
        // timeout to catch anchors that appear via React portals
        // mounted by the active step (e.g. the overflow menu opens
        // when its tour step is reached). The MutationObserver on
        // body subtree catches childList changes, but it sometimes
        // fires before the new anchor's `getBoundingClientRect`
        // returns its final size — these scheduled recomputes pick
        // up the settled rect.
        const settleTimers = [
            requestAnimationFrame(() => requestAnimationFrame(recompute)),
            window.setTimeout(recompute, 150) as unknown as number,
            window.setTimeout(recompute, 350) as unknown as number,
        ];

        // Wire the four reposition signals. Vertical scroll lives on
        // the document; horizontal scroll lives on `<body>` (per
        // `globals.css`'s split overflow rules). We listen on
        // `document` with `capture: true` so we catch scroll events
        // from either element AND from any nested overflow:auto
        // container the user has scrolled. Resize fires on window.
        const onScrollOrResize = (): void => recompute();
        document.addEventListener("scroll", onScrollOrResize, {
            passive: true,
            capture: true,
        });
        window.addEventListener("resize", onScrollOrResize);

        // ResizeObserver per matched element so we follow internal
        // resizes (e.g. the user typing in a hand-size input that
        // grows the cell). Observe BOTH the spotlight and popover
        // anchor sets — the popover anchor may be a different element
        // than the spotlight when `step.popoverAnchor` is set
        // (e.g. the player-column step's popover targets just the
        // header cell while the spotlight covers all body cells).
        const observedEls = new Set<HTMLElement>([
            ...findAnchorElements(resolveAnchorToken(currentStep)),
            ...findAnchorElements(resolvePopoverAnchorToken(currentStep)),
        ]);
        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined" && observedEls.size > 0) {
            observer = new ResizeObserver(() => recompute());
            for (const el of observedEls) observer.observe(el);
        }

        // MutationObserver on the body to catch anchors that
        // appear / disappear AFTER the step changes (e.g. the
        // overflow menu's content portal mounts when the menu
        // opens). Cheap because we only react to subtree changes
        // — and we throttle via rAF so a flurry of mutations
        // collapses into one recompute.
        let rafId = 0;
        const scheduleRecompute = (): void => {
            if (rafId !== 0) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                recompute();
            });
        };
        const mutationObserver = new MutationObserver(scheduleRecompute);
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => {
            document.removeEventListener(
                "scroll",
                onScrollOrResize,
                { capture: true } as EventListenerOptions,
            );
            window.removeEventListener("resize", onScrollOrResize);
            if (observer) observer.disconnect();
            mutationObserver.disconnect();
            if (rafId !== 0) cancelAnimationFrame(rafId);
            // Cancel the settle-recomputes scheduled at step start.
            // First entry is a rAF id; the rest are setTimeout ids.
            const [rafTimer, ...timeoutTimers] = settleTimers;
            if (rafTimer !== undefined) cancelAnimationFrame(rafTimer);
            for (const t of timeoutTimers) {
                if (t !== undefined) window.clearTimeout(t);
            }
        };
    }, [
        activeScreen,
        stepIndex,
        currentStep,
        state.uiMode,
    ]);

    // While a tour is active, the page beneath the veil is
    // keyboard-inert. App-level shortcuts (`⌘K`, `⌘Z`, the per-tab
    // "go to" shortcuts, etc.) listen at the window in BUBBLE phase;
    // we install a CAPTURE-phase listener so we run first and can
    // selectively swallow events.
    //
    //   - Escape dismisses the tour — unconditional.
    //   - Other keys: if the event target is inside the popover
    //     content (Tab between Back / Skip / Next, Enter to click),
    //     pass through; otherwise stopPropagation + preventDefault so
    //     the page beneath gets nothing.
    //
    // `capture: true` matters for collisions — bubble-phase listeners
    // we want to suppress fire AFTER us, so our `stopPropagation` is
    // load-bearing.
    useEffect(() => {
        if (!activeScreen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === KEY_ESCAPE) {
                e.stopPropagation();
                dismissTour(DISMISS_VIA_ESC);
                return;
            }
            const target = e.target;
            if (target instanceof Node) {
                const popoverContent = document.querySelector(
                    `[${POPOVER_CONTENT_ATTR}]`,
                );
                if (popoverContent && popoverContent.contains(target)) {
                    return;
                }
            }
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () =>
            window.removeEventListener("keydown", onKey, { capture: true });
    }, [activeScreen, dismissTour]);

    // Pull keyboard focus into the popover's "Next" button each time
    // a step becomes active. Without this, focus stays on whatever
    // element initiated the tour (usually a menu item or the document
    // body), so `Tab` would walk into the page beneath — already
    // suppressed by the keydown isolator above, but it FEELS off.
    // Focusing inside the popover anchors the user's keyboard intent
    // where the visual attention already is.
    const nextButtonRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        if (!activeScreen || !currentStep) return;
        // Defer to the next paint so Radix's portal mount completes
        // before we try to focus.
        const id = requestAnimationFrame(() => {
            nextButtonRef.current?.focus();
        });
        return () => cancelAnimationFrame(id);
    }, [activeScreen, stepIndex, currentStep]);

    // Tap-veil-to-advance failsafe. After a short delay (so the user
    // doesn't accidentally skip a step they just entered by tapping
    // the page during scroll-decay), the dim backdrop becomes
    // clickable and advances the tour to the next step (or finishes
    // it on the last step). This is the safety net for cases where
    // the popover renders off-screen due to a layout we didn't
    // anticipate — the user can always tap anywhere to escape.
    //
    // Disabled on advance-on-click steps: those route clicks through
    // to the spotlit anchor, so the backdrop is `pointer-events:
    // none` and a tap-to-advance handler on it wouldn't fire anyway.
    //
    // Esc remains the keyboard escape; this is the touch-friendly
    // equivalent for users without a keyboard.
    const [canAdvanceFromBackdrop, setCanAdvanceFromBackdrop] =
        useState(false);
    useEffect(() => {
        if (!activeScreen || !currentStep) return;
        setCanAdvanceFromBackdrop(false);
        const delay = Duration.toMillis(BACKDROP_ADVANCE_DELAY);
        const id = window.setTimeout(
            () => setCanAdvanceFromBackdrop(true),
            delay,
        );
        return () => window.clearTimeout(id);
    }, [activeScreen, stepIndex, currentStep]);

    // advance-on-click pattern. When the active step has `advanceOn`
    // set, the popover hides its Next button and we listen for clicks
    // on elements matching the `advanceOn.anchor` token. The first
    // such click advances the tour. The spotlight rendering further
    // down drops `pointer-events: auto` for advance-on-click steps so
    // the click reaches the underlying element — the user's tap fires
    // both the element's native handler (selecting a tab, opening a
    // cell) AND our listener.
    const advanceOn = currentStep?.advanceOn;
    useEffect(() => {
        if (!activeScreen || !advanceOn) return;
        const matches = findAnchorElements(advanceOn.anchor);
        if (matches.length === 0) return;
        const handler = (): void => nextStep();
        for (const el of matches) {
            el.addEventListener(advanceOn.event, handler);
        }
        return () => {
            for (const el of matches) {
                el.removeEventListener(advanceOn.event, handler);
            }
        };
        // Re-resolve elements when the step changes or the anchor
        // token swaps (advanceOn.anchor is part of the step config so
        // it changes with the step). `nextStep` identity is stable
        // through useCallback in TourProvider but include it for
        // correctness.
    }, [activeScreen, stepIndex, advanceOn, nextStep]);

    // Click isolator for advance-on-click steps. The spotlight +
    // backdrop both drop `pointer-events` so the user's tap on the
    // spotlit element reaches it natively. But that means a tap
    // ANYWHERE on the page would also reach the page — letting the
    // user e.g. click a cell other than the spotlit one and close
    // the explanation row mid-tour. This capture-phase filter cancels
    // every click EXCEPT ones that land on the `advanceOn.anchor`
    // element(s) or inside the tour popover itself.
    //
    // Gated to advance-on-click steps only. Default blocking steps
    // don't need the filter — their backdrop has `pointer-events:
    // auto` and absorbs clicks before they reach anything.
    // Non-blocking steps deliberately let all clicks through.
    useEffect(() => {
        if (!activeScreen || !advanceOn) return;
        const onClickCapture = (e: MouseEvent): void => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            // Allow clicks inside the popover (X / Back / Skip).
            const inPopover = target.closest(`[${POPOVER_CONTENT_ATTR}]`);
            if (inPopover !== null) return;
            // Allow clicks inside the advance-on anchor — those are
            // the user's intended interaction. The anchor selector
            // matches the same `~=` whitespace-list rule as
            // `findAnchorElements`, so `<div data-tour-anchor="a b">`
            // matches `[data-tour-anchor~="a"]`.
            const inAnchor = target.closest(
                `[data-tour-anchor~="${advanceOn.anchor}"]`,
            );
            if (inAnchor !== null) return;
            // Everything else: cancel.
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener("click", onClickCapture, { capture: true });
        return () =>
            window.removeEventListener("click", onClickCapture, {
                capture: true,
            } as EventListenerOptions);
    }, [activeScreen, advanceOn]);

    if (!activeScreen || !steps || !currentStep) return null;

    const totalSteps = steps.length;
    const stepNumber = stepIndex + 1;
    // Body copy is optional — short call-to-action steps (e.g. the
    // "Get started by logging the first suggestion!" wrap-up) only
    // need the title.
    //
    // Tour copy uses `t.rich` so the body can splice in `<yes></yes>`
    // and `<no></no>` glyphs (rendered as `ProseChecklistIcon`)
    // instead of the literal letters "Y" / "N". The icons match what
    // the user sees in the deduction grid, so the tour reads in the
    // same visual language as the rest of the app. See CLAUDE.md's
    // "Terminology" section for the rationale.
    //
    // Advance-on-click steps use `<strong></strong>` to call out the
    // action prompt ("Tap the highlighted cell to continue"), so the
    // user can find what to do at a glance even if they're skimming
    // the body copy.
    //
    // next-intl's rich-text format expects `<tag>chunks</tag>` (no
    // self-closing form), so the i18n strings use `<yes></yes>` etc.
    // and the callbacks for the void tags ignore the empty `chunks`
    // arg.
    // Device-aware action verb for advance-on-click step bodies that
    // reference what the user should physically do — `{action}` in
    // copy resolves to "Click" on mouse/trackpad devices and "Tap" on
    // touch. Step bodies that don't reference `{action}` ignore the
    // value; passing it unconditionally is harmless and avoids
    // per-step branching.
    const actionVerb = hasKeyboard ? t("verbClick") : t("verbTap");
    const bodyNode =
        currentStep.bodyKey !== undefined
            ? t.rich(currentStep.bodyKey, {
                  action: actionVerb,
                  yes: () => (
                      <ProseChecklistIcon
                          value={Y}
                          className="!inline-flex !h-[18px] !w-[18px] !align-[-3px] text-[12px]"
                      />
                  ),
                  no: () => (
                      <ProseChecklistIcon
                          value={N}
                          className="!inline-flex !h-[18px] !w-[18px] !align-[-3px] text-[12px]"
                      />
                  ),
                  // Today `<strong>` is only used to mark the
                  // "Tap [thing] to continue" action prompt at the
                  // end of advance-on-click step bodies. Render it as
                  // a block-level element with a top margin so the
                  // prompt sits visually separated from the
                  // explanation copy above it — without the gap, the
                  // user's eye runs together "blank if we don't know
                  // yet. Tap the highlighted cell to open the
                  // breakdown." and misses the action.
                  //
                  // `data-tour-action-prompt` is the boundary marker
                  // the disabled "Next" button uses to imperatively
                  // re-trigger the `tour-action-bounce` CSS animation
                  // (toggling the class via classList — a React key
                  // change doesn't reliably remount through next-intl's
                  // rich-text output, and re-rendering the same node
                  // doesn't restart a CSS animation either).
                  strong: (chunks) => (
                      <strong
                          data-tour-action-prompt
                          className="mt-2 block font-semibold"
                      >
                          {chunks}
                      </strong>
                  ),
                  // `<columns><left>…</left><right>…</right></columns>`
                  // renders two side-by-side body panels. Used today
                  // by the desktop two-halves step to mirror the
                  // checklist (left) / suggestion log (right)
                  // spotlight layout in the popover's body copy.
                  // Flex with `flex-1 basis-0` ensures both columns
                  // get equal width regardless of text length.
                  columns: (chunks) => (
                      <div className="flex gap-4">{chunks}</div>
                  ),
                  left: (chunks) => (
                      <div className="flex-1 basis-0">{chunks}</div>
                  ),
                  right: (chunks) => (
                      <div className="flex-1 basis-0">{chunks}</div>
                  ),
              })
            : null;
    // The "Next" button on the last step uses `currentStep.finishLabelKey`
    // when present (e.g. "Start playing" for the Checklist & Suggest
    // wrap-up); otherwise it falls back to a generic "Finish".
    // eslint-disable-next-line i18next/no-literal-string -- default i18n key under the `onboarding` namespace
    const finishKey = currentStep.finishLabelKey ?? "finish";
    // Pad the spotlight by a few pixels so the highlight comfortably
    // surrounds the target rather than hugging its edges.
    const SPOTLIGHT_PAD = 6;
    // Per-step `side` + `align`, with `sideByViewport` overriding the
    // top-level values when set. Computed during render so it picks
    // up the active viewport on each remount.
    const { side: resolvedSide, align: resolvedAlign } =
        resolveSideAndAlign(currentStep);

    return (
        <>
            {/* Backdrop: a transparent fixed-inset layer that absorbs
                clicks landing OUTSIDE the spotlight + popover. Clicks
                on this layer are intentionally dropped — earlier
                versions dismissed the tour on backdrop click, but
                that made it too easy to accidentally bail mid-tour.
                The user must explicitly click X / Skip tour / press
                Esc to exit. `touch-action` is left at its default
                `auto` so vertical/horizontal scroll passes through —
                the user can pan the page to find anchors that scroll
                with content.

                Tap-to-advance failsafe: after `BACKDROP_ADVANCE_DELAY`
                the backdrop becomes clickable and a tap advances the
                tour (or finishes it on the last step). This is the
                escape hatch for cases where the popover ends up
                off-screen due to a layout we didn't anticipate. The
                delay keeps an accidental tap right after step entry
                from skipping past content the user hasn't read.

                advance-on-click steps drop the backdrop's
                `pointer-events` so the user's click on the spotlit
                element reaches it natively. The step's own listener
                on that element fires alongside, advancing the tour;
                the window-level click filter (see the useEffect
                above) cancels every other click outside the popover
                or advance anchor. */}
            <div
                aria-hidden
                className="fixed inset-0 z-[var(--z-tour-backdrop)]"
                style={
                    advanceOn !== undefined
                        ? { pointerEvents: "none" }
                        : undefined
                }
                onClick={
                    advanceOn === undefined && canAdvanceFromBackdrop
                        ? () => nextStep()
                        : undefined
                }
            />
            {/* Spotlight: a transparent box sized to the anchor with
                a giant `box-shadow` painting darkness OUTSIDE the box.
                `pointer-events: auto` so clicks that LAND ON the
                spotlit area are absorbed (not passed through to the
                underlying anchor). Without this, the user could
                click an overflow-menu item mid-tour during step 5,
                or toggle a checklist cell during step 4 — both
                states the tour is trying to teach, not let the user
                interact with yet.

                When no anchor is on the page (fallback), render a
                plain dark overlay instead so the user still sees
                they're in tour mode.

                advance-on-click steps drop the spotlight's pointer
                events so the user's tap reaches the spotlit element
                natively. The window-level click filter higher up
                cancels every other click that lands outside the
                advance anchor / popover. */}
            {spotlights.length > 0 ? (
                spotlights.map((rect, i) => {
                    // The outer-darkening box-shadow paints
                    // darkness OUTSIDE the rect, so it can't cut
                    // cleanly around MULTIPLE spotlights — the first
                    // one's "outside" includes the second one's area.
                    // Multi-spotlight steps deliberately render
                    // ring-only and let the popover carry the
                    // attention. The gate is the step's
                    // `multiSpotlight` config (not the current rect
                    // count) so the dim doesn't flash on / off
                    // during portal-mount transitions where the
                    // count briefly hits 1 before the second element
                    // mounts.
                    const paintsDim = currentStep.multiSpotlight !== true;
                    return (
                        <div
                            key={i}
                            aria-hidden
                            style={{
                                position: "fixed",
                                top: rect.top - SPOTLIGHT_PAD,
                                left: rect.left - SPOTLIGHT_PAD,
                                width: rect.width + SPOTLIGHT_PAD * 2,
                                height: rect.height + SPOTLIGHT_PAD * 2,
                                // 0.6 alpha for the outer darkness: the
                            // parchment / cream surfaces in the app
                            // are light enough that a 0.45 overlay
                            // wasn't visibly registering as a "veil"
                            // to users — the dim tan + dim cream read
                            // as nearly the same color as the un-
                            // dimmed surfaces. 0.6 puts a noticeable
                            // gap between the spotlit area (un-
                            // dimmed cream) and the surrounding page.
                            boxShadow: paintsDim
                                    ? "0 0 0 9999px rgba(0,0,0,0.6), 0 0 0 2px var(--color-tour-accent)"
                                    : "0 0 0 2px var(--color-tour-accent)",
                                borderRadius: "var(--tour-radius)",
                                // advance-on-click steps need the spotlight to
                                // pass clicks through so the underlying element
                                // (a nav tab, a cell, etc.) receives the user's
                                // tap. The tap also fires our listener and
                                // advances the tour.
                                pointerEvents:
                                    advanceOn !== undefined
                                        ? "none"
                                        : "auto",
                                zIndex: "var(--z-tour-spotlight)",
                            }}
                            className="tour-spotlight transition-all"
                            onClick={
                                advanceOn === undefined
                                && canAdvanceFromBackdrop
                                    ? () => nextStep()
                                    : undefined
                            }
                        />
                    );
                })
            ) : (
                // Fallback dim layer: rendered when no anchor matched
                // on the page. Paints the same `bg-black/60` veil so
                // the user still sees "the tour is active" — pointer
                // behavior follows the same advanceOn rule as the
                // spotlit path.
                <div
                    aria-hidden
                    className="fixed inset-0 z-[var(--z-tour-backdrop)] bg-black/60"
                    style={
                        advanceOn !== undefined
                            ? { pointerEvents: "none" }
                            : undefined
                    }
                    onClick={
                        advanceOn === undefined && canAdvanceFromBackdrop
                            ? () => nextStep()
                            : undefined
                    }
                />
            )}
            {/* Key the entire Popover.Root tree on the active step
                AND the union-rect signature. Radix Popper's
                content-wrapper element is created once per Popover
                lifecycle and caches `--radix-popper-anchor-*` CSS
                variables that drive positioning. Re-keying on each
                anchor change forces the wrapper to remount with
                fresh measurements — without this, switching to a
                step whose anchor has different dimensions leaves
                the popover positioned against the previous step's
                rect (visible in step 5 where the open menu's union
                differed from earlier table-row steps). */}
            <Popover.Root key={`${activeScreen}-${stepIndex}-${anchorTick}`} open>
                <Popover.Anchor virtualRef={virtualElementRef} />
                <Popover.Portal>
                    <Popover.Content
                        side={resolvedSide}
                        align={resolvedAlign}
                        sideOffset={14}
                        collisionPadding={24}
                        // The tour floats above the backdrop and
                        // above any popover/menu the active step
                        // might trigger to open. The
                        // `max-h-[calc(100vh-32px)] overflow-y-auto`
                        // pair caps the popover at viewport height
                        // so a tall popover (long body copy + 4-line
                        // step list) scrolls internally rather than
                        // overflowing the viewport — fixing the
                        // mobile-Safari case where Radix could
                        // resolve the popper to a y-coord with the
                        // bottom edge below the viewport.
                        className={
                            "z-[var(--z-tour-popover)] w-[min(92vw,360px)] max-h-[calc(100vh-32px)] overflow-y-auto rounded-[var(--tour-radius)] " +
                            "border-2 border-[var(--color-tour-border)] " +
                            "bg-[var(--color-tour-bg)] text-[var(--color-tour-text)] " +
                            "shadow-[0_10px_28px_rgba(30,64,175,0.28)] focus:outline-none"
                        }
                        // Tag the dialog so screen-readers announce it
                        // as a tour step rather than a regular popover.
                        role="dialog"
                        aria-labelledby="tour-step-title"
                        aria-describedby="tour-step-body"
                        // Boundary marker for the keyboard isolator —
                        // any keydown whose target is INSIDE this
                        // element passes through; everything else is
                        // swallowed.
                        data-tour-popover-content=""
                        // The anchorTick re-render forces Radix to
                        // recompute its popper position when
                        // virtualElementRef.current swapped.
                        key={anchorTick}
                    >
                        {/* Single wrapping element so `Popover.Content`
                            sees ONE child rather than a list. Radix's
                            DismissableLayer + FocusScope wrap content
                            via `Slot` (with `asChild`), and `Slot`
                            calls `React.Children.toArray(children)`
                            which warns in React 19 about unkeyed
                            JSX children even when the array isn't
                            iterated further. Wrapping in a single
                            `<div>` (or Fragment) is the standard
                            workaround. The wrapper is `display:
                            contents` so it doesn't add a layout box —
                            Tailwind utility classes still target the
                            children directly. */}
                        <div className="contents">
                        {!resolveHideArrow(currentStep) && (
                            <Popover.Arrow
                                width={14}
                                height={8}
                                className="fill-[var(--color-tour-bg)] stroke-[var(--color-tour-border)]"
                                strokeWidth={2}
                            />
                        )}
                        {/* Header: just the step's own title + the
                            close X. The cross-tour label ("Setup
                            tour" / "Checklist & Suggest tour") was
                            removed — each step is recognizable from
                            its title and the body, and stripping
                            the meta header lets the popover stay
                            tight around its content. The step
                            counter moved to the bottom-left of the
                            footer so it sits next to the Skip link. */}
                        <div
                            className="flex items-start justify-between gap-3 px-4 pt-3 pb-2"
                        >
                            <div
                                id="tour-step-title"
                                className="font-semibold text-[1rem] leading-snug text-[var(--color-tour-text)]"
                            >
                                {/* `currentStep.titleKey` is a full
                                    next-intl key under the
                                    `onboarding` namespace
                                    (e.g. `setup.cardPack.title`).
                                    `{action}` is interpolated for
                                    titles that reference the user's
                                    physical action ("Tap" / "Click"
                                    per device). Step titles that
                                    don't reference `{action}` ignore
                                    the variable. */}
                                {t(currentStep.titleKey, {
                                    action: actionVerb,
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => dismissTour("close")}
                                aria-label={tCommon("close")}
                                className="-mt-0.5 shrink-0 cursor-pointer rounded-full border-none bg-transparent p-1 text-[var(--color-tour-accent)] hover:bg-[var(--color-tour-bg-hover)]"
                            >
                                <XIcon size={16} />
                            </button>
                        </div>
                        {bodyNode !== null && (
                            <div
                                id="tour-step-body"
                                className="px-4 pb-3 text-[1rem] leading-snug text-[var(--color-tour-text)]"
                            >
                                {bodyNode}
                            </div>
                        )}
                        <div
                            className="flex items-center justify-between gap-3 border-t border-[var(--color-tour-border)] px-4 py-2.5"
                        >
                            <span className="text-[1rem] text-[var(--color-tour-accent)]">
                                {t("stepCounter", {
                                    step: stepNumber,
                                    total: totalSteps,
                                })}
                                {" "}
                                <button
                                    type="button"
                                    onClick={() => dismissTour("skip")}
                                    className="cursor-pointer border-none bg-transparent p-0 text-[1rem] text-[var(--color-tour-accent)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-tour-accent-hover)]"
                                >
                                    {t("skipParens")}
                                </button>
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => prevStep()}
                                    disabled={stepIndex === 0}
                                    className="tap-target-compact text-tap-compact cursor-pointer rounded-[var(--tour-radius)] border border-[var(--color-tour-border)] bg-white text-[var(--color-tour-accent)] hover:bg-[var(--color-tour-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {t("back")}
                                </button>
                                {/* Next button is rendered on every
                                    step. On advance-on-click steps it
                                    looks primary but is visually
                                    locked (aria-disabled + opacity);
                                    clicking it doesn't advance the
                                    tour — it imperatively re-fires
                                    the `tour-action-bounce` animation
                                    on the body's action prompt,
                                    redirecting the user's attention
                                    to the spotlit element they need
                                    to click. We use `aria-disabled`
                                    rather than the native `disabled`
                                    attribute so the click handler
                                    still fires. */}
                                <button
                                    ref={nextButtonRef}
                                    type="button"
                                    aria-disabled={
                                        advanceOn !== undefined ? true : undefined
                                    }
                                    onClick={() => {
                                        if (advanceOn !== undefined) {
                                            // Bounce the body's action
                                            // prompt to redirect the
                                            // user's eye back to the
                                            // spotlit element. WAAPI
                                            // (instead of CSS class
                                            // toggling) guarantees the
                                            // animation restarts on
                                            // every click — class
                                            // toggling caches the
                                            // completed state in some
                                            // browsers and skips the
                                            // second run.
                                            const el =
                                                document.querySelector(
                                                    `[${POPOVER_CONTENT_ATTR}] [data-tour-action-prompt]`,
                                                );
                                            if (el instanceof HTMLElement) {
                                                for (const a of el.getAnimations()) {
                                                    a.cancel();
                                                }
                                                el.animate(
                                                    TOUR_ACTION_BOUNCE_KEYFRAMES,
                                                    TOUR_ACTION_BOUNCE_OPTIONS,
                                                );
                                            }
                                            return;
                                        }
                                        nextStep();
                                    }}
                                    className={
                                        "tap-target-compact text-tap-compact rounded-[var(--tour-radius)] border-2 border-[var(--color-tour-accent)] bg-[var(--color-tour-accent)] font-semibold text-white "
                                        + (advanceOn !== undefined
                                            ? "cursor-not-allowed opacity-60"
                                            : "cursor-pointer hover:bg-[var(--color-tour-accent-hover)]")
                                    }
                                >
                                    {isLastStep ? t(finishKey) : t("next")}
                                </button>
                            </div>
                        </div>
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </>
    );
}
