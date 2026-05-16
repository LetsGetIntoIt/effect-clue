"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Reorder } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
    addCardToCategoryInCardSet,
    addCategoryToCardSet,
    CardSet,
    removeCardFromCardSet,
    removeCategoryFromCardSet,
    renameCardInCardSet,
    renameCategoryInCardSet,
    reorderCardsInCategoryInCardSet,
    reorderCategoriesInCardSet,
    type CardEntry,
    type Category,
} from "../../logic/CardSet";
import { GameSetup } from "../../logic/GameSetup";
import { useCardPackActions } from "../components/cardPackActions";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    TrashIcon,
    XIcon,
} from "../components/Icons";
import { useModalStack } from "../components/ModalStack";
import {
    createModalSlotStore,
    type ModalSlotStore,
    useModalSlotStoreSelector,
} from "../components/modalSlotStore";
import { useConfirm } from "../hooks/useConfirm";
import { usePrompt } from "../hooks/usePrompt";
import { useClue } from "../state";
import { DelayedReorderItem } from "./shared/useReorderPressDelay";

// Reorder.Group axis values — pulled to module scope so the
// i18next/no-literal-string lint reads them as wire identifiers.
const REORDER_AXIS_Y = "y" as const;

// Decorative drag-handle glyph (mirrors PlayerListReorder + the
// legacy inline customize editor).
const DRAG_HANDLE_GLYPH = "⋮⋮";

/**
 * The card-pack editor modal — replaces the inline
 * `SetupStepCardPackCustomize` sub-flow.
 *
 * Local-draft model: the modal owns a `CardSet` draft state and every
 * edit is applied via pure helpers from `CardSet.ts`. The active game
 * is untouched until Save. On Save:
 *
 * - The pack is persisted via `savePack` (either as a new custom pack
 *   or by updating an existing custom pack).
 * - When `applyToActiveGame` is true (opened from setup step 1), the
 *   reducer also receives a `setSetup` dispatch so the running game
 *   uses the edited deck. `setSetup` prunes session entries that
 *   reference removed cards/categories but preserves entries for
 *   anything still in the deck — a rename never wipes the user's game.
 * - When `applyToActiveGame` is false (opened from a My Card Packs
 *   row), the active game is left alone. The user re-loads the edited
 *   pack via setup step 1 to bring the edits into the running game.
 *
 * Cancel / X dismisses the draft without touching either the active
 * game or the pack file. Outside-click and Escape are disabled at the
 * `useModalStack` layer to prevent accidental data loss; only the
 * explicit Cancel / X path closes the modal.
 */
interface Props {
    readonly initialCardSet: CardSet;
    readonly initialPackId?: string;
    readonly initialPackLabel?: string;
    readonly initialPackIsBuiltIn?: boolean;
    readonly applyToActiveGame: boolean;
    readonly onSaved?: (savedPackId: string) => void;
}

interface EditorStoreState {
    readonly draft: CardSet;
}

function CardPackEditorHeader({
    titleText,
    onClose,
}: {
    readonly titleText: string;
    readonly onClose: () => void;
}) {
    const tCommon = useTranslations("common");
    return (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                {titleText}
            </Dialog.Title>
            <button
                type="button"
                aria-label={tCommon("close")}
                onClick={onClose}
                className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-fg hover:bg-hover"
            >
                <XIcon size={18} />
            </button>
        </div>
    );
}

