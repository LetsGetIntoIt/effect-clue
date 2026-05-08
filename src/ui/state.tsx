"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    Card,
    newCardId,
    newCategoryId,
    Player,
} from "../logic/GameObjects";
import {
    allCardEntries,
    CardEntry,
    CARD_SETS,
    categoryName as resolveCategoryName,
    categoryOfCard,
    Category,
    DEFAULT_SETUP,
    disambiguateName,
    findCardEntry,
    findCategoryEntry,
    GameSetup,
    newGameSetup,
} from "../logic/GameSetup";
import {
    type CardPackUsage,
    recordCardPackUse,
} from "../logic/CardPackUsage";
import { cardPackUsageQueryKey } from "../data/cardPackUsage";
import { HashMap } from "effect";
import {
    computeHypothesisConflict,
    emptyHypotheses,
    foldHypothesesInto,
    type HypothesisConflict,
    type HypothesisMap,
} from "../logic/Hypothesis";

// Re-export for ContradictionBanner (which historically imports from
// "../state"). The type itself moved to ./logic/Hypothesis.
export type { HypothesisConflict };
import { caseFileProgress } from "../logic/Recommender";
import {
    caseFileSolved,
    deductionRevealed,
    gameSetupStarted,
    gameStarted,
} from "../analytics/events";
import {
    claimCaseFileSolved,
    claimGameStarted,
    gameDurationMs,
    isFirstSession,
    setupDurationMs,
    startSetup,
} from "../analytics/gameSession";
import { type Cell, type CellValue, type Knowledge } from "../logic/Knowledge";
import { chainFor } from "../logic/Provenance";
import {
    buildInitialKnowledge,
    KnownCard,
} from "../logic/InitialKnowledge";
import { Effect, Result } from "effect";
import deduce, { type DeductionResult } from "../logic/Deducer";
import { TelemetryRuntime } from "../observability/runtime";
import {
    Accusation,
    AccusationId,
    newAccusationId,
} from "../logic/Accusation";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
} from "../logic/Suggestion";
import {
    type GameSession,
    loadFromLocalStorage,
    saveToLocalStorage,
} from "../logic/Persistence";
import {
    loadGameLifecycleState,
    markGameCreated,
    markGameTouched,
} from "../logic/GameLifecycleState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    deduceWithExplanations,
    type Provenance,
} from "../logic/Provenance";
import {
    emptyFootnotes,
    type FootnoteMap,
    refuterCandidateFootnotes,
} from "../logic/Footnotes";
import {
    AccusationsService,
    CardSetService,
    PlayerSetService,
    SuggestionsService,
    makeAccusationsLayer,
    makeSetupLayer,
    makeSuggestionsLayer,
} from "../logic/services";
import { DateTime, Duration, Layer } from "effect";
import { requestFocusAddForm } from "./addFormFocus";
import { requestFocusChecklistCell } from "./checklistFocus";
import { useGlobalShortcut } from "./keyMap";
import { PANE_SETTLE } from "./motion";
import type { UiMode } from "../logic/ClueState";

type DeduceLayer = Layer.Layer<
    | AccusationsService
    | CardSetService
    | PlayerSetService
    | SuggestionsService
>;

/**
 * Window for the Cmd+K double-tap that clears the suggestion form.
 * A second press within this window after the first signals "I want
 * to start fresh"; outside it, the second press just refocuses.
 */
const DOUBLE_TAP: Duration.Duration = Duration.millis(400);

/**
 * Whether a uiMode transition triggers a visible slide whose target
 * DOM we shouldn't measure/focus/scroll-to until the pane has settled.
 *
 * - `setup ↔ play` animates the top-level AnimatePresence on every
 *   breakpoint.
 * - `checklist ↔ suggest` only animates on mobile (the desktop layout
 *   shows both panes statically).
 * - No transition when the mode isn't actually changing.
 */
function needsPaneSettle(fromMode: UiMode, toMode: UiMode): boolean {
    if (fromMode === toMode) return false;
    if (fromMode === "setup" || toMode === "setup") return true;
    if (typeof window === "undefined") return false;
    return !window.matchMedia("(min-width: 800px)").matches;
}

export type { DraftSuggestion } from "../logic/ClueState";
import type {
    ClueAction,
    ClueState,
    PendingSuggestionDraft,
} from "../logic/ClueState";

const initialState: ClueState = {
    setup: DEFAULT_SETUP,
    handSizes: [],
    knownCards: [],
    suggestions: [],
    accusations: [],
    uiMode: "setup",
    hypotheses: emptyHypotheses,
    pendingSuggestion: null,
    selfPlayerId: null,
    firstDealtPlayerId: null,
};

