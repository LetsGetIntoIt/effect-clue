"use client";

import { useTranslations } from "next-intl";
import { useClue } from "../../state";
import { PlayerListReorder } from "../shared/PlayerListReorder";
import { SetupStepPanel } from "../SetupStepPanel";
import {
    VALID,
    VALIDATION_BLOCKED,
    type StepValidation,
    type WizardStepId,
} from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

// Step id discriminator hoisted so it isn't flagged as user copy.
const STEP_ID = "players" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
}

/**
 * Step 2 — "Who are the players?"
 *
 * Renders the helper text first (turn-order hint), then the
 * `<PlayerListReorder>` widget for drag/keyboard reordering, name
 * editing, and add/remove. Validation: blocked when fewer than two
 * players. The duplicate-name guard is per-row (inline) and doesn't
 * surface here.
 *
 * Not skippable — at least two players are required for any
 * meaningful Clue game.
 */
export function SetupStepPlayers({
    state,
    stepNumber,
    totalSteps,
    onClickToEdit,
    registerPanelEl,
}: Props) {
    const t = useTranslations("setupWizard.players");
    const { state: clue } = useClue();
    const players = clue.setup.players;

    const validation: StepValidation =
        players.length < 2
            ? { level: VALIDATION_BLOCKED, message: t("validationMin") }
            : VALID;

    const summary =
        players.length === 0
            ? t("summaryEmpty")
            : t("summary", {
                  count: players.length,
                  names: players.map(p => String(p)).join(", "),
              });

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={summary}
            validation={validation}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
        >
            <p className="m-0 text-[13px] text-muted">
                {t("turnOrderHint")}
            </p>
            <PlayerListReorder />
        </SetupStepPanel>
    );
}
