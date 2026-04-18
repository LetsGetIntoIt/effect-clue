import { signal, computed, Signal, ReadonlySignal } from "@preact/signals";
import {
    Card,
    Player,
    PlayerOwner,
} from "../logic/GameObjects";
import {
    allCards,
    DEFAULT_SETUP,
    GameSetup,
    newGameSetup,
} from "../logic/GameSetup";
import {
    emptyKnowledge,
    Knowledge,
    setCell,
    setHandSize,
    Y,
    Cell,
} from "../logic/Knowledge";
import deduce, { DeductionResult } from "../logic/Deducer";
import { Suggestion } from "../logic/Suggestion";
import {
    GameSession,
    loadFromLocalStorage,
    saveToLocalStorage,
    decodeSessionFromUrl,
    encodeSessionToUrl,
} from "../logic/Persistence";
import {
    deduceWithExplanations,
    Provenance,
} from "../logic/Provenance";
import {
    emptyFootnotes,
    FootnoteMap,
    refuterCandidateFootnotes,
} from "../logic/Footnotes";

/**
 * A single known card held by a specific player — either the solver's own
 * hand or cards publicly revealed during play. These get folded into the
 * initial knowledge before every deduction.
 */
export interface KnownCard {
    readonly player: Player;
    readonly card: Card;
}

/**
 * UI-level shape of a suggestion that hasn't been converted to a Data
 * record yet — matches the form inputs directly. The form renders
 * these and the state layer converts them on submit.
 */
export interface DraftSuggestion {
    readonly id: string;
    readonly suggester: Player;
    readonly cards: ReadonlyArray<Card>;
    readonly nonRefuters: ReadonlyArray<Player>;
    readonly refuter?: Player;
    readonly seenCard?: Card;
}

// ---- Root signals ------------------------------------------------------

export const setupSignal: Signal<GameSetup> = signal(DEFAULT_SETUP);

export const handSizesSignal: Signal<ReadonlyArray<readonly [Player, number]>> =
    signal([]);

export const knownCardsSignal: Signal<ReadonlyArray<KnownCard>> = signal([]);

export const suggestionsSignal: Signal<ReadonlyArray<DraftSuggestion>> =
    signal([]);

/**
 * Explanations are expensive to compute so we gate them behind a toggle
 * the UI can flip. When off, the main deducer (which skips provenance
 * tracking) runs instead.
 */
export const explanationsEnabledSignal: Signal<boolean> = signal(true);

// ---- Derived computations ----------------------------------------------

const buildInitialKnowledge = (
    setup: GameSetup,
    knownCards: ReadonlyArray<KnownCard>,
    handSizes: ReadonlyArray<readonly [Player, number]>,
): Knowledge => {
    let k = emptyKnowledge;
    const deck = new Set(allCards(setup));
    for (const { player, card } of knownCards) {
        // Ignore cards that don't belong to this setup (e.g. after a
        // preset change).
        if (!setup.players.includes(player)) continue;
        if (!deck.has(card)) continue;
        try {
            k = setCell(k, Cell(PlayerOwner(player), card), Y);
        } catch {
            // swallow duplicates — they'll show up in the deducer's
            // contradiction output instead.
        }
    }
    for (const [player, size] of handSizes) {
        if (!setup.players.includes(player)) continue;
        k = setHandSize(k, PlayerOwner(player), size);
    }
    return k;
};

export const suggestionsAsDataSignal: ReadonlySignal<ReadonlyArray<Suggestion>> =
    computed(() => suggestionsSignal.value.map(s => Suggestion({
        id: s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter,
        seenCard: s.seenCard,
    })));

export const initialKnowledgeSignal: ReadonlySignal<Knowledge> = computed(() =>
    buildInitialKnowledge(
        setupSignal.value,
        knownCardsSignal.value,
        handSizesSignal.value,
    ));

