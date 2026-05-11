import { HashMap, Result } from "effect";
import {
    Accusation,
    AccusationId,
    accusationCards,
    newAccusationId,
} from "./Accusation";
import type { InsightConfidence } from "./BehavioralInsights";
import {
    CaseFileOwner,
    Card,
    Player,
    PlayerOwner,
} from "./GameObjects";
import { CardEntry, Category, GameSetup } from "./GameSetup";
import {
    emptyHypotheses,
    type HypothesisMap,
    type HypothesisValue,
} from "./Hypothesis";
import { Cell } from "./Knowledge";
import {
    decodeV6Unknown,
    decodeV7Unknown,
    decodeV8Unknown,
    decodeV9Unknown,
    decodeV10Unknown,
    decodeV11Unknown,
    type PersistedDismissedInsight,
    type PersistedHypothesis,
    type PersistedHypothesisOrderEntry,
    type PersistedPendingSuggestion,
    type PersistedSessionV6,
    type PersistedSessionV7,
    type PersistedSessionV8,
    type PersistedSessionV9,
    type PersistedSessionV10,
    type PersistedSessionV11,
} from "./PersistenceSchema";
import type { PendingSuggestionDraft } from "./ClueState";
import {
    newSuggestionId,
    Suggestion,
    SuggestionId,
    suggestionCards,
    suggestionNonRefuters,
} from "./Suggestion";

/**
 * JSON representation of the mutable parts of a game session. Only
 * the mutable inputs are serialized; derived knowledge is cheap to
 * recompute, so there's no need to persist it.
 *
 * v11 (current) adds `hypothesisOrder` — UI-only most-recent-first
 * ordering of active hypotheses. v10 / v9 / v8 / v7 / v6 reads still
 * work via the corresponding decoders; they're auto-lifted with the
 * new field defaulted (v10 reads use the `hypotheses` array's iteration
 * order, older versions yield []). Writes always produce v11.
 */
interface PersistedGameV11 {
    readonly version: 11;
    readonly setup: {
        readonly players: ReadonlyArray<string>;
        readonly categories: ReadonlyArray<{
            readonly id: string;
            readonly name: string;
            readonly cards: ReadonlyArray<{
                readonly id: string;
                readonly name: string;
            }>;
        }>;
    };
    readonly hands: ReadonlyArray<{
        readonly player: string;
        readonly cards: ReadonlyArray<string>;
    }>;
    readonly handSizes: ReadonlyArray<{
        readonly player: string;
        readonly size: number;
    }>;
    readonly suggestions: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly suggester: string;
        readonly cards: ReadonlyArray<string>;
        readonly nonRefuters: ReadonlyArray<string>;
        readonly refuter: string | null;
        readonly seenCard: string | null;
        readonly loggedAt: number;
    }>;
    readonly accusations: ReadonlyArray<{
        readonly id?: string | undefined;
        readonly accuser: string;
        readonly cards: ReadonlyArray<string>;
        readonly loggedAt: number;
    }>;
    readonly hypotheses: ReadonlyArray<{
        readonly player: string | null;
        readonly card: string;
        readonly value: "Y" | "N";
    }>;
    readonly hypothesisOrder: ReadonlyArray<{
        readonly player: string | null;
        readonly card: string;
    }>;
    readonly pendingSuggestion: PersistedPendingSuggestion | null;
    readonly selfPlayerId: string | null;
    readonly firstDealtPlayerId: string | null;
    readonly dismissedInsights: ReadonlyArray<{
        readonly key: string;
        readonly atConfidence: InsightConfidence;
    }>;
}

type PersistedGame = PersistedGameV11;

export interface GameSession {
    setup: GameSetup;
    hands: ReadonlyArray<{ player: Player; cards: ReadonlyArray<Card> }>;
    handSizes: ReadonlyArray<{ player: Player; size: number }>;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    hypotheses: HypothesisMap;
    /**
     * UI-only ordering of active hypotheses, most-recent first. Mirrors
     * `hypotheses` keys; persisted since v11. Older versions (and the
     * shares wire format, which omits hypotheses entirely) yield `[]`.
     */
    hypothesisOrder: ReadonlyArray<Cell>;
    pendingSuggestion: PendingSuggestionDraft | null;
    selfPlayerId: Player | null;
    firstDealtPlayerId: Player | null;
    dismissedInsights: ReadonlyMap<string, InsightConfidence>;
}

