"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { startSetup } from "../../analytics/gameSession";
import {
    gameSetupStarted,
    setupWizardCompleted,
    setupWizardStepAdvanced,
    setupWizardStepReentered,
    setupWizardStepSkipped,
} from "../../analytics/events";
import { useConfirm } from "../hooks/useConfirm";
import { useClue } from "../state";
import { useSetupWizardFocus } from "./SetupWizardFocusContext";
import { SetupStepCardPack } from "./steps/SetupStepCardPack";
import { SetupStepHandSizes } from "./steps/SetupStepHandSizes";
import { SetupStepIdentity } from "./steps/SetupStepIdentity";
import { SetupStepKnownCards } from "./steps/SetupStepKnownCards";
import { SetupStepMyCards } from "./steps/SetupStepMyCards";
import { SetupStepPlayers } from "./steps/SetupStepPlayers";
import {
    isStepDataComplete,
    visibleSteps,
    type WizardStepId,
} from "./wizardSteps";
import type { StepPanelState } from "./SetupStepPanel";

// Module-scope discriminators so the i18next/no-literal-string lint
// rule treats these as identifiers, not user-facing copy.
const STEP_EDITING: StepPanelState = "editing";
const STEP_COMPLETE: StepPanelState = "complete";
const STEP_PENDING: StepPanelState = "pending";

/**
 * M6 setup wizard — accordion of step panels rendered when the
 * `setup-wizard` feature flag is on AND `state.uiMode === "setup"`.
 *
 * **Accordion shell** (per the plan's 0c decision): a vertical
 * stack of panels rendered identically at every breakpoint, max
 * width ~720px centered on desktop. Exactly one panel is in
 * `editing` state at a time; the others are `pending` (lock; below
 * the active step) or `complete` (collapsed; above the active
 * step). Clicking a complete panel re-enters editing for that step
 * and the previously-editing panel becomes complete.
 *
 * **Step set in PR-A2:** Players (step 2), Identity (step 3), Hand
 * sizes (step 4). The plan's full step list is six (Card pack, …,
 * My cards, Other players' cards) — those land in PR-A3. Until then
 * the wizard renders only the three implemented steps; the renumbering
 * is a no-op for review purposes since the flag stays off.
 *
 * **Sticky bottom CTA** kicks the user from setup to play once all
 * required (non-skippable) visible steps are complete OR the user
 * has already played at least one suggestion (mid-game edits don't
 * re-gate "Continue Playing"). The CTA dispatches
 * `setUiMode("checklist")`.
 *
 * **Wizard navigation state** (focusedStepId, completedSteps) lives
 * in local React state, NOT in `ClueState` — it's pure UI nav,
 * doesn't survive refresh meaningfully, doesn't go through undo/
 * redo. Only data the steps edit goes through dispatch.
 */
