"use client";

import { DateTime } from "effect";
import { LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
    cardPackPickerOpened,
    cardPackSelected,
    cardsDealt,
} from "../../../analytics/events";
import {
    useCustomCardPacks,
} from "../../../data/customCardPacks";
import {
    useCardPackUsage,
    useForgetCardPackUse,
    useRecordCardPackUse,
} from "../../../data/cardPackUsage";
import { topRecentPacks } from "../../../logic/CardPackUsage";
import { cardSetEquals, type CardSet } from "../../../logic/CardSet";
import type { CustomCardSet } from "../../../logic/CustomCardSets";
import { CARD_SETS } from "../../../logic/GameSetup";
import { useConfirm } from "../../hooks/useConfirm";
import { T_STANDARD, useReducedTransition } from "../../motion";
import { useClue } from "../../state";
import { useCardPackActions } from "../../components/cardPackActions";
import {
    CardPackPicker,
    type PickerPack,
} from "../../components/CardPackPicker";
import { SetupStepCardPackCustomize } from "./SetupStepCardPackCustomize";
import { SetupStepPanel } from "../SetupStepPanel";
import {
    VALID,
    VALIDATION_BLOCKED,
    type StepValidation,
    type WizardStepId,
} from "../wizardSteps";
import type { StepPanelState } from "../SetupStepPanel";

const STEP_ID = "cardPack" as const;
// Tour anchor shared with the M6 setup tour's "Card pack" step.
const PILLS_TOUR_ANCHOR = "setup-step-cardpack-pills" as const;

// Surface budget: Classic always pinned + 3 MRU non-Classic = 4 pills
// before the dropdown takes over. Mirrors the legacy CardPackRow.
const RECENT_LIMIT = 3;
const SURFACE_BUDGET = 1 + RECENT_LIMIT;

// Wire-format strings for the cardPackSelected event — module scope
// so the i18next/no-literal-string lint reads them as identifiers.
const PACK_TYPE_BUILT_IN = "built-in" as const;
const PACK_TYPE_CUSTOM = "custom" as const;
const SOURCE_PINNED = "pinned" as const;
const SOURCE_RECENT = "recent" as const;
const SOURCE_SEARCH = "search" as const;

const TRUE_LITERAL = "true" as const;
// Wire option for `localeCompare` — module-scope so the
// i18next/no-literal-string lint reads it as a configuration
// identifier, not user copy.
const LOCALE_COMPARE_OPTIONS = { sensitivity: "base" } as const;

interface DisplayPack {
    readonly id: string;
    readonly label: string;
    readonly cardSet: CardSet;
    readonly isCustom: boolean;
}

const toDisplayPack = (
    pack: CustomCardSet | (typeof CARD_SETS)[number],
    isCustom: boolean,
): DisplayPack => ({
    id: pack.id,
    label: pack.label,
    cardSet: pack.cardSet,
    isCustom,
});

const toPickerPack = (pack: DisplayPack): PickerPack => ({
    id: pack.id,
    label: pack.label,
    isCustom: pack.isCustom,
});