const encodeHypotheses = (
    hypotheses: HypothesisMap,
): PersistedGameV11["hypotheses"] => {
    const out: Array<PersistedGameV11["hypotheses"][number]> = [];
    for (const [cell, value] of hypotheses) {
        const player =
            cell.owner._tag === "Player"
                ? String(cell.owner.player)
                : null;
        out.push({ player, card: String(cell.card), value });
    }
    return out;
};

const encodeHypothesisOrder = (
    order: ReadonlyArray<Cell>,
): PersistedGameV11["hypothesisOrder"] =>
    order.map(cell => ({
        player:
            cell.owner._tag === "Player"
                ? String(cell.owner.player)
                : null,
        card: String(cell.card),
    }));

const decodeHypothesisOrder = (
    raw: ReadonlyArray<PersistedHypothesisOrderEntry>,
): ReadonlyArray<Cell> =>
    raw.map(({ player, card }) =>
        Cell(player !== null ? PlayerOwner(player) : CaseFileOwner(), card),
    );

// ---- Pending-suggestion encoding -------------------------------------
//
// `PendingSuggestionDraft` slots have three runtime states: `null`
// ("not decided"), Nobody ("explicit no one"), or a typed Player/Card.
// The persisted form uses a pair of flat booleans + the value field
// per slot to round-trip them without `Schema.Union`:
//
//   decided=false                  -> null
//   decided=true, isNobody=true    -> Nobody
//   decided=true, isNobody=false   -> the value (Player / Card / Player[])
//
// Mirrors the flat encoding pattern used by the persisted hypothesis
// schema. See PersistenceSchema.ts for the rationale.

const NOBODY_DRAFT = Object.freeze({
    kind: "nobody" as const,
});

const isPendingNobody = (
    v: unknown,
): v is { readonly kind: "nobody" } =>
    typeof v === "object"
    && v !== null
    && !Array.isArray(v)
    && (v as { kind?: unknown }).kind === "nobody";

const encodePendingSuggestion = (
    pending: PendingSuggestionDraft | null,
): PersistedPendingSuggestion | null => {
    if (pending === null) return null;
    const { nonRefuters, refuter, seenCard } = pending;
    const nonRefutersDecided = nonRefuters !== null;
    const nonRefutersIsNobody = isPendingNobody(nonRefuters);
    const refuterDecided = refuter !== null;
    const refuterIsNobody = isPendingNobody(refuter);
    const seenCardDecided = seenCard !== null;
    const seenCardIsNobody = isPendingNobody(seenCard);
    return {
        id: pending.id,
        suggester: pending.suggester,
        cards: pending.cards,
        nonRefutersDecided,
        nonRefutersIsNobody,
        nonRefuters:
            nonRefuters === null || isPendingNobody(nonRefuters)
                ? []
                : nonRefuters,
        refuterDecided,
        refuterIsNobody,
        refuter:
            refuter === null || isPendingNobody(refuter) ? null : refuter,
        seenCardDecided,
        seenCardIsNobody,
        seenCard:
            seenCard === null || isPendingNobody(seenCard)
                ? null
                : seenCard,
    };
};

