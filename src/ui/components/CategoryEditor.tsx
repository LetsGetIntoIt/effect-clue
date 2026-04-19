"use client";

import { useEffect, useState } from "react";
import {
    Card,
    CardCategory,
    newCardId,
    newCategoryId,
    Player,
} from "../../logic/GameObjects";
import {
    Category,
    disambiguateName,
    GameSetup,
    validateSetup,
} from "../../logic/GameSetup";
import { useClue } from "../state";

/**
 * UI-local draft of the category editor state. We keep this entirely
 * local (not in the reducer) until the user clicks Apply — otherwise
 * every keystroke in a card name field would dispatch a setSetup and
 * prune the session repeatedly.
 *
 * Every category / card in the draft carries the stable id it had on
 * the live setup; newly-added ones get fresh ids. On Apply we build a
 * new setup preserving those ids, so references (known cards,
 * suggestions) survive the round trip.
 */
interface DraftCard {
    readonly id: Card;
    readonly name: string;
}
interface DraftCategory {
    readonly id: CardCategory;
    readonly name: string;
    readonly cards: ReadonlyArray<DraftCard>;
}

const categoriesToDraft = (
    categories: ReadonlyArray<Category>,
): ReadonlyArray<DraftCategory> =>
    categories.map(c => ({
        id: c.id,
        name: c.name,
        cards: c.cards.map(card => ({ id: card.id, name: card.name })),
    }));

const draftToSetup = (
    players: ReadonlyArray<Player>,
    draft: ReadonlyArray<DraftCategory>,
): GameSetup => {
    // Disambiguate as we go: every card name must be unique across the
    // entire deck, every category name must be unique among categories.
    // Trimming here means blank-ish entries still fail validateSetup,
    // which is what we want.
    const seenCategoryNames: string[] = [];
    const seenCardNames: string[] = [];

    const categories: Category[] = draft.map(c => {
        const trimmedName = c.name.trim();
        const resolvedCatName =
            trimmedName.length === 0
                ? ""
                : disambiguateName(trimmedName, seenCategoryNames);
        seenCategoryNames.push(resolvedCatName);

        const cards = c.cards.map(card => {
            const trimmedCardName = card.name.trim();
            const resolvedCardName =
                trimmedCardName.length === 0
                    ? ""
                    : disambiguateName(trimmedCardName, seenCardNames);
            seenCardNames.push(resolvedCardName);
            return { id: card.id, name: resolvedCardName };
        });

        return { id: c.id, name: resolvedCatName, cards };
    });

    return GameSetup({ players, categories });
};

const BUTTON_ACCENT =
    "cursor-pointer rounded border-none bg-accent px-3 py-1 text-[13px] text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-unknown";
const BUTTON_GHOST =
    "cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover";
const BUTTON_DANGER =
    "cursor-pointer border-none bg-transparent px-1 text-[14px] leading-none text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40";
const INPUT =
    "rounded border border-border px-2 py-1 text-[13px] w-full box-border";

/**
 * Editable category / card deck configuration. Sits inside
 * GameSetupPanel. Starts collapsed — clicking "Edit deck" reveals the
 * editor; clicking Cancel or Apply closes it again.
 *
 * We mirror the setup into a local draft so we can validate & revert
 * without touching the reducer until the user explicitly confirms.
 */
