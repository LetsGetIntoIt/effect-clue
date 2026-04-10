import { signal, computed, Signal, ReadonlySignal } from "@preact/signals";
import {
    Card,
    Player,
    PlayerOwner,
} from "../logic/GameObjects";
import {
    CLASSIC_SETUP_3P,
    GameSetup,
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

export const setupSignal: Signal<GameSetup> = signal(CLASSIC_SETUP_3P);

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
    for (const { player, card } of knownCards) {
        // Ignore cards that don't belong to this setup (e.g. after a
        // preset change).
        if (!setup.players.includes(player)) continue;
        const inDeck =
            setup.suspects.includes(card) ||
            setup.weapons.includes(card) ||
            setup.rooms.includes(card);
        if (!inDeck) continue;
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

// ---- Actions -----------------------------------------------------------

export const loadPreset = (preset: GameSetup): void => {
    setupSignal.value = preset;
    // Reset everything else — different decks don't mix cleanly.
    knownCardsSignal.value = [];
    handSizesSignal.value = [];
    suggestionsSignal.value = [];
    persist();
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
        id: `restored-${i}`,
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
