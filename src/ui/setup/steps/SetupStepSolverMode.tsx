"use client";

import { useTranslations } from "next-intl";
import { useSolverModeToggle } from "../../components/useSolverModeToggle";
import {
    SOLVER_MODE_CHECK,
    SOLVER_MODE_SOLVE,
} from "../../../logic/ClueState";
import { useClue } from "../../state";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState, WizardMode } from "../SetupStepPanel";

const STEP_ID = "teachMode" as const;
const TEACH_SOURCE_WIZARD = "wizard" as const;

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
 * "Apprentice mode" wizard step — a two-option radio group that flips
 * `state.solverMode` between `"solve"` and `"check"`. Default is
 * `"solve"`. The user can also flip this mid-game from the overflow
 * menu.
 *
 * Always validates `valid` — fully optional. Skip = leave the choice
 * in its current state (which is the same outcome the wizard yields
 * if the user never visits this step).
 */
export function SetupStepSolverMode({
    state,
    wizardMode,
    stepNumber,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("teachMode");
    const { state: clue } = useClue();
    const requestSolverMode = useSolverModeToggle();
    const inCheckMode = clue.solverMode === SOLVER_MODE_CHECK;

    const summary = inCheckMode
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
            <div
                role="radiogroup"
                aria-label={t("wizardStepTitle")}
                className="flex flex-col gap-2"
            >
                <ModeRadioOption
                    checked={!inCheckMode}
                    label={t("wizardOptionSolverLabel")}
                    help={t("wizardOptionSolverHelp")}
                    onSelect={() =>
                        requestSolverMode(
                            SOLVER_MODE_SOLVE,
                            TEACH_SOURCE_WIZARD,
                        )
                    }
                />
                <ModeRadioOption
                    checked={inCheckMode}
                    label={t("wizardOptionApprenticeLabel")}
                    help={t("wizardOptionApprenticeHelp")}
                    onSelect={() =>
                        requestSolverMode(
                            SOLVER_MODE_CHECK,
                            TEACH_SOURCE_WIZARD,
                        )
                    }
                />
            </div>
            <p className="m-0 text-[0.9375rem] text-muted">
                {t("wizardToggleHelp")}
            </p>
        </SetupStepPanel>
    );
}

function ModeRadioOption({
    checked,
    label,
    help,
    onSelect,
}: {
    readonly checked: boolean;
    readonly label: string;
    readonly help: string;
    readonly onSelect: () => void;
}) {
    return (
        <label className="flex cursor-pointer items-start gap-3 rounded border border-border bg-control p-3">
            <input
                type="radio"
                checked={checked}
                onChange={(e) => {
                    if (e.currentTarget.checked) onSelect();
                }}
                className="mt-1"
            />
            <span className="flex flex-col gap-1">
                <span className="text-[1.125rem] font-semibold text-fg">
                    {label}
                </span>
                <span className="text-[1rem] text-muted">{help}</span>
            </span>
        </label>
    );
}
