"use client";

import { useTranslations } from "next-intl";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";
import { useShareContext } from "../../share/ShareProvider";

const STEP_ID = "inviteOtherPlayers" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
}

/**
 * Optional final wizard step. Pitches inviting another player to
 * follow the game on their own device, with a single button that
 * pushes the share modal in invite-variant. The wizard's `isLastStep`
 * detection puts the "Start playing" CTA on this panel's footer, so
 * the user can either send an invite first or skip straight to play.
 *
 * Carries `data-tour-anchor="setup-invite-player"` so the existing
 * `sharing` tour finds its target — the anchor was previously
 * referenced by `tours.ts` but no DOM element provided it.
 */
export function SetupStepInviteOtherPlayers({
    state,
    stepNumber,
    totalSteps,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.inviteOtherPlayers");
    const { openInvitePlayer } = useShareContext();
    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={t("summarySkipped")}
            validation={VALID}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[1rem] leading-relaxed text-[#2a1f12]">
                {t("description")}
            </p>
            <button
                type="button"
                onClick={() => openInvitePlayer()}
                data-tour-anchor="setup-invite-player"
                className="tap-target text-tap inline-flex cursor-pointer items-center justify-center gap-2 self-start rounded-[var(--radius)] border-2 border-accent bg-accent px-5 font-semibold text-white hover:bg-accent-hover"
            >
                {t("cta")}
            </button>
        </SetupStepPanel>
    );
}
