"use client";

import { useTranslations } from "next-intl";
import { useClue } from "../../state";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID } from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "identity" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onAdvance: () => void;
    readonly onSkip: () => void;
    readonly onClickToEdit: () => void;
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
    onAdvance,
    onSkip,
    onClickToEdit,
}: Props) {
    const t = useTranslations("setupWizard.identity");
    const { state: clue, dispatch } = useClue();
    const players = clue.setup.players;
    const selfPlayerId = clue.selfPlayerId;

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
            skippable={true}
            validation={VALID}
            onAdvance={onAdvance}
            onSkip={() => {
                if (selfPlayerId !== null) {
                    dispatch({ type: "setSelfPlayer", player: null });
                }
                onSkip();
            }}
            onClickToEdit={onClickToEdit}
        >
            <p className="m-0 text-[13px] text-muted">
                {t("helperText")}
            </p>
            {players.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">
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
                                className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                                    active
                                        ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                        : "border-border bg-bg text-fg hover:bg-hover"
                                }`}
                                aria-pressed={active}
                                onClick={() =>
                                    dispatch({
                                        type: "setSelfPlayer",
                                        player: active ? null : player,
                                    })
                                }
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
