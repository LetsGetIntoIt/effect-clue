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
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { XIcon } from "../components/Icons";
import { useClue } from "../state";
import { useTour } from "./TourProvider";

/**
 * Wrapper around `getBoundingClientRect()` that satisfies the shape
 * Radix's `virtualRef` expects. Returns a "virtual" element with a
 * `getBoundingClientRect` method.
 */
type VirtualElement = {
    readonly getBoundingClientRect: () => DOMRect;
};

/**
 * Find every on-page element a tour step targets.
 *
 * Uses the `~=` attribute selector so a single DOM element can carry
 * multiple anchor names (space-separated), e.g. the first cell of the
 * checklist grid is both `setup-known-cell` and `checklist-cell`.
 * Returns the empty array when no element matches; the caller falls
 * back to a fixed viewport position.
 */
const findAnchorElements = (anchor: string): HTMLElement[] => {
    if (typeof document === "undefined") return [];
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            `[data-tour-anchor~="${anchor}"]`,
        ),
    );
};

/**
 * The smallest axis-aligned rect that contains every input rect.
 * Used to highlight a row, a column, or any group of elements as a
 * single spotlight without rendering one per element.
 *
 * Zero-area rects (typically `display: none` siblings — e.g. the
 * Toolbar's ⋯ trigger that's hidden on mobile while the BottomNav's
 * ⋯ trigger carries the same anchor) are filtered out before
 * unioning. Including them would extend the union all the way to
 * the document origin (0,0), making the spotlight cover huge swaths
 * of the page.
 */