const reducer = (state: ClueState, action: ClueAction): ClueState => {
    switch (action.type) {
        case "newGame":
            return {
                ...initialState,
                setup: newGameSetup(),
            };

        case "setUiMode":
            return { ...state, uiMode: action.mode };

        case "loadCardSet":
            // Swap the deck; keep the current player roster. Hand
            // sizes, known cards, suggestions, accusations, and
            // hypotheses reference card ids from the old deck and are
            // discarded. Any in-flight pending-suggestion draft also
            // references the old deck's cards, so drop it too.
            return {
                ...state,
                setup: GameSetup({
                    cardSet: action.cardSet,
                    playerSet: state.setup.playerSet,
                }),
                knownCards: [],
                handSizes: [],
                suggestions: [],
                accusations: [],
                hypotheses: emptyHypotheses,
                pendingSuggestion: null,
            };

        case "setSetup":
            return pruneSessionToSetup(state, action.setup);

        case "addCategory": {
            const existingCategoryNames = state.setup.categories.map(c => c.name);
            const existingCardNames = allCardEntries(state.setup).map(c => c.name);
            const catName = disambiguateName(
                nextNumberedCategoryName(existingCategoryNames),
                existingCategoryNames,
            );
            const cardName = disambiguateName(
                nextNumberedCardName(existingCardNames),
                existingCardNames,
            );
            const newCat: Category = Category({
                id: newCategoryId(),
                name: catName,
                cards: [CardEntry({ id: newCardId(), name: cardName })],
            });
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: [...state.setup.categories, newCat],
                }),
            };
        }

        case "removeCategoryById": {
            if (state.setup.categories.length <= 1) return state;
            const nextSetup = GameSetup({
                players: state.setup.players,
                categories: state.setup.categories.filter(
                    c => c.id !== action.categoryId,
                ),
            });
            return pruneSessionToSetup(state, nextSetup);
        }

        case "addCardToCategoryById": {
            const existingCardNames = allCardEntries(state.setup).map(c => c.name);
            const cardName = disambiguateName(
                nextNumberedCardName(existingCardNames),
                existingCardNames,
            );
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: state.setup.categories.map(c =>
                        c.id === action.categoryId
                            ? Category({
                                  id: c.id,
                                  name: c.name,
                                  cards: [
                                      ...c.cards,
                                      CardEntry({ id: newCardId(), name: cardName }),
                                  ],
                              })
                            : c,
                    ),
                }),
            };
        }

        case "removeCardById": {
            const target = state.setup.categories.find(c =>
                c.cards.some(e => e.id === action.cardId),
            );
            if (!target) return state;
            if (target.cards.length <= 1) return state;
            const nextSetup = GameSetup({
                players: state.setup.players,
                categories: state.setup.categories.map(c =>
                    c.id === target.id
                        ? Category({
                              id: c.id,
                              name: c.name,
                              cards: c.cards.filter(
                                  e => e.id !== action.cardId,
                              ),
                          })
                        : c,
                ),
            });
            return pruneSessionToSetup(state, nextSetup);
        }

        case "renameCategory": {
            const current = findCategoryEntry(state.setup, action.categoryId);
            if (!current) return state;
            const proposed = action.name.trim();
            if (proposed.length === 0) return state;
            if (proposed === current.name) return state;
            const othersNames = state.setup.categories
                .filter(c => c.id !== action.categoryId)
                .map(c => c.name);
            const finalName = disambiguateName(proposed, othersNames);
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: state.setup.categories.map(c =>
                        c.id === action.categoryId
                            ? Category({ id: c.id, name: finalName, cards: c.cards })
                            : c,
                    ),
                }),
            };
        }

        case "renameCard": {
            const current = findCardEntry(state.setup, action.cardId);
            if (!current) return state;
            const proposed = action.name.trim();
            if (proposed.length === 0) return state;
            if (proposed === current.name) return state;
            const othersNames = allCardEntries(state.setup)
                .filter(e => e.id !== action.cardId)
                .map(e => e.name);
            const finalName = disambiguateName(proposed, othersNames);
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: state.setup.categories.map(c => Category({
                        id: c.id,
                        name: c.name,
                        cards: c.cards.map(e =>
                            e.id === action.cardId
                                ? CardEntry({ id: e.id, name: finalName })
                                : e,
                        ),
                    })),
                }),
            };
        }

        case "addKnownCard":
            return {
                ...state,
                knownCards: [...state.knownCards, action.card],
            };

        case "removeKnownCard":
            return {
                ...state,
                knownCards: state.knownCards.filter(
                    (_, i) => i !== action.index,
                ),
            };

        case "setHandSize": {
            const filtered = state.handSizes.filter(
                ([p]) => p !== action.player,
            );
            return {
                ...state,
                handSizes:
                    action.size === undefined
                        ? filtered
                        : [...filtered, [action.player, action.size] as const],
            };
        }

        case "addSuggestion":
            // Submitting the draft also clears it — the form re-mounts
            // empty for the next entry, and a stale persisted draft
            // would otherwise re-seed the next form.
            return {
                ...state,
                suggestions: [...state.suggestions, action.suggestion],
                pendingSuggestion: null,
            };

        case "updateSuggestion":
            return {
                ...state,
                suggestions: state.suggestions.map(s =>
                    s.id === action.suggestion.id ? action.suggestion : s,
                ),
            };

        case "removeSuggestion":
            return {
                ...state,
                suggestions: state.suggestions.filter(
                    s => s.id !== action.id,
                ),
            };

        case "addAccusation":
            return {
                ...state,
                accusations: [...state.accusations, action.accusation],
            };

        case "updateAccusation":
            return {
                ...state,
                accusations: state.accusations.map(a =>
                    a.id === action.accusation.id ? action.accusation : a,
                ),
            };

        case "removeAccusation":
            return {
                ...state,
                accusations: state.accusations.filter(
                    a => a.id !== action.id,
                ),
            };

        case "addPlayer": {
            const existing = new Set(
                state.setup.players.map(p => String(p)),
            );
            let n = 1;
            while (existing.has(`Player ${n}`)) n++;
            return {
                ...state,
                setup: GameSetup({
                    players: [...state.setup.players, Player(`Player ${n}`)],
                    categories: state.setup.categories,
                }),
            };
        }

        case "removePlayer":
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players.filter(
                        p => p !== action.player,
                    ),
                    categories: state.setup.categories,
                }),
                knownCards: state.knownCards.filter(
                    kc => kc.player !== action.player,
                ),
                handSizes: state.handSizes.filter(
                    ([p]) => p !== action.player,
                ),
                suggestions: state.suggestions
                    .filter(s => s.suggester !== action.player)
                    .map(s => ({
                        ...s,
                        nonRefuters: s.nonRefuters.filter(
                            p => p !== action.player,
                        ),
                        refuter:
                            s.refuter === action.player
                                ? undefined
                                : s.refuter,
                    })),
                accusations: state.accusations.filter(
                    a => a.accuser !== action.player,
                ),
                // The in-flight draft may reference the removed player
                // in any of its slots; drop it rather than partial-prune.
                pendingSuggestion: null,
                // Identity references must follow the player set: a
                // dangling `selfPlayerId` would gate UI on a non-
                // existent player. Same for `firstDealtPlayerId`.
                selfPlayerId:
                    state.selfPlayerId === action.player
                        ? null
                        : state.selfPlayerId,
                firstDealtPlayerId:
                    state.firstDealtPlayerId === action.player
                        ? null
                        : state.firstDealtPlayerId,
            };

        case "movePlayer": {
            const i = state.setup.players.indexOf(action.player);
            if (i === -1) return state;
            const target = action.direction === "left" ? i - 1 : i + 1;
            if (target < 0 || target >= state.setup.players.length) return state;
            const players = [...state.setup.players];
            const a = players[i];
            const b = players[target];
            if (a === undefined || b === undefined) return state;
            players[i] = b;
            players[target] = a;
            return {
                ...state,
                setup: GameSetup({
                    players,
                    categories: state.setup.categories,
                }),
            };
        }

        case "renamePlayer": {
            if (action.oldName === action.newName) return state;
            const { oldName, newName } = action;
            const pending = state.pendingSuggestion;
            const renamedPending: PendingSuggestionDraft | null =
                pending === null
                    ? null
                    : {
                          ...pending,
                          suggester:
                              pending.suggester === oldName
                                  ? newName
                                  : pending.suggester,
                          nonRefuters:
                              pending.nonRefuters === null ||
                              isPendingNobody(pending.nonRefuters)
                                  ? pending.nonRefuters
                                  : pending.nonRefuters.map(p =>
                                        p === oldName ? newName : p,
                                    ),
                          refuter:
                              pending.refuter === oldName
                                  ? newName
                                  : pending.refuter,
                      };
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players.map(p =>
                        p === oldName ? newName : p,
                    ),
                    categories: state.setup.categories,
                }),
                knownCards: state.knownCards.map(kc =>
                    kc.player === oldName ? { ...kc, player: newName } : kc,
                ),
                handSizes: state.handSizes.map(
                    ([p, size]) =>
                        (p === oldName
                            ? ([newName, size] as const)
                            : ([p, size] as const)),
                ),
                suggestions: state.suggestions.map(s => ({
                    ...s,
                    suggester:
                        s.suggester === oldName ? newName : s.suggester,
                    nonRefuters: s.nonRefuters.map(p =>
                        p === oldName ? newName : p,
                    ),
                    refuter:
                        s.refuter === oldName ? newName : s.refuter,
                })),
                accusations: state.accusations.map(a => ({
                    ...a,
                    accuser: a.accuser === oldName ? newName : a.accuser,
                })),
                pendingSuggestion: renamedPending,
                // Identity references follow the rename so a user
                // who set themselves as "Alice" stays identified as
                // "Alice" after a typo fix.
                selfPlayerId:
                    state.selfPlayerId === oldName
                        ? newName
                        : state.selfPlayerId,
                firstDealtPlayerId:
                    state.firstDealtPlayerId === oldName
                        ? newName
                        : state.firstDealtPlayerId,
            };
        }

        case "setHypothesis":
            return {
                ...state,
                hypotheses: HashMap.set(
                    state.hypotheses,
                    action.cell,
                    action.value,
                ),
            };

        case "clearHypothesis":
            return {
                ...state,
                hypotheses: HashMap.remove(state.hypotheses, action.cell),
            };

        case "replaceSession": {
            const { session } = action;
            return {
                ...state,
                setup: session.setup,
                knownCards: session.hands.flatMap(h =>
                    h.cards.map(card => KnownCard({ player: h.player, card })),
                ),
                handSizes: session.handSizes.map(
                    ({ player, size }) => [player, size] as const,
                ),
                suggestions: session.suggestions.map(s => ({
                    id: s.id === SuggestionId("")
                        ? newSuggestionId()
                        : s.id,
                    suggester: s.suggester,
                    cards: Array.from(s.cards),
                    nonRefuters: Array.from(s.nonRefuters),
                    refuter: s.refuter,
                    seenCard: s.seenCard,
                })),
                accusations: session.accusations.map(a => ({
                    id: a.id === AccusationId("")
                        ? newAccusationId()
                        : a.id,
                    accuser: a.accuser,
                    cards: Array.from(a.cards),
                })),
                hypotheses: session.hypotheses,
                // Imported sessions don't carry a draft. Drop any
                // local in-flight draft so the new game starts clean.
                pendingSuggestion: session.pendingSuggestion ?? null,
                // Localstorage round-trip carries identity through
                // (so a reload preserves "I'm Alice"), but the share
                // wire format does NOT — receivers pick their own.
                // The codec defaults missing fields to null so this
                // works for both paths.
                selfPlayerId: session.selfPlayerId ?? null,
                firstDealtPlayerId: session.firstDealtPlayerId ?? null,
            };
        }

        case "setPendingSuggestion":
            return { ...state, pendingSuggestion: action.draft };

        case "setSelfPlayer":
            return { ...state, selfPlayerId: action.player };

        case "setFirstDealtPlayer":
            return { ...state, firstDealtPlayerId: action.player };

        case "reorderPlayers": {
            // Validate the input is a permutation of the current
            // player list — otherwise the action is a malformed
            // bulk-replace and we'd silently drop or invent players.
            const current = state.setup.players;
            const next = action.players;
            if (next.length !== current.length) return state;
            const currentSet = new Set(current as ReadonlyArray<Player>);
            for (const p of next) {
                if (!currentSet.has(p)) return state;
            }
            // Same set, possibly reordered. Accept.
            return {
                ...state,
                setup: GameSetup({
                    players: next,
                    categories: state.setup.categories,
                }),
            };
        }

        case "reorderCategories": {
            const current = state.setup.categories;
            const next = action.categories;
            if (next.length !== current.length) return state;
            const currentIds = new Set(current.map(c => c.id));
            for (const c of next) {
                if (!currentIds.has(c.id)) return state;
            }
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: next,
                }),
            };
        }

        case "reorderCardsInCategory": {
            const cat = state.setup.categories.find(
                c => c.id === action.categoryId,
            );
            if (cat === undefined) return state;
            // Permutation check on the card ids.
            if (action.cards.length !== cat.cards.length) return state;
            const currentIds = new Set(cat.cards.map(c => c.id));
            for (const card of action.cards) {
                if (!currentIds.has(card.id)) return state;
            }
            return {
                ...state,
                setup: GameSetup({
                    players: state.setup.players,
                    categories: state.setup.categories.map(c =>
                        c.id === action.categoryId
                            ? Category({ ...c, cards: action.cards })
                            : c,
                    ),
                }),
            };
        }
    }
};

