"use client";

import { Reorder } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
    type CardEntry,
    type Category,
} from "../../../logic/CardSet";
import type { CustomCardSet } from "../../../logic/CustomCardSets";
import { useConfirm } from "../../hooks/useConfirm";
import { usePrompt } from "../../hooks/usePrompt";
import { useClue } from "../../state";
import { useCardPackActions } from "../../components/cardPackActions";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    TrashIcon,
} from "../../components/Icons";

// Reorder.Group axis values — pulled to module scope so the
// i18next/no-literal-string lint reads them as wire identifiers.
const REORDER_AXIS_Y = "y" as const;

// Decorative drag-handle glyph (mirrors PlayerListReorder).
const DRAG_HANDLE_GLYPH = "⋮⋮";

interface Props {
    /**
     * The custom pack (if any) the user loaded via a pill before
     * opening this customize panel. Drives the "Update {label}"
     * footer button: only meaningful when the user explicitly
     * started from a saved custom pack (built-ins like Classic
     * never qualify, since they live in code rather than the
     * mutable library).
     */
    readonly loadedCustomPack: CustomCardSet | null;
    /**
     * Notify the parent so it can flip its `loadedFromCustomPackId`
     * to the freshly-saved pack's id — that way "Update" appears
     * for the new pack on the next save without needing a re-load.
     */
    readonly onSavedAsNewPack: (packId: string) => void;
}

/**
 * Inline customize sub-flow for the M6 wizard's step 1.
 *
 * Lets the user rename, add, remove, and drag-to-reorder categories
 * and the cards inside them. Footer offers "Save as new pack"
 * (always) and "Update {label}" (only when the user started from a
 * saved custom pack). Built-in decks like Classic never get an
 * "Update" CTA because their canonical copy lives in code, not the
 * user's library.
 *
 * Edits dispatch immediately to the reducer (mirroring today's
 * behavior — every edit goes through `dispatch`, no per-flow draft
 * buffer). Drag-end commits a bulk reorder action so the operation
 * is one undo step.
 */