const unionRect = (rects: ReadonlyArray<DOMRect>): DOMRect | null => {
    const visible = rects.filter(r => r.width > 0 && r.height > 0);
    if (visible.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of visible) {
        if (r.left < left) left = r.left;
        if (r.top < top) top = r.top;
        if (r.right > right) right = r.right;
        if (r.bottom > bottom) bottom = r.bottom;
    }
    return new DOMRect(left, top, right - left, bottom - top);
};

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

        const scrollSpotlightIntoView = (rect: DOMRect): void => {
            if (typeof window === "undefined") return;
            const margin = 48;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const inViewVertical =
                rect.top >= margin && rect.bottom <= vh - margin;
            const inViewHorizontal =
                rect.left >= margin && rect.right <= vw - margin;
            if (inViewVertical && inViewHorizontal) return;
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
            const dx = inViewHorizontal
                ? 0
                : rect.width + margin * 2 < vw
                    ? rect.left + rect.width / 2 - vw / 2
                    : rect.left - margin;
            // Use `auto` (instantaneous) rather than `smooth`. The
            // recompute fires multiple times per step (mutation
            // observer + step-change effect + React re-renders all
            // re-trigger it), and back-to-back smooth-scroll calls
            // cancel each other before the animation can commit any
            // movement — leaving body.scrollTop stuck at 0. Instant
            // scroll matches the user's mental model anyway: the
            // tour jumped to a new step, the page should already be
            // showing what the step is about.
            // eslint-disable-next-line i18next/no-literal-string -- ScrollBehavior enum
            const behavior: ScrollBehavior = "auto";
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
            if (dy !== 0) {
                verticalEl.scrollTo({
                    top: verticalEl.scrollTop + dy,
                    behavior,
                });
            }
            if (dx !== 0) {
                horizontalEl.scrollTo({
                    left: horizontalEl.scrollLeft + dx,
                    behavior,
                });
            }
        };

        const recompute = (): void => {
            const els = findAnchorElements(currentStep.anchor);
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
            // shape. Popover positioning anchors to JUST THE FIRST
            // matched element, not the union. Reasoning: for big
            // unions (e.g. trigger + open menu, or a column tall
            // enough to fill the viewport), there's nowhere for the
            // popover to fit if Radix tries to position it against
            // the whole union — collision detection ends up shoving
            // the popper off-screen. Anchoring to the first
            // element keeps the popover near a natural visual hook
            // while the spotlight communicates the full extent of
            // the highlighted region.
            const spotlightMeasure = (): DOMRect => {
                const rects = els.map(el => el.getBoundingClientRect());
                return unionRect(rects) ?? fallbackVirtualRect();
            };
            const popoverMeasure = (): DOMRect => {
                // Pick the first VISIBLE element. The Toolbar +
                // BottomNav both render an OverflowMenu trigger
                // with the same anchor name; one is hidden via CSS
                // on the other's breakpoint and reports a 0x0 rect.
                // Skip the zero-area one so the popover anchors to
                // the visible trigger.
                for (const el of els) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return r;
                }
                return fallbackVirtualRect();
            };
            virtualElementRef.current = {
                getBoundingClientRect: popoverMeasure,
            };
            const measured = spotlightMeasure();
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
            // Auto-scroll once per step so anchors below the fold
            // (or off to the side on a horizontally-scrolling page)
            // come into view. Subsequent recomputes don't re-scroll;
            // the user is in control once they start interacting.
            const scrollTracker = scrolledForStepRef.current;
            if (
                scrollTracker.screen !== activeScreen ||
                scrollTracker.step !== stepIndex
            ) {
                scrolledForStepRef.current = {
                    screen: activeScreen,
                    step: stepIndex,
                };
            }
            // Always re-check whether the spotlight is in view: the
            // page may have reflowed (e.g. menu opened, image
            // loaded) since we last checked. The fn no-ops when the
            // rect is comfortably inside the viewport, and `auto`
            // scroll is idempotent at the same target.
            scrollSpotlightIntoView(measured);
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
        // grows the cell).
        const els = findAnchorElements(currentStep.anchor);
        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined" && els.length > 0) {
            observer = new ResizeObserver(() => recompute());
            for (const el of els) observer.observe(el);
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
    }, [activeScreen, stepIndex, currentStep, state.uiMode]);

    // Esc dismisses the active tour. Wired at the document level
    // rather than via Radix's `onOpenChange` because the controlled
    // `open` Popover would otherwise also fire `onOpenChange(false)`
    // for outside clicks AND for any sibling modal's interactions —
    // letting the tour dismiss itself the moment the splash modal
    // dispatched its own outside-click guard.
    useEffect(() => {
        if (!activeScreen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                e.stopPropagation();
                // eslint-disable-next-line i18next/no-literal-string -- analytics discriminator
                dismissTour("esc");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [activeScreen, dismissTour]);

    if (!activeScreen || !steps || !currentStep) return null;

    const totalSteps = steps.length;
    const stepNumber = stepIndex + 1;
    const tourTitle = t(`tourTitle.${activeScreen}`);
    // Pad the spotlight by a few pixels so the highlight comfortably
    // surrounds the target rather than hugging its edges.
    const SPOTLIGHT_PAD = 6;

    return (
        <>
            {/* Click-everywhere dismiss layer. Lives BENEATH the
                spotlight so clicks anywhere outside the highlighted
                anchor still dismiss the tour. */}
            <div
                aria-hidden
                onClick={() => dismissTour("backdrop")}
                className="fixed inset-0 z-40"
            />
            {/* Spotlight: a transparent box sized to the anchor with
                a giant `box-shadow` painting darkness OUTSIDE the box.
                Visually highlights the anchor area without needing a
                clip-path or SVG mask. `pointer-events-none` so the
                click goes through to the backdrop above. */}
            {spotlight ? (
                <div
                    aria-hidden
                    style={{
                        position: "fixed",
                        top: spotlight.top - SPOTLIGHT_PAD,
                        left: spotlight.left - SPOTLIGHT_PAD,
                        width: spotlight.width + SPOTLIGHT_PAD * 2,
                        height: spotlight.height + SPOTLIGHT_PAD * 2,
                        boxShadow:
                            "0 0 0 9999px rgba(0,0,0,0.45), 0 0 0 2px var(--color-tour-accent)",
                        borderRadius: "var(--tour-radius)",
                        pointerEvents: "none",
                        zIndex: 41,
                    }}
                    className="tour-spotlight transition-all"
                />
            ) : (
                <div
                    aria-hidden
                    className="fixed inset-0 z-40 bg-black/45"
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
                        side={currentStep.side ?? "bottom"}
                        align={currentStep.align ?? "center"}
                        sideOffset={14}
                        collisionPadding={16}
                        // The tour floats above the backdrop (z-40)
                        // AND above any popover/menu the active step
                        // might trigger to open (the overflow menu
                        // content uses z-50). Bumped to z-60 so the
                        // tour copy stays visible.
                        className={
                            "z-[60] w-[min(92vw,360px)] rounded-[var(--tour-radius)] " +
                            "border-2 border-[var(--color-tour-border)] " +
                            "bg-[var(--color-tour-bg)] text-[var(--color-tour-text)] " +
                            "shadow-[0_10px_28px_rgba(30,64,175,0.28)] focus:outline-none"
                        }
                        // Tag the dialog so screen-readers announce it
                        // as a tour step rather than a regular popover.
                        role="dialog"
                        aria-labelledby="tour-step-title"
                        aria-describedby="tour-step-body"
                        // The anchorTick re-render forces Radix to
                        // recompute its popper position when
                        // virtualElementRef.current swapped.
                        key={anchorTick}
                    >
                        <Popover.Arrow
                            width={14}
                            height={8}
                            className="fill-[var(--color-tour-bg)] stroke-[var(--color-tour-border)]"
                            strokeWidth={2}
                        />
                        <div className="flex flex-col gap-0.5 border-b border-[var(--color-tour-border)] px-4 pt-3 pb-2">
                            <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold text-[13px] text-[var(--color-tour-accent)]">
                                    {tourTitle}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => dismissTour("close")}
                                    aria-label={tCommon("close")}
                                    className="-mt-0.5 cursor-pointer rounded-full border-none bg-transparent p-1 text-[var(--color-tour-accent)] hover:bg-[var(--color-tour-bg-hover)]"
                                >
                                    <XIcon size={16} />
                                </button>
                            </div>
                            <span className="text-[11px] text-[var(--color-tour-accent)] opacity-70">
                                {t("stepLabel", {
                                    step: stepNumber,
                                    total: totalSteps,
                                })}
                            </span>
                        </div>
                        <div className="px-4 py-3">
                            <div
                                id="tour-step-title"
                                className="font-semibold text-[15px] text-[var(--color-tour-text)]"
                            >
                                {/* `currentStep.titleKey` is a full
                                    next-intl key under the
                                    `onboarding` namespace
                                    (e.g. `setup.cardPack.title`). */}
                                {t(currentStep.titleKey)}
                            </div>
                            <div
                                id="tour-step-body"
                                className="mt-1 text-[13px] leading-snug text-[var(--color-tour-text)]"
                            >
                                {t(currentStep.bodyKey)}
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-tour-border)] px-4 py-2.5">
                            <button
                                type="button"
                                onClick={() => dismissTour("skip")}
                                className="cursor-pointer rounded-[var(--tour-radius)] border-none bg-transparent px-2 py-1 text-[12px] text-[var(--color-tour-accent)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-tour-accent-hover)]"
                            >
                                {t("skip")}
                            </button>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => prevStep()}
                                    disabled={stepIndex === 0}
                                    className="cursor-pointer rounded-[var(--tour-radius)] border border-[var(--color-tour-border)] bg-white px-3 py-1.5 text-[13px] text-[var(--color-tour-accent)] hover:bg-[var(--color-tour-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {t("back")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => nextStep()}
                                    className="cursor-pointer rounded-[var(--tour-radius)] border-2 border-[var(--color-tour-accent)] bg-[var(--color-tour-accent)] px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-tour-accent-hover)]"
                                >
                                    {isLastStep ? t("finish") : t("next")}
                                </button>
                            </div>
                        </div>
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </>
    );
}