const decodePendingSuggestion = (
    persisted: PersistedPendingSuggestion | null,
): PendingSuggestionDraft | null => {
    if (persisted === null) return null;
    const decodeNullable = <T,>(
        decided: boolean,
        isNobody: boolean,
        value: T | null,
    ): T | { readonly kind: "nobody" } | null => {
        if (!decided) return null;
        if (isNobody) return NOBODY_DRAFT;
        return value;
    };
    const decodePassers = (
        decided: boolean,
        isNobody: boolean,
        value: ReadonlyArray<Player>,
    ): ReadonlyArray<Player> | { readonly kind: "nobody" } | null => {
        if (!decided) return null;
        if (isNobody) return NOBODY_DRAFT;
        return value;
    };
    return {
        id: persisted.id,
        suggester: persisted.suggester,
        cards: persisted.cards,
        nonRefuters: decodePassers(
            persisted.nonRefutersDecided,
            persisted.nonRefutersIsNobody,
            persisted.nonRefuters,
        ),
        refuter: decodeNullable(
            persisted.refuterDecided,
            persisted.refuterIsNobody,
            persisted.refuter,
        ),
        seenCard: decodeNullable(
            persisted.seenCardDecided,
            persisted.seenCardIsNobody,
            persisted.seenCard,
        ),
    };
};

const decodeHypotheses = (
    raw: ReadonlyArray<PersistedHypothesis>,
): HypothesisMap => {
    let m: HypothesisMap = emptyHypotheses;
    for (const h of raw) {
        const owner =
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner();
        m = HashMap.set(m, Cell(owner, h.card), h.value as HypothesisValue);
    }
    return m;
};

const encodeDismissedInsights = (
    map: ReadonlyMap<string, InsightConfidence>,
): PersistedGameV11["dismissedInsights"] => {
    const out: Array<{ key: string; atConfidence: InsightConfidence }> = [];
    for (const [key, atConfidence] of map) {
        out.push({ key, atConfidence });
    }
    // Sort for deterministic round-trip — the map's iteration order is
    // insertion-driven, but a stable on-disk ordering simplifies tests
    // and diff-friendly localStorage payloads.
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
};

const decodeDismissedInsights = (
    raw: ReadonlyArray<PersistedDismissedInsight>,
): Map<string, InsightConfidence> => {
    const m = new Map<string, InsightConfidence>();
    for (const { key, atConfidence } of raw) {
        m.set(key, atConfidence);
    }
    return m;
};

export const encodeSession = (session: GameSession): PersistedGame => ({
    version: 11,
    setup: {
        players: session.setup.players.map(p => String(p)),
        categories: session.setup.categories.map(c => ({
            id: String(c.id),
            name: c.name,
            cards: c.cards.map(card => ({
                id: String(card.id),
                name: card.name,
            })),
        })),
    },
    hands: session.hands.map(h => ({
        player: String(h.player),
        cards: h.cards.map(c => String(c)),
    })),
    handSizes: session.handSizes.map(h => ({
        player: String(h.player),
        size: h.size,
    })),
    suggestions: session.suggestions.map(s => ({
        id: String(s.id),
        suggester: String(s.suggester),
        cards: suggestionCards(s).map(c => String(c)),
        nonRefuters: suggestionNonRefuters(s).map(p => String(p)),
        refuter: s.refuter === undefined ? null : String(s.refuter),
        seenCard: s.seenCard === undefined ? null : String(s.seenCard),
        loggedAt: s.loggedAt,
    })),
    accusations: session.accusations.map(a => ({
        id: String(a.id),
        accuser: String(a.accuser),
        cards: accusationCards(a).map(c => String(c)),
        loggedAt: a.loggedAt,
    })),
    hypotheses: encodeHypotheses(session.hypotheses),
    hypothesisOrder: encodeHypothesisOrder(session.hypothesisOrder),
    pendingSuggestion: encodePendingSuggestion(session.pendingSuggestion),
    selfPlayerId:
        session.selfPlayerId === null ? null : String(session.selfPlayerId),
    firstDealtPlayerId:
        session.firstDealtPlayerId === null
            ? null
            : String(session.firstDealtPlayerId),
    dismissedInsights: encodeDismissedInsights(session.dismissedInsights),
});

