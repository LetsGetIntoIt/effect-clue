/**
 * Renders the active onboarding tour step as a Radix Popover anchored
 * to the DOM node carrying `data-tour-anchor="<step.anchor>"`.
 *
 * The popover lives in a portal at the document root and is
 * positioned via `Popover.Anchor virtualRef={...}` — meaning we don't
 * have to thread a `ref` through every component that's a tour
 * target. Each component that wants to be anchorable just adds
 * `data-tour-anchor="..."` to a stable DOM node and the tour finds
 * it on its own.
 *
 * Visual identity is intentionally distinct from the in-game UI —
 * the parchment/oxblood `InfoPopover` and `SplashModal` palette is
 * for game state; this is meta UI guiding the user through the app.
 * Blue accent + "Tour · Step N of M" header signal "this is a
 * walkthrough, not part of your game".
 *
 * Lookup runs on mount and on every step change. If the anchor node
 * isn't on the page (the user navigated away mid-tour, or the step
 * targets an element that hasn't mounted yet), we fall back to a
 * fixed position in the bottom-right of the viewport so the user
 * still sees the tour copy.
 *
 * Spotlight / backdrop is a `fixed` `<div>` with low-alpha black so
 * the user's eye is drawn to the popover. We don't punch a hole
 * around the anchor — the bounding-rect-based mask was enough work
 * that it'd inflate this PR; a future polish pass can add it.
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
 * Find the on-page element a tour step targets.
 *
 * Uses the `~=` attribute selector so a single DOM element can carry
 * multiple anchor names (space-separated), e.g. the first cell of the
 * checklist grid is both `setup-known-cell` and `checklist-cell`. The
 * fallback to the exact-match selector keeps simple single-token
 * anchors working unchanged.
 */
const findAnchorElement = (anchor: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return (
        document.querySelector<HTMLElement>(
            `[data-tour-anchor~="${anchor}"]`,
        ) ??
        document.querySelector<HTMLElement>(`[data-tour-anchor="${anchor}"]`)
    );
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

    // Re-render whenever the anchor element changes so Radix
    // recomputes the popover's position.
    const [anchorTick, setAnchorTick] = useState(0);

    // Step-driven uiMode dispatch. On mobile the checklist and suggest
    // panes don't co-exist, so a step that anchors inside the suggest
    // pane needs uiMode flipped before its anchor resolves. Desktop
    // renders both panes simultaneously so the dispatch is harmless.
    useEffect(() => {
        if (!currentStep?.requiredUiMode) return;
        if (state.uiMode === currentStep.requiredUiMode) return;
        dispatch({ type: "setUiMode", mode: currentStep.requiredUiMode });
    }, [currentStep, state.uiMode, dispatch]);

    // Anchor resolution. Runs after every step change AND every
    // uiMode change so the suggest-pane anchors resolve after the
    // dispatch above has flipped the rendered tree.
    useEffect(() => {
        if (!activeScreen || !currentStep) {
            virtualElementRef.current = {
                getBoundingClientRect: fallbackVirtualRect,
            };
            return;
        }
        const el = findAnchorElement(currentStep.anchor);
        if (el) {
            virtualElementRef.current = {
                getBoundingClientRect: () => el.getBoundingClientRect(),
            };
        } else {
            virtualElementRef.current = {
                getBoundingClientRect: fallbackVirtualRect,
            };
        }
        setAnchorTick(n => n + 1);
    }, [activeScreen, stepIndex, currentStep, state.uiMode]);

    // Spotlight rect — refreshed alongside the anchor effect so the
    // dim cutout follows the active step.
    const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
    useEffect(() => {
        if (!activeScreen || !currentStep) {
            setSpotlight(null);
            return;
        }
        const el = findAnchorElement(currentStep.anchor);
        setSpotlight(el ? el.getBoundingClientRect() : null);
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
            <Popover.Root open>
                <Popover.Anchor virtualRef={virtualElementRef} />
                <Popover.Portal>
                    <Popover.Content
                        side={currentStep.side ?? "bottom"}
                        align={currentStep.align ?? "center"}
                        sideOffset={10}
                        collisionPadding={16}
                        // The tour floats above the backdrop (z-40).
                        className={
                            "z-50 w-[min(92vw,360px)] rounded-[var(--tour-radius)] " +
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
