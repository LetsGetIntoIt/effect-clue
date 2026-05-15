"use client";

import { useTranslations } from "next-intl";
import { useTeachModeToggle } from "../../components/useTeachModeToggle";
import { useClue } from "../../state";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState, WizardMode } from "../SetupStepPanel";

const STEP_ID = "teachMode" as const;

interface Props {
    readonly state: StepPanelState;
    readonly wizardMode: WizardMode;
    readonly stepNumber: number;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
}

/**
 * "Teach me mode" wizard step — a single optional toggle that flips
 * `state.teachMode`. Default off. The user can also toggle teach-mode
 * from the overflow menu at any point during a game.
 *
 * Always validates `valid` — fully optional. Skip = leave the toggle
 * in its current state (which is the same outcome the wizard yields
 * if the user never visits this step).
 */
export function SetupStepTeachMode({
    state,
    wizardMode,
    stepNumber,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("teachMode");
    const { state: clue } = useClue();
    const requestTeachMode = useTeachModeToggle();
    const teachMode = clue.teachMode;

    const summary = teachMode
        ? t("menuLabelActive")
        : t("wizardStepSummary");

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            wizardMode={wizardMode}
            stepNumber={stepNumber}
            title={t("wizardStepTitle")}
            summary={summary}
            validation={VALID}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[1rem] text-muted">
                {t("wizardStepSummary")}
            </p>
            <label className="flex cursor-pointer items-center gap-3 rounded border border-border bg-control p-3">
                <input
                    type="checkbox"
                    checked={teachMode}
                    onChange={e =>
                        requestTeachMode(e.currentTarget.checked, "wizard")
                    }
                />
                <span className="flex flex-col gap-1">
                    <span className="text-[1.125rem] font-semibold text-fg">
                        {t("wizardToggleLabel")}
                    </span>
                    <span className="text-[1rem] text-muted">
                        {t("wizardToggleHelp")}
                    </span>
                </span>
            </label>
        </SetupStepPanel>
    );
}
