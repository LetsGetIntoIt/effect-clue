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
    readonly skippable: boolean;
    readonly validation: StepValidation;
    readonly onAdvance: () => void;
    readonly onSkip?: () => void;
    readonly onClickToEdit?: () => void;
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
    state,
    stepNumber,
    totalSteps,
    title,
    summary,
    children,
    skippable,
    validation,
    onAdvance,
    onSkip,
    onClickToEdit,
}: Props) {
    const t = useTranslations("setupWizard");
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    const isPending = state === "pending";
    const isEditing = state === "editing";
    const isComplete = state === "complete";

    const headerTextClass = isPending
        ? "text-muted opacity-60"
        : "text-fg";

    const headerClickable = isComplete && onClickToEdit !== undefined;

    return (
        <section
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
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold ${
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
                        <h2 className="m-0 text-[15px] font-semibold leading-tight">
                            {title}
                        </h2>
                        <span className="text-[11px] uppercase tracking-wide text-muted">
                            {t("stepCounter", {
                                step: stepNumber,
                                total: totalSteps,
                            })}
                        </span>
                    </div>
                </div>
                {isComplete && (
                    <span className="shrink-0 text-[12px] text-muted">
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
                                        className={`flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 text-[13px] ${
                                            validation.level === "blocked"
                                                ? "border-danger/40 bg-danger/5 text-danger"
                                                : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                                        }`}
                                    >
                                        <AlertIcon size={16} />
                                        <span>{validation.message}</span>
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/20 pt-3">
                                    {skippable && onSkip && (
                                        <button
                                            type="button"
                                            className="cursor-pointer rounded border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                                            onClick={onSkip}
                                        >
                                            {t("skip")}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded border-none bg-accent px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={onAdvance}
                                        disabled={validation.level === "blocked"}
                                    >
                                        {t("next")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {isPending && (
                <div className="border-t border-border/20 px-4 py-2 text-[12px] text-muted">
                    {summary}
                </div>
            )}
        </section>
    );
}
