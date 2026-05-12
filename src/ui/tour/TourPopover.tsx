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
import { XIcon } from "../components/Icons";
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
        dispatch({ type: "setUiMode", mode: currentStep.requiredUiMode });
    }, [currentStep, state.uiMode, dispatch]);

    // Spotlight rect — set to the union of all anchor element rects,
    // or null when no anchor matches. Refreshed alongside the
    // popover position via the tracking effect below so the dim
    // cutout follows the active step.
    const [spotlight, setSpotlight] = useState<DOMRect | null>(null);

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
            setSpotlight(null);
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
                setSpotlight(null);
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
            // Spotlight uses the UNION of all matched rects so it
            // can highlight a row/column/group as one cohesive
            // shape. Popover positioning anchors to a SINGLE element
            // (not the union). Reasoning: for big unions (e.g. an
            // entire column or trigger + open menu), there's nowhere
            // for the popover to fit if Radix tries to position it
            // against the whole union — collision detection ends up
            // shoving the popper off-screen.
            //
            // Two knobs select the popover's anchor element:
            //   - `step.popoverAnchor` overrides the token (lets a
            //     step keep the spotlight on a wide region while
            //     pinning the popover to a small one — used for the
            //     player-column step).
            //   - `step.popoverAnchorPriority` picks `first-visible`
            //     (default) or `last-visible` from the matched
            //     elements (used for the overflow-menu step where
            //     the portaled menu content appears AFTER the trigger
            //     in DOM order).
            const popoverEls = currentStep.popoverAnchor !== undefined
                ? findAnchorElements(resolvePopoverAnchorToken(currentStep))
                : els;
            const spotlightMeasure = (): DOMRect => {
                const rects = els.map(el => el.getBoundingClientRect());
                return unionRect(rects) ?? fallbackVirtualRect();
            };
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
            let measured = spotlightMeasure();
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
                if (scrollSpotlightIntoView(measured)) {
                    measured = spotlightMeasure();
                }
            }
            setSpotlight(measured);
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

    // While a tour is active, the page beneath the veil should be
    // keyboard-inert. App-level shortcuts (`⌘K`, `⌘Z`, the per-tab
    // "go to" shortcuts, etc.) listen at the window in BUBBLE phase;
    // we install a CAPTURE-phase listener so we run first and can
    // selectively swallow events.
    //
    //   - Escape dismisses the tour (existing behavior, kept as the
    //     authoritative keyboard-out path) — unconditional.
    //   - Other keys: in BLOCKING mode (the default), if the event
    //     target is inside the popover content (Tab between Back /
    //     Skip / Next, Enter to click), pass through; otherwise
    //     stopPropagation + preventDefault so the page beneath gets
    //     nothing. In NON-BLOCKING mode (`currentStep.nonBlocking`),
    //     every non-Esc keystroke passes through so the user can
    //     type into wizard inputs / use page shortcuts while the
    //     informational popover floats.
    //
    // `capture: true` matters for collisions — bubble-phase listeners
    // we want to suppress fire AFTER us, so our `stopPropagation` is
    // load-bearing.
    const nonBlocking = currentStep?.nonBlocking ?? false;
    useEffect(() => {
        if (!activeScreen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === KEY_ESCAPE) {
                e.stopPropagation();
                dismissTour(DISMISS_VIA_ESC);
                return;
            }
            if (nonBlocking) return;
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
    }, [activeScreen, dismissTour, nonBlocking]);

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
    // Gated on blocking mode only: in non-blocking mode the backdrop
    // already passes clicks through to the page, so tap-to-advance
    // would fight with normal interaction. Non-blocking tours have a
    // visible Next button on screen anyway (the popover doesn't
    // dim the page).
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

    if (!activeScreen || !steps || !currentStep) return null;

    const totalSteps = steps.length;
    const stepNumber = stepIndex + 1;
    // Body copy is optional — short call-to-action steps (e.g. the
    // "Get started by logging the first suggestion!" wrap-up) only
    // need the title.
    const bodyText =
        currentStep.bodyKey !== undefined ? t(currentStep.bodyKey) : "";
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

                In non-blocking mode (`currentStep.nonBlocking`) the
                backdrop drops its `pointer-events` so taps land on
                the page beneath — the popover is informational and
                the user is meant to keep interacting with the page
                while it floats.

                Tap-to-advance failsafe: after `BACKDROP_ADVANCE_DELAY`
                the backdrop becomes clickable and a tap advances the
                tour (or finishes it on the last step). This is the
                escape hatch for cases where the popover ends up
                off-screen due to a layout we didn't anticipate. The
                delay keeps an accidental tap right after step entry
                from skipping past content the user hasn't read. */}
            <div
                aria-hidden
                className="fixed inset-0 z-[var(--z-tour-backdrop)]"
                style={nonBlocking ? { pointerEvents: "none" } : undefined}
                onClick={
                    !nonBlocking && canAdvanceFromBackdrop
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

                In non-blocking mode, we drop both the darkening
                outer-shadow and `pointer-events: auto` — the
                accent-ring is all that remains so the user sees what
                the popover is pointing at without losing access to
                it. */}
            {spotlight ? (
                <div
                    aria-hidden
                    style={{
                        position: "fixed",
                        top: spotlight.top - SPOTLIGHT_PAD,
                        left: spotlight.left - SPOTLIGHT_PAD,
                        width: spotlight.width + SPOTLIGHT_PAD * 2,
                        height: spotlight.height + SPOTLIGHT_PAD * 2,
                        boxShadow: nonBlocking
                            ? "0 0 0 2px var(--color-tour-accent)"
                            : "0 0 0 9999px rgba(0,0,0,0.45), 0 0 0 2px var(--color-tour-accent)",
                        borderRadius: "var(--tour-radius)",
                        pointerEvents: nonBlocking ? "none" : "auto",
                        zIndex: "var(--z-tour-spotlight)",
                    }}
                    className="tour-spotlight transition-all"
                    onClick={
                        !nonBlocking && canAdvanceFromBackdrop
                            ? () => nextStep()
                            : undefined
                    }
                />
            ) : (
                <div
                    aria-hidden
                    className={
                        nonBlocking
                            ? "fixed inset-0 z-[var(--z-tour-backdrop)]"
                            : "fixed inset-0 z-[var(--z-tour-backdrop)] bg-black/45"
                    }
                    style={nonBlocking ? { pointerEvents: "none" } : undefined}
                    onClick={
                        !nonBlocking && canAdvanceFromBackdrop
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
                                    (e.g. `setup.cardPack.title`). */}
                                {t(currentStep.titleKey)}
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
                        {bodyText !== "" && (
                            <div
                                id="tour-step-body"
                                className="px-4 pb-3 text-[1rem] leading-snug text-[var(--color-tour-text)]"
                            >
                                {bodyText}
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
                                <button
                                    ref={nextButtonRef}
                                    type="button"
                                    onClick={() => nextStep()}
                                    className="tap-target-compact text-tap-compact cursor-pointer rounded-[var(--tour-radius)] border-2 border-[var(--color-tour-accent)] bg-[var(--color-tour-accent)] font-semibold text-white hover:bg-[var(--color-tour-accent-hover)]"
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
