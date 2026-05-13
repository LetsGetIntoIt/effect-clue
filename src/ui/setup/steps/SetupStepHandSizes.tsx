"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
    type WizardStepId,
} from "../wizardSteps";
import type { StepPanelState, WizardMode } from "../SetupStepPanel";

const STEP_ID = "handSizes" as const;

interface Props {
    readonly state: StepPanelState;
    readonly wizardMode: WizardMode;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onClickToEdit: () => void;
    /**
     * Register a callback the wizard fires before transitioning
     * away from this step. Used to commit placeholder defaults to
     * `state.handSizes` when the user advances without typing
     * anything — treat the displayed default as an active choice.
     *
     * The wizard owns a single `beforeAdvance` slot (the focused
     * step writes to it; the wizard reads + clears on advance/skip).
     * Steps that don't need it can ignore the prop.
     */
    readonly registerBeforeAdvance?: (fn: (() => void) | null) => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
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
    wizardMode,
    stepNumber,
    totalSteps,
    onClickToEdit,
    registerBeforeAdvance,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.handSizes");
    const { state: clue, dispatch } = useClue();
    const setup = clue.setup;
    const players = setup.players;

    /**
     * On advance/skip from this step, commit the currently-displayed
     * placeholder default for any player without a typed value.
     * Treats accepting the default as an active choice rather than
     * leaving the field unset.
     *
     * Re-registers on every render while editing so the closure
     * captures the latest `clue.handSizes` / `firstDealtPlayerId` /
     * `setup.players` — re-running with stale values would commit
     * the wrong defaults.
     */
    useEffect(() => {
        if (state !== "editing" || registerBeforeAdvance === undefined) {
            return;
        }
        registerBeforeAdvance(() => {
            const liveMap = new Map(clue.handSizes);
            const liveDefaults = new Map(
                firstDealtHandSizes(setup, clue.firstDealtPlayerId),
            );
            for (const player of setup.players) {
                if (liveMap.has(player)) continue;
                const def = liveDefaults.get(player);
                if (def === undefined) continue;
                dispatch({ type: "setHandSize", player, size: def });
            }
        });
        return () => registerBeforeAdvance(null);
    }, [
        state,
        registerBeforeAdvance,
        clue.handSizes,
        clue.firstDealtPlayerId,
        setup,
        dispatch,
    ]);

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
            wizardMode={wizardMode}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={summary}
            validation={validation}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            {players.length === 0 ? (
                <p className="m-0 text-[1rem] text-muted">
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
                                <span className="min-w-0 truncate text-[1rem]">
                                    {String(player)}
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={allCardIds(setup).length}
                                    className="w-16 rounded border border-border px-2 py-1 text-center text-[1rem]"
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
            <summary className="cursor-pointer text-[1rem] text-muted">
                {t("adjustDealingTitle")}
            </summary>
            <fieldset className="m-0 mt-3 flex flex-col gap-2 border-none p-0">
                <legend className="m-0 mb-1 p-0 text-[1rem] text-muted">
                    {t("firstDealtLegend")}
                </legend>
                <label className="flex cursor-pointer items-center gap-2 text-[1rem]">
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
                        className="flex cursor-pointer items-center gap-2 text-[1rem]"
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
