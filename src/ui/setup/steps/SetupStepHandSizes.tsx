"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { setupFirstDealtPlayerSet } from "../../../analytics/events";
import { allCardIds, caseFileSize } from "../../../logic/CardSet";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { firstDealtHandSizes } from "../firstDealt";
import { SetupStepPanel } from "../SetupStepPanel";
import {
    VALID,
    VALIDATION_WARNING,
    type StepValidation,
} from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "handSizes" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onAdvance: () => void;
    readonly onSkip: () => void;
    readonly onClickToEdit: () => void;
}

/**
 * Step 4 — "How many cards does each person have?" (skippable).
 *
 * One row per player with the dealing-default as placeholder and an
 * editable number input. Defaults are computed from `firstDealtHandSizes`
 * so the "Adjust dealing" affordance below changes them in lockstep
 * with the user's pick.
 *
 * "Adjust dealing" is a `<details>` so the default state is clean —
 * most users won't open it. Inside it, a radio group picks the
 * first-dealt player; "(automatic — first in turn order)" is the
 * `null` choice.
 *
 * Validation: warning banner when totals don't add up. Doesn't block
 * advancement (today's checklist also warns without blocking).
 */
export function SetupStepHandSizes({
    state,
    stepNumber,
    totalSteps,
    onAdvance,
    onSkip,
    onClickToEdit,
}: Props) {
    const t = useTranslations("setupWizard.handSizes");
    const { state: clue, dispatch } = useClue();
    const setup = clue.setup;
    const players = setup.players;

    const handSizeMap = new Map(clue.handSizes);
    const defaults = new Map(
        firstDealtHandSizes(setup, clue.firstDealtPlayerId),
    );
    const totalDealt = allCardIds(setup).length - caseFileSize(setup);
    const setSizes = players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allSet = setSizes.length === players.length && players.length > 0;
    const totalEntered = setSizes.reduce((a, b) => a + b, 0);
    const mismatch = allSet && totalEntered !== totalDealt;

    const validation: StepValidation = mismatch
        ? {
              level: VALIDATION_WARNING,
              message: t("mismatch", {
                  total: totalEntered,
                  expected: totalDealt,
              }),
          }
        : VALID;

    const onChange = (player: Player, raw: string) => {
        if (raw === "") {
            dispatch({ type: "setHandSize", player, size: undefined });
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
            dispatch({ type: "setHandSize", player, size: n });
        }
    };

    const summary = (() => {
        if (players.length === 0) return t("summaryNoPlayers");
        if (allSet) {
            return t("summary", { total: totalEntered });
        }
        return t("summaryPartial");
    })();

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={summary}
            skippable={true}
            validation={validation}
            onAdvance={onAdvance}
            onSkip={onSkip}
            onClickToEdit={onClickToEdit}
        >
            {players.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">
                    {t("noPlayersHint")}
                </p>
            ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {players.map(player => {
                        const current = handSizeMap.get(player);
                        const def = defaults.get(player);
                        return (
                            <li
                                key={String(player)}
                                className="flex items-center justify-between gap-3 rounded border border-border/40 px-3 py-2"
                            >
                                <span className="min-w-0 truncate text-[14px]">
                                    {String(player)}
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={allCardIds(setup).length}
                                    className="w-16 rounded border border-border px-2 py-1 text-center text-[14px]"
                                    value={
                                        current === undefined
                                            ? ""
                                            : String(current)
                                    }
                                    placeholder={
                                        def === undefined ? "" : String(def)
                                    }
                                    aria-label={t("handSizeAria", {
                                        player: String(player),
                                    })}
                                    onChange={e =>
                                        onChange(player, e.currentTarget.value)
                                    }
                                />
                            </li>
                        );
                    })}
                </ul>
            )}

            <AdjustDealing />
        </SetupStepPanel>
    );
}

/**
 * Collapsed-by-default `<details>` that lets the user pick a
 * first-dealt player. The radio group binds to `firstDealtPlayerId`;
 * the `null` option is "(automatic — first in turn order)" and is
 * the default.
 */
function AdjustDealing() {
    const t = useTranslations("setupWizard.handSizes");
    const { state, dispatch } = useClue();
    const players = state.setup.players;
    const firstDealt = state.firstDealtPlayerId;

    const [open, setOpen] = useState(firstDealt !== null);

    if (players.length === 0) return null;

    return (
        <details
            className="rounded border border-border/30 px-3 py-2"
            open={open}
            onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="cursor-pointer text-[13px] text-muted">
                {t("adjustDealingTitle")}
            </summary>
            <fieldset className="m-0 mt-3 flex flex-col gap-2 border-none p-0">
                <legend className="m-0 mb-1 p-0 text-[12px] text-muted">
                    {t("firstDealtLegend")}
                </legend>
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                        type="radio"
                        name="first-dealt"
                        checked={firstDealt === null}
                        onChange={() => {
                            dispatch({
                                type: "setFirstDealtPlayer",
                                player: null,
                            });
                            setupFirstDealtPlayerSet({ auto: true });
                        }}
                    />
                    {t("firstDealtAuto")}
                </label>
                {players.map(player => (
                    <label
                        key={String(player)}
                        className="flex cursor-pointer items-center gap-2 text-[13px]"
                    >
                        <input
                            type="radio"
                            name="first-dealt"
                            checked={firstDealt === player}
                            onChange={() => {
                                dispatch({
                                    type: "setFirstDealtPlayer",
                                    player,
                                });
                                setupFirstDealtPlayerSet({ auto: false });
                            }}
                        />
                        {String(player)}
                    </label>
                ))}
            </fieldset>
        </details>
    );
}
