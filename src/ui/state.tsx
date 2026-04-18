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
    Player,
} from "../logic/GameObjects";
import {
    DEFAULT_SETUP,
    GameSetup,
    newGameSetup,
} from "../logic/GameSetup";
import type { Knowledge } from "../logic/Knowledge";
import {
    buildInitialKnowledge,
    type KnownCard,
} from "../logic/InitialKnowledge";
import deduce, { type DeductionResult } from "../logic/Deducer";
import { Suggestion } from "../logic/Suggestion";
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
 * Re-exported from the logic layer so UI code keeps importing from state.
 */
export type { KnownCard };

/**
 * UI-level shape of a suggestion that hasn't been converted to a Data
 * record yet — matches the form inputs directly. Forms render these and
 * the state layer converts them on submit.
 */
export interface DraftSuggestion {
    readonly id: string;
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly nonRefuters: ReadonlyArray<Player>;
    readonly refuter?: Player;
    readonly seenCard?: Card;
}

/**
 * Everything dispatch-able from the UI. One concrete action per
 * thing-the-user-might-do; the reducer below enumerates them exactly.
 */
export type ClueAction =
    | { type: "newGame" }
    | { type: "loadPreset"; setup: GameSetup }
    | { type: "setSetup"; setup: GameSetup }
    | { type: "addKnownCard"; card: KnownCard }
    | { type: "removeKnownCard"; index: number }
    | { type: "setHandSize"; player: Player; size: number | undefined }
    | { type: "addSuggestion"; suggestion: DraftSuggestion }
    | { type: "updateSuggestion"; suggestion: DraftSuggestion }
    | { type: "removeSuggestion"; id: string }
    | { type: "resetAll" }
    | { type: "addPlayer" }
    | { type: "removePlayer"; player: Player }
    | { type: "renamePlayer"; oldName: Player; newName: Player }
    | { type: "toggleExplanations" }
    | { type: "replaceSession"; session: GameSession };

export interface ClueState {
    readonly setup: GameSetup;
    readonly handSizes: ReadonlyArray<readonly [Player, number]>;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly suggestions: ReadonlyArray<DraftSuggestion>;
    readonly explanationsEnabled: boolean;
}

const initialState: ClueState = {
    setup: DEFAULT_SETUP,
    handSizes: [],
    knownCards: [],
    suggestions: [],
    explanationsEnabled: true,
};

const reducer = (state: ClueState, action: ClueAction): ClueState => {
    switch (action.type) {
        case "newGame":
            return {
                ...initialState,
                setup: newGameSetup(4),
                explanationsEnabled: state.explanationsEnabled,
            };

        case "loadPreset":
            // Swap to a preset deck and discard anything tied to the
            // previous one. (Hands, suggestions, etc. reference card
            // and player objects from the old setup, so we can't
            // keep them.)
            return {
                ...state,
                setup: action.setup,
                knownCards: [],
                handSizes: [],
                suggestions: [],
            };

        case "setSetup":
            // Inline category/card/player edits. We DON'T clear the
            // input state — we just filter it back to things still
            // present in the new setup. That lets the user rename a
            // card or add a category mid-game without losing
            // unrelated progress.
            return pruneSessionToSetup(state, action.setup);

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

        case "resetAll":
            return {
                ...state,
                knownCards: [],
                handSizes: [],
                suggestions: [],
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

        case "toggleExplanations":
            return {
                ...state,
                explanationsEnabled: !state.explanationsEnabled,
            };

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
                suggestions: session.suggestions.map((s, i) => ({
                    id: s.id || `restored-${i}`,
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
export interface ClueDerived {
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
    if (state.explanationsEnabled) {
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
    }
    const footnotes =
        deductionResult._tag === "Ok"
            ? refuterCandidateFootnotes(
                  suggestionsAsData,
                  deductionResult.knowledge,
              )
            : emptyFootnotes;
    return { provenance, footnotes };
};

// ---- Context + hook -----------------------------------------------------

export interface ClueContextValue {
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
 * When the user edits the setup inline (e.g. renames a category or
 * removes a card), filter out references to players/cards that no
 * longer exist. Suggestions whose suggester is gone or whose card
 * list references a removed card are dropped — there's no sensible
 * way to keep them.
 */
const pruneSessionToSetup = (
    state: ClueState,
    setup: GameSetup,
): ClueState => {
    const playerSet = new Set(setup.players.map(p => String(p)));
    const cardSet = new Set(
        setup.categories.flatMap(c => c.cards.map(card => String(card))),
    );
    return {
        ...state,
        setup,
        knownCards: state.knownCards.filter(
            kc =>
                playerSet.has(String(kc.player)) &&
                cardSet.has(String(kc.card)),
        ),
        handSizes: state.handSizes.filter(([p]) =>
            playerSet.has(String(p)),
        ),
        suggestions: state.suggestions
            .filter(s => playerSet.has(String(s.suggester)))
            .filter(s =>
                s.cards.every(c => cardSet.has(String(c))),
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
                    s.seenCard && cardSet.has(String(s.seenCard))
                        ? s.seenCard
                        : undefined,
            })),
    };
};