function CardPackEditorBody({
    store,
    applyToActiveGame,
}: {
    readonly store: ModalSlotStore<EditorStoreState>;
    readonly applyToActiveGame: boolean;
}) {
    const t = useTranslations("cardPackEditor");
    const { state } = useClue();
    const confirm = useConfirm();
    const draft = useModalSlotStoreSelector(store, (s) => s.draft);

    const setDraft: React.Dispatch<React.SetStateAction<CardSet>> = (
        next,
    ) => {
        store.set((s) => ({
            draft:
                typeof next === "function"
                    ? (next as (prev: CardSet) => CardSet)(s.draft)
                    : next,
        }));
    };

    const cardHasSessionRefs = (cardId: string): boolean => {
        if (!applyToActiveGame) return false;
        const inKnownCards = state.knownCards.some(
            (kc) => String(kc.card) === cardId,
        );
        const inSuggestions = state.suggestions.length > 0;
        return inKnownCards || inSuggestions;
    };

    const categoryHasSessionRefs = (cat: Category): boolean => {
        if (!applyToActiveGame) return false;
        const inKnownCards = state.knownCards.some((kc) =>
            cat.cards.some((c) => c.id === kc.card),
        );
        const inSuggestions = state.suggestions.length > 0;
        return inKnownCards || inSuggestions;
    };

    return (
        <div className="flex flex-col gap-3 px-5 pt-3 pb-3">
            <p className="m-0 text-[1rem] leading-normal text-muted">
                {t("helperText")}
            </p>
            <CategoriesEditor
                draft={draft}
                setDraft={setDraft}
                confirmRemoveCategory={async (cat) => {
                    if (!categoryHasSessionRefs(cat)) return true;
                    return await confirm({
                        message: t("removeCategoryConfirm", {
                            name: cat.name,
                        }),
                    });
                }}
                confirmRemoveCard={async (entry) => {
                    if (!cardHasSessionRefs(String(entry.id)))
                        return true;
                    return await confirm({
                        message: t("removeCardConfirm", {
                            card: entry.name,
                        }),
                    });
                }}
            />
            <button
                type="button"
                className="tap-target text-tap self-start cursor-pointer rounded border border-border bg-control hover:bg-control-hover"
                onClick={() =>
                    setDraft((prev) => addCategoryToCardSet(prev))
                }
            >
                {t("addCategory")}
            </button>
        </div>
    );
}