export const deductionResultSignal: ReadonlySignal<DeductionResult> =
    computed(() => deduce(
        setupSignal.value,
        suggestionsAsDataSignal.value,
    )(initialKnowledgeSignal.value));

export const provenanceSignal: ReadonlySignal<Provenance | undefined> =
    computed(() => {
        if (!explanationsEnabledSignal.value) return undefined;
        try {
            const { provenance } = deduceWithExplanations(
                setupSignal.value,
                suggestionsAsDataSignal.value,
                initialKnowledgeSignal.value,
            );
            return provenance;
        } catch {
            return undefined;
        }
    });

/**
 * Footnotes: for each cell, which suggestion numbers contribute a
 * "refuter owns one of these cards" constraint that still has this cell
 * as a live candidate. Stage 6 will render these as superscripts; for
 * now exposing the signal is enough to unblock the UI work.
 */
export const footnotesSignal: ReadonlySignal<FootnoteMap> = computed(() => {
    const result = deductionResultSignal.value;
    if (result._tag !== "Ok") return emptyFootnotes;
    return refuterCandidateFootnotes(
        suggestionsAsDataSignal.value,
        result.knowledge,
    );
});

// ---- Actions -----------------------------------------------------------

/**
 * Reset to a fresh game with the default 4-player setup. Caller is
 * responsible for warning the user before discarding existing data —
 * see `hasGameData()`.
 */
export const newGame = (): void => {
    setupSignal.value = newGameSetup(4);
    knownCardsSignal.value = [];
    handSizesSignal.value = [];
    suggestionsSignal.value = [];
    persist();
};

/**
 * True when the user has entered any game data — known cards, hand
 * sizes, suggestions, or customized players (different from the
 * default `Player 1..N`). Used to gate the "New game" confirm dialog.
 */
export const hasGameData = (): boolean => {
    if (knownCardsSignal.value.length > 0) return true;
    if (handSizesSignal.value.length > 0) return true;
    if (suggestionsSignal.value.length > 0) return true;
    const players = setupSignal.value.players;
    if (players.length !== DEFAULT_SETUP.players.length) return true;
    for (let i = 0; i < players.length; i++) {
        if (players[i] !== DEFAULT_SETUP.players[i]) return true;
    }
    return false;
};

export const addKnownCard = (card: KnownCard): void => {
    knownCardsSignal.value = [...knownCardsSignal.value, card];
    persist();
};

export const removeKnownCard = (index: number): void => {
    knownCardsSignal.value = knownCardsSignal.value.filter((_, i) => i !== index);
    persist();
};

export const setHandSizeFor = (player: Player, size: number | undefined): void => {
    const filtered = handSizesSignal.value.filter(([p]) => p !== player);
    handSizesSignal.value = size === undefined
        ? filtered
        : [...filtered, [player, size] as const];
    persist();
};

export const addSuggestion = (suggestion: DraftSuggestion): void => {
    suggestionsSignal.value = [...suggestionsSignal.value, suggestion];
    persist();
};

export const updateSuggestion = (updated: DraftSuggestion): void => {
    suggestionsSignal.value = suggestionsSignal.value.map(
        s => s.id === updated.id ? updated : s,
    );
    persist();
};

export const removeSuggestion = (id: string): void => {
    suggestionsSignal.value = suggestionsSignal.value.filter(s => s.id !== id);
    persist();
};

export const resetAll = (): void => {
    knownCardsSignal.value = [];
    handSizesSignal.value = [];
    suggestionsSignal.value = [];
    persist();
};

/**
 * Append a new player to the setup. Picks the next free `Player N` name
 * by inspecting existing names — so removing "Player 2" and then adding
 * yields "Player 2" again rather than colliding with "Player 4".
 */
export const addPlayer = (): void => {
    const setup = setupSignal.value;
    const existing = new Set(setup.players.map(p => String(p)));
    let n = 1;
    while (existing.has(`Player ${n}`)) n++;
    const newName = Player(`Player ${n}`);
    setupSignal.value = GameSetup({
        players: [...setup.players, newName],
        categories: setup.categories,
    });
    persist();
};