const isPendingNobody = (
    v: ReadonlyArray<Player> | { readonly kind: "nobody" } | null,
): v is { readonly kind: "nobody" } => {
    if (v === null) return false;
    if (Array.isArray(v)) return false;
    return (v as { readonly kind: "nobody" }).kind === "nobody";
};

// ---- Derived ------------------------------------------------------------

/**
 * Everything computed from `ClueState` — cached via useMemo so the heavy
 * deducer only re-runs when inputs actually change. React Compiler handles
 * the downstream component render memoization, so we don't need useMemo in
 * every consumer.
 */
interface ClueDerived {
    readonly suggestionsAsData: ReadonlyArray<Suggestion>;
    readonly accusationsAsData: ReadonlyArray<Accusation>;
    readonly initialKnowledge: Knowledge;
    readonly deductionResult: DeductionResult;
    readonly provenance: Provenance | undefined;
    /**
     * Provenance against `realFacts ∪ hypotheses`. Used to render the
     * deduction chain in the cell-why popover for `derived` cells —
     * cells whose value follows from the user's hypotheses but isn't
     * proven by real facts alone. `undefined` when no hypotheses are
     * active or the joint deduction failed.
     */
    readonly jointProvenance: Provenance | undefined;
    readonly footnotes: FootnoteMap;
    /**
     * Active hypothesis map (mirrored from `state.hypotheses` so
     * components can read the canonical input alongside the
     * `jointDeductionResult` it produced).
     */
    readonly hypotheses: HypothesisMap;
    /**
     * The joint deduction over `realFacts ∪ hypotheses`, when at least
     * one hypothesis is active. `undefined` when no hypotheses are
     * active (consumers can fall back to `deductionResult`). Failure
     * branch represents either a fold-time direct conflict (a
     * hypothesis disagreed with a known cell of `initialKnowledge`) or
     * a runtime contradiction inside the deducer's fixed-point loop.
     */
    readonly jointDeductionResult: DeductionResult | undefined;
    /**
     * Categorised data for the hypothesis-conflict banner, set when
     * the real-only deduction succeeds but at least one active
     * hypothesis is rejected. `kind` distinguishes the two failure
     * modes the banner copy distinguishes:
     *
     *   - `directly-contradicted`: at least one hypothesis disagrees
     *     with a real fact. `entries` lists those hypotheses (only
     *     the contradicted ones — other plausible hypotheses don't
     *     belong in this banner).
     *   - `jointly-conflicting`: every hypothesis is individually
     *     plausible against the real-only knowledge, but their union
     *     is unsatisfiable. `entries` lists ALL active hypotheses
     *     since the conflict is in their interaction.
     *
     * Real-deduction failure still wins precedence — when
     * `deductionResult` itself is a failure, this is `undefined`.
     */
    readonly hypothesisConflict: HypothesisConflict | undefined;
}