function CardPackEditorFooter({
    store,
    initialPackId,
    initialPackLabel,
    initialPackIsBuiltIn,
    applyToActiveGame,
    onClose,
    onSaved,
}: {
    readonly store: ModalSlotStore<EditorStoreState>;
    readonly initialPackId: string | undefined;
    readonly initialPackLabel: string | undefined;
    readonly initialPackIsBuiltIn: boolean;
    readonly applyToActiveGame: boolean;
    readonly onClose: () => void;
    readonly onSaved?: (savedPackId: string) => void;
}) {
    const t = useTranslations("cardPackEditor");
    const tCommon = useTranslations("common");
    const prompt = usePrompt();
    const { savePack } = useCardPackActions();
    const { state, dispatch } = useClue();

    const applyDraftToActiveGameIfRequested = (draft: CardSet) => {
        if (!applyToActiveGame) return;
        // `setSetup` prunes session entries referencing removed
        // cards/categories but preserves entries for the survivors.
        dispatch({
            type: "setSetup",
            setup: GameSetup({
                cardSet: draft,
                playerSet: state.setup.playerSet,
            }),
        });
    };

    const saveAsNewPack = async () => {
        const name = await prompt({
            title: t("saveAsPackPromptTitle"),
            label: t("saveAsPackPromptLabel"),
            initialValue: initialPackLabel ?? "",
            confirmLabel: tCommon("save"),
        });
        if (name === null) return;
        const trimmed = name.trim();
        if (trimmed.length === 0) return;
        const draft = store.get().draft;
        const saved = await savePack({
            label: trimmed,
            cardSet: draft,
        });
        onSaved?.(saved.id);
        applyDraftToActiveGameIfRequested(draft);
        onClose();
    };

    const updateLoadedPack = async () => {
        if (initialPackId === undefined || initialPackIsBuiltIn) return;
        const label = initialPackLabel ?? "";
        const draft = store.get().draft;
        await savePack({
            label,
            cardSet: draft,
            existingId: initialPackId,
        });
        onSaved?.(initialPackId);
        applyDraftToActiveGameIfRequested(draft);
        onClose();
    };

    return (
        <div className="flex flex-wrap items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
            <button
                type="button"
                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-white font-semibold text-[#2a1f12] hover:bg-hover"
                onClick={onClose}
            >
                {t("cancel")}
            </button>
            <button
                type="button"
                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-white font-semibold text-[#2a1f12] hover:bg-hover"
                onClick={saveAsNewPack}
            >
                {t("saveAsNewPack")}
            </button>
            {initialPackId !== undefined && !initialPackIsBuiltIn && (
                <button
                    type="button"
                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover"
                    onClick={updateLoadedPack}
                >
                    {t("updatePack", {
                        label: initialPackLabel ?? "",
                    })}
                </button>
            )}
        </div>
    );
}

/**
 * Categories editor — Reorder.Group of categories, each with its own
 * card-list Reorder.Group inside. All mutations route through pure
 * `CardSet` helpers via `setDraft`, so the modal's draft is the
 * single source of truth.
 */
function CategoriesEditor({
    draft,
    setDraft,
    confirmRemoveCategory,
    confirmRemoveCard,
}: {
    readonly draft: CardSet;
    readonly setDraft: React.Dispatch<React.SetStateAction<CardSet>>;
    readonly confirmRemoveCategory: (cat: Category) => Promise<boolean>;
    readonly confirmRemoveCard: (entry: CardEntry) => Promise<boolean>;
}) {
    const t = useTranslations("cardPackEditor");
    // Mirror Reorder.Group's local-buffer pattern from the legacy
    // customize sub-flow: a draft array drives the DOM during the
    // drag; the parent draft commits on drag-end so the order
    // matches the user's release position exactly.
    const [categoryDraft, setCategoryDraft] = useState<
        ReadonlyArray<Category>
    >(draft.categories);
    useEffect(() => {
        setCategoryDraft(draft.categories);
    }, [draft.categories]);

    const commitCategoryReorder = (next: ReadonlyArray<Category>) => {
        const sameOrder =
            next.length === draft.categories.length &&
            next.every((c, i) => c.id === draft.categories[i]?.id);
        if (sameOrder) return;
        setDraft(prev => reorderCategoriesInCardSet(prev, next));
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
        setDraft(prev => reorderCategoriesInCardSet(prev, next));
    };

    return (
        <Reorder.Group
            axis={REORDER_AXIS_Y}
            values={[...categoryDraft]}
            onReorder={(next: ReadonlyArray<Category>) => {
                setCategoryDraft(next);
            }}
            className="m-0 flex list-none flex-col gap-3 p-0"
        >
            {categoryDraft.map((category, idx) => (
                <DelayedReorderItem
                    key={String(category.id)}
                    value={category}
                    onDragEnd={() => commitCategoryReorder(categoryDraft)}
                    className="flex flex-col gap-2 rounded border border-border/40 bg-control p-2"
                >
                    <CategoryHeader
                        category={category}
                        canRemove={categoryDraft.length > 1}
                        isFirst={idx === 0}
                        isLast={idx === categoryDraft.length - 1}
                        onMoveUp={() => moveCategory(idx, -1)}
                        onMoveDown={() => moveCategory(idx, 1)}
                        onRename={(name: string) =>
                            setDraft(prev =>
                                renameCategoryInCardSet(
                                    prev,
                                    category.id,
                                    name,
                                ),
                            )
                        }
                        onRemove={async () => {
                            const ok =
                                await confirmRemoveCategory(category);
                            if (!ok) return;
                            setDraft(prev =>
                                removeCategoryFromCardSet(
                                    prev,
                                    category.id,
                                ),
                            );
                        }}
                    />
                    <CardListEditor
                        category={category}
                        setDraft={setDraft}
                        confirmRemoveCard={confirmRemoveCard}
                    />
                    <button
                        type="button"
                        className="self-start cursor-pointer rounded border border-border bg-control px-2 py-1 text-[1rem] hover:bg-control-hover"
                        onClick={() =>
                            setDraft(prev =>
                                addCardToCategoryInCardSet(
                                    prev,
                                    category.id,
                                ),
                            )
                        }
                    >
                        {t("addCard")}
                    </button>
                </DelayedReorderItem>
            ))}
        </Reorder.Group>
    );
}

function CardListEditor({
    category,
    setDraft,
    confirmRemoveCard,
}: {
    readonly category: Category;
    readonly setDraft: React.Dispatch<React.SetStateAction<CardSet>>;
    readonly confirmRemoveCard: (entry: CardEntry) => Promise<boolean>;
}) {
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
        setDraft(prev =>
            reorderCardsInCategoryInCardSet(prev, category.id, next),
        );
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
        setDraft(prev =>
            reorderCardsInCategoryInCardSet(prev, category.id, next),
        );
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
                <DelayedReorderItem
                    key={String(entry.id)}
                    value={entry}
                    onDragEnd={() => commitCardReorder(cardDraft)}
                    className="flex items-center gap-2 rounded border border-border/40 bg-control px-1 py-0.5"
                >
                    <CardRow
                        entry={entry}
                        canRemove={cardDraft.length > 1}
                        isFirst={idx === 0}
                        isLast={idx === cardDraft.length - 1}
                        onMoveUp={() => moveCard(idx, -1)}
                        onMoveDown={() => moveCard(idx, 1)}
                        onRename={(name: string) =>
                            setDraft(prev =>
                                renameCardInCardSet(prev, entry.id, name),
                            )
                        }
                        onRemove={async () => {
                            const ok = await confirmRemoveCard(entry);
                            if (!ok) return;
                            setDraft(prev =>
                                removeCardFromCardSet(prev, entry.id),
                            );
                        }}
                    />
                </DelayedReorderItem>
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
    onRename,
    onRemove,
}: {
    readonly category: Category;
    readonly canRemove: boolean;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly onRename: (name: string) => void;
    readonly onRemove: () => void;
}) {
    const t = useTranslations("cardPackEditor");
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
        onRename(trimmed);
    };

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                className="box-border min-w-0 flex-1 rounded border border-border px-2 py-1 text-[1rem] font-semibold uppercase tracking-wide"
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
                downLabel={t("moveCategoryDownAria", {
                    name: category.name,
                })}
            />
            {canRemove && (
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded border border-border bg-control p-1 text-fg hover:bg-control-hover"
                    aria-label={t("removeCategoryTitle", {
                        name: category.name,
                    })}
                    onClick={onRemove}
                >
                    <TrashIcon size={14} />
                </button>
            )}
            <span
                aria-hidden
                className="ml-3 shrink-0 cursor-grab select-none text-[1.125rem] leading-none text-muted"
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
    onRename,
    onRemove,
}: {
    readonly entry: CardEntry;
    readonly canRemove: boolean;
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly onMoveUp: () => void;
    readonly onMoveDown: () => void;
    readonly onRename: (name: string) => void;
    readonly onRemove: () => void;
}) {
    const t = useTranslations("cardPackEditor");
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
        onRename(trimmed);
    };

    return (
        <div className="flex w-full items-center gap-2">
            <input
                type="text"
                className="box-border min-w-0 flex-1 rounded border border-border px-2 py-1 text-[1rem]"
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
                    className="shrink-0 cursor-pointer rounded border border-border bg-control p-1 text-fg hover:bg-control-hover"
                    aria-label={t("removeCardTitle", { name: entry.name })}
                    onClick={onRemove}
                >
                    <TrashIcon size={14} />
                </button>
            )}
            <span
                aria-hidden
                className="ml-3 shrink-0 cursor-grab select-none text-[1rem] leading-none text-muted"
            >
                {DRAG_HANDLE_GLYPH}
            </span>
        </div>
    );
}

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