const buildSessionFromV11 = (v11: PersistedSessionV11): GameSession => ({
    setup: GameSetup({
        players: v11.setup.players,
        categories: v11.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v11.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v11.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v11.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v11.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v11.hypotheses),
    hypothesisOrder: decodeHypothesisOrder(v11.hypothesisOrder),
    pendingSuggestion: decodePendingSuggestion(v11.pendingSuggestion),
    selfPlayerId: v11.selfPlayerId,
    firstDealtPlayerId: v11.firstDealtPlayerId,
    dismissedInsights: decodeDismissedInsights(v11.dismissedInsights),
});

const buildSessionFromV10 = (v10: PersistedSessionV10): GameSession => ({
    setup: GameSetup({
        players: v10.setup.players,
        categories: v10.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v10.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v10.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v10.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v10.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v10.hypotheses),
    // v10 → v11 lift: the persisted v10 `hypotheses` is an array, so its
    // iteration order is meaningful — it's the order the user last saw
    // rendered. Reuse it to seed the new ordering field.
    hypothesisOrder: v10.hypotheses.map(h =>
        Cell(
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner(),
            h.card,
        ),
    ),
    pendingSuggestion: decodePendingSuggestion(v10.pendingSuggestion),
    selfPlayerId: v10.selfPlayerId,
    firstDealtPlayerId: v10.firstDealtPlayerId,
    dismissedInsights: decodeDismissedInsights(v10.dismissedInsights),
});

const buildSessionFromV9 = (v9: PersistedSessionV9): GameSession => ({
    setup: GameSetup({
        players: v9.setup.players,
        categories: v9.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v9.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v9.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v9.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v9.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v9.hypotheses),
    // v9 → v11 lift: same array-order trick as v10 → v11.
    hypothesisOrder: v9.hypotheses.map(h =>
        Cell(
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner(),
            h.card,
        ),
    ),
    pendingSuggestion: decodePendingSuggestion(v9.pendingSuggestion),
    selfPlayerId: v9.selfPlayerId,
    firstDealtPlayerId: v9.firstDealtPlayerId,
    // v9 → v10 lift: no recorded dismissals on prior builds.
    dismissedInsights: new Map<string, InsightConfidence>(),
});

const buildSessionFromV8 = (v8: PersistedSessionV8): GameSession => ({
    setup: GameSetup({
        players: v8.setup.players,
        categories: v8.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v8.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v8.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v8.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v8.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v8.hypotheses),
    // v8 → v11 lift: same array-order trick as v10 → v11.
    hypothesisOrder: v8.hypotheses.map(h =>
        Cell(
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner(),
            h.card,
        ),
    ),
    pendingSuggestion: decodePendingSuggestion(v8.pendingSuggestion),
    // v8 → v9 lift: identity fields default to null. Existing
    // sessions don't lose state on the upgrade — the M6 wizard's
    // identity step is skippable, so null is the same value a
    // fresh wizard skip produces.
    selfPlayerId: null,
    firstDealtPlayerId: null,
    // v8 → v10 lift: no dismissals on the prior build.
    dismissedInsights: new Map<string, InsightConfidence>(),
});

const buildSessionFromV7 = (v7: PersistedSessionV7): GameSession => ({
    setup: GameSetup({
        players: v7.setup.players,
        categories: v7.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v7.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v7.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v7.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v7.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: decodeHypotheses(v7.hypotheses),
    // v7 → v11 lift: same array-order trick as v10 → v11.
    hypothesisOrder: v7.hypotheses.map(h =>
        Cell(
            h.player !== null ? PlayerOwner(h.player) : CaseFileOwner(),
            h.card,
        ),
    ),
    pendingSuggestion: null,
    // v7 → v10 lift: identity fields default to null (skippable
    // wizard step's natural value); no recorded dismissals.
    selfPlayerId: null,
    firstDealtPlayerId: null,
    dismissedInsights: new Map<string, InsightConfidence>(),
});

/**
 * Lift a v6 payload to v9 by attaching an empty hypothesis set, a
 * null pending-suggestion draft, and null identity fields. Forward-
 * only and lossless.
 */
const liftV6ToV7 = (v6: PersistedSessionV6): GameSession => ({
    setup: GameSetup({
        players: v6.setup.players,
        categories: v6.setup.categories.map(c => Category({
            id: c.id,
            name: c.name,
            cards: c.cards.map(card => CardEntry({
                id: card.id,
                name: card.name,
            })),
        })),
    }),
    hands: v6.hands.map(h => ({ player: h.player, cards: h.cards })),
    handSizes: v6.handSizes.map(h => ({
        player: h.player,
        size: h.size,
    })),
    suggestions: v6.suggestions.map(s => Suggestion({
        id: s.id === undefined || s.id === SuggestionId("")
            ? newSuggestionId()
            : s.id,
        suggester: s.suggester,
        cards: s.cards,
        nonRefuters: s.nonRefuters,
        refuter: s.refuter === null ? undefined : s.refuter,
        seenCard: s.seenCard === null ? undefined : s.seenCard,
        loggedAt: s.loggedAt,
    })),
    accusations: v6.accusations.map(a => Accusation({
        id: a.id === undefined || a.id === AccusationId("")
            ? newAccusationId()
            : a.id,
        accuser: a.accuser,
        cards: a.cards,
        loggedAt: a.loggedAt,
    })),
    hypotheses: emptyHypotheses,
    hypothesisOrder: [],
    pendingSuggestion: null,
    selfPlayerId: null,
    firstDealtPlayerId: null,
    dismissedInsights: new Map<string, InsightConfidence>(),
});

export const decodeSession = (data: unknown): GameSession | undefined => {
    const v11 = decodeV11Unknown(data);
    if (Result.isSuccess(v11)) return buildSessionFromV11(v11.success);
    const v10 = decodeV10Unknown(data);
    if (Result.isSuccess(v10)) return buildSessionFromV10(v10.success);
    const v9 = decodeV9Unknown(data);
    if (Result.isSuccess(v9)) return buildSessionFromV9(v9.success);
    const v8 = decodeV8Unknown(data);
    if (Result.isSuccess(v8)) return buildSessionFromV8(v8.success);
    const v7 = decodeV7Unknown(data);
    if (Result.isSuccess(v7)) return buildSessionFromV7(v7.success);
    const v6 = decodeV6Unknown(data);
    if (Result.isSuccess(v6)) return liftV6ToV7(v6.success);
    return undefined;
};

const STORAGE_KEY = "effect-clue.session.v11";
const LEGACY_STORAGE_KEY_V10 = "effect-clue.session.v10";
const LEGACY_STORAGE_KEY_V9 = "effect-clue.session.v9";
const LEGACY_STORAGE_KEY_V8 = "effect-clue.session.v8";
const LEGACY_STORAGE_KEY_V7 = "effect-clue.session.v7";
const LEGACY_STORAGE_KEY_V6 = "effect-clue.session.v6";

export const saveToLocalStorage = (session: GameSession): void => {
    try {
        const encoded = encodeSession(session);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

export const loadFromLocalStorage = (): GameSession | undefined => {
    try {
        const rawV11 = window.localStorage.getItem(STORAGE_KEY);
        if (rawV11) return decodeSession(JSON.parse(rawV11));
        const rawV10 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V10);
        if (rawV10) return decodeSession(JSON.parse(rawV10));
        const rawV9 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V9);
        if (rawV9) return decodeSession(JSON.parse(rawV9));
        const rawV8 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V8);
        if (rawV8) return decodeSession(JSON.parse(rawV8));
        const rawV7 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V7);
        if (rawV7) return decodeSession(JSON.parse(rawV7));
        const rawV6 = window.localStorage.getItem(LEGACY_STORAGE_KEY_V6);
        if (rawV6) return decodeSession(JSON.parse(rawV6));
        return undefined;
    } catch {
        return undefined;
    }
};

// The base64 `?state=...` URL share path that previously lived here was
// dropped during the M3 SSR + RQ refactor — its replacement is the
// server-stored `/share/[id]` route, which lands in M9 with a richer
// sender-controlled snapshot UI. Old base64 share links no longer
// hydrate the app on landing; the per-user direction was that nobody
// is using them, so no back-compat layer was added.