/**
 * Remove a player from the setup and scrub every reference to them
 * from known cards, hand sizes, and suggestions. Suggestions where the
 * removed player was the suggester are dropped entirely; otherwise the
 * player is filtered out of nonRefuters and the refuter field cleared
 * if matched.
 */
export const removePlayer = (player: Player): void => {
    const setup = setupSignal.value;
    setupSignal.value = GameSetup({
        players: setup.players.filter(p => p !== player),
        categories: setup.categories,
    });

    knownCardsSignal.value = knownCardsSignal.value.filter(
        kc => kc.player !== player,
    );

    handSizesSignal.value = handSizesSignal.value.filter(
        ([p]) => p !== player,
    );

    suggestionsSignal.value = suggestionsSignal.value
        .filter(s => s.suggester !== player)
        .map(s => ({
            ...s,
            nonRefuters: s.nonRefuters.filter(p => p !== player),
            refuter: s.refuter === player ? undefined : s.refuter,
        }));

    persist();
};

export const renamePlayer = (oldName: Player, newName: Player): void => {
    if (oldName === newName) return;

    const setup = setupSignal.value;
    setupSignal.value = GameSetup({
        players: setup.players.map(p => p === oldName ? newName : p),
        categories: setup.categories,
    });

    knownCardsSignal.value = knownCardsSignal.value.map(kc =>
        kc.player === oldName ? { ...kc, player: newName } : kc,
    );

    handSizesSignal.value = handSizesSignal.value.map(([p, size]) =>
        p === oldName ? [newName, size] as const : [p, size] as const,
    );

    suggestionsSignal.value = suggestionsSignal.value.map(s => ({
        ...s,
        suggester: s.suggester === oldName ? newName : s.suggester,
        nonRefuters: s.nonRefuters.map(p => p === oldName ? newName : p),
        refuter: s.refuter === oldName ? newName : s.refuter,
    }));

    persist();
};

// ---- Persistence glue --------------------------------------------------

const currentSession = (): GameSession => ({
    setup: setupSignal.value,
    hands: groupKnownCardsByPlayer(knownCardsSignal.value),
    handSizes: handSizesSignal.value.map(([player, size]) => ({ player, size })),
    suggestions: suggestionsAsDataSignal.value,
});

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

const persist = (): void => saveToLocalStorage(currentSession());

const applySession = (session: GameSession): void => {
    setupSignal.value = session.setup;
    knownCardsSignal.value = session.hands.flatMap(h =>
        h.cards.map(card => ({ player: h.player, card })));
    handSizesSignal.value = session.handSizes.map(
        ({ player, size }) => [player, size] as const);
    // Convert Suggestion (Data records) back to DraftSuggestion for UI.
    suggestionsSignal.value = session.suggestions.map((s, i) => ({
        id: s.id || `restored-${i}`,
        suggester: s.suggester,
        cards: Array.from(s.cards),
        nonRefuters: Array.from(s.nonRefuters),
        refuter: s.refuter,
        seenCard: s.seenCard,
    }));
};

/**
 * One-shot initialization: rehydrate from a URL query parameter if
 * present, otherwise from localStorage. The UI calls this on mount.
 */
export const hydrateFromStorage = (): void => {
    // URL first — sharing a link should override persisted state.
    if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const state = params.get("state");
        if (state) {
            const session = decodeSessionFromUrl(state);
            if (session) {
                applySession(session);
                return;
            }
        }
    }
    const session = loadFromLocalStorage();
    if (session) applySession(session);
};

/**
 * Produce a shareable URL for the current session.
 */
export const currentShareUrl = (): string => {
    if (typeof window === "undefined") return "";
    const encoded = encodeSessionToUrl(currentSession());
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?state=${encoded}`;
};