export function CategoryEditor() {
    const { state, dispatch } = useClue();
    const setup = state.setup;

    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<ReadonlyArray<DraftCategory>>(() =>
        categoriesToDraft(setup.categories),
    );

    useEffect(() => {
        if (!open) setDraft(categoriesToDraft(setup.categories));
    }, [setup.categories, open]);

    const setCategory = (
        index: number,
        update: (c: DraftCategory) => DraftCategory,
    ) => {
        setDraft(prev =>
            prev.map((c, i) => (i === index ? update(c) : c)),
        );
    };

    const updateCategoryName = (index: number, name: string) => {
        setCategory(index, c => ({ ...c, name }));
    };

    const updateCard = (
        catIdx: number,
        cardIdx: number,
        nextName: string,
    ) => {
        setCategory(catIdx, c => ({
            ...c,
            cards: c.cards.map((existing, i) =>
                i === cardIdx ? { ...existing, name: nextName } : existing,
            ),
        }));
    };

    const addCard = (catIdx: number) => {
        setCategory(catIdx, c => ({
            ...c,
            cards: [...c.cards, { id: newCardId(), name: "" }],
        }));
    };

    const removeCard = (catIdx: number, cardIdx: number) => {
        setCategory(catIdx, c => ({
            ...c,
            cards: c.cards.filter((_, i) => i !== cardIdx),
        }));
    };

    const addCategory = () => {
        setDraft(prev => [
            ...prev,
            {
                id: newCategoryId(),
                name: `Category ${prev.length + 1}`,
                cards: [{ id: newCardId(), name: "" }],
            },
        ]);
    };

    const removeCategory = (index: number) => {
        setDraft(prev => prev.filter((_, i) => i !== index));
    };

    const onApply = () => {
        const nextSetup = draftToSetup(setup.players, draft);
        const errors = validateSetup(nextSetup);
        if (errors.length > 0) return;
        dispatch({ type: "setSetup", setup: nextSetup });
        setOpen(false);
    };

    const onCancel = () => {
        setDraft(categoriesToDraft(setup.categories));
        setOpen(false);
    };

    if (!open) {
        return (
            <button
                type="button"
                className={BUTTON_GHOST}
                onClick={() => {
                    setDraft(categoriesToDraft(setup.categories));
                    setOpen(true);
                }}
            >
                Edit deck
            </button>
        );
    }

    const candidateSetup = draftToSetup(setup.players, draft);
    const errors = validateSetup(candidateSetup);
    const canApply = errors.length === 0;

    return (
        <div className="mt-3 rounded-[var(--radius)] border border-border bg-row-alt p-3">
            <h3 className="m-0 mb-2 text-[14px] font-semibold text-accent">
                Edit deck
            </h3>
            {errors.length > 0 && (
                <div className="mb-3 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
                    <strong>Fix before applying:</strong>
                    <ul className="m-0 list-disc pl-5">
                        {errors.map((err, i) => (
                            <li key={i}>{err.message}</li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex flex-col gap-3">
                {draft.map((cat, catIdx) => (
                    <div
                        key={String(cat.id)}
                        className="rounded border border-border bg-white p-2"
                    >
                        <div className="mb-2 flex items-center gap-2">
                            <input
                                type="text"
                                className={`${INPUT} font-semibold`}
                                value={cat.name}
                                placeholder="Category name"
                                onChange={e =>
                                    updateCategoryName(
                                        catIdx,
                                        e.currentTarget.value,
                                    )
                                }
                            />
                            <button
                                type="button"
                                className={BUTTON_DANGER}
                                title="Remove category"
                                disabled={draft.length <= 1}
                                onClick={() => removeCategory(catIdx)}
                            >
                                &times;
                            </button>
                        </div>
                        <ul className="flex flex-col gap-1 pl-0">
                            {cat.cards.map((card, cardIdx) => (
                                <li
                                    key={String(card.id)}
                                    className="flex items-center gap-2"
                                >
                                    <input
                                        type="text"
                                        className={INPUT}
                                        value={card.name}
                                        placeholder="Card name"
                                        onChange={e =>
                                            updateCard(
                                                catIdx,
                                                cardIdx,
                                                e.currentTarget.value,
                                            )
                                        }
                                    />
                                    <button
                                        type="button"
                                        className={BUTTON_DANGER}
                                        title="Remove card"
                                        disabled={cat.cards.length <= 1}
                                        onClick={() =>
                                            removeCard(catIdx, cardIdx)
                                        }
                                    >
                                        &times;
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <button
                            type="button"
                            className="mt-2 cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                            onClick={() => addCard(catIdx)}
                        >
                            + add card
                        </button>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
                <button
                    type="button"
                    className={BUTTON_GHOST}
                    onClick={addCategory}
                >
                    + add category
                </button>
                <div className="flex gap-2">
                    <button
                        type="button"
                        className={BUTTON_GHOST}
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={BUTTON_ACCENT}
                        disabled={!canApply}
                        onClick={onApply}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
