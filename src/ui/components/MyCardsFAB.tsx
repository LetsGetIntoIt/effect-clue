"use client";

import { Duration } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {
    myCardsSectionToggled,
    MY_CARDS_SURFACE_FAB,
} from "../../analytics/events";
import { T_STANDARD, useReducedTransition } from "../motion";
import { ChevronDownIcon, HandOfCardsIcon } from "./Icons";
import { MyHandPanelBody } from "./MyHandPanel";
import {
    SuggestionBanner,
    useSuggestionBannerVisible,
} from "./SuggestionBanner";

// Match the long-press constants used by the Checklist cell — same
// timing keeps the gesture vocabulary consistent across the app.
const LONG_PRESS_DELAY = Duration.millis(500);
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const TOOLTIP_LINGER = Duration.millis(1200);

const PANEL_OFFSET_VAR = "--my-cards-panel-offset" as const;
const TEASER_OFFSET_VAR = "--my-cards-teaser-offset" as const;

/**
 * Mobile-only My Cards entry point. Renders a fixed FAB at the
 * bottom-left of the viewport (above BottomNav, beneath modals); tap
 * to open the bottom panel containing the same `MyHandPanelBody` the
 * desktop section renders.
 *
 * When the panel is closed and a suggestion draft is generating
 * banner content, a small teaser banner floats above the FAB
 * showing the (card-name-redacted) hint and bouncing for attention.
 * Tapping the teaser opens the panel where the full banner is
 * visible alongside the user's chip row. The FAB stays visible in
 * this state — both the teaser and the FAB are valid entry points.
 *
 * Panel persistence rule: only the chevron in the panel's header
 * dismisses it. Tap-outside, page scroll, Checklist cell taps, and
 * BottomNav tab switches all leave the panel open. The component's
 * `panelOpen` state is local (no localStorage), so the panel starts
 * closed every session.
 *
 * When the panel is open, the panel's measured height is published
 * via the `--my-cards-panel-offset` CSS variable (mirroring the
 * `--header-offset` / `--contradiction-banner-offset` pattern in
 * `Clue.tsx`). `<main>`'s `padding-bottom` resolves the variable so
 * the user can scroll the page far enough to see the last row of
 * content without the panel sitting on top of it.
 *
 * Long-pressing the FAB (touch) and hovering the FAB (mouse) both
 * show a "My cards" overlay above it. The 500ms long-press threshold
 * matches the Checklist cell's timing.
 */
