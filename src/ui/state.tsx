"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    type ReactNode,
} from "react";
import {
    Card,
    CardCategory,
    newCardId,
    newCategoryId,
    Player,
} from "../logic/GameObjects";
import {
    allCardEntries,
    Category,
    DEFAULT_SETUP,
    disambiguateName,
    findCardEntry,
    findCategoryEntry,
    GameSetup,
    newGameSetup,
} from "../logic/GameSetup";
import type { Knowledge } from "../logic/Knowledge";
import {
    buildInitialKnowledge,
    type KnownCard,
} from "../logic/InitialKnowledge";
import { Either } from "effect";
import deduce, { type DeductionResult } from "../logic/Deducer";
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

/**
 * UI-level shape of a suggestion that hasn't been converted to a Data
 * record yet — matches the form inputs directly. Forms render these and
 * the state layer converts them on submit.
 */
export interface DraftSuggestion {
    readonly id: SuggestionId;
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly nonRefuters: ReadonlyArray<Player>;
    readonly refuter?: Player | undefined;
    readonly seenCard?: Card | undefined;
}

/**
 * Everything dispatch-able from the UI. One concrete action per
 * thing-the-user-might-do; the reducer below enumerates them exactly.
 *
 * Category / card operations come in id-based flavours (for inline grid
 * edits that know the stable id) and are resolved against the current
 * setup inside the reducer.
 *
 * **Invariant**: every mutation of `ClueState` must go through
 * `dispatch` (a `ClueAction`) — never via direct assignment or a
 * `setState` call escaping this module. This invariant is what lets
 * the upcoming undo/redo meta-reducer observe every user-visible
 * change, and what keeps the action log replayable. Components only
 * ever *read* `state` / `derived`; they never touch them.
 *
 * Ephemeral per-component UI state (like a form's local "editing"
 * buffer) is fine to keep in `useState`; the bar is specifically
 * against mutating anything inside `ClueState`.
 */
type ClueAction =
    | { type: "newGame" }
    | { type: "loadPreset"; setup: GameSetup }
    | { type: "setSetup"; setup: GameSetup }
    | { type: "addCategory" }
    | { type: "removeCategoryById"; categoryId: CardCategory }
    | { type: "addCardToCategoryById"; categoryId: CardCategory }
    | { type: "removeCardById"; cardId: Card }
    | { type: "renameCategory"; categoryId: CardCategory; name: string }
    | { type: "renameCard"; cardId: Card; name: string }
    | { type: "addKnownCard"; card: KnownCard }
    | { type: "removeKnownCard"; index: number }
    | { type: "setHandSize"; player: Player; size: number | undefined }
    | { type: "addSuggestion"; suggestion: DraftSuggestion }
    | { type: "updateSuggestion"; suggestion: DraftSuggestion }
    | { type: "removeSuggestion"; id: SuggestionId }
    | { type: "addPlayer" }
    | { type: "removePlayer"; player: Player }
    | { type: "renamePlayer"; oldName: Player; newName: Player }
    | { type: "replaceSession"; session: GameSession };

interface ClueState {
    readonly setup: GameSetup;
    readonly handSizes: ReadonlyArray<readonly [Player, number]>;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly suggestions: ReadonlyArray<DraftSuggestion>;
}

const initialState: ClueState = {
    setup: DEFAULT_SETUP,
    handSizes: [],
    knownCards: [],
    suggestions: [],
};

const reducer = (state: ClueState, action: ClueAction): ClueState => {
    switch (action.type) {
        case "newGame":
            return {
                ...initialState,
                setup: newGameSetup(4),
            };

        case "loadPreset":
            // Swap to a preset deck and discard anything tied to the
            // previous one. (Hands, suggestions, etc. reference card
            // ids from the old setup.)
            return {
                ...state,
                setup: action.setup,
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
            const newCat: Category = {
                id: newCategoryId(),
                name: catName,
                cards: [{ id: newCardId(), name: cardName }],
            };
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
                            ? {
                                  ...c,
                                  cards: [
                                      ...c.cards,
                                      { id: newCardId(), name: cardName },
                                  ],
                              }
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
                        ? {
                              ...c,
                              cards: c.cards.filter(
                                  e => e.id !== action.cardId,
                              ),
                          }
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
                            ? { ...c, name: finalName }
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
                    categories: state.setup.categories.map(c => ({
                        ...c,
                        cards: c.cards.map(e =>
                            e.id === action.cardId
                                ? { ...e, name: finalName }
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
                    h.cards.map(card => ({ player: h.player, card })),
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
    state: ClueState,
    suggestionsAsData: ReadonlyArray<Suggestion>,
    initialKnowledge: Knowledge,
    deductionResult: DeductionResult,
): { provenance: Provenance | undefined; footnotes: FootnoteMap } => {
    let provenance: Provenance | undefined;
    try {
        const { provenance: p } = deduceWithExplanations(
            state.setup,
            suggestionsAsData,
            initialKnowledge,
        );
        provenance = p;
    } catch {
        provenance = undefined;
    }
    const footnotes = Either.isRight(deductionResult)
        ? refuterCandidateFootnotes(
              suggestionsAsData,
              deductionResult.right,
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
}

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
    const [state, dispatch] = useReducer(reducer, initialState);

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

    const deductionResult = useMemo(
        () => deduce(state.setup, suggestionsAsData)(initialKnowledge),
        [state.setup, suggestionsAsData, initialKnowledge],
    );

    const { provenance, footnotes } = useMemo(
        () =>
            deriveState(
                state,
                suggestionsAsData,
                initialKnowledge,
                deductionResult,
            ),
        [state, suggestionsAsData, initialKnowledge, deductionResult],
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

    // One-shot hydration on mount: URL first, then localStorage.
    useEffect(() => {
        if (didHydrate.current) return;
        didHydrate.current = true;
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const state = params.get("state");
        if (state) {
            const session = decodeSessionFromUrl(state);
            if (session) {
                dispatch({ type: "replaceSession", session });
                return;
            }
        }
        const session = loadFromLocalStorage();
        if (session) dispatch({ type: "replaceSession", session });
    }, []);

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
        }),
        [state, derived, hasGameData, currentShareUrl],
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
