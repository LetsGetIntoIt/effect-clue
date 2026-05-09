"use client";

import { useTranslations } from "next-intl";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { PlayerColumnCardList } from "../shared/PlayerColumnCardList";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "myCards" as const;

// Tour anchor shared with `tours.ts` setup step 4 ("Mark your cards").
// Pulled to module scope so the i18next/no-literal-string lint treats
// it as a wire identifier, not user copy.
const FIRST_ROW_TOUR_ANCHOR = "setup-step-mycards-firstrow" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly selfPlayerId: Player;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
}

/**
 * Step 5 — "Which cards do you have?"
 *
 * Rendered only when `selfPlayerId !== null`; the parent guards
 * mounting via `visibleSteps()`, so the step receives the resolved
 * `selfPlayerId` as a prop and never has to handle null.
 *
 * Skippable. The user may not want to mark every card up front, and
 * setting them later via the cell-popover sightings (M9) is fine.
 */
export function SetupStepMyCards({
    state,
    stepNumber,
    totalSteps,
    selfPlayerId,
    onClickToEdit,
    registerPanelEl,
}: Props) {
    const t = useTranslations("setupWizard.myCards");
    const { state: clue } = useClue();
    const ownedCount = clue.knownCards.filter(
        kc => kc.player === selfPlayerId,
    ).length;
    const summary =
        ownedCount === 0
            ? t("summaryEmpty")
            : t("summary", { count: ownedCount });

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
        >
            <p className="m-0 text-[13px] text-muted">{t("helperText")}</p>
            <PlayerColumnCardList
                player={selfPlayerId}
                heading={t("yourHand")}
                firstRowTourAnchor={FIRST_ROW_TOUR_ANCHOR}
            />
        </SetupStepPanel>
    );
}
