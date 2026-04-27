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
import { HashMap } from "effect";
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
import type { Cell, CellValue, Knowledge } from "../logic/Knowledge";
import { chainFor } from "../logic/Provenance";
import {
    buildInitialKnowledge,
    KnownCard,
} from "../logic/InitialKnowledge";
import { Effect, Result } from "effect";
import deduce, { type DeductionResult } from "../logic/Deducer";
import { TelemetryRuntime } from "../observability/runtime";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
} from "../logic/Suggestion";
import {
    decodeSessionFromUrl,
    encodeSessionToUrl,
    type GameSession,
    loadFromLocalStorage,
    saveToLocalStorage,
} from "../logic/Persistence";
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
    CardSetService,
    PlayerSetService,
    SuggestionsService,
    makeSetupLayer,
    makeSuggestionsLayer,
} from "../logic/services";
import { Layer } from "effect";
import { requestFocusSuggestionForm } from "./suggestionFormFocus";
import { requestFocusChecklistCell } from "./checklistFocus";
import { useGlobalShortcut } from "./keyMap";
import { PANE_SETTLE_MS } from "./motion";
import type { UiMode } from "../logic/ClueState";

type DeduceLayer = Layer.Layer<
    CardSetService | PlayerSetService | SuggestionsService
>;

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
import type { ClueAction, ClueState } from "../logic/ClueState";

const initialState: ClueState = {
    setup: DEFAULT_SETUP,
    handSizes: [],
    knownCards: [],
    suggestions: [],
    uiMode: "setup",
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
            // sizes, known cards, and suggestions reference card ids
            // from the old deck and are discarded.
            return {
                ...state,
                setup: GameSetup({
                    cardSet: action.cardSet,
                    playerSet: state.setup.playerSet,
                }),
                knownCards: [],
                handSizes: [],
                suggestions: [],
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
            return {
                ...state,
                suggestions: [...state.suggestions, action.suggestion],
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
            };

        case "renamePlayer": {
            if (action.oldName === action.newName) return state;
            const { oldName, newName } = action;
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
            };
        }

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
            };
        }
    }
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
    readonly initialKnowledge: Knowledge;
    readonly deductionResult: DeductionResult;
    readonly provenance: Provenance | undefined;
    readonly footnotes: FootnoteMap;
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
    readonly currentShareUrl: () => string;
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
    if (action.type === "replaceSession" || action.type === "setUiMode") {
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

export function ClueProvider({ children }: { children: ReactNode }) {
    const [history, dispatchRaw] = useReducer(historyReducer, {
        past: [],
        pastActions: [],
        current: initialState,
        future: [],
        futureActions: [],
    });
    const state = history.current;
    const dispatch = dispatchRaw as React.Dispatch<ClueAction>;
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
    const undo = useCallback(() => dispatchRaw({ type: "__undo" }), []);
    const redo = useCallback(() => dispatchRaw({ type: "__redo" }), []);

    // Refs shared by several shortcut handlers so their handler
    // references stay stable (no listener churn when state changes).
    const uiModeRef = useRef(state.uiMode);
    useEffect(() => {
        uiModeRef.current = state.uiMode;
    }, [state.uiMode]);
    const gameStartedRef = useRef(false);
    useEffect(() => {
        gameStartedRef.current =
            state.knownCards.length > 0 || state.suggestions.length > 0;
    }, [state.knownCards, state.suggestions]);

    // Keyboard bindings wired via the central keyMap module. Each
    // useGlobalShortcut installs one window keydown listener that only
    // fires on a match; labels shown in the UI come from the same
    // module so they stay in lockstep with the matcher.
    useGlobalShortcut("global.undo", useCallback(() => undo(), [undo]));
    useGlobalShortcut("global.redo", useCallback(() => redo(), [redo]));

    // Cmd/Ctrl+K: switch to Play tab and focus the suggestion form.
    // Two presses within DOUBLE_TAP_MS also clear the form. The tab
    // switch goes through `dispatchRaw` so it stays out of the undo
    // history — matching how hydration flips the tab.
    const lastGotoPlayAtRef = useRef(0);
    useGlobalShortcut(
        "global.gotoPlay",
        useCallback(() => {
            const DOUBLE_TAP_MS = 400;
            const now = Date.now();
            const clear = now - lastGotoPlayAtRef.current < DOUBLE_TAP_MS;
            lastGotoPlayAtRef.current = clear ? 0 : now;
            const needsDelay = needsPaneSettle(uiModeRef.current, "suggest");
            dispatchRaw({ type: "setUiMode", mode: "suggest" });
            // Opening the Suggester popover has to wait until the pane
            // slide settles — Radix measures the trigger's rect at open
            // time, so opening mid-slide anchors the menu to a stale
            // position that doesn't follow the pill into place.
            requestFocusSuggestionForm({
                clear,
                settleMs: needsDelay ? PANE_SETTLE_MS : 0,
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
                }),
            ),
        [state.suggestions],
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
            ),
        [state.setup, suggestionsAsData],
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

    const derived: ClueDerived = useMemo(
        () => ({
            suggestionsAsData,
            initialKnowledge,
            deductionResult,
            provenance,
            footnotes,
        }),
        [
            suggestionsAsData,
            initialKnowledge,
            deductionResult,
            provenance,
            footnotes,
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

    // One-shot hydration on mount: URL first, then localStorage. The
    // `?view=setup|checklist|suggest` param overrides the smart default;
    // with no explicit view we land on the Checklist (play mode) if the
    // hydrated session has any suggestions, else Setup (the reducer's
    // default). On desktop `checklist` and `suggest` both render the
    // same Play grid; on mobile they route to their own pane.
    useEffect(() => {
        if (didHydrate.current) return;
        didHydrate.current = true;
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const stateParam = params.get("state");
        const viewParam = params.get("view");
        let session: GameSession | undefined;
        if (stateParam) session = decodeSessionFromUrl(stateParam);
        if (!session) session = loadFromLocalStorage();
        if (session) dispatch({ type: "replaceSession", session });

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

    // Save to localStorage whenever inputs change. Skip the first render
    // (before hydration) to avoid trampling a saved session with the
    // empty default.
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
        };
        saveToLocalStorage(session);
    }, [state, suggestionsAsData]);

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
        const players = state.setup.players;
        if (players.length !== DEFAULT_SETUP.players.length) return true;
        for (let i = 0; i < players.length; i++) {
            if (players[i] !== DEFAULT_SETUP.players[i]) return true;
        }
        return false;
    }, [state]);

    const currentShareUrl = useCallback((): string => {
        if (typeof window === "undefined") return "";
        const session: GameSession = {
            setup: state.setup,
            hands: groupKnownCardsByPlayer(state.knownCards),
            handSizes: state.handSizes.map(([player, size]) => ({
                player,
                size,
            })),
            suggestions: suggestionsAsData,
        };
        const encoded = encodeSessionToUrl(session);
        const base = `${window.location.origin}${window.location.pathname}`;
        return `${base}?state=${encoded}`;
    }, [state, suggestionsAsData]);

    const value: ClueContextValue = useMemo(
        () => ({
            state,
            dispatch,
            derived,
            hasGameData,
            currentShareUrl,
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
            currentShareUrl,
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
    };
};