export function SetupWizard() {
    const t = useTranslations("setupWizard");
    const tSetup = useTranslations("setup");
    const tToolbar = useTranslations("toolbar");
    const { state, dispatch } = useClue();
    const confirm = useConfirm();
    const focus = useSetupWizardFocus();

    // PR-A3 ships steps 1, 5, 6 alongside the existing 2-4 — every
    // step in `visibleSteps(state)` is now implemented, so the filter
    // is a no-op until a future PR adds steps that need a render-time
    // gate (e.g., shipped behind a sub-flag). Keep the filter wired
    // in so adding a stub step doesn't break the wizard.
    const steps = useMemo(() => visibleSteps(state), [state]);

    // Initial completed set: any step whose data is already filled
    // in. Lets the user re-enter a populated wizard at the right
    // place if they returned from play mode.
    const [completed, setCompleted] = useState<ReadonlySet<WizardStepId>>(
        () =>
            new Set(steps.filter(id => isStepDataComplete(id, state))),
    );

    // Initial focused step: the focus-context hint (M7 jumps), else
    // the first non-completed step, else the last step. Covers both
    // "fresh start" (lands on step 1) and "returning user" (lands on
    // first incomplete step).
    const [focusedStep, setFocusedStep] = useState<WizardStepId | null>(
        () => {
            const hinted = focus?.consumeFocusHint() ?? null;
            if (hinted !== null && steps.includes(hinted)) return hinted;
            const firstIncomplete = steps.find(
                id => !isStepDataComplete(id, state),
            );
            return firstIncomplete ?? steps[steps.length - 1] ?? null;
        },
    );

    // If the visible-step set changes (e.g. selfPlayerId toggled to
    // null mid-wizard), drop any focusedStep / completed entries
    // that no longer apply.
    useEffect(() => {
        const visibleSet = new Set(steps);
        setCompleted(prev => {
            let next: Set<WizardStepId> | null = null;
            for (const id of prev) {
                if (!visibleSet.has(id)) {
                    if (next === null) next = new Set(prev);
                    next.delete(id);
                }
            }
            return next ?? prev;
        });
        setFocusedStep(prev =>
            prev !== null && visibleSet.has(prev) ? prev : (steps[0] ?? null),
        );
    }, [steps]);

    const stepStateFor = (id: WizardStepId): StepPanelState => {
        if (id === focusedStep) return STEP_EDITING;
        if (completed.has(id)) return STEP_COMPLETE;
        return STEP_PENDING;
    };

    const advance = (currentId: WizardStepId) => {
        // Mark current step complete; pick the next non-completed
        // step in canonical order; if all visible steps are done,
        // collapse without focus (CTA takes over).
        const nextCompleted = new Set(completed);
        nextCompleted.add(currentId);
        setCompleted(nextCompleted);
        const remaining = steps.find(id => !nextCompleted.has(id));
        setFocusedStep(remaining ?? null);
        setupWizardStepAdvanced({ step: currentId });
    };

    const skip = (currentId: WizardStepId) => {
        // Same flow as `advance` (one less event, different signal).
        // The accordion treats "Skip" and "Next" identically — both
        // mark the step complete and move on; the analytics
        // distinction lets us see which steps users actually fill in.
        const nextCompleted = new Set(completed);
        nextCompleted.add(currentId);
        setCompleted(nextCompleted);
        const remaining = steps.find(id => !nextCompleted.has(id));
        setFocusedStep(remaining ?? null);
        setupWizardStepSkipped({ step: currentId });
    };

    const reEnter = (id: WizardStepId) => {
        // Clicking a complete step: collapse the previously-editing
        // panel into "complete" with current values, expand the
        // clicked one. The previously-editing panel may not have
        // been "really" complete yet (the user clicked away mid-
        // edit) — mark it complete anyway since they've moved on,
        // matching the accordion's "you can always come back" model.
        const nextCompleted = new Set(completed);
        if (focusedStep !== null && focusedStep !== id) {
            nextCompleted.add(focusedStep);
        }
        nextCompleted.delete(id);
        setCompleted(nextCompleted);
        setFocusedStep(id);
        setupWizardStepReentered({ step: id });
    };

    // Required visible steps (subset that block "Start playing"):
    // today the required steps are `cardPack` (every game needs a
    // deck) and `players` (every game needs at least 2 players).
    // Identity, hand sizes, my cards, and other-player cards are
    // skippable per their step config. Always-allow the CTA once
    // a game is in progress (mid-game edits to setup don't re-gate
    // the user out of play).
    const REQUIRED: ReadonlySet<WizardStepId> = useMemo(
        () => new Set<WizardStepId>(["cardPack", "players"]),
        [],
    );
    const requiredVisible = useMemo(
        () => steps.filter(id => REQUIRED.has(id)),
        [steps, REQUIRED],
    );
    const allRequiredComplete = requiredVisible.every(id =>
        completed.has(id),
    );
    const hasGameProgress =
        state.suggestions.length > 0 || state.accusations.length > 0;
    const ctaEnabled = allRequiredComplete || hasGameProgress;
    const ctaLabel = hasGameProgress
        ? tSetup("continuePlaying", { shortcut: "" })
        : tSetup("startPlaying", { shortcut: "" });

    const startPlaying = () => {
        if (!ctaEnabled) return;
        if (!hasGameProgress) {
            startSetup();
            gameSetupStarted();
        }
        setupWizardCompleted();
        dispatch({ type: "setUiMode", mode: "checklist" });
    };

    const newGame = async () => {
        const ok = await confirm({
            message: tToolbar("newGameConfirm"),
        });
        if (ok) {
            dispatch({ type: "newGame" });
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
            <header className="flex flex-col gap-1">
                <h2 className="m-0 text-[24px] font-semibold tracking-tight">
                    {t("heading")}
                </h2>
                <p className="m-0 text-[14px] text-muted">
                    {t("subheading")}
                </p>
            </header>

            <div
                className="flex flex-col gap-3"
                data-tour-anchor="setup-wizard-shell"
            >
                {steps.map((id, idx) => {
                    const stepNumber = idx + 1;
                    const totalSteps = steps.length;
                    const panelState = stepStateFor(id);
                    if (id === "cardPack") {
                        return (
                            <SetupStepCardPack
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onAdvance={() => advance(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    if (id === "players") {
                        return (
                            <SetupStepPlayers
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onAdvance={() => advance(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    if (id === "identity") {
                        return (
                            <SetupStepIdentity
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onAdvance={() => advance(id)}
                                onSkip={() => skip(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    if (id === "handSizes") {
                        return (
                            <SetupStepHandSizes
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onAdvance={() => advance(id)}
                                onSkip={() => skip(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    if (id === "myCards") {
                        // visibleSteps already gates this on
                        // selfPlayerId !== null, but TypeScript needs
                        // the runtime guard to narrow the prop.
                        if (state.selfPlayerId === null) return null;
                        return (
                            <SetupStepMyCards
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                selfPlayerId={state.selfPlayerId}
                                onAdvance={() => advance(id)}
                                onSkip={() => skip(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    if (id === "knownCards") {
                        return (
                            <SetupStepKnownCards
                                key={id}
                                state={panelState}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onAdvance={() => advance(id)}
                                onSkip={() => skip(id)}
                                onClickToEdit={() => reEnter(id)}
                            />
                        );
                    }
                    return null;
                })}
            </div>

            <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 border-t border-border/30 bg-bg/95 px-2 py-3 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                    onClick={newGame}
                >
                    {t("newGame")}
                </button>
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={startPlaying}
                    disabled={!ctaEnabled}
                    data-tour-anchor="setup-start-playing"
                    data-setup-cta=""
                >
                    {ctaLabel}
                </button>
            </div>
        </div>
    );
}