export function SetupStepCardPackCustomize({
    loadedCustomPack,
    onSavedAsNewPack,
}: Props) {
    const t = useTranslations("setupWizard.cardPack.customize");
    const { state, dispatch } = useClue();
    const confirm = useConfirm();
    const prompt = usePrompt();
    const tCommon = useTranslations("common");
    const { savePack } = useCardPackActions();
    const setup = state.setup;

    const [categoryDraft, setCategoryDraft] = useState<
        ReadonlyArray<Category>
    >(setup.categories);
    useEffect(() => {
        setCategoryDraft(setup.categories);
    }, [setup.categories]);

    const commitCategoryReorder = (next: ReadonlyArray<Category>) => {
        const sameOrder =
            next.length === setup.categories.length &&
            next.every((c, i) => c.id === setup.categories[i]?.id);
        if (sameOrder) return;
        dispatch({ type: "reorderCategories", categories: next });
    };

    const moveCategory = (idx: number, dir: -1 | 1) => {
        const target = idx + dir;
        if (target < 0 || target >= categoryDraft.length) return;
        const next = [...categoryDraft];
        const a = next[idx];
        const b = next[target];
        if (!a || !b) return;
        next[idx] = b;
        next[target] = a;
        dispatch({ type: "reorderCategories", categories: next });
    };

    const saveAsNewPack = async () => {
        const name = await prompt({
            title: t("saveAsPackPromptTitle"),
            label: t("saveAsPackPromptLabel"),
            initialValue: loadedCustomPack?.label ?? "",
            confirmLabel: tCommon("save"),
        });
        if (name === null) return;
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const saved = await savePack({
            label: trimmed,
            cardSet: setup.cardSet,
        });
        onSavedAsNewPack(saved.id);
    };

    const updateLoadedPack = async () => {
        if (loadedCustomPack === null) return;
        await savePack({
            label: loadedCustomPack.label,
            cardSet: setup.cardSet,
            existingId: loadedCustomPack.id,
        });
    };

    return (
        <div className="flex flex-col gap-3 rounded border border-border/30 p-3">
            <p className="m-0 text-[13px] text-muted">{t("helperText")}</p>

            <Reorder.Group
                axis={REORDER_AXIS_Y}
                values={[...categoryDraft]}
                onReorder={(next: ReadonlyArray<Category>) => {
                    setCategoryDraft(next);
                }}
                className="m-0 flex list-none flex-col gap-3 p-0"
            >
                {categoryDraft.map((category, idx) => (
                    <Reorder.Item
                        key={String(category.id)}
                        value={category}
                        onDragEnd={() => commitCategoryReorder(categoryDraft)}
                        className="flex touch-none flex-col gap-2 rounded border border-border/40 bg-bg p-2"
                    >
                        <CategoryHeader
                            category={category}
                            canRemove={categoryDraft.length > 1}
                            isFirst={idx === 0}
                            isLast={idx === categoryDraft.length - 1}
                            onMoveUp={() => moveCategory(idx, -1)}
                            onMoveDown={() => moveCategory(idx, 1)}
                            onRemove={async () => {
                                const hasReferences =
                                    state.knownCards.some(kc =>
                                        category.cards.some(
                                            c => c.id === kc.card,
                                        ),
                                    ) || state.suggestions.length > 0;
                                if (hasReferences) {
                                    const ok = await confirm({
                                        message: t("removeCategoryConfirm", {
                                            name: category.name,
                                        }),
                                    });
                                    if (!ok) return;
                                }
                                dispatch({
                                    type: "removeCategoryById",
                                    categoryId: category.id,
                                });
                            }}
                        />
                        <CardList category={category} />
                        <button
                            type="button"
                            className="self-start cursor-pointer rounded border border-border bg-bg px-2 py-1 text-[12px] hover:bg-hover"
                            onClick={() =>
                                dispatch({
                                    type: "addCardToCategoryById",
                                    categoryId: category.id,
                                })
                            }
                        >
                            {t("addCard")}
                        </button>
                    </Reorder.Item>
                ))}
            </Reorder.Group>

            <button
                type="button"
                className="self-start cursor-pointer rounded border border-border bg-bg px-2 py-1 text-[12px] hover:bg-hover"
                onClick={() => dispatch({ type: "addCategory" })}
            >
                {t("addCategory")}
            </button>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/30 pt-3">
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-bg px-3 py-1.5 text-[13px] hover:bg-hover"
                    onClick={saveAsNewPack}
                >
                    {t("saveAsNewPack")}
                </button>
                {loadedCustomPack !== null && (
                    <button
                        type="button"
                        className="cursor-pointer rounded border-none bg-accent px-3 py-1.5 text-[13px] text-white hover:bg-accent-hover"
                        onClick={updateLoadedPack}
                    >
                        {t("updatePack", { label: loadedCustomPack.label })}
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * One category's card list — its own `Reorder.Group` so cards drag
 * within their parent category. Dispatches `reorderCardsInCategory`
 * on drag end. Splitting this out keeps the parent Reorder.Group
 * cleaner and isolates per-category state.
 */
function CardList({ category }: { readonly category: Category }) {
    const t = useTranslations("setupWizard.cardPack.customize");
    const { state, dispatch } = useClue();
    const confirm = useConfirm();

    const [cardDraft, setCardDraft] = useState<ReadonlyArray<CardEntry>>(
        category.cards,
    );
    useEffect(() => {
        setCardDraft(category.cards);
    }, [category.cards]);

    const commitCardReorder = (next: ReadonlyArray<CardEntry>) => {
        const sameOrder =
            next.length === category.cards.length &&
            next.every((c, i) => c.id === category.cards[i]?.id);
        if (sameOrder) return;
        dispatch({
            type: "reorderCardsInCategory",
            categoryId: category.id,
            cards: next,
        });
    };

    const moveCard = (idx: number, dir: -1 | 1) => {
        const target = idx + dir;
        if (target < 0 || target >= cardDraft.length) return;
        const next = [...cardDraft];
        const a = next[idx];
        const b = next[target];
        if (!a || !b) return;
        next[idx] = b;
        next[target] = a;
        dispatch({
            type: "reorderCardsInCategory",
            categoryId: category.id,
            cards: next,
        });
    };

    return (
        <Reorder.Group
            axis={REORDER_AXIS_Y}
            values={[...cardDraft]}
            onReorder={(next: ReadonlyArray<CardEntry>) => {
                setCardDraft(next);
            }}
            className="m-0 flex list-none flex-col gap-1 p-0"
        >
            {cardDraft.map((entry, idx) => (
                <Reorder.Item
                    key={String(entry.id)}
                    value={entry}
                    onDragEnd={() => commitCardReorder(cardDraft)}
                    className="flex touch-none items-center gap-2 rounded border border-border/40 bg-bg px-1 py-0.5"
                >
                    <CardRow
                        entry={entry}
                        canRemove={cardDraft.length > 1}
                        isFirst={idx === 0}
                        isLast={idx === cardDraft.length - 1}
                        onMoveUp={() => moveCard(idx, -1)}
                        onMoveDown={() => moveCard(idx, 1)}
                        onRemove={async () => {
                            const hasReferences =
                                state.knownCards.some(
                                    kc => kc.card === entry.id,
                                ) || state.suggestions.length > 0;
                            if (hasReferences) {
                                const ok = await confirm({
                                    message: t("removeCardConfirm", {
                                        card: entry.name,
                                    }),
                                });
                                if (!ok) return;
                            }
                            dispatch({
                                type: "removeCardById",
                                cardId: entry.id,
                            });
                        }}
                    />
                </Reorder.Item>
            ))}
        </Reorder.Group>
    );
}

function CategoryHeader({
    category,
    canRemove,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onRemove,
}: {
    readonly category: Category;
    readonly canRemove: boolean;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly onRemove: () => void;
}) {
    const t = useTranslations("setupWizard.cardPack.customize");
    const { dispatch } = useClue();
    const [draft, setDraft] = useState(category.name);
    useEffect(() => {
        setDraft(category.name);
    }, [category]);

    const commit = () => {
        const trimmed = draft.trim();
        if (!trimmed || trimmed === category.name) {
            setDraft(category.name);
            return;
        }
        dispatch({
            type: "renameCategory",
            categoryId: category.id,
            name: trimmed,
        });
    };

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                className="box-border min-w-0 flex-1 rounded border border-border px-2 py-1 text-[13px] font-semibold uppercase tracking-wide"
                value={draft}
                aria-label={t("categoryNameAria", { name: category.name })}
                onChange={e => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        commit();
                        (e.currentTarget as HTMLInputElement).blur();
                    } else if (e.key === "Escape") {
                        setDraft(category.name);
                        (e.currentTarget as HTMLInputElement).blur();
                    }
                }}
            />
            <ArrowButtons
                isFirst={isFirst}
                isLast={isLast}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                upLabel={t("moveCategoryUpAria", { name: category.name })}
                downLabel={t("moveCategoryDownAria", { name: category.name })}
            />
            {canRemove && (
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded border border-border bg-bg p-1 text-fg hover:bg-hover"
                    aria-label={t("removeCategoryTitle", {
                        name: category.name,
                    })}
                    onClick={onRemove}
                >
                    <TrashIcon size={14} />
                </button>
            )}
            {/* Drag handle on the right with extra ml-3 gap from
                the trash so a thumb reaching for the handle can't
                accidentally hit delete. */}
            <span
                aria-hidden
                className="ml-3 shrink-0 cursor-grab select-none text-[18px] leading-none text-muted"
            >
                {DRAG_HANDLE_GLYPH}
            </span>
        </div>
    );
}

function CardRow({
    entry,
    canRemove,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onRemove,
}: {
    readonly entry: CardEntry;
    readonly canRemove: boolean;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly onRemove: () => void;
}) {
    const t = useTranslations("setupWizard.cardPack.customize");
    const { dispatch } = useClue();
    const [draft, setDraft] = useState(entry.name);
    useEffect(() => {
        setDraft(entry.name);
    }, [entry]);

    const commit = () => {
        const trimmed = draft.trim();
        if (!trimmed || trimmed === entry.name) {
            setDraft(entry.name);
            return;
        }
        dispatch({
            type: "renameCard",
            cardId: entry.id,
            name: trimmed,
        });
    };

    return (
        <div className="flex w-full items-center gap-2">
            <input
                type="text"
                className="box-border min-w-0 flex-1 rounded border border-border px-2 py-1 text-[13px]"
                value={draft}
                aria-label={t("cardNameAria", { name: entry.name })}
                onChange={e => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        commit();
                        (e.currentTarget as HTMLInputElement).blur();
                    } else if (e.key === "Escape") {
                        setDraft(entry.name);
                        (e.currentTarget as HTMLInputElement).blur();
                    }
                }}
            />
            <ArrowButtons
                isFirst={isFirst}
                isLast={isLast}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                upLabel={t("moveCardUpAria", { name: entry.name })}
                downLabel={t("moveCardDownAria", { name: entry.name })}
            />
            {canRemove && (
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded border border-border bg-bg p-1 text-fg hover:bg-hover"
                    aria-label={t("removeCardTitle", { name: entry.name })}
                    onClick={onRemove}
                >
                    <TrashIcon size={14} />
                </button>
            )}
            {/* Drag handle on the right with extra ml-3 gap from
                trash. Mirrors the CategoryHeader pattern. */}
            <span
                aria-hidden
                className="ml-3 shrink-0 cursor-grab select-none text-[14px] leading-none text-muted"
            >
                {DRAG_HANDLE_GLYPH}
            </span>
        </div>
    );
}

/**
 * Up/down arrow buttons used by both `CategoryHeader` and `CardRow`.
 * Drives the same dispatch-on-click semantics as the drag-end commit
 * — that's how the keyboard a11y path stays in lock-step with drag.
 *
 * Visually the arrows are stacked vertically; "up" maps to a left
 * chevron rotated -90° and "down" to a right chevron rotated -90°,
 * matching the established pattern in `PlayerListReorder`.
 */
function ArrowButtons({
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    upLabel,
    downLabel,
}: {
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly upLabel: string;
    readonly downLabel: string;
}) {
    return (
        <div className="flex shrink-0 flex-col">
            <button
                type="button"
                className="flex h-5 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                disabled={isFirst}
                aria-label={upLabel}
                onClick={onMoveUp}
            >
                <ChevronLeftIcon size={12} className="-rotate-90" />
            </button>
            <button
                type="button"
                className="flex h-5 w-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                disabled={isLast}
                aria-label={downLabel}
                onClick={onMoveDown}
            >
                <ChevronRightIcon size={12} className="-rotate-90" />
            </button>
        </div>
    );
}
