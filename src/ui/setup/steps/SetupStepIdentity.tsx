"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { setupSelfPlayerSet } from "../../../analytics/events";
import { useClue } from "../../state";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "identity" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onClickToEdit: () => void;
    /**
     * Register a beforeSkip callback the wizard fires before
     * advancing on Skip. Identity uses this to clear `selfPlayerId`
     * if the user has set themselves and then opts to skip — the
     * "Skip = un-set" semantic preserved across the unified sticky
     * CTA bar.
     */
    readonly registerBeforeSkip?: (fn: (() => void) | null) => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
}

/**
 * Step 3 — "Who are you?" (skippable, no consequences).
 *
 * Renders one pill per player — clicking sets `selfPlayerId`,
 * clicking the active pill clears it. The skip explainer below
 * mentions what's gated on identity (My cards, refute hints) so the
 * user knows what they're trading for; no shaming copy if they
 * skip.
 *
 * Always validates `valid` — identity is fully optional.
 */
export function SetupStepIdentity({
    state,
    stepNumber,
    totalSteps,
    onClickToEdit,
    registerBeforeSkip,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.identity");
    const { state: clue, dispatch } = useClue();
    const players = clue.setup.players;
    const selfPlayerId = clue.selfPlayerId;

    // Skip-clears-identity: when the user advances via Skip after
    // having selected themselves, un-set selfPlayerId. Re-registers
    // on every render while editing so the closure captures the
    // latest selfPlayerId value (avoids un-setting on stale ref).
    useEffect(() => {
        if (state !== "editing" || registerBeforeSkip === undefined) {
            return;
        }
        registerBeforeSkip(() => {
            if (clue.selfPlayerId !== null) {
                dispatch({ type: "setSelfPlayer", player: null });
                setupSelfPlayerSet({ cleared: true });
            }
        });
        return () => registerBeforeSkip(null);
    }, [state, registerBeforeSkip, clue.selfPlayerId, dispatch]);

    const summary =
        selfPlayerId === null
            ? t("summarySkipped")
            : t("summary", { player: String(selfPlayerId) });

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={summary}
            validation={VALID}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[1rem] text-muted">
                {t("helperText")}
            </p>
            {players.length === 0 ? (
                <p className="m-0 text-[1rem] text-muted">
                    {t("noPlayersHint")}
                </p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {players.map(player => {
                        const active = selfPlayerId === player;
                        return (
                            <button
                                key={String(player)}
                                type="button"
                                className={`tap-target-compact text-tap-compact cursor-pointer rounded-full border transition-colors ${
                                    active
                                        ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                        : "border-border bg-control text-fg hover:bg-hover"
                                }`}
                                aria-pressed={active}
                                onClick={() => {
                                    const next = active ? null : player;
                                    dispatch({
                                        type: "setSelfPlayer",
                                        player: next,
                                    });
                                    setupSelfPlayerSet({
                                        cleared: next === null,
                                    });
                                }}
                            >
                                {String(player)}
                            </button>
                        );
                    })}
                </div>
            )}
        </SetupStepPanel>
    );
}
