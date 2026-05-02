"use client";

import { DateTime } from "effect";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { T_STANDARD, useReducedTransition } from "../motion";
import {
    cardPackPickerOpened,
    cardPackSelected,
    cardsDealt,
} from "../../analytics/events";
import { cardSetEquals, type CardSet } from "../../logic/CardSet";
import {
    compareCardPackLabels,
    topRecentPacks,
} from "../../logic/CardPackUsage";
import {
    useCardPackUsage,
    useForgetCardPackUse,
    useRecordCardPackUse,
} from "../../data/cardPackUsage";
import { CARD_SETS } from "../../logic/GameSetup";
import { CustomCardSet } from "../../logic/CustomCardSets";
import {
    useCustomCardPacks,
    useDeleteCardPack,
    useSaveCardPack,
} from "../../data/customCardPacks";
import { useConfirm } from "../hooks/useConfirm";
import { useClue } from "../state";
import { CardPackPicker, type PickerPack } from "./CardPackPicker";
import { SearchIcon, TrashIcon } from "./Icons";
import { ShareIcon } from "./ShareIcon";
import { useShareContext } from "../share/ShareProvider";

const RECENT_LIMIT = 3;
const SURFACE_BUDGET = 1 + RECENT_LIMIT; // Classic + 3 recents = 4 pills before the dropdown.

// Module-scope discriminators kept exempt from the i18next/no-literal-string
// lint rule (it ignores literals declared outside component bodies). These
// are wire-format strings that flow into PostHog as event-property values,
// not user-visible copy.
const PACK_TYPE_BUILT_IN = "built-in" as const;
const PACK_TYPE_CUSTOM = "custom" as const;
const SOURCE_PINNED = "pinned" as const;
const SOURCE_RECENT = "recent" as const;
const SOURCE_SEARCH = "search" as const;

// Module-scope literals: hooked in via `data-*` attributes so styled-pill
// integration tests and CSS selectors can target the active pack pill
// and the activated Save pill without depending on class-name internals.
const TRUE_LITERAL = "true" as const;

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

/**
 * Card-pack picker row: swap the active deck without touching the
 * player roster. Only rendered while the UI is in Setup mode — in
 * Play mode the deck is locked and the buttons disappear.
 *
 * Surface layout scales with the user's library:
 *   - Classic is always pinned as the first pill.
 *   - The next up to 3 pills are the most-recently-used non-Classic
 *     packs (recency tracked per pack id, see CardPackUsage).
 *   - When the user has more than 4 total packs, a 5th "All card
 *     packs" pill opens a typeahead dropdown listing every pack
 *     alphabetically.
 *   - "+ Save as card pack" stays as the trailing dashed pill.
 */