const deriveState = (
    suggestionsAsData: ReadonlyArray<Suggestion>,
    initialKnowledge: Knowledge,
    deductionResult: DeductionResult,
    deduceLayer: DeduceLayer,
): { provenance: Provenance | undefined; footnotes: FootnoteMap } => {
    // deduceWithExplanations now fails via the Effect failure channel
    // on contradiction; Effect.result materialises it back to a Result
    // so we can branch here without a try/catch.
    const traced = TelemetryRuntime.runSync(
        Effect.result(deduceWithExplanations(initialKnowledge)).pipe(
            Effect.provide(deduceLayer),
        ),
    );
    const provenance = Result.isSuccess(traced)
        ? traced.success.provenance
        : undefined;
    const footnotes = Result.isSuccess(deductionResult)
        ? refuterCandidateFootnotes(
              suggestionsAsData,
              deductionResult.success,
          )
        : emptyFootnotes;
    return { provenance, footnotes };
};

// ---- Context + hook -----------------------------------------------------

interface ClueContextValue {
    readonly state: ClueState;
    readonly dispatch: React.Dispatch<ClueAction>;
    readonly derived: ClueDerived;
    readonly hasGameData: () => boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly undo: () => void;
    readonly redo: () => void;
    /**
     * False on the very first render (server/SSG snapshot and the
     * initial client render) while the URL/localStorage hydration
     * effect hasn't resolved the real `uiMode` yet. Consumers gate
     * view-specific UI behind this so the default `"setup"` pane
     * doesn't flash before the hydrated view takes over.
     */
    readonly hydrated: boolean;
    /**
     * The action that the next `undo()` would reverse, plus the state
     * snapshot *before* that action fired (so id-keyed actions can
     * resolve names via the pre-action `setup`). `undefined` when the
     * past stack is empty.
     */
    readonly nextUndo: {
        readonly action: ClueAction;
        readonly previousState: ClueState;
    } | undefined;
    /**
     * Mirror of `nextUndo` for redo — the action `redo()` would replay.
     * The snapshot is the current state (the action fires against it,
     * same as any forward dispatch).
     */
    readonly nextRedo: {
        readonly action: ClueAction;
        readonly previousState: ClueState;
    } | undefined;
}

/**
 * History wrapper for undo/redo. Each non-ephemeral user action pushes
 * the previous state *and* the action itself to `past` / `pastActions`
 * — the action snapshot is what lets the Toolbar's hover tooltip
 * describe "what would be undone" in natural language.
 *
 * `replaceSession` (hydration from URL/localStorage) and `setUiMode`
 * (purely presentational) bypass the history so they can't be undone
 * into — they're not user-visible semantic changes.
 *
 * `pastActions[i]` is the action that transitioned `past[i]` into
 * either `past[i+1]` or (when `i` is the last index) `current`.
 * `futureActions` mirrors the same invariant on the redo side.
 */
interface History {
    readonly past: ReadonlyArray<ClueState>;
    readonly pastActions: ReadonlyArray<ClueAction>;
    readonly current: ClueState;
    readonly future: ReadonlyArray<ClueState>;
    readonly futureActions: ReadonlyArray<ClueAction>;
}

type HistoryAction =
    | ClueAction
    | { type: "__undo" }
    | { type: "__redo" };

const historyReducer = (h: History, action: HistoryAction): History => {
    if (action.type === "__undo") {
        if (h.past.length === 0) return h;
        const prev = h.past[h.past.length - 1]!;
        const reversedAction = h.pastActions[h.pastActions.length - 1]!;
        return {
            past: h.past.slice(0, -1),
            pastActions: h.pastActions.slice(0, -1),
            current: prev,
            future: [h.current, ...h.future],
            futureActions: [reversedAction, ...h.futureActions],
        };
    }
    if (action.type === "__redo") {
        if (h.future.length === 0) return h;
        const [next, ...restFuture] = h.future;
        const [replayedAction, ...restFutureActions] = h.futureActions;
        return {
            past: [...h.past, h.current],
            pastActions: [...h.pastActions, replayedAction!],
            current: next!,
            future: restFuture,
            futureActions: restFutureActions,
        };
    }
    const newCurrent = reducer(h.current, action);
    if (newCurrent === h.current) return h;
    // Ephemeral / restore actions don't participate in history.
    // `setPendingSuggestion` fires per keystroke as the form-side
    // mirror updates ClueState; making it undoable would mean every
    // typed character pushes a frame onto the undo stack.
    if (
        action.type === "replaceSession"
        || action.type === "setUiMode"
        || action.type === "setPendingSuggestion"
    ) {
        return { ...h, current: newCurrent };
    }
    return {
        past: [...h.past, h.current],
        pastActions: [...h.pastActions, action],
        current: newCurrent,
        future: [],
        futureActions: [],
    };
};

const ClueContext = createContext<ClueContextValue | undefined>(undefined);

export const useClue = (): ClueContextValue => {
    const ctx = useContext(ClueContext);
    if (!ctx) {
        throw new Error("useClue must be used inside <ClueProvider>");
    }
    return ctx;
};

// ---- Provider -----------------------------------------------------------

/**
 * React Query cache key for the persisted game session. The shape
 * mirrors what `loadFromLocalStorage` returns from the v6 storage
 * key — a `GameSession` (or `null` before localStorage has been
 * read).
 *
 * Today the in-memory `historyReducer` is the source of truth for
 * the live game state; the RQ cache is a downstream mirror updated
 * after every dispatch so RQ DevTools can show the current session
 * and the persister can write it to `effect-clue.rq-cache.v1`. M8
 * extends this hook to swap in server-backed state for signed-in
 * users; the cache shape stays the same.
 */
