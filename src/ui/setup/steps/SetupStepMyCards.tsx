"use client";

import { useTranslations } from "next-intl";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { CardSelectionGrid } from "../shared/CardSelectionGrid";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState, WizardMode } from "../SetupStepPanel";

const STEP_ID = "myCards" as const;

// Tour anchor shared with `tours.ts` setup step 4 ("Mark your cards").
// Pulled to module scope so the i18next/no-literal-string lint treats
// it as a wire identifier, not user copy.
const FIRST_ROW_TOUR_ANCHOR = "setup-step-mycards-firstrow" as const;

interface Props {
    readonly state: StepPanelState;
    readonly wizardMode: WizardMode;
    readonly stepNumber: number;
    readonly selfPlayerId: Player;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
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
    wizardMode,
    stepNumber,
    selfPlayerId,
    onClickToEdit,
    registerPanelEl,
    footer,
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
            wizardMode={wizardMode}
            stepNumber={stepNumber}
            title={t("title")}
            summary={summary}
            validation={VALID}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[1rem] text-muted">{t("helperText")}</p>
            <CardSelectionGrid
                players={[selfPlayerId]}
                firstCellTourAnchor={FIRST_ROW_TOUR_ANCHOR}
            />
        </SetupStepPanel>
    );
}
