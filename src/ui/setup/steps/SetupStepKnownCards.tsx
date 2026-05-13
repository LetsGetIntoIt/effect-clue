"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { PlayerColumnCardList } from "../shared/PlayerColumnCardList";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "knownCards" as const;

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
 * Step 6 — "Do you know any other player's cards?" (skippable).
 *
 * Iterates non-self players when `selfPlayerId` is set, or every
 * player when it isn't. Layout:
 *
 * - **Desktop (≥ 800px):** all relevant `<PlayerColumnCardList>`
 *   columns rendered side-by-side in a horizontal grid.
 * - **Mobile (< 800px):** single column with paginator (left / right
 *   arrow buttons + a "Player N of M" indicator).
 *
 * Same component on both layouts; only the container differs. The
 * mobile variant uses local state (`activeIndex`) to track which
 * player's column is showing; the desktop variant ignores it.
 */
export function SetupStepKnownCards({
    state,
    stepNumber,
    totalSteps,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.knownCards");
    const { state: clue } = useClue();
    const players = clue.setup.players;
    const selfPlayerId = clue.selfPlayerId;
    const targets =
        selfPlayerId === null
            ? players
            : players.filter(p => p !== selfPlayerId);

    const [activeIndex, setActiveIndex] = useState(0);
    useEffect(() => {
        if (activeIndex >= targets.length) {
            setActiveIndex(Math.max(0, targets.length - 1));
        }
    }, [targets.length, activeIndex]);

    const otherKnownCount = clue.knownCards.filter(
        kc => kc.player !== selfPlayerId,
    ).length;
    const summary =
        otherKnownCount === 0
            ? t("summaryEmpty")
            : t("summary", { count: otherKnownCount });

    if (targets.length === 0) {
        return (
            <SetupStepPanel
                stepId={STEP_ID}
                state={state}
                stepNumber={stepNumber}
                totalSteps={totalSteps}
                title={t("title")}
                summary={t("summaryEmpty")}
                validation={VALID}
                onClickToEdit={onClickToEdit}
                registerPanelEl={registerPanelEl}
                footer={footer}
            >
                <p className="m-0 text-[1rem] text-muted">
                    {t("noOtherPlayers")}
                </p>
            </SetupStepPanel>
        );
    }

    const currentPlayer = targets[activeIndex] as Player;

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
            <p className="m-0 text-[1rem] text-muted">{t("helperText")}</p>

            {/* Desktop: side-by-side grid. */}
            <div className="hidden gap-3 [@media(min-width:800px)]:grid [@media(min-width:800px)]:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                {targets.map(player => (
                    <PlayerColumnCardList
                        key={String(player)}
                        player={player}
                    />
                ))}
            </div>

            {/* Mobile: paginated. */}
            <div className="flex flex-col gap-2 [@media(min-width:800px)]:hidden">
                <div className="flex items-center justify-between gap-2">
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-control p-1.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-control"
                        disabled={activeIndex === 0}
                        aria-label={t("prevPlayer")}
                        onClick={() =>
                            setActiveIndex(i => Math.max(0, i - 1))
                        }
                    >
                        <ChevronLeftIcon size={16} />
                    </button>
                    <span className="text-[1rem] text-muted">
                        {t("paginator", {
                            current: activeIndex + 1,
                            total: targets.length,
                            player: String(currentPlayer),
                        })}
                    </span>
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-control p-1.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-control"
                        disabled={activeIndex >= targets.length - 1}
                        aria-label={t("nextPlayer")}
                        onClick={() =>
                            setActiveIndex(i =>
                                Math.min(targets.length - 1, i + 1),
                            )
                        }
                    >
                        <ChevronRightIcon size={16} />
                    </button>
                </div>
                <PlayerColumnCardList player={currentPlayer} />
            </div>
        </SetupStepPanel>
    );
}