const totalCardsIn = (cardSet: CardSet): number =>
    cardSet.categories.reduce((n, c) => n + c.cards.length, 0);

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
 * Step 1 — "Pick a card pack."
 *
 * Pill row layout scales with the user's library:
 *   - Classic is always pinned as the first pill.
 *   - The next up to 3 pills are the most-recently-used non-Classic
 *     packs (recency tracked per pack id, see CardPackUsage).
 *   - When the user has more than 4 total packs, an "All card packs"
 *     trailing pill opens a typeahead dropdown listing every pack
 *     alphabetically.
 *
 * The active pack — the one whose contents match the live deck —
 * gets accent styling (`border-accent bg-accent text-white`) so the
 * user sees at a glance which deck is loaded. As soon as the user
 * customizes anything, the active match flips to undefined and the
 * styling drops off (the "Update {label}" button in the customize
 * sub-flow takes over from there).
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
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.cardPack");
    const tSetup = useTranslations("setup");
    const { state: clue, dispatch } = useClue();
    const confirm = useConfirm();
    const customPacksQuery = useCustomCardPacks();
    const usageQuery = useCardPackUsage();
    const customPacks = customPacksQuery.data ?? [];
    const usage = usageQuery.data ?? new Map();
    const recordUseMutation = useRecordCardPackUse();
    const forgetUseMutation = useForgetCardPackUse();
    const cardPackActions = useCardPackActions();
    const setup = clue.setup;

    const [showCustomize, setShowCustomize] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    // Single transition routed through useReducedTransition so the
    // pill reposition (Framer Motion FLIP) collapses to instant when
    // the user has prefers-reduced-motion. Mirrors the legacy
    // `CardPackRow` behavior where surface pills smoothly slide
    // when MRU ordering shifts after a load.
    const pillLayoutTransition = useReducedTransition(T_STANDARD);

    const classic = CARD_SETS[0]!;
    const classicDisplay = useMemo<DisplayPack>(
        () => toDisplayPack(classic, false),
        [classic],
    );

    const otherPacks = useMemo<ReadonlyArray<DisplayPack>>(() => {
        const otherBuiltIns = CARD_SETS.slice(1).map(p =>
            toDisplayPack(p, false),
        );
        const customs = customPacks.map(p => toDisplayPack(p, true));
        return [...otherBuiltIns, ...customs];
    }, [customPacks]);

    const allPacks = useMemo<ReadonlyArray<DisplayPack>>(
        () => [classicDisplay, ...otherPacks],
        [classicDisplay, otherPacks],
    );

    /**
     * The pack the user last loaded, *if* the live deck still matches
     * its contents by `cardSetEquals`. Tracked by recency (most-recent
     * usage entry whose pack still matches). Falls back to Classic on
     * first run before any pack is recorded. Returns `undefined` once
     * the live deck diverges from any saved pack.
     */
    const activeMatch = useMemo<DisplayPack | undefined>(() => {
        let candidateId: string | undefined;
        let mostRecent: DateTime.Utc | undefined;
        for (const [id, at] of usage.entries()) {
            if (
                !mostRecent ||
                DateTime.toEpochMillis(at) > DateTime.toEpochMillis(mostRecent)
            ) {
                mostRecent = at;
                candidateId = id;
            }
        }
        if (!candidateId) candidateId = classic.id;
        const candidate = allPacks.find(p => p.id === candidateId);
        if (!candidate) return undefined;
        return cardSetEquals(setup.cardSet, candidate.cardSet)
            ? candidate
            : undefined;
    }, [allPacks, setup.cardSet, usage, classic.id]);

    /**
     * The user-owned pack most-recently loaded, regardless of whether
     * the live deck still matches. Drives the "Update {label}" button
     * in the customize sub-flow's footer — built-ins never qualify
     * (their canonical copy lives in code, not the user's library).
     */
    const loadedCustomPack = useMemo<CustomCardSet | undefined>(() => {
        let candidate: CustomCardSet | undefined;
        let mostRecent: DateTime.Utc | undefined;
        for (const [id, at] of usage.entries()) {
            const pack = customPacks.find(p => p.id === id);
            if (!pack) continue;
            if (
                !mostRecent ||
                DateTime.toEpochMillis(at) > DateTime.toEpochMillis(mostRecent)
            ) {
                mostRecent = at;
                candidate = pack;
            }
        }
        return candidate;
    }, [customPacks, usage]);

    const recents = useMemo<ReadonlyArray<DisplayPack>>(() => {
        const baseRecents = topRecentPacks(otherPacks, usage, RECENT_LIMIT);
        if (!activeMatch || activeMatch.id === classic.id) return baseRecents;
        const withoutMatch = baseRecents.filter(p => p.id !== activeMatch.id);
        return [activeMatch, ...withoutMatch].slice(0, RECENT_LIMIT);
    }, [otherPacks, usage, activeMatch, classic.id]);

    const surfacePacks = useMemo<ReadonlyArray<DisplayPack>>(
        () => [classicDisplay, ...recents],
        [classicDisplay, recents],
    );

    const showAllCardPacksPill = allPacks.length > SURFACE_BUDGET;

    /**
     * Sorted alphabetically with Classic pinned first; this is what
     * the typeahead dropdown displays before any filtering.
     */
    const dropdownOrder = useMemo<ReadonlyArray<DisplayPack>>(() => {
        const sorted = [...otherPacks].sort((a, b) =>
            a.label.localeCompare(b.label, undefined, LOCALE_COMPARE_OPTIONS),
        );
        return [classicDisplay, ...sorted];
    }, [classicDisplay, otherPacks]);

    const pickerPacks = useMemo<ReadonlyArray<PickerPack>>(
        () => dropdownOrder.map(toPickerPack),
        [dropdownOrder],
    );

    const findDisplayPack = (id: string): DisplayPack | undefined =>
        allPacks.find(p => p.id === id);

    const hasDestructiveData =
        clue.knownCards.length > 0 ||
        clue.suggestions.length > 0 ||
        clue.handSizes.length > 0;

    const performLoad = async (
        pack: DisplayPack,
        source: typeof SOURCE_PINNED | typeof SOURCE_RECENT | typeof SOURCE_SEARCH,
    ): Promise<void> => {
        if (
            hasDestructiveData &&
            !(await confirm({ message: t("loadConfirm") }))
        ) {
            return;
        }
        dispatch({
            type: "loadCardSet",
            cardSet: pack.cardSet,
            label: pack.label,
        });
        cardsDealt({
            playerCount: clue.setup.players.length,
            totalCards: totalCardsIn(pack.cardSet),
        });
        cardPackSelected({
            packType: pack.isCustom ? PACK_TYPE_CUSTOM : PACK_TYPE_BUILT_IN,
            source,
        });
        recordUseMutation.mutate(pack.id);
    };

    const onSelectFromSurface = (pack: DisplayPack) => {
        const source = pack.id === classic.id ? SOURCE_PINNED : SOURCE_RECENT;
        void performLoad(pack, source);
    };

    const onSelectFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack) return;
        void performLoad(pack, SOURCE_SEARCH);
    };

    const toActionTarget = (pack: DisplayPack) => ({
        clientGeneratedId: pack.id,
        label: pack.label,
        cardSet: pack.cardSet,
    });

    const onDeleteCustomPack = async (pack: DisplayPack) => {
        const ok = await cardPackActions.deletePack(toActionTarget(pack));
        if (!ok) return;
        forgetUseMutation.mutate(pack.id);
    };

    const onDeleteFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack || !pack.isCustom) return;
        void onDeleteCustomPack(pack);
    };

    const onRenameFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack || !pack.isCustom) return;
        void cardPackActions.renamePack(toActionTarget(pack));
    };

    const onSharePackFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack) return;
        cardPackActions.sharePack(toActionTarget(pack));
    };

    const onPickerOpenChange = (next: boolean) => {
        setPickerOpen(next);
        if (next) cardPackPickerOpened();
    };

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
            validation={validation}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[13px] text-muted">{t("helperText")}</p>

            <div
                className="flex flex-wrap items-center gap-2"
                data-tour-anchor={PILLS_TOUR_ANCHOR}
            >
                <LayoutGroup id="card-pack-surface">
                    {surfacePacks.map(pack => {
                        const isActive = pack.id === activeMatch?.id;
                        return (
                            <motion.span
                                key={pack.id}
                                layout
                                transition={pillLayoutTransition}
                                className="inline-flex"
                            >
                                <button
                                    type="button"
                                    className={
                                        "cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors duration-200 ease-out " +
                                        (isActive
                                            ? "border-accent bg-accent font-semibold text-white"
                                            : "border-border bg-bg hover:bg-hover")
                                    }
                                    aria-pressed={isActive}
                                    data-card-pack-active={
                                        isActive ? TRUE_LITERAL : undefined
                                    }
                                    onClick={() => onSelectFromSurface(pack)}
                                    title={
                                        pack.isCustom
                                            ? tSetup(
                                                  "loadCustomCardSetTitle",
                                                  { label: pack.label },
                                              )
                                            : pack.label
                                    }
                                >
                                    {pack.label}
                                </button>
                            </motion.span>
                        );
                    })}
                </LayoutGroup>
                {showAllCardPacksPill && (
                    <CardPackPicker
                        open={pickerOpen}
                        onOpenChange={onPickerOpenChange}
                        packs={pickerPacks}
                        activeMatchId={activeMatch?.id}
                        onSelect={onSelectFromPicker}
                        onDeleteCustomPack={onDeleteFromPicker}
                        onRenameCustomPack={onRenameFromPicker}
                        onSharePack={onSharePackFromPicker}
                    >
                        <button
                            type="button"
                            className="cursor-pointer rounded-full border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                        >
                            {t("allCardPacks")}
                        </button>
                    </CardPackPicker>
                )}
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
                        loadedCustomPack={loadedCustomPack ?? null}
                        onSavedAsNewPack={packId =>
                            recordUseMutation.mutate(packId)
                        }
                    />
                )}
            </div>
        </SetupStepPanel>
    );
}
