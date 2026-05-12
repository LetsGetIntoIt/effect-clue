"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cardName, categoryName } from "../../logic/CardSet";
import type { Card, CardCategory } from "../../logic/GameObjects";
import { useClue } from "../state";

const STORAGE_KEY = "effect-clue.my-hand-panel.collapsed.v1";

/**
 * Persistent "your hand" affordance shown above the play layout when
 * the user has identified themselves (`selfPlayerId !== null`) and
 * has marked at least one card as their own. Renders nothing when
 * either condition is false — per the M6 plan's 0i decision, gated
 * UI is hidden, not shown with apologetic empty-state copy.
 *
 * Cards are grouped by category so the row reads as
 * "Suspect: Miss Scarlet · Weapon: Knife · Room: Library" — that
 * keeps the grouping cue users already learned in the checklist.
 *
 * Collapse toggle persists across reloads. The panel is intentionally
 * compact (a single horizontal scroll-free strip with `flex-wrap`)
 * so it doesn't fight the play view for vertical space.
 */
export function MyHandPanel() {
    const t = useTranslations("myHand");
    const { state } = useClue();
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "1";
        } catch {
            return false;
        }
    });

    const selfPlayer = state.selfPlayerId;
    const myCards = useMemo<ReadonlyArray<Card>>(() => {
        if (selfPlayer === null) return [];
        return state.knownCards
            .filter(kc => kc.player === selfPlayer)
            .map(kc => kc.card);
    }, [state.knownCards, selfPlayer]);

    // Grouped lookup: category id → category name + card names in that
    // category that the user owns. Iterates the deck order so the
    // grouping reads in canonical category order.
    const grouped = useMemo(() => {
        if (selfPlayer === null || myCards.length === 0) return [];
        const myCardSet = new Set(myCards);
        return state.setup.cardSet.categories
            .map(category => ({
                id: category.id as CardCategory,
                label: categoryName(state.setup.cardSet, category.id),
                cards: category.cards
                    .filter(entry => myCardSet.has(entry.id))
                    .map(entry => entry.name),
            }))
            .filter(g => g.cards.length > 0);
    }, [state.setup.cardSet, myCards, selfPlayer]);

    if (selfPlayer === null) return null;
    if (myCards.length === 0) return null;

    const toggle = () => {
        setCollapsed(prev => {
            const next = !prev;
            try {
                window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
            } catch {
                // Quota / private mode — non-fatal.
            }
            return next;
        });
    };

    return (
        <section
            aria-label={t("title")}
            data-my-hand-panel=""
            // contain-inline-size: stops the wrapped chip rows from
            // propagating their no-wrap intrinsic size into
            // `<main>`'s `min-w-max` calculation on mobile (mirrors
            // SuggestionLogPanel's pill row pattern).
            className="contain-inline-size rounded border border-border/40 bg-panel/60 px-3 py-2"
        >
            <header className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[1.25rem] font-semibold uppercase tracking-wide text-muted">
                    {t("title")}
                </h2>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-control px-2 py-0.5 text-[1rem] hover:bg-hover"
                    aria-expanded={!collapsed}
                    onClick={toggle}
                >
                    {collapsed ? t("toggleShow") : t("toggleHide")}
                </button>
            </header>
            {!collapsed && (
                <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
                    {grouped.map(group => (
                        <li
                            key={String(group.id)}
                            className="flex items-baseline gap-1.5 text-[1rem]"
                        >
                            <span className="font-semibold text-muted">
                                {t("categoryLabel", { category: group.label })}
                            </span>
                            <span>{group.cards.join(", ")}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Helper used by `RefuteHint` to derive the user's hand. Module-
 * internal — no other consumer today, and exporting it would invite
 * call-site drift. Returns the set of card ids in the current
 * user's hand; empty when identity is unset or no cards are marked.
 */
function useMyCards(): ReadonlySet<Card> {
    const { state } = useClue();
    return useMemo(() => {
        if (state.selfPlayerId === null) return new Set();
        return new Set(
            state.knownCards
                .filter(kc => kc.player === state.selfPlayerId)
                .map(kc => kc.card),
        );
    }, [state.knownCards, state.selfPlayerId]);
}

/**
 * Inline hint shown beneath the "Add a suggestion" form when the
 * three suggested cards are filled in. Tells the user whether they
 * can refute (and with which cards) given their identified hand.
 *
 * Visibility rules per the M8 plan:
 *   - Hidden when `selfPlayerId === null`.
 *   - Hidden until all three suggested cards are filled in.
 *   - Empty intersection → "You can't refute this."
 *   - Non-empty intersection → "You can refute with: X, Y, or Z."
 *
 * Reads directly from `useClue` so the form (which is intentionally
 * decoupled from the reducer — it dispatches via an `onSubmit`
 * callback) doesn't have to take new props. The hint mounts as a
 * sibling of the form inside `SuggestionLogPanel`'s AddForm wrapper.
 */
export function RefuteHint() {
    const t = useTranslations("refuteHint");
    const { state } = useClue();
    const myCards = useMyCards();

    if (state.selfPlayerId === null) return null;
    const draft = state.pendingSuggestion;
    if (draft === null) return null;
    const filledCards = draft.cards.filter(
        (c): c is Card => c !== null,
    );
    if (filledCards.length !== state.setup.cardSet.categories.length) {
        return null;
    }

    const intersect = filledCards.filter(card => myCards.has(card));
    const setup = state.setup;

    if (intersect.length === 0) {
        return (
            <p
                className="m-0 px-1 py-1 text-[1rem] text-muted"
                data-refute-hint=""
            >
                {t("cannotRefute")}
            </p>
        );
    }

    const names = intersect.map(card =>
        cardName(setup.cardSet, card),
    );
    return (
        <p
            className="m-0 px-1 py-1 text-[1rem] text-fg"
            data-refute-hint=""
        >
            {t("canRefute", {
                cards: names.join(t("join")),
            })}
        </p>
    );
}
