"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { T_STANDARD, useReducedTransition } from "../motion";
import { AlertIcon, CheckIcon } from "../components/Icons";
import type { StepValidation, WizardStepId } from "./wizardSteps";

export type StepPanelState = "pending" | "editing" | "complete";

interface Props {
    readonly stepId: WizardStepId;
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
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
    stepNumber,
    totalSteps,
    title,
    summary,
    children,
    validation,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard");
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    // Ref-callback that lets the wizard look up this panel's DOM
    // node for smooth-scroll on advance. Cleans up on unmount via
    // the `null` payload.
    const sectionRef = (el: HTMLElement | null): void => {
        registerPanelEl?.(stepId, el);
    };

    const isPending = state === "pending";
    const isEditing = state === "editing";
    const isComplete = state === "complete";

    const headerTextClass = isPending
        ? "text-muted opacity-60"
        : "text-fg";

    const headerClickable = isComplete && onClickToEdit !== undefined;

    return (
        <section
            ref={sectionRef}
            // Stable tour-anchor per step id so the setup tour's
            // "Get started by picking a card pack" step can spotlight
            // the first wizard section without a bespoke anchor on
            // each step component. Token shape:
            // `setup-wizard-step-cardpack` / `-players` / etc.
            data-tour-anchor={`setup-wizard-step-${stepId}`}
            className={`rounded-[var(--radius)] border bg-panel transition-colors ${
                isEditing
                    ? "border-accent/40 shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
                    : "border-border/40"
            }`}
            aria-current={isEditing ? "step" : undefined}
        >
            <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 rounded-t-[var(--radius)] px-4 py-3 text-left ${
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
                        <span className="text-[1rem] uppercase tracking-wide text-muted">
                            {t("stepCounter", {
                                step: stepNumber,
                                total: totalSteps,
                            })}
                        </span>
                    </div>
                </div>
                {isComplete && (
                    <span className="shrink-0 text-[1rem] text-muted">
                        {summary}
                    </span>
                )}
            </button>

            <AnimatePresence initial={false}>
                {isEditing && (
                    <motion.div
                        key="body"
                        initial={{ height: 0, opacity: 0 }}
                        // eslint-disable-next-line i18next/no-literal-string -- CSS auto value
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={transition}
                        className="overflow-hidden"
                    >
                        <div className="border-t border-border/30 px-4 py-4">
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