const gameSessionQueryKey = ["game-session"] as const;

const readGameSession = (): GameSession | null =>
    typeof window === "undefined" ? null : loadFromLocalStorage() ?? null;

export function ClueProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    // The RQ-backed mirror of the persisted session. The live game
    // state still flows through `historyReducer` below — this query
    // exists for cross-cutting concerns: persister, DevTools, and the
    // cache-shape contract that M8 will swap from localStorage to a
    // server action without touching consumer code.
    useQuery({
        queryKey: gameSessionQueryKey,
        queryFn: readGameSession,
        initialData: readGameSession,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const [history, dispatchRaw] = useReducer(historyReducer, {
        past: [],
        pastActions: [],
        current: initialState,
        future: [],
        futureActions: [],
    });
    const state = history.current;
    /**
     * Telemetry-instrumented dispatch. Every action becomes a
     * `rq.gameState.<action.type>` span under `TelemetryRuntime`,
     * so Honeycomb sees the per-action call counts and timings; the
     * underlying reducer step still runs synchronously inside the
     * span so React's batching is unaffected. With no Honeycomb key
     * configured, `TelemetryRuntime` is `Layer.empty` and the wrap
     * collapses to a plain function call.
     */
    const dispatch = useCallback(
        (action: ClueAction) => {
            TelemetryRuntime.runSync(
                Effect.fn(`rq.gameState.${action.type}`)(function* () {
                    dispatchRaw(action);
                })(),
            );
            // Sync game-lifecycle storage so the stale-game prompt
            // sees genuine staleness. `setUiMode` and `replaceSession`
            // are excluded — flipping panes or rehydrating from
            // localStorage isn't "the user touched the game".
            if (action.type === "newGame") {
                markGameCreated(DateTime.nowUnsafe());
                // Stamp Classic as just-used so the card-pack pill row
                // re-anchors its active highlight to Classic — matching
                // the fresh-Classic deck the reducer just loaded. Without
                // this, whichever pack the user previously loaded stays
                // most-recent in the usage map, but no pill gets the
                // active styling because cardSetEquals(setup, that pack)
                // is now false.
                const classicId = CARD_SETS[0]!.id;
                recordCardPackUse(classicId);
                queryClient.setQueryData<CardPackUsage>(
                    cardPackUsageQueryKey,
                    (old) => {
                        const next = new Map(old ?? new Map());
                        next.set(classicId, DateTime.nowUnsafe());
                        return next;
                    },
                );
            } else if (
                action.type !== "setUiMode"
                && action.type !== "replaceSession"
                && action.type !== "setPendingSuggestion"
            ) {
                markGameTouched(DateTime.nowUnsafe());
            }
        },
        [],
    );
    const canUndo = history.past.length > 0;
    const canRedo = history.future.length > 0;
    const nextUndo = canUndo
        ? {
              action: history.pastActions[history.pastActions.length - 1]!,
              previousState: history.past[history.past.length - 1]!,
          }
        : undefined;
    const nextRedo = canRedo
        ? {
              action: history.futureActions[0]!,
              previousState: history.current,
          }
        : undefined;
    const undo = useCallback(() => {
        dispatchRaw({ type: "__undo" });
        markGameTouched(DateTime.nowUnsafe());
    }, []);
    const redo = useCallback(() => {
        dispatchRaw({ type: "__redo" });
        markGameTouched(DateTime.nowUnsafe());
    }, []);

    // Refs shared by several shortcut handlers so their handler
    // references stay stable (no listener churn when state changes).
    const uiModeRef = useRef(state.uiMode);
    useEffect(() => {
        uiModeRef.current = state.uiMode;
    }, [state.uiMode]);
    const gameStartedRef = useRef(false);
    useEffect(() => {
        gameStartedRef.current =
            state.knownCards.length > 0
            || state.suggestions.length > 0
            || state.accusations.length > 0;
    }, [state.knownCards, state.suggestions, state.accusations]);

    // Keyboard bindings wired via the central keyMap module. Each
    // useGlobalShortcut installs one window keydown listener that only
    // fires on a match; labels shown in the UI come from the same
    // module so they stay in lockstep with the matcher.
    useGlobalShortcut("global.undo", useCallback(() => undo(), [undo]));
    useGlobalShortcut("global.redo", useCallback(() => redo(), [redo]));

    // Cmd/Ctrl+K: switch to Play tab and focus the suggestion form.
    // Two presses within DOUBLE_TAP also clear the form. The tab
    // switch goes through `dispatchRaw` so it stays out of the undo
    // history — matching how hydration flips the tab.
    const lastGotoPlayAtRef = useRef(0);
    useGlobalShortcut(
        "global.gotoPlay",
        useCallback(() => {
            const now = Date.now();
            const clear =
                now - lastGotoPlayAtRef.current < Duration.toMillis(DOUBLE_TAP);
            lastGotoPlayAtRef.current = clear ? 0 : now;
            const needsDelay = needsPaneSettle(uiModeRef.current, "suggest");
            dispatchRaw({ type: "setUiMode", mode: "suggest" });
            // Opening the Suggester popover has to wait until the pane
            // slide settles — Radix measures the trigger's rect at open
            // time, so opening mid-slide anchors the menu to a stale
            // position that doesn't follow the pill into place.
            requestFocusAddForm("suggestion", {
                clear,
                settle: needsDelay ? PANE_SETTLE : Duration.zero,
            });
        }, []),
    );

    // Cmd/Ctrl+I: switch to Play tab, flip the Add-form into
    // accusation mode, and focus the accusation form's first pill.
    // Mirrors ⌘K but lands on the accusation tab; no double-tap-to-
    // clear semantics (the form is short, and partially-filled
    // accusations should survive a re-press).
    useGlobalShortcut(
        "global.gotoAccusation",
        useCallback(() => {
            const needsDelay = needsPaneSettle(uiModeRef.current, "suggest");
            dispatchRaw({ type: "setUiMode", mode: "suggest" });
            requestFocusAddForm("accusation", {
                clear: false,
                settle: needsDelay ? PANE_SETTLE : Duration.zero,
            });
        }, []),
    );

    // Cmd/Ctrl+H: switch to the Setup tab. (Overrides the Mac
    // "hide app" default.) Smart-landing:
    //   - game started → focus the last-focused checklist cell, else
    //     the first setup cell
    //   - fresh game → focus the first card-pack preset button
    useGlobalShortcut(
        "global.gotoSetup",
        useCallback(() => {
            dispatchRaw({ type: "setUiMode", mode: "setup" });
            queueMicrotask(() => {
                if (gameStartedRef.current) {
                    requestFocusChecklistCell();
                } else {
                    const btn = document.querySelector<HTMLElement>(
                        "[data-setup-first-target='card-pack']",
                    );
                    btn?.focus();
                }
            });
        }, []),
    );

    // Cmd/Ctrl+J: jump to the Checklist. On desktop Play already
    // shows the checklist; on mobile Play-suggest hides it, and Setup
    // renders its own Checklist variant — in both cases flip to the
    // "checklist" sub-mode so the user lands in the Play view.
    useGlobalShortcut(
        "global.gotoChecklist",
        useCallback(() => {
            if (uiModeRef.current !== "checklist") {
                dispatchRaw({ type: "setUiMode", mode: "checklist" });
            }
            // Defer the focus call so React can commit the swap and
            // the entering Checklist's useLayoutEffect can register
            // its handler first. Calling synchronously would invoke
            // the still-current exiting Checklist's handler, which
            // would scroll/focus into the pane that's about to slide
            // off (matches the Cmd+H/L pattern).
            queueMicrotask(requestFocusChecklistCell);
        }, []),
    );

    // Cmd/Ctrl+L: jump to the Prior suggestions log. Focuses the
    // first rendered row so the user can immediately use ↑↓ — "first"
    // means first in DOM order, not `data-suggestion-row="0"`, since
    // the list is rendered newest-first and could be reordered later
    // without touching this shortcut. Falls back to the section
    // header when the list is empty.
    useGlobalShortcut(
        "global.gotoPriorLog",
        useCallback(() => {
            if (uiModeRef.current !== "suggest") {
                dispatchRaw({ type: "setUiMode", mode: "suggest" });
            }
            queueMicrotask(() => {
                const header = document.getElementById("prior-suggestions");
                header?.scrollIntoView({ block: "start" });
                const firstRow = document.querySelector<HTMLElement>(
                    "[data-suggestion-row]",
                );
                if (firstRow) {
                    firstRow.focus({ preventScroll: true });
                } else if (header instanceof HTMLElement) {
                    header.focus({ preventScroll: true });
                }
            });
        }, []),
    );

    // Derive expensive values. The inner useMemos chain so each only
    // recomputes when its actual inputs change; React Compiler will
    // often collapse these, but the explicit chain is cheap insurance.
    const suggestionsAsData = useMemo(
        () =>
            state.suggestions.map(s =>
                Suggestion({
                    id: s.id,
                    suggester: s.suggester,
                    cards: s.cards,
                    nonRefuters: s.nonRefuters,
                    refuter: s.refuter,
                    seenCard: s.seenCard,
                    loggedAt: s.loggedAt ?? 0,
                }),
            ),
        [state.suggestions],
    );

    const accusationsAsData = useMemo(
        () =>
            state.accusations.map(a =>
                Accusation({
                    id: a.id,
                    accuser: a.accuser,
                    cards: a.cards,
                    loggedAt: a.loggedAt ?? 0,
                }),
            ),
        [state.accusations],
    );

    const initialKnowledge = useMemo(
        () =>
            buildInitialKnowledge(
                state.setup,
                state.knownCards,
                state.handSizes,
            ),
        [state.setup, state.knownCards, state.handSizes],
    );

    // Shared service layer for the deducer + traced-deducer Effect.gen
    // paths. Both memoised pipelines below run against the same ambient
    // context, so we compose once and provide it twice.
    const deduceLayer = useMemo(
        () =>
            Layer.mergeAll(
                makeSetupLayer(state.setup),
                makeSuggestionsLayer(suggestionsAsData),
                makeAccusationsLayer(accusationsAsData),
            ),
        [state.setup, suggestionsAsData, accusationsAsData],
    );

    const deductionResult = useMemo(
        () =>
            // `deduce` fails on the Effect failure channel when a
            // contradiction is detected; Effect.result materialises it
            // back to Result<Knowledge, ContradictionTrace> so downstream
            // UI code keeps its isSuccess / isFailure branching intact.
            TelemetryRuntime.runSync(
                Effect.result(deduce(initialKnowledge)).pipe(
                    Effect.provide(deduceLayer),
                ),
            ),
        [deduceLayer, initialKnowledge],
    );

    // Joint deduction: real facts ∪ hypotheses. Sentinel-undefined when
    // no hypotheses are active, so the common path skips the extra
    // deduce call entirely. When hypotheses ARE active, this is a
    // second `deduce` against an augmented initial knowledge — its
    // failure does NOT feed the global contradiction banner (which
    // reads `deductionResult` only); the cell renderer surfaces
    // contradictions inline via the per-cell hypothesis status.
    const jointDeductionResult = useMemo<DeductionResult | undefined>(() => {
        if (HashMap.size(state.hypotheses) === 0) return undefined;
        const folded = foldHypothesesInto(initialKnowledge, state.hypotheses);
        if (Result.isFailure(folded)) return folded;
        return TelemetryRuntime.runSync(
            Effect.result(deduce(folded.success)).pipe(
                Effect.provide(deduceLayer),
            ),
        );
    }, [deduceLayer, initialKnowledge, state.hypotheses]);

    // Joint provenance — same shape as `provenance`, but computed
    // against `realFacts ∪ hypotheses`. Used by the cell popover to
    // explain `derived` cells (cells whose value follows from the
    // user's hypotheses but isn't proven by real facts alone). The
    // hypothesis cells themselves appear as `initial-known-card`
    // entries in the chain — that's a slight abuse of the "you
    // marked this" copy, but the popover's preamble ("Based on your
    // active hypothesis(es).") sets context so the chain reads
    // correctly. `undefined` when no hypotheses are active or the
    // joint deduction failed.
    const jointProvenance = useMemo<Provenance | undefined>(() => {
        if (HashMap.size(state.hypotheses) === 0) return undefined;
        const folded = foldHypothesesInto(initialKnowledge, state.hypotheses);
        if (Result.isFailure(folded)) return undefined;
        const traced = TelemetryRuntime.runSync(
            Effect.result(deduceWithExplanations(folded.success)).pipe(
                Effect.provide(deduceLayer),
            ),
        );
        return Result.isSuccess(traced) ? traced.success.provenance : undefined;
    }, [deduceLayer, initialKnowledge, state.hypotheses]);

    const { provenance, footnotes } = useMemo(
        () =>
            deriveState(
                suggestionsAsData,
                initialKnowledge,
                deductionResult,
                deduceLayer,
            ),
        [suggestionsAsData, initialKnowledge, deductionResult, deduceLayer],
    );

    const hypothesisConflict = useMemo(
        () =>
            computeHypothesisConflict(
                deductionResult,
                jointDeductionResult,
                state.hypotheses,
            ),
        [deductionResult, jointDeductionResult, state.hypotheses],
    );

    const derived: ClueDerived = useMemo(
        () => ({
            suggestionsAsData,
            accusationsAsData,
            initialKnowledge,
            deductionResult,
            provenance,
            jointProvenance,
            footnotes,
            hypotheses: state.hypotheses,
            jointDeductionResult,
            hypothesisConflict,
        }),
        [
            suggestionsAsData,
            accusationsAsData,
            initialKnowledge,
            deductionResult,
            provenance,
            jointProvenance,
            footnotes,
            state.hypotheses,
            jointDeductionResult,
            hypothesisConflict,
        ],
    );

    // ---- Persistence --------------------------------------------------

    const didHydrate = useRef(false);
    // State mirror of `didHydrate` for consumers that need to gate
    // rendering on it (refs don't trigger re-renders). Starts false
    // on SSG and the initial client render so they match; flips true
    // after the hydration effect resolves, so TabContent can paint a
    // neutral skeleton until we know which view to render instead of
    // flashing the default `"setup"` pane.
    const [hydrated, setHydrated] = useState(false);

    // One-shot hydration on mount: read localStorage and apply
    // `?view=setup|checklist|suggest`. With no explicit view we land
    // on the Checklist (play mode) if the hydrated session has any
    // suggestions, else Setup (the reducer's default). On desktop
    // `checklist` and `suggest` both render the same Play grid; on
    // mobile they route to their own pane.
    //
    // The historical `?state=...` base64-encoded session URL was
    // dropped during M3. Old shared links no longer hydrate; the
    // server-stored `/share/[id]` flow that replaces them lands in M9.
    useEffect(() => {
        if (didHydrate.current) return;
        didHydrate.current = true;
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const viewParam = params.get("view");
        const session = loadFromLocalStorage();
        if (session) dispatch({ type: "replaceSession", session });

        // Backfill lifecycle timestamps for users upgrading from a
        // build before this feature shipped. New users get fresh
        // `createdAt`/`lastModifiedAt` from the `newGame` / mutation
        // path; existing sessions need a one-time stamp so the
        // stale-game gate has something to reason about. Use the
        // most recent suggestion/accusation `loggedAt` when present
        // (best-effort proxy for "last touched"), else stamp now.
        const lifecycle = loadGameLifecycleState();
        if (
            lifecycle.createdAt === undefined
            && lifecycle.lastModifiedAt === undefined
        ) {
            const loggedAtSamples: number[] = [];
            for (const s of session?.suggestions ?? []) {
                if (s.loggedAt > 0) loggedAtSamples.push(s.loggedAt);
            }
            for (const a of session?.accusations ?? []) {
                if (a.loggedAt > 0) loggedAtSamples.push(a.loggedAt);
            }
            if (loggedAtSamples.length > 0) {
                const maxLoggedAt = Math.max(...loggedAtSamples);
                const stamp = DateTime.makeUnsafe(new Date(maxLoggedAt));
                markGameCreated(stamp);
            } else {
                markGameCreated(DateTime.nowUnsafe());
            }
        }

        // View precedence: explicit `?view=` wins; otherwise pick based
        // on hydrated suggestions. The default state.uiMode is "setup",
        // so only dispatch when we actually need to change it.
        if (viewParam === "checklist") {
            dispatch({ type: "setUiMode", mode: "checklist" });
        } else if (viewParam === "suggest") {
            dispatch({ type: "setUiMode", mode: "suggest" });
        } else if (viewParam === "setup") {
            // No-op: default is already "setup".
        } else if (session && session.suggestions.length > 0) {
            dispatch({ type: "setUiMode", mode: "checklist" });
        }
        setHydrated(true);
    }, []);

    // Mirror `uiMode` to the URL as `?view=setup|checklist|suggest`.
    // Uses replaceState (not pushState) because view flips shouldn't
    // clutter the back stack — same spirit as `setUiMode` bypassing
    // undo/redo history. Gated on `didHydrate` so the initial reducer
    // default doesn't stomp an unset URL before hydration has chosen
    // the view.
    useEffect(() => {
        if (!didHydrate.current) return;
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const urlView = state.uiMode;
        if (params.get("view") === urlView) return;
        params.set("view", urlView);
        const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
        window.history.replaceState(null, "", newUrl);
    }, [state.uiMode]);

    // Save to localStorage whenever inputs change, and mirror the
    // session into the RQ cache so DevTools and the persister see the
    // same data. Skip the first render (before hydration) to avoid
    // trampling a saved session with the empty default.
    useEffect(() => {
        if (!didHydrate.current) return;
        const session: GameSession = {
            setup: state.setup,
            hands: groupKnownCardsByPlayer(state.knownCards),
            handSizes: state.handSizes.map(([player, size]) => ({
                player,
                size,
            })),
            suggestions: suggestionsAsData,
            accusations: accusationsAsData,
            hypotheses: state.hypotheses,
            pendingSuggestion: state.pendingSuggestion,
            selfPlayerId: state.selfPlayerId,
            firstDealtPlayerId: state.firstDealtPlayerId,
        };
        saveToLocalStorage(session);
        queryClient.setQueryData(gameSessionQueryKey, session);
    }, [state, suggestionsAsData, accusationsAsData, queryClient]);

    // ---- Analytics: state-driven funnel events ----------------------------

    // 1) `game_setup_started` on initial mount when the user lands in
    //    setup mode and no analytics session has been opened yet
    //    (a fresh visit, vs the Toolbar/Clue handlers that fire it
    //    explicitly on a "New Game" click).
    useEffect(() => {
        if (!hydrated) return;
        if (state.uiMode === "setup" && isFirstSession()) {
            startSetup();
            gameSetupStarted();
        }
    }, [hydrated]);

    // 2) `game_started` on the FIRST setup → checklist transition per
    //    game. The first post-hydration render snapshots `prevUiMode`
    //    without firing — that's the hydration-completion render
    //    itself, where uiMode may have flipped from the default
    //    "setup" to whatever localStorage / ?view= chose.
    const prevUiModeForAnalyticsRef = useRef<UiMode | null>(null);
    useEffect(() => {
        if (!hydrated) return;
        const prev = prevUiModeForAnalyticsRef.current;
        prevUiModeForAnalyticsRef.current = state.uiMode;
        if (prev === null) return;
        if (prev === "setup" && state.uiMode === "checklist") {
            if (claimGameStarted()) {
                gameStarted({
                    playerCount: state.setup.players.length,
                    setupDurationMs: setupDurationMs(),
                });
            }
        }
    }, [hydrated, state.uiMode, state.setup.players.length]);

    // 3) `deduction_revealed` per newly-derived cell, and
    //    `case_file_solved` once the deducer narrows every category to
    //    a single candidate. Both ride the same diff: snapshot the
    //    current checklist into a ref, then on the next derivation
    //    walk the new HashMap and fire one event per cell that wasn't
    //    in the prior snapshot. The deducer is monotone (only adds
    //    cells, never removes) so a HashMap.has check on the prior
    //    map is sufficient.
    const prevChecklistRef = useRef<HashMap.HashMap<Cell, CellValue> | null>(
        null,
    );
    useEffect(() => {
        if (!hydrated) return;
        if (!Result.isSuccess(derived.deductionResult)) {
            // Contradiction: don't diff or fire — the knowledge is
            // invalid until the user fixes the inputs. Reset the
            // snapshot so when they recover we don't claim every
            // existing cell as "newly revealed".
            prevChecklistRef.current = null;
            return;
        }
        const knowledge = derived.deductionResult.success;
        const newChecklist = knowledge.checklist;
        const prev = prevChecklistRef.current;
        prevChecklistRef.current = newChecklist;
        if (prev !== null) {
            HashMap.forEach(newChecklist, (_value, cell) => {
                if (!HashMap.has(prev, cell)) {
                    const catId = categoryOfCard(state.setup.cardSet, cell.card);
                    const chain = derived.provenance
                        ? chainFor(derived.provenance, cell)
                        : [];
                    deductionRevealed({
                        categoryName: catId
                            ? resolveCategoryName(state.setup.cardSet, catId)
                            : "",
                        deductionChainLength: chain.length,
                    });
                }
            });
        }
        if (caseFileProgress(state.setup, knowledge) === 1) {
            if (claimCaseFileSolved()) {
                caseFileSolved({
                    durationMs: gameDurationMs(),
                    suggestionsCount: state.suggestions.length,
                });
            }
        }
    }, [
        hydrated,
        derived.deductionResult,
        derived.provenance,
        state.setup,
        state.suggestions.length,
    ]);

    const hasGameData = useCallback((): boolean => {
        if (state.knownCards.length > 0) return true;
        if (state.handSizes.length > 0) return true;
        if (state.suggestions.length > 0) return true;
        if (state.accusations.length > 0) return true;
        // M6: a user who only set their identity has expressed intent
        // ("I'm Alice in this game") that the brand-new-user redirect
        // shouldn't override. Same for first-dealt-player.
        if (state.selfPlayerId !== null) return true;
        if (state.firstDealtPlayerId !== null) return true;
        const players = state.setup.players;
        if (players.length !== DEFAULT_SETUP.players.length) return true;
        for (let i = 0; i < players.length; i++) {
            if (players[i] !== DEFAULT_SETUP.players[i]) return true;
        }
        return false;
    }, [state]);

    const value: ClueContextValue = useMemo(
        () => ({
            state,
            dispatch,
            derived,
            hasGameData,
            canUndo,
            canRedo,
            undo,
            redo,
            nextUndo,
            nextRedo,
            hydrated,
        }),
        [
            state,
            dispatch,
            derived,
            hasGameData,
            canUndo,
            canRedo,
            undo,
            redo,
            nextUndo,
            nextRedo,
            hydrated,
        ],
    );

    return (
        <ClueContext.Provider value={value}>
            {children}
        </ClueContext.Provider>
    );
}

/** Pick the next "Category N" that doesn't collide with any existing one. */
const nextNumberedCategoryName = (
    existingNames: ReadonlyArray<string>,
): string => {
    const taken = new Set(existingNames);
    let n = 1;
    while (taken.has(`Category ${n}`)) n++;
    return `Category ${n}`;
};

/** Pick the next "Card N" that doesn't collide anywhere in the deck. */
const nextNumberedCardName = (
    existingNames: ReadonlyArray<string>,
): string => {
    const taken = new Set(existingNames);
    let n = 1;
    while (taken.has(`Card ${n}`)) n++;
    return `Card ${n}`;
};

const groupKnownCardsByPlayer = (
    cards: ReadonlyArray<KnownCard>,
): ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }> => {
    const by = new Map<Player, Card[]>();
    for (const { player, card } of cards) {
        const existing = by.get(player);
        if (existing) existing.push(card);
        else by.set(player, [card]);
    }
    return Array.from(by.entries(), ([player, cards]) => ({ player, cards }));
};

