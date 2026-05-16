"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { T_STANDARD, useReducedTransition } from "../motion";
import { AlertIcon, CheckIcon } from "../components/Icons";
import type { StepValidation, WizardStepId } from "./wizardSteps";

export type StepPanelState = "pending" | "editing" | "complete";

/**
 * Wizard's overall mode, derived from the central game-phase
 * machine. Drives whether closed steps are openable and whether the
 * "pending" treatment dims them.
 *
 * - `"flow"`: first-time setup. Steps walked in canonical order;
 *   pending steps below the focused one are locked (greyed, header
 *   non-interactive). Footer shows "Skip" / "Next" (or "Start
 *   playing" on the last step).
 * - `"edit"`: spot-check edit. Every step is openable independently;
 *   "pending" reads as "closed without data" with no dim. Footer
 *   shows a single "Done" that collapses the focused step.
 */
export type WizardMode = "flow" | "edit";

interface Props {
    readonly stepId: WizardStepId;
    readonly state: StepPanelState;
    readonly wizardMode: WizardMode;
    readonly stepNumber: number;
    readonly title: string;
    readonly summary: ReactNode;
    readonly children: ReactNode;
    /**
     * Validation envelope. The panel only uses it to render the
     * inline banner inside the editing body — Next / Skip enable
     * state lives on the wizard's sticky CTA bar (which reads
     * `stepValidationLevel(focusedStep, state)` from `wizardSteps`).
     */
    readonly validation: StepValidation;
    readonly onClickToEdit?: () => void;
    /**
     * Optional ref-callback the wizard uses to look up each panel's
     * DOM node for the smooth-scroll-on-advance behavior. Each step
     * forwards the wizard's registration callback through this prop;
     * the panel calls it on mount with its `<section>` and on
     * unmount with `null`.
     *
     * Typed as `| undefined` (rather than `?`) to satisfy
     * `exactOptionalPropertyTypes` when steps pass through their
     * own optional prop directly.
     */
    readonly registerPanelEl?:
        | ((stepId: WizardStepId, el: HTMLElement | null) => void)
        | undefined;
    /**
     * The wizard's CTA footer (Start over / Skip / Next /
     * Start playing). Passed through every step but rendered only
     * when the panel is in editing state. Inside the panel body,
     * positioned `sticky bottom-0` so it pins to the visible
     * viewport bottom while the panel content is taller than the
     * viewport, and settles at the panel's natural bottom when
     * the content fits.
     */
    readonly footer?: ReactNode | undefined;
}

/**
 * Generic accordion panel for one step of the M6 setup wizard.
 *
 * Three render states (per the plan's 0c decision):
 *
 * - **pending** — locked, greyed out. Shows the title only, with a
 *   placeholder summary. Not interactively expandable.
 * - **editing** — the active step. Full controls (`children`)
 *   visible, validation banner above the action row, "Next" / "Skip"
 *   buttons at the bottom.
 * - **complete** — collapsed back to header + summary. Click to
 *   re-enter editing for that step. The shell coordinates the
 *   transition (the previously-editing panel collapses to complete).
 *
 * Exactly one panel is in `editing` state at a time; the shell owns
 * that invariant. The expand / collapse is a height transition via
 * `AnimatePresence` on the body, NOT a horizontal slide — the
 * outer Setup ↔ Play slide stays in `Clue.tsx`.
 */