export function CardPackRow() {
    const t = useTranslations("setup");
    const confirm = useConfirm();
    const { state, dispatch } = useClue();
    const setup = state.setup;
    const hasDestructiveData =
        state.knownCards.length > 0 || state.suggestions.length > 0;
    // RQ-backed reads. Both queries are SSR-gated and fall back to
    // empty (`[]` / `new Map()`) until the client fetches — so the
    // server HTML and client's first render agree. After mutations,
    // each hook's `setQueryData` keeps the cache up to date without a
    // refetch.
    const customPacksQuery = useCustomCardPacks();
    const usageQuery = useCardPackUsage();
    const customPacks = customPacksQuery.data ?? [];
    const usage = usageQuery.data ?? new Map();
    const savePackMutation = useSaveCardPack();
    const deletePackMutation = useDeleteCardPack();
    const recordUseMutation = useRecordCardPackUse();
    const forgetUseMutation = useForgetCardPackUse();
    const { openShareCardPack } = useShareContext();
    const [pickerOpen, setPickerOpen] = useState(false);

    // The Classic id is the first entry in CARD_SETS and is the
    // single always-pinned pill. Master Detective participates in
    // the recency pool like any other pack.
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
     * its contents by user-visible name. Tracked by pack id (via the
     * recency map's most-recent entry) so duplicate-contents packs
     * stay distinguishable: only the pack the user actually clicked
     * is active. Falls back to Classic on first run before any pack
     * has been recorded.
     *
     * The cardSet equality check is what handles mutation: as soon
     * as the user renames / adds / removes anything, the live deck
     * diverges from the candidate pack and `activeMatch` flips to
     * `undefined` — which then lights up "Save as card pack".
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
        // First-run fallback: Classic is the implicit "loaded" pack
        // before the user clicks anything.
        if (!candidateId) candidateId = classic.id;
        const candidate = allPacks.find(p => p.id === candidateId);
        if (!candidate) return undefined;
        return cardSetEquals(setup.cardSet, candidate.cardSet)
            ? candidate
            : undefined;
    }, [allPacks, setup.cardSet, usage, classic.id]);

    const recents = useMemo<ReadonlyArray<DisplayPack>>(() => {
        const baseRecents = topRecentPacks(otherPacks, usage, RECENT_LIMIT);
        // Promote the active match (if it's a non-Classic pack) to the
        // top of the recents — even if it isn't otherwise in the top
        // RECENT_LIMIT by usage. This keeps the active pill anchored
        // immediately after Classic.
        if (!activeMatch || activeMatch.id === classic.id) return baseRecents;
        const withoutMatch = baseRecents.filter(p => p.id !== activeMatch.id);
        return [activeMatch, ...withoutMatch].slice(0, RECENT_LIMIT);
    }, [otherPacks, usage, activeMatch, classic.id]);

    const surfacePacks = useMemo<ReadonlyArray<DisplayPack>>(
        () => [classicDisplay, ...recents],
        [classicDisplay, recents],
    );

    const showAllCardPacksPill = allPacks.length > SURFACE_BUDGET;
    const showSaveAsActive = activeMatch === undefined;

    /**
     * The custom pack the user most-recently loaded, regardless of
     * whether the live deck still matches its contents. This is the
     * pack the user is conceptually "editing" — when `activeMatch`
     * is undefined but `loadedCustomPack` is defined, the deck has
     * diverged from the loaded pack and the save action should
     * default to "Update [pack name]" instead of creating a new pack.
     *
     * Classic doesn't qualify: it's a built-in, not user-owned, so
     * editing the Classic deck always produces a new custom pack.
     */
    const loadedCustomPack = useMemo<DisplayPack | undefined>(() => {
        let candidateId: string | undefined;
        let mostRecent: DateTime.Utc | undefined;
        for (const [id, at] of usage.entries()) {
            if (id === classic.id) continue;
            if (
                !mostRecent ||
                DateTime.toEpochMillis(at) > DateTime.toEpochMillis(mostRecent)
            ) {
                mostRecent = at;
                candidateId = id;
            }
        }
        if (!candidateId) return undefined;
        return otherPacks.find(p => p.id === candidateId);
    }, [otherPacks, usage, classic.id]);

    const canUpdateLoadedPack =
        showSaveAsActive && loadedCustomPack !== undefined;

    /**
     * Sorted alphabetically with Classic pinned first; this is what
     * the typeahead dropdown displays before any filtering.
     */
    const dropdownOrder = useMemo<ReadonlyArray<DisplayPack>>(() => {
        const sorted = [...otherPacks].sort((a, b) =>
            compareCardPackLabels(a.label, b.label),
        );
        return [classicDisplay, ...sorted];
    }, [classicDisplay, otherPacks]);

    const pickerPacks = useMemo<ReadonlyArray<PickerPack>>(
        () => dropdownOrder.map(toPickerPack),
        [dropdownOrder],
    );

    const findDisplayPack = (id: string): DisplayPack | undefined =>
        allPacks.find(p => p.id === id);

    const performLoad = async (
        pack: DisplayPack,
        source: typeof SOURCE_PINNED | typeof SOURCE_RECENT | typeof SOURCE_SEARCH,
    ): Promise<void> => {
        if (
            hasDestructiveData &&
            !(await confirm({ message: t("loadCardSetConfirm") }))
        )
            return;
        dispatch({
            type: "loadCardSet",
            cardSet: pack.cardSet,
            label: pack.label,
        });
        cardsDealt({
            playerCount: state.setup.players.length,
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

    const onSaveCardSet = async () => {
        // When the user has a custom pack loaded and has edited the
        // deck since loading, the save button updates that pack in
        // place rather than minting a new id. The label stays the
        // same as the loaded pack (no prompt) so "Update MyDeck"
        // doesn't surprise the user with a label-rename dialog.
        if (canUpdateLoadedPack && loadedCustomPack !== undefined) {
            const updated = await savePackMutation.mutateAsync({
                label: loadedCustomPack.label,
                cardSet: setup.cardSet,
                existingId: loadedCustomPack.id,
            });
            recordUseMutation.mutate(updated.id);
            return;
        }
        const label = window.prompt(t("saveAsCardPackPrompt"));
        if (!label || !label.trim()) return;
        const newPack = await savePackMutation.mutateAsync({
            label: label.trim(),
            cardSet: setup.cardSet,
        });
        // Stamp the new pack as the most-recently-used pack so the
        // active-match resolver picks it up: with cardSetEquals(setup,
        // newPack.cardSet) trivially true (we just snapshotted setup),
        // the new pack becomes the active pill — and the Save pill
        // un-activates because the live deck now matches a saved pack.
        recordUseMutation.mutate(newPack.id);
    };

    /**
     * "Save as new pack…" — secondary action when a loaded custom
     * pack is being edited but the user wants to fork rather than
     * overwrite. Prompts for a new label and inserts (no
     * `existingId`).
     */
    const onSaveAsNewCardSet = async () => {
        const label = window.prompt(t("saveAsCardPackPrompt"));
        if (!label || !label.trim()) return;
        const newPack = await savePackMutation.mutateAsync({
            label: label.trim(),
            cardSet: setup.cardSet,
        });
        recordUseMutation.mutate(newPack.id);
    };

    const onDeleteCustomPack = async (pack: DisplayPack) => {
        if (
            !(await confirm({
                message: t("deleteCustomCardSetConfirm", {
                    label: pack.label,
                }),
            }))
        )
            return;
        deletePackMutation.mutate(pack.id);
        forgetUseMutation.mutate(pack.id);
    };

    const onDeleteFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack || !pack.isCustom) return;
        void onDeleteCustomPack(pack);
    };

    const onSharePill = (pack: DisplayPack) => {
        // Per-pack share is always pack-only (Flow 1): the surface
        // pill / picker row is a content-management surface, not a
        // game-state one. The clicked pack overrides the live setup
        // pack so the share contains exactly what the user clicked,
        // regardless of which pack is active in the table below.
        openShareCardPack({
            forcedCardPack: pack.cardSet,
            packLabel: pack.label,
        });
    };

    const onSharePackFromPicker = (picked: PickerPack) => {
        const pack = findDisplayPack(picked.id);
        if (!pack) return;
        onSharePill(pack);
    };

    const onPickerOpenChange = (next: boolean) => {
        setPickerOpen(next);
        if (next) cardPackPickerOpened();
    };

    // Single transition routed through useReducedTransition so the
    // pill reposition (Framer Motion FLIP) collapses to instant when
    // the user has prefers-reduced-motion. The color fade rides on
    // CSS `transition-colors` and is gentle enough to keep on.
    const pillLayoutTransition = useReducedTransition(T_STANDARD);

    return (
        <div
            className="mb-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3"
            data-tour-anchor="setup-card-pack"
        >
            <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-accent">
                {t("cardPack")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <LayoutGroup id="card-pack-surface">
                {surfacePacks.map((pack, i) => {
                    const isFirst = i === 0;
                    const isActive = pack.id === activeMatch?.id;
                    const dataAttr: Record<string, string> = {};
                    if (isFirst)
                        dataAttr["data-setup-first-target"] = "card-pack";
                    if (isActive)
                        dataAttr["data-card-pack-active"] = TRUE_LITERAL;
                    // Tailwind `transition-colors` gives the gentle color fade
                    // between active and inactive states; Framer Motion's
                    // `layout` prop drives the FLIP-style reposition when
                    // pack ordering changes.
                    const wrapperBase =
                        "inline-flex items-center overflow-hidden rounded border text-[13px] transition-colors duration-200 ease-out";
                    const wrapperTone = isActive
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-white";
                    const loadBase =
                        "cursor-pointer px-3 py-1 transition-colors duration-200 ease-out";
                    const loadTone = isActive
                        ? "font-semibold"
                        : "hover:bg-hover";
                    // Both built-in and custom pills wrap a label
                    // button + a share icon button, so the share
                    // affordance is reachable on every pack pill —
                    // not just on the active one (which is what the
                    // bottom-row "Share this pack" button targets).
                    // Custom pills additionally append a trash-icon
                    // delete (destructive — paired with a confirm dialog).
                    const sharePillBase =
                        "cursor-pointer border-l px-2 py-1 transition-colors duration-200 ease-out";
                    const sharePillTone = isActive
                        ? "border-white/40 text-white/80 hover:bg-white/15"
                        : "border-border text-muted hover:bg-hover hover:text-accent";
                    const deletePillTone = isActive
                        ? "border-white/40 text-white/80 hover:bg-white/15"
                        : "border-border text-muted hover:bg-hover hover:text-danger";
                    return (
                        <motion.span
                            key={pack.id}
                            layout
                            transition={pillLayoutTransition}
                            className={`${wrapperBase} ${wrapperTone}`}
                        >
                            <button
                                type="button"
                                className={`${loadBase} ${loadTone}`}
                                onClick={() => onSelectFromSurface(pack)}
                                title={
                                    pack.isCustom
                                        ? t("loadCustomCardSetTitle", {
                                              label: pack.label,
                                          })
                                        : pack.label
                                }
                                aria-pressed={isActive}
                                {...dataAttr}
                            >
                                {pack.label}
                            </button>
                            <button
                                type="button"
                                className={`${sharePillBase} ${sharePillTone}`}
                                onClick={() => onSharePill(pack)}
                                title={t("sharePackTitle", {
                                    label: pack.label,
                                })}
                                aria-label={t("sharePackAria", {
                                    label: pack.label,
                                })}
                                data-share-pack-pill
                                {...(isFirst
                                    ? { "data-tour-anchor": "setup-share-pack-pill" }
                                    : {})}
                            >
                                <ShareIcon size={12} />
                            </button>
                            {pack.isCustom ? (
                                <button
                                    type="button"
                                    className={`${sharePillBase} ${deletePillTone}`}
                                    onClick={() => void onDeleteCustomPack(pack)}
                                    title={t("deleteCustomCardSetTitle", {
                                        label: pack.label,
                                    })}
                                    aria-label={t("deleteCustomCardSetAria", {
                                        label: pack.label,
                                    })}
                                >
                                    <TrashIcon size={12} />
                                </button>
                            ) : null}
                        </motion.span>
                    );
                })}
                <AnimatePresence initial={false}>
                {showAllCardPacksPill ? (
                    <motion.span
                        key="all-card-packs-pill"
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={pillLayoutTransition}
                        className="inline-flex"
                    >
                    <CardPackPicker
                        open={pickerOpen}
                        onOpenChange={onPickerOpenChange}
                        packs={pickerPacks}
                        onSelect={onSelectFromPicker}
                        onDeleteCustomPack={onDeleteFromPicker}
                        onSharePack={onSharePackFromPicker}
                        activeMatchId={activeMatch?.id}
                    >
                        <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-white px-3 py-1 text-[13px] transition-colors duration-200 ease-out hover:bg-hover"
                            title={t("allCardPacksPillTitle")}
                            aria-haspopup="listbox"
                            aria-expanded={pickerOpen}
                        >
                            <SearchIcon className="text-muted" size={14} />
                            {t("allCardPacksPill")}
                        </button>
                    </CardPackPicker>
                    </motion.span>
                ) : null}
                </AnimatePresence>
                </LayoutGroup>
                <button
                    type="button"
                    className={
                        "cursor-pointer rounded border border-dashed px-3 py-1 text-[13px] transition-colors duration-200 ease-out " +
                        (showSaveAsActive
                            ? "border-accent bg-accent font-semibold text-white"
                            : "border-border bg-white text-muted hover:bg-hover hover:text-accent")
                    }
                    onClick={onSaveCardSet}
                    title={
                        canUpdateLoadedPack && loadedCustomPack !== undefined
                            ? t("updateCardPackTitle", {
                                  label: loadedCustomPack.label,
                              })
                            : t("saveAsCardPackTitle")
                    }
                    {...(showSaveAsActive
                        ? { "data-card-pack-save-active": TRUE_LITERAL }
                        : {})}
                >
                    {canUpdateLoadedPack && loadedCustomPack !== undefined
                        ? t("updateCardPack", {
                              label: loadedCustomPack.label,
                          })
                        : t("saveAsCardPack")}
                </button>
                {canUpdateLoadedPack ? (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] text-muted transition-colors duration-200 ease-out hover:bg-hover hover:text-accent"
                        onClick={onSaveAsNewCardSet}
                        title={t("saveAsCardPackTitle")}
                    >
                        {t("saveAsNewCardPack")}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