/**
 * When the user edits the setup (e.g. removes a card), filter out
 * references to players/cards that no longer exist. Suggestions whose
 * suggester or card list references a removed entity are dropped.
 *
 * Note: renames do NOT prune anything — ids stay stable, references
 * continue to resolve. Only add/remove changes the id set.
 */
const pruneSessionToSetup = (
    state: ClueState,
    setup: GameSetup,
): ClueState => {
    const playerSet = new Set(setup.players.map(p => String(p)));
    const cardIdSet = new Set(
        allCardEntries(setup).map(e => String(e.id)),
    );
    let prunedHypotheses = state.hypotheses;
    for (const [cell] of state.hypotheses) {
        const cardOk = cardIdSet.has(String(cell.card));
        const ownerOk =
            cell.owner._tag === "CaseFile" ||
            playerSet.has(String(cell.owner.player));
        if (!cardOk || !ownerOk) {
            prunedHypotheses = HashMap.remove(prunedHypotheses, cell);
        }
    }
    return {
        ...state,
        setup,
        knownCards: state.knownCards.filter(
            kc =>
                playerSet.has(String(kc.player)) &&
                cardIdSet.has(String(kc.card)),
        ),
        handSizes: state.handSizes.filter(([p]) =>
            playerSet.has(String(p)),
        ),
        suggestions: state.suggestions
            .filter(s => playerSet.has(String(s.suggester)))
            .filter(s =>
                s.cards.every(c => cardIdSet.has(String(c))),
            )
            .map(s => ({
                ...s,
                nonRefuters: s.nonRefuters.filter(p =>
                    playerSet.has(String(p)),
                ),
                refuter:
                    s.refuter && playerSet.has(String(s.refuter))
                        ? s.refuter
                        : undefined,
                seenCard:
                    s.seenCard && cardIdSet.has(String(s.seenCard))
                        ? s.seenCard
                        : undefined,
            })),
        accusations: state.accusations
            .filter(a => playerSet.has(String(a.accuser)))
            .filter(a => a.cards.every(c => cardIdSet.has(String(c)))),
        hypotheses: prunedHypotheses,
        // The in-flight draft references Player and Card ids. Rather
        // than partial-prune slots in place, drop the whole draft when
        // the setup changes — the user is mid-flow at the keyboard, so
        // re-entering is cheaper than auditing per-slot validity.
        pendingSuggestion: null,
    };
};