export function MyCardsFAB() {
    const t = useTranslations("myHand");
    const [panelOpen, setPanelOpen] = useState(false);
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
    const wasLongPressRef = useRef(false);

    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });
    const teaserRef = useRef<HTMLDivElement>(null);

    // When the panel is closed AND a suggestion draft is generating
    // banner content, the entry point flips from the circular FAB to a
    // stacked teaser bar that sits directly above the BottomNav. The
    // teaser carries the hand-of-cards icon on its left for continuity
    // with the FAB and the desktop section. Otherwise the FAB is the
    // sole entry point.
    const bannerVisible = useSuggestionBannerVisible();
    const showTeaser = !panelOpen && bannerVisible;
    const showFab = !panelOpen && !bannerVisible;

    // Publish the stacked-teaser height as a CSS variable so
    // `<main>`'s padding-bottom can reserve space above it (the
    // teaser is `position: fixed` directly above BottomNav, so
    // without this the last row of page content would sit behind it
    // on scroll).
    useLayoutEffect(() => {
        const root = document.documentElement;
        if (!showTeaser) {
            root.style.removeProperty(TEASER_OFFSET_VAR);
            return;
        }
        const el = teaserRef.current;
        if (!el) return;
        const write = () =>
            root.style.setProperty(
                TEASER_OFFSET_VAR,
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty(TEASER_OFFSET_VAR);
        };
    }, [showTeaser]);

    // Publish the panel's height as a CSS variable on the document
    // root so `<main>` can reserve space for it. Cleared on unmount or
    // when the panel closes.
    useLayoutEffect(() => {
        const root = document.documentElement;
        if (!panelOpen) {
            root.style.removeProperty(PANEL_OFFSET_VAR);
            return;
        }
        const el = panelRef.current;
        if (!el) return;
        const write = () =>
            root.style.setProperty(
                PANEL_OFFSET_VAR,
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty(PANEL_OFFSET_VAR);
        };
    }, [panelOpen]);

    const clearLongPressTimer = useCallback(() => {
        if (longPressTimerRef.current !== null) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        longPressStartRef.current = null;
    }, []);

    const clearTooltipTimer = useCallback(() => {
        if (tooltipTimerRef.current !== null) {
            clearTimeout(tooltipTimerRef.current);
            tooltipTimerRef.current = null;
        }
    }, []);

    const hideTooltipSoon = useCallback(() => {
        clearTooltipTimer();
        tooltipTimerRef.current = setTimeout(() => {
            setTooltipOpen(false);
        }, Duration.toMillis(TOOLTIP_LINGER));
    }, [clearTooltipTimer]);

    useEffect(() => {
        return () => {
            clearLongPressTimer();
            clearTooltipTimer();
        };
    }, [clearLongPressTimer, clearTooltipTimer]);

    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType !== "touch") return;
        clearLongPressTimer();
        wasLongPressRef.current = false;
        longPressStartRef.current = { x: e.clientX, y: e.clientY };
        longPressTimerRef.current = setTimeout(() => {
            wasLongPressRef.current = true;
            setTooltipOpen(true);
            hideTooltipSoon();
        }, Duration.toMillis(LONG_PRESS_DELAY));
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        const start = longPressStartRef.current;
        if (start === null) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (
            dx * dx + dy * dy >
            LONG_PRESS_MOVE_TOLERANCE_PX * LONG_PRESS_MOVE_TOLERANCE_PX
        ) {
            clearLongPressTimer();
        }
    };

    const handlePointerEnd = () => {
        clearLongPressTimer();
    };

    // Mouse-only hover handlers — show / hide the tooltip on mouse
    // pointer enter / leave. Touch pointers come through `pointerdown`
    // (which gates on `pointerType === "touch"`) so this handler skips
    // them; otherwise tapping a touch FAB would briefly show the
    // tooltip in addition to opening the panel.
    const handlePointerEnter = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "touch") return;
        clearTooltipTimer();
        setTooltipOpen(true);
    };
    const handlePointerLeave = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "touch") return;
        clearTooltipTimer();
        setTooltipOpen(false);
    };

    const handleClick = () => {
        // The synthetic click that follows a long-press touch sequence
        // should NOT also open the panel — the long-press was a
        // "preview the label" gesture.
        if (wasLongPressRef.current) {
            wasLongPressRef.current = false;
            return;
        }
        openPanel();
    };

    const openPanel = () => {
        setPanelOpen(true);
        myCardsSectionToggled({
            surface: MY_CARDS_SURFACE_FAB,
            expanded: true,
            bannerShowing: bannerVisible,
        });
    };
    const closePanel = () => {
        setPanelOpen(false);
        myCardsSectionToggled({
            surface: MY_CARDS_SURFACE_FAB,
            expanded: false,
            bannerShowing: bannerVisible,
        });
    };

    return (
        <>
            <AnimatePresence>
                {showFab && (
                    <motion.div
                        key="fab"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={transition}
                        className="fixed left-5 z-[var(--z-app-chrome)] [bottom:calc(env(safe-area-inset-bottom,0px)+68px)] [@media(min-width:800px)]:hidden"
                    >
                        {tooltipOpen && (
                            <span
                                role="tooltip"
                                aria-hidden="false"
                                data-my-cards-fab-tooltip=""
                                className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-panel px-2 py-1 text-[0.875rem] text-fg shadow-[0_1px_4px_rgba(0,0,0,0.15)]"
                            >
                                {t("fabTooltip")}
                            </span>
                        )}
                        <button
                            type="button"
                            data-tour-anchor="my-cards-fab"
                            aria-label={t("fabAriaLabel")}
                            onClick={handleClick}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerEnd}
                            onPointerCancel={handlePointerEnd}
                            onPointerEnter={handlePointerEnter}
                            onPointerLeave={handlePointerLeave}
                            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border-0 bg-accent text-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] hover:bg-accent-hover"
                        >
                            <HandOfCardsIcon size={22} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* Mobile stacked teaser — full-width opaque bar that
                stacks directly above the BottomNav (no gap) when the
                panel is closed AND there's banner content to surface.
                The hand-of-cards icon on the left maintains visual
                continuity with the FAB (which is hidden in this
                state — the teaser IS the entry point). Tap opens the
                panel where the full banner is visible alongside the
                user's chip row. */}
            <AnimatePresence>
                {showTeaser && (
                    <motion.div
                        key="teaser"
                        ref={teaserRef}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={transition}
                        onClick={openPanel}
                        onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openPanel();
                            }
                        }}
                        role="button"
                        tabIndex={0}
                        data-my-cards-fab-teaser=""
                        className="fixed inset-x-0 z-[var(--z-app-chrome)] [bottom:calc(env(safe-area-inset-bottom,0px)+56px)] cursor-pointer [@media(min-width:800px)]:hidden"
                    >
                        <SuggestionBanner
                            teaser
                            paused={false}
                            variant="stacked"
                            surface={MY_CARDS_SURFACE_FAB}
                            expanded={false}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            <AnimatePresence>
                {panelOpen && (
                    <motion.aside
                        key="panel"
                        ref={panelRef}
                        data-tour-anchor="my-cards-panel"
                        data-my-cards-panel=""
                        aria-label={t("title")}
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 24 }}
                        transition={transition}
                        className="fixed left-0 right-0 z-[var(--z-app-chrome)] [bottom:calc(env(safe-area-inset-bottom,0px)+56px)] max-h-[calc(100dvh-var(--header-offset,0px)-var(--contradiction-banner-offset,0px)-12rem)] overflow-y-auto rounded-t-[var(--radius)] border-x border-t border-border bg-panel px-3 py-2 shadow-[0_-4px_12px_rgba(0,0,0,0.12)] [@media(min-width:800px)]:hidden"
                    >
                        <header className="flex items-center justify-between gap-2">
                            <h3 className="m-0 flex items-center gap-2 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                                <HandOfCardsIcon
                                    size={20}
                                    className="text-accent"
                                />
                                {t("title")}
                            </h3>
                            <button
                                type="button"
                                aria-label={t("panelCloseAriaLabel")}
                                className="tap-icon flex cursor-pointer items-center justify-center rounded border border-border bg-control text-fg hover:bg-hover"
                                onClick={closePanel}
                            >
                                <ChevronDownIcon size={18} />
                            </button>
                        </header>
                        {/*
                          The mobile panel is always-on while open —
                          opening the FAB acknowledges the surface, so
                          the banner skips its attention bounce by
                          passing `paused`.
                        */}
                        <div className="mt-1.5">
                            <SuggestionBanner
                                paused
                                surface={MY_CARDS_SURFACE_FAB}
                                expanded
                            />
                        </div>
                        <div className="mt-1.5">
                            <MyHandPanelBody />
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>
        </>
    );
}
