"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useCustomCardPacks } from "../../../data/customCardPacks";
import type { CardSet } from "../../../logic/CardSet";
import { CARD_SETS } from "../../../logic/GameSetup";
import { useConfirm } from "../../hooks/useConfirm";
import { useClue } from "../../state";
import { SetupStepCardPackCustomize } from "./SetupStepCardPackCustomize";
import { SetupStepPanel } from "../SetupStepPanel";
import {
    VALID,
    VALIDATION_BLOCKED,
    type StepValidation,
} from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "cardPack" as const;
// Tour anchor shared with the M6 setup tour's "Card pack" step.
const PILLS_TOUR_ANCHOR = "setup-step-cardpack-pills" as const;

interface Props {
    readonly state: StepPanelState;
    readonly stepNumber: number;
    readonly totalSteps: number;
    readonly onAdvance: () => void;
    readonly onClickToEdit: () => void;
}

interface Pill {
    readonly id: string;
    readonly label: string;
    readonly isCustom: boolean;
    readonly load: () => void;
}

/**
 * Step 1 — "Pick a card pack."
 *
 * Pill row: every available pack — bundled (Classic, Master
 * Detective) + the user's saved custom packs. Click a pill to load
 * the deck. Below the pills, a "Customize" button expands the
 * panel into the customize sub-flow (rename / add / remove
 * categories and cards inline).
 *
 * Not skippable — every game needs a deck. The default new-game
 * preset has Classic loaded, so the user can advance with one
 * click. Validation blocks if `setup.categories.length === 0`
 * (defensive — bundled packs always have categories, but the
 * customize sub-flow could in principle empty them).
 */
export function SetupStepCardPack({
    state,
    stepNumber,
    totalSteps,
    onAdvance,
    onClickToEdit,
}: Props) {
    const t = useTranslations("setupWizard.cardPack");
    const { state: clue, dispatch } = useClue();
    const confirm = useConfirm();
    const customPacksQuery = useCustomCardPacks();
    const customPacks = customPacksQuery.data ?? [];
    const setup = clue.setup;

    const [showCustomize, setShowCustomize] = useState(false);
    // The custom pack the user most recently loaded via a pill, if
    // any. Drives the "Update {label}" footer button in the customize
    // sub-flow — only meaningful when the user explicitly started
    // from a saved pack. Cleared if they load a built-in afterwards
    // or save-as a new one. Component-local; resets when the wizard
    // remounts (cold start, fresh game), which is fine — re-clicking
    // a pill is a one-tap recovery.
    const [loadedFromCustomPackId, setLoadedFromCustomPackId] = useState<
        string | null
    >(null);
    const loadedCustomPack =
        loadedFromCustomPackId === null
            ? null
            : customPacks.find(p => p.id === loadedFromCustomPackId) ?? null;

    const hasDestructiveData =
        clue.knownCards.length > 0 ||
        clue.suggestions.length > 0 ||
        clue.handSizes.length > 0;

    const load = async (input: {
        readonly cardSet: CardSet;
        readonly label: string;
        readonly fromCustomPackId: string | null;
    }) => {
        if (
            hasDestructiveData &&
            !(await confirm({ message: t("loadConfirm") }))
        ) {
            return;
        }
        dispatch({
            type: "loadCardSet",
            cardSet: input.cardSet,
            label: input.label,
        });
        setLoadedFromCustomPackId(input.fromCustomPackId);
    };

    const pills = useMemo<ReadonlyArray<Pill>>(() => {
        const builtIn: ReadonlyArray<Pill> = CARD_SETS.map(p => ({
            id: p.id,
            label: p.label,
            isCustom: false,
            load: () => {
                void load({
                    cardSet: p.cardSet,
                    label: p.label,
                    fromCustomPackId: null,
                });
            },
        }));
        const custom: ReadonlyArray<Pill> = customPacks.map(p => ({
            id: p.id,
            label: p.label,
            isCustom: true,
            load: () => {
                void load({
                    cardSet: p.cardSet,
                    label: p.label,
                    fromCustomPackId: p.id,
                });
            },
        }));
        return [...builtIn, ...custom];
    }, [customPacks]);

    const cardCount = setup.categories.reduce(
        (acc, c) => acc + c.cards.length,
        0,
    );
    const summary =
        setup.categories.length === 0
            ? t("summaryEmpty")
            : t("summary", {
                  categories: setup.categories.length,
                  cards: cardCount,
              });

    const validation: StepValidation =
        setup.categories.length < 1
            ? { level: VALIDATION_BLOCKED, message: t("validationEmpty") }
            : VALID;

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            stepNumber={stepNumber}
            totalSteps={totalSteps}
            title={t("title")}
            summary={summary}
            skippable={false}
            validation={validation}
            onAdvance={onAdvance}
            onClickToEdit={onClickToEdit}
        >
            <p className="m-0 text-[13px] text-muted">{t("helperText")}</p>

            <div
                className="flex flex-wrap gap-2"
                data-tour-anchor={PILLS_TOUR_ANCHOR}
            >
                {pills.map(pill => (
                    <button
                        key={pill.id}
                        type="button"
                        className="cursor-pointer rounded-full border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                        onClick={pill.load}
                    >
                        {pill.label}
                    </button>
                ))}
            </div>

            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    className="self-start cursor-pointer rounded border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                    onClick={() => setShowCustomize(prev => !prev)}
                    aria-expanded={showCustomize}
                >
                    {showCustomize
                        ? t("customizeCollapse")
                        : t("customizeExpand")}
                </button>
                {showCustomize && (
                    <SetupStepCardPackCustomize
                        loadedCustomPack={loadedCustomPack}
                        onSavedAsNewPack={packId =>
                            setLoadedFromCustomPackId(packId)
                        }
                    />
                )}
            </div>
        </SetupStepPanel>
    );
}