export function SetupStepPanel({
    stepId,
    state,
    wizardMode,
    stepNumber,
    title,
    summary,
    children,
    validation,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });
    // `overflow-hidden` is required during the height: 0 ↔ auto reveal
    // (otherwise the panel's content would briefly leak out of the
    // animated wrapper). But at rest, that same `overflow-hidden`
    // becomes the nearest scrolling-ancestor for `position: sticky`
    // descendants — and breaks them, because the wrapper itself
    // doesn't scroll. The `CardSelectionGrid`'s sticky thead and
    // first column would pin to the wrapper instead of the page.
    //
    // Toggle the overflow class around the animation. While the body
    // is mid-transition we clip; once Framer fires
    // `onAnimationComplete`, drop the clip so sticky resolves to body
    // (the page's scroll container). On exit the component unmounts,
    // so the cleanup is implicit.
    const [bodyAnimating, setBodyAnimating] = useState(true);

    // Ref-callback that lets the wizard look up this panel's DOM
    // node for smooth-scroll on advance. Cleans up on unmount via
    // the `null` payload.
    const sectionRef = (el: HTMLElement | null): void => {
        registerPanelEl?.(stepId, el);
    };

    const isPending = state === "pending";
    const isEditing = state === "editing";
    const isComplete = state === "complete";
    const isEditMode = wizardMode === "edit";

    // While the panel is open, publish its sticky header's height to
    // `--setup-accordion-header-offset` so descendant sticky-thead
    // rules (e.g. `CardSelectionGrid`'s `<thead>`) can stack BELOW
    // the pinned accordion header instead of behind it. Matches the
    // `--header-offset` ResizeObserver pattern in `Clue.tsx`. Cleared
    // to `0px` on collapse so closed panels don't leave a phantom
    // offset behind. Only one panel is `editing` at a time, so the
    // single document-root variable is safely owned by the open one.
    const headerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!isEditing) return;
        const el = headerRef.current;
        if (!el) return;
        const root = document.documentElement;
        const write = () =>
            root.style.setProperty(
                "--setup-accordion-header-offset",
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.setProperty(
                "--setup-accordion-header-offset",
                "0px",
            );
        };
    }, [isEditing]);

    // Dim the header only in flow mode's "pending" treatment.
    // Edit mode renders every closed step at full opacity — they're
    // all equally accessible, dimming would mis-signal "locked."
    const headerTextClass =
        isPending && !isEditMode ? "text-muted opacity-60" : "text-fg";

    // Header click semantics:
    //   flow mode  — only completed steps are re-enterable.
    //   edit mode  — every non-editing step is openable. Pending
    //               (closed-without-data) steps included; the
    //               accordion's `reEnter` handler is symmetric on
    //               state, so the shell's existing code path works.
    const headerClickable =
        onClickToEdit !== undefined
        && (isEditMode ? !isEditing : isComplete);

    return (
        <section
            ref={sectionRef}
            // Stable tour-anchor per step id so the setup tour's
            // "Get started by picking a card pack" step can spotlight
            // the first wizard section without a bespoke anchor on
            // each step component. Token shape:
            // `setup-wizard-step-cardpack` / `-players` / etc.
            data-tour-anchor={`setup-wizard-step-${stepId}`}
            className={`rounded-[var(--radius)] border bg-panel transition-colors shadow-[0_2px_6px_rgba(0,0,0,0.05)] ${
                isEditing
                    ? "border-accent/40 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
                    : "border-border/40"
            }`}
            aria-current={isEditing ? "step" : undefined}
        >
            <button
                ref={headerRef}
                type="button"
                // When the panel is open, the header pins to the top
                // of the page (below the fixed page header + the
                // contradiction banner if present) so the user keeps
                // sight of the current step's question as they scroll
                // through long body content. `bg-panel` covers the
                // body content scrolling under it, and the conditional
                // `border-b` carries the body/header divider with the
                // sticky header (instead of the body wrapper, where
                // it would scroll out of view). Closed panels stay
                // in normal flow — no sticky treatment.
                className={`flex w-full items-center justify-between gap-3 rounded-t-[var(--radius)] px-4 py-3 text-left ${
                    isEditing
                        ? "sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] z-[var(--z-checklist-sticky-header)] border-b border-border/30 bg-panel"
                        : ""
                } ${
                    headerClickable
                        ? "cursor-pointer hover:bg-hover"
                        : "cursor-default"
                }`}
                onClick={headerClickable ? onClickToEdit : undefined}
                disabled={!headerClickable}
                aria-expanded={isEditing}
            >
                <div className={`flex min-w-0 items-center gap-3 ${headerTextClass}`}>
                    <span
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[1rem] font-semibold ${
                            isComplete
                                ? "border-accent bg-accent text-white"
                                : isEditing
                                  ? "border-accent text-accent"
                                  : "border-border/60 text-muted"
                        }`}
                        aria-hidden
                    >
                        {isComplete ? (
                            <CheckIcon size={14} />
                        ) : (
                            stepNumber
                        )}
                    </span>
                    <div className="flex min-w-0 flex-col">
                        <h3 className="m-0 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent leading-tight">
                            {title}
                        </h3>
                        {/* Narrow-viewport summary: stacks below the
                          * title when there isn't horizontal room for
                          * the title + side-summary combo. Hidden on
                          * wider screens, where the right-aligned
                          * span below takes over. */}
                        {isComplete && (
                            <span className="mt-0.5 text-[1rem] text-muted [@media(min-width:520px)]:hidden">
                                {summary}
                            </span>
                        )}
                    </div>
                </div>
                {isComplete && (
                    // `truncate` ellipsizes when the summary is too
                    // long for the available width (10 players list
                    // a 80-char string that used to push the title
                    // into a second line). `min-w-0 max-w-[60%]`
                    // caps the summary's share so the title side
                    // always has half the row to itself.
                    <span className="hidden min-w-0 max-w-[60%] truncate text-[1rem] text-muted [@media(min-width:520px)]:inline-block">
                        {summary}
                    </span>
                )}
            </button>

            <AnimatePresence
                initial={false}
                onExitComplete={() => setBodyAnimating(true)}
            >
                {isEditing && (
                    <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        // eslint-disable-next-line i18next/no-literal-string -- CSS auto value
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={transition}
                        onAnimationStart={() => setBodyAnimating(true)}
                        onAnimationComplete={() => setBodyAnimating(false)}
                        className={bodyAnimating ? "overflow-hidden" : ""}
                    >
                        <div className="px-4 py-4">
                            <div className="flex flex-col gap-4">
                                {children}

                                {validation.message && validation.level !== "valid" && (
                                    <div
                                        role="alert"
                                        className={`flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-[1rem] ${
                                            validation.level === "blocked"
                                                ? "border-danger/40 bg-danger/5 text-danger"
                                                : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                                        }`}
                                    >
                                        <AlertIcon size={16} />
                                        <span>{validation.message}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/*
              CTA footer rendered OUTSIDE the AnimatePresence motion
              wrapper so its `position: sticky` isn't trapped by the
              wrapper's `overflow-hidden` (needed for the height
              transition). Sticky-bottom inside the section means the
              bar pins to the visible viewport bottom while the card
              content is taller than the viewport, and settles at
              the card's natural bottom when the content fits.
              `[bottom: 0]` is relative to the body's scroll
              container (page-level scroll lives on body per
              app/globals.css).
            */}
            {isEditing && footer ? footer : null}

            {isPending && (
                <div className="border-t border-border/20 px-4 py-2 text-[1rem] text-muted">
                    {summary}
                </div>
            )}
        </section>
    );
}