const EDITOR_MODAL_ID = "card-pack-editor" as const;
const EDITOR_MODAL_MAX_WIDTH = "min(92vw, 720px)" as const;

/**
 * Helper to push the editor modal from any caller (setup step 1 +
 * AccountModal's My Card Packs section). Centralises the
 * `dismissOnOutsideClick: false` / `dismissOnEscape: false`
 * configuration so every entry point yields the same alert-style
 * "edits only close via explicit buttons" behavior.
 */
export function useOpenCardPackEditor(): (args: Props) => void {
    const { push, pop } = useModalStack();
    const tEditor = useTranslations("cardPackEditor");
    return (args) => {
        const title =
            args.initialPackId === undefined
                ? tEditor("titleCreate")
                : args.initialPackIsBuiltIn
                  ? tEditor("titleCustomize", {
                        label: args.initialPackLabel ?? "",
                    })
                  : tEditor("titleEdit", {
                        label: args.initialPackLabel ?? "",
                    });
        const store = createModalSlotStore<EditorStoreState>({
            draft: args.initialCardSet,
        });
        const close = () => pop();
        push({
            id: EDITOR_MODAL_ID,
            title,
            maxWidth: EDITOR_MODAL_MAX_WIDTH,
            dismissOnOutsideClick: false,
            dismissOnEscape: false,
            header: (
                <CardPackEditorHeader
                    titleText={title}
                    onClose={close}
                />
            ),
            content: (
                <CardPackEditorBody
                    store={store}
                    applyToActiveGame={args.applyToActiveGame}
                />
            ),
            footer: (
                <CardPackEditorFooter
                    store={store}
                    initialPackId={args.initialPackId}
                    initialPackLabel={args.initialPackLabel}
                    initialPackIsBuiltIn={
                        args.initialPackIsBuiltIn ?? false
                    }
                    applyToActiveGame={args.applyToActiveGame}
                    onClose={close}
                    {...(args.onSaved !== undefined
                        ? { onSaved: args.onSaved }
                        : {})}
                />
            ),
        });
    };
}
