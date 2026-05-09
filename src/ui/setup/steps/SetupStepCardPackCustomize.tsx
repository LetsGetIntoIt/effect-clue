"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
    type Category,
    type CardEntry,
} from "../../../logic/CardSet";
import { useConfirm } from "../../hooks/useConfirm";
import { useClue } from "../../state";
import { TrashIcon } from "../../components/Icons";

/**
 * Inline customize sub-flow for the M6 wizard's step 1.
 *
 * Lets the user rename, add, and remove categories and cards. The
 * sub-flow doesn't reorder via drag-and-drop yet — that's deferred
 * to a follow-up since the existing `reorderCategories` /
 * `reorderCardsInCategory` actions (PR-A1) are wired but the UI
 * component isn't.
 *
 * Edits dispatch immediately, mirroring today's inSetup behavior.
 * The confirm dialogs gate destructive removals when the action
 * would also drop known cards / suggestions referencing them
 * (matching the legacy `<Checklist inSetup>` patterns).
 *
 * Save-as / update-pack will land in a follow-up PR alongside the
 * DnD reorder UI; for now the user can save and reuse via the
 * legacy CardPackRow pill bar (still mounted under the feature
 * flag's "off" code path) or the existing share modal.
 */
export function SetupStepCardPackCustomize() {
    const t = useTranslations("setupWizard.cardPack.customize");
    const { state, dispatch } = useClue();
    const confirm = useConfirm();
    const setup = state.setup;

    return (
        <div className="flex flex-col gap-3 rounded border border-border/30 p-3">
            <p className="m-0 text-[13px] text-muted">{t("helperText")}</p>

            <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {setup.categories.map(category => (
                    <li
                        key={String(category.id)}
                        className="flex flex-col gap-2 rounded border border-border/40 p-2"
                    >
                        <CategoryHeader
                            category={category}
                            canRemove={setup.categories.length > 1}
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
                        <ul className="m-0 flex list-none flex-col gap-1 p-0">
                            {category.cards.map(entry => (
                                <li
                                    key={String(entry.id)}
                                    className="flex items-center gap-2"
                                >
                                    <CardRow
                                        entry={entry}
                                        canRemove={category.cards.length > 1}
                                        onRemove={async () => {
                                            const hasReferences =
                                                state.knownCards.some(
                                                    kc => kc.card === entry.id,
                                                ) ||
                                                state.suggestions.length > 0;
                                            if (hasReferences) {
                                                const ok = await confirm({
                                                    message: t(
                                                        "removeCardConfirm",
                                                        {
                                                            card: entry.name,
                                                        },
                                                    ),
                                                });
                                                if (!ok) return;
                                            }
                                            dispatch({
                                                type: "removeCardById",
                                                cardId: entry.id,
                                            });
                                        }}
                                    />
                                </li>
                            ))}
                        </ul>
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
                    </li>
                ))}
            </ul>
            <button
                type="button"
                className="self-start cursor-pointer rounded border border-border bg-bg px-2 py-1 text-[12px] hover:bg-hover"
                onClick={() => dispatch({ type: "addCategory" })}
            >
                {t("addCategory")}
            </button>
        </div>
    );
}

function CategoryHeader({
    category,
    canRemove,
    onRemove,
}: {
    readonly category: Category;
    readonly canRemove: boolean;
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
                aria-label={t("categoryNameAria", {
                    name: category.name,
                })}
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
        </div>
    );
}

function CardRow({
    entry,
    canRemove,
    onRemove,
}: {
    readonly entry: CardEntry;
    readonly canRemove: boolean;
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
        </div>
    );
}
