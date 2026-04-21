import { allCardEntries, cardName, GameSetup } from "./GameSetup";
import { Card, Player } from "./GameObjects";
import type { DraftSuggestion } from "./ClueState";
import { newSuggestionId } from "./Suggestion";

/**
 * Parser for the "streamlined" natural-language suggestion input. Given
 * a raw string like
 *
 *   "Mustard suggests Knife, Plum, Ballroom. Passed by Green. Refuted
 *    by Scarlet (with Plum)."
 *
 * and a current game setup, produces a structured `ParsedSuggestion`:
 * each sentence slot (suggester, one card per category, optional
 * passers, optional refuter + seen card) comes back as a `SlotState`
 * describing whether the user has resolved it, is still typing, or
 * entered something unrecognised.
 *
 * The parser is tolerant by design:
 * - Case-insensitive matching.
 * - Unique-prefix matching ("must" -> "Col. Mustard").
 * - Levenshtein-1 typo recovery ("Mustrd" -> "Col. Mustard").
 * - `and`/`,`/`;` are interchangeable separators.
 * - Synonyms: `suggests`/`suggested`/`proposes`/`accuses`,
 *   `refuted by`/`shown by`, `passed`/`passed by`/`no-showed by`,
 *   `with`/`showed`/`showing`.
 * - Punctuation (`.`, `;`) is optional where unambiguous.
 *
 * Pure + synchronous — no React, no services, no Effect runtime. The
 * output powers both the live autocomplete dropdown and the live
 * 4-item checklist panel.
 */

// ---- Slot types --------------------------------------------------------

export type Range = readonly [number, number];

export interface Candidate<T> {
    readonly value: T;
    readonly label: string;
}

export type SlotState<T> =
    | { readonly _tag: "Empty" }
    | {
          readonly _tag: "Typing";
          readonly raw: string;
          readonly range: Range;
          readonly candidates: ReadonlyArray<Candidate<T>>;
      }
    | {
          readonly _tag: "Resolved";
          readonly raw: string;
          readonly range: Range;
          readonly value: T;
          readonly label: string;
      }
    | {
          readonly _tag: "Ambiguous";
          readonly raw: string;
          readonly range: Range;
          readonly candidates: ReadonlyArray<Candidate<T>>;
      }
    | {
          readonly _tag: "Unknown";
          readonly raw: string;
          readonly range: Range;
          readonly nearestCandidates: ReadonlyArray<Candidate<T>>;
      };

export type ActiveSlot =
    | { readonly kind: "suggester" }
    | { readonly kind: "card"; readonly index: number }
    | { readonly kind: "passer"; readonly index: number }
    | { readonly kind: "refuter" }
    | { readonly kind: "seenCard" }
    | { readonly kind: "done" };

export interface ParsedSuggestion {
    readonly suggester: SlotState<Player>;
    readonly cards: ReadonlyArray<SlotState<Card>>;
    readonly nonRefuters: ReadonlyArray<SlotState<Player>>;
    readonly refuter: SlotState<Player>;
    readonly seenCard: SlotState<Card>;
    readonly activeSlot: ActiveSlot;
    readonly draft: DraftSuggestion | null;
}

// ---- Keyword tables ----------------------------------------------------

// Order matters for longest-match: "passed by" must win over "passed",
// "shown by" must win over "shown", etc. We always attempt the
// "<verb> by" variant first.
const SUGGESTS_RE = /\b(?:suggests?|suggested|proposes?|proposed|accuses?|accused)\b/i;
const PASSERS_RE =
    /\b(?:passed\s+by|passers?\s*:|no[-\s]?showed\s+by|could\s*not\s*refute|no\s+refute|passed|pass)\b/i;
const REFUTER_RE =
    /\b(?:refuted\s+by|shown\s+by|showed\s+by|refuted|shown|showed)\b/i;
const WITH_RE = /\b(?:with|showed|showing|shows)\b/i;

// When splitting a list of names, accept comma / "and" / semicolon.
const LIST_SEP_RE = /(\s*,\s*|\s+and\s+|\s*;\s*)/gi;

// ---- Name matching -----------------------------------------------------

interface MatchResult<T> {
    readonly exact: Candidate<T> | null;
    readonly prefix: ReadonlyArray<Candidate<T>>;
    readonly fuzzy: ReadonlyArray<Candidate<T>>;
}

const normalize = (s: string): string =>
    s.trim().toLowerCase().replace(/\s+/g, " ");

// Classic edit distance, bounded at 2 — we only care whether it's <= 1
// for typo correction. Small inputs (<40 chars), so O(n*m) is fine.
const levenshtein = (a: string, b: string, max: number): number => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array<number>(n + 1);
    let curr = new Array<number>(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        let rowMin = curr[0]!;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(
                prev[j]! + 1,
                curr[j - 1]! + 1,
                prev[j - 1]! + cost,
            );
            if (curr[j]! < rowMin) rowMin = curr[j]!;
        }
        if (rowMin > max) return max + 1;
        [prev, curr] = [curr, prev];
    }
    return prev[n]!;
};

const matchName = <T>(
    raw: string,
    candidates: ReadonlyArray<Candidate<T>>,
): MatchResult<T> => {
    const needle = normalize(raw);
    if (needle.length === 0) {
        return { exact: null, prefix: [], fuzzy: [] };
    }
    let exact: Candidate<T> | null = null;
    const prefix: Array<Candidate<T>> = [];
    const fuzzy: Array<Candidate<T>> = [];
    for (const cand of candidates) {
        const hay = normalize(cand.label);
        if (hay === needle) {
            exact = cand;
            continue;
        }
        if (hay.startsWith(needle)) {
            prefix.push(cand);
            continue;
        }
        // Also treat word-start matches as prefix: "plum" should hit
        // "Prof. Plum". We split on non-word chars and check whether any
        // word starts with the needle.
        const words = hay.split(/[^a-z0-9]+/).filter(w => w.length > 0);
        if (words.some(w => w.startsWith(needle))) {
            prefix.push(cand);
            continue;
        }
        // Levenshtein-1 typo recovery — only when the needle is long
        // enough that a single edit is a strong signal (3+ chars).
        if (needle.length >= 3) {
            const d = levenshtein(needle, hay, 1);
            if (d <= 1) fuzzy.push(cand);
        }
    }
    return { exact, prefix, fuzzy };
};

const resolveFinalSlot = <T>(
    raw: string,
    range: Range,
    candidates: ReadonlyArray<Candidate<T>>,
): SlotState<T> => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { _tag: "Empty" };
    }
    const result = matchName(trimmed, candidates);
    if (result.exact !== null) {
        return {
            _tag: "Resolved",
            raw,
            range,
            value: result.exact.value,
            label: result.exact.label,
        };
    }
    if (result.prefix.length === 1) {
        const hit = result.prefix[0]!;
        return {
            _tag: "Resolved",
            raw,
            range,
            value: hit.value,
            label: hit.label,
        };
    }
    if (result.prefix.length > 1) {
        return {
            _tag: "Ambiguous",
            raw,
            range,
            candidates: result.prefix,
        };
    }
    if (result.fuzzy.length === 1) {
        const hit = result.fuzzy[0]!;
        return {
            _tag: "Resolved",
            raw,
            range,
            value: hit.value,
            label: hit.label,
        };
    }
    return {
        _tag: "Unknown",
        raw,
        range,
        nearestCandidates: result.fuzzy,
    };
};

const resolveActiveSlot = <T>(
    raw: string,
    range: Range,
    candidates: ReadonlyArray<Candidate<T>>,
): SlotState<T> => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { _tag: "Empty" };
    }
    const result = matchName(trimmed, candidates);
    // Active = caret sits at the end of this fragment, user is still
    // typing. A unique match still resolves — we just also want the
    // dropdown to show the candidate so the user can Tab to canonicalise
    // the raw text. Ambiguous input stays in Typing state so submit
    // (Enter) is gated until the user disambiguates.
    if (result.exact !== null) {
        return {
            _tag: "Resolved",
            raw,
            range,
            value: result.exact.value,
            label: result.exact.label,
        };
    }
    if (result.prefix.length === 1) {
        const hit = result.prefix[0]!;
        return {
            _tag: "Resolved",
            raw,
            range,
            value: hit.value,
            label: hit.label,
        };
    }
    if (result.prefix.length > 1) {
        return {
            _tag: "Typing",
            raw,
            range,
            candidates: result.prefix,
        };
    }
    if (result.fuzzy.length === 1) {
        const hit = result.fuzzy[0]!;
        return {
            _tag: "Resolved",
            raw,
            range,
            value: hit.value,
            label: hit.label,
        };
    }
    return { _tag: "Unknown", raw, range, nearestCandidates: result.fuzzy };
};

// ---- Tokenisation ------------------------------------------------------

interface Token {
    readonly raw: string; // includes leading/trailing whitespace within the slice
    readonly trimStart: number;
    readonly trimEnd: number;
}

/**
 * Split a range of text on list separators (`,`, `and`, `;`) and return
 * one Token per non-empty piece. Each token's range points at the
 * non-whitespace part of the fragment in the original input.
 */
const splitList = (
    text: string,
    start: number,
    end: number,
): ReadonlyArray<Token> => {
    const slice = text.slice(start, end);
    const parts: Array<Token> = [];
    let cursor = 0;
    LIST_SEP_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LIST_SEP_RE.exec(slice))) {
        const piece = slice.slice(cursor, match.index);
        pushPiece(parts, piece, start + cursor);
        cursor = match.index + match[0].length;
    }
    // Trailing piece
    const piece = slice.slice(cursor);
    pushPiece(parts, piece, start + cursor);
    return parts;
};

const pushPiece = (
    out: Array<Token>,
    piece: string,
    startOffset: number,
): void => {
    const leading = piece.length - piece.trimStart().length;
    const trailing = piece.length - piece.trimEnd().length;
    const trimStart = startOffset + leading;
    const trimEnd = startOffset + piece.length - trailing;
    if (trimStart >= trimEnd) return;
    out.push({
        raw: piece.slice(leading, piece.length - trailing),
        trimStart,
        trimEnd,
    });
};

// ---- Parsing -----------------------------------------------------------

interface Keywords {
    readonly suggests: RegExpMatchInfo | null;
    readonly passers: RegExpMatchInfo | null;
    readonly refuter: RegExpMatchInfo | null;
}

interface RegExpMatchInfo {
    readonly start: number;
    readonly end: number;
}

const findAt = (
    text: string,
    re: RegExp,
    from: number,
): RegExpMatchInfo | null => {
    const slice = text.slice(from);
    const m = re.exec(slice);
    if (!m) return null;
    return { start: from + m.index, end: from + m.index + m[0].length };
};

const findKeywords = (text: string): Keywords => {
    const suggests = findAt(text, SUGGESTS_RE, 0);
    const searchFrom = suggests ? suggests.end : 0;
    // Look for PASSERS and REFUTER keywords after `suggests`. We return
    // them in source order; ordering semantics (passers before refuter
    // vs. the reverse) are handled in parse below.
    const passers = findAt(text, PASSERS_RE, searchFrom);
    const refuter = findAt(text, REFUTER_RE, searchFrom);
    return { suggests, passers, refuter };
};

const trimToRange = (
    text: string,
    start: number,
    end: number,
): [string, Range] => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    // Also strip leading punctuation like a period left behind by the
    // previous clause.
    while (s < e && /[.;,]/.test(text[s]!)) s++;
    while (s < e && /\s/.test(text[s]!)) s++;
    return [text.slice(s, e), [s, e]];
};

const isActiveAt = (caret: number, range: Range): boolean => {
    // The fragment is "active" if the caret sits at its right edge and
    // the user is still typing it.
    return caret === range[1];
};

const buildCandidates = (setup: GameSetup) => {
    const playerCandidates: ReadonlyArray<Candidate<Player>> =
        setup.players.map(p => ({ value: p, label: String(p) }));
    const cardCandidatesByCategory: ReadonlyArray<ReadonlyArray<Candidate<Card>>> =
        setup.categories.map(cat =>
            cat.cards.map(entry => ({ value: entry.id, label: entry.name })),
        );
    const allCardCandidates: ReadonlyArray<Candidate<Card>> = allCardEntries(
        setup,
    ).map(e => ({ value: e.id, label: e.name }));
    return { playerCandidates, cardCandidatesByCategory, allCardCandidates };
};

/**
 * Attempt to split a refuted-section fragment into `refuter` +
 * `seenCard`. Handles `(with X)`, `refuted by X with Y`, `shown by X
 * showed Y`, etc. Parentheses are preserved in the raw token range but
 * stripped for matching.
 */
const splitRefutedSection = (
    text: string,
    start: number,
    end: number,
): {
    refuterRaw: string;
    refuterRange: Range;
    seenRaw: string | null;
    seenRange: Range | null;
} => {
    const slice = text.slice(start, end);
    const withMatch = WITH_RE.exec(slice);
    if (!withMatch) {
        // No "with" keyword — everything is the refuter name (with
        // parens stripped later).
        const [rRaw, rRange] = stripParensTrim(text, start, end);
        return {
            refuterRaw: rRaw,
            refuterRange: rRange,
            seenRaw: null,
            seenRange: null,
        };
    }
    const withStart = start + withMatch.index;
    const withEnd = withStart + withMatch[0].length;
    const [rRaw, rRange] = stripParensTrim(text, start, withStart);
    const [sRaw, sRange] = stripParensTrim(text, withEnd, end);
    return {
        refuterRaw: rRaw,
        refuterRange: rRange,
        seenRaw: sRaw === "" ? null : sRaw,
        seenRange: sRaw === "" ? null : sRange,
    };
};

const stripParensTrim = (
    text: string,
    start: number,
    end: number,
): [string, Range] => {
    let s = start;
    let e = end;
    while (s < e && /[\s().,;]/.test(text[s]!)) s++;
    while (e > s && /[\s().,;]/.test(text[e - 1]!)) e--;
    return [text.slice(s, e), [s, e]];
};

// ---- Main entry point --------------------------------------------------

export const parseSuggestionInput = (
    text: string,
    caret: number,
    setup: GameSetup,
): ParsedSuggestion => {
    const { playerCandidates, cardCandidatesByCategory, allCardCandidates } =
        buildCandidates(setup);
    const n = text.length;
    const keywords = findKeywords(text);

    // --- Suggester --------------------------------------------------------
    const suggesterEnd = keywords.suggests ? keywords.suggests.start : n;
    const [suggesterRaw, suggesterRange] = trimToRange(text, 0, suggesterEnd);
    const suggesterIsActive =
        !keywords.suggests &&
        isActiveAt(caret, [suggesterRange[0], suggesterRange[1]]);
    const suggester: SlotState<Player> = suggesterIsActive
        ? resolveActiveSlot(suggesterRaw, suggesterRange, playerCandidates)
        : resolveFinalSlot(suggesterRaw, suggesterRange, playerCandidates);

    // --- Cards section ---------------------------------------------------
    const totalCardSlots = setup.categories.length;
    const cardsSectionStart = keywords.suggests ? keywords.suggests.end : n;
    const cardsSectionEnd = earliestAfter(
        cardsSectionStart,
        keywords.passers,
        keywords.refuter,
        n,
    );

    const cardTokens = keywords.suggests
        ? splitList(text, cardsSectionStart, cardsSectionEnd)
        : [];
    const cards: ReadonlyArray<SlotState<Card>> = buildCardSlots(
        cardTokens,
        totalCardSlots,
        caret,
        cardsSectionEnd === n && !keywords.passers && !keywords.refuter,
        cardCandidatesByCategory,
        allCardCandidates,
    );

    // --- Passers section --------------------------------------------------
    const passersStart = keywords.passers ? keywords.passers.end : -1;
    const passersEnd =
        keywords.passers && keywords.refuter &&
        keywords.refuter.start > keywords.passers.end
            ? keywords.refuter.start
            : n;
    const passerTokens =
        passersStart >= 0 ? splitList(text, passersStart, passersEnd) : [];
    const passersActiveAtEnd =
        keywords.passers !== null &&
        !keywords.refuter &&
        isAtEndOfInput(caret, text);
    const nonRefuters: ReadonlyArray<SlotState<Player>> = passerTokens.map(
        (tok, i) => {
            const active = passersActiveAtEnd && i === passerTokens.length - 1;
            const range: Range = [tok.trimStart, tok.trimEnd];
            return active
                ? resolveActiveSlot(tok.raw, range, playerCandidates)
                : resolveFinalSlot(tok.raw, range, playerCandidates);
        },
    );

    // --- Refuter section -------------------------------------------------
    let refuter: SlotState<Player> = { _tag: "Empty" };
    let seenCard: SlotState<Card> = { _tag: "Empty" };
    if (keywords.refuter) {
        const refStart = keywords.refuter.end;
        const refEnd = n;
        const split = splitRefutedSection(text, refStart, refEnd);
        const caretInSeen =
            split.seenRange !== null &&
            caret >= split.seenRange[0] &&
            caret <= split.seenRange[1];
        const refuterActive =
            !caretInSeen &&
            split.seenRaw === null &&
            isAtEndOfInput(caret, text);
        refuter = refuterActive
            ? resolveActiveSlot(
                  split.refuterRaw,
                  split.refuterRange,
                  playerCandidates,
              )
            : resolveFinalSlot(
                  split.refuterRaw,
                  split.refuterRange,
                  playerCandidates,
              );
        if (split.seenRaw !== null && split.seenRange !== null) {
            seenCard = caretInSeen && isAtEndOfInput(caret, text)
                ? resolveActiveSlot(
                      split.seenRaw,
                      split.seenRange,
                      allCardCandidates,
                  )
                : resolveFinalSlot(
                      split.seenRaw,
                      split.seenRange,
                      allCardCandidates,
                  );
        }
    }

    // --- Active slot -----------------------------------------------------
    const activeSlot = computeActiveSlot({
        text,
        caret,
        keywords,
        suggesterRange,
        cards,
        cardTokens,
        totalCardSlots,
        passerTokens,
        passersStart,
        passersEnd,
        refuterKw: keywords.refuter,
    });

    // --- Draft if valid --------------------------------------------------
    const draft = buildDraft({
        suggester,
        cards,
        nonRefuters,
        refuter,
        seenCard,
        totalCardSlots,
        setup,
    });

    return {
        suggester,
        cards,
        nonRefuters,
        refuter,
        seenCard,
        activeSlot,
        draft,
    };
};

// ---- Helpers -----------------------------------------------------------

const earliestAfter = (
    after: number,
    ...candidates: Array<RegExpMatchInfo | null | number>
): number => {
    let best = Infinity;
    for (const c of candidates) {
        if (c === null) continue;
        const pos = typeof c === "number" ? c : c.start;
        if (pos >= after && pos < best) best = pos;
    }
    return best === Infinity ? Number.MAX_SAFE_INTEGER : best;
};

const isAtEndOfInput = (caret: number, text: string): boolean => {
    // Allow trailing whitespace past the caret to still count as "at end".
    return caret >= text.trimEnd().length;
};

const buildCardSlots = (
    tokens: ReadonlyArray<Token>,
    totalSlots: number,
    caret: number,
    sectionIsOpen: boolean,
    cardCandidatesByCategory: ReadonlyArray<ReadonlyArray<Candidate<Card>>>,
    allCardCandidates: ReadonlyArray<Candidate<Card>>,
): ReadonlyArray<SlotState<Card>> => {
    const out: Array<SlotState<Card>> = [];
    for (let i = 0; i < totalSlots; i++) {
        const tok = tokens[i];
        if (tok === undefined) {
            out.push({ _tag: "Empty" });
            continue;
        }
        const range: Range = [tok.trimStart, tok.trimEnd];
        // Prefer the card candidates for the matching category slot, but
        // fall back to all cards if the user types a name that fits a
        // different category (user may rearrange later).
        const scoped = cardCandidatesByCategory[i] ?? allCardCandidates;
        const active =
            sectionIsOpen &&
            i === tokens.length - 1 &&
            isActiveAt(caret, range);
        const resolved = active
            ? resolveActiveSlot(tok.raw, range, scoped)
            : resolveFinalSlot(tok.raw, range, scoped);
        if (resolved._tag === "Unknown" && scoped !== allCardCandidates) {
            // Second chance: the user may have typed the name of a card
            // from a different category. Retry against all cards.
            const retry = active
                ? resolveActiveSlot(tok.raw, range, allCardCandidates)
                : resolveFinalSlot(tok.raw, range, allCardCandidates);
            if (retry._tag === "Resolved") {
                out.push(retry);
                continue;
            }
        }
        out.push(resolved);
    }
    // If user typed more tokens than categories, we still want extras to
    // surface as errors in the checklist. For now, drop trailing tokens —
    // the grammar is "one card per category".
    return out;
};

const computeActiveSlot = (params: {
    text: string;
    caret: number;
    keywords: Keywords;
    suggesterRange: Range;
    cards: ReadonlyArray<SlotState<Card>>;
    cardTokens: ReadonlyArray<Token>;
    totalCardSlots: number;
    passerTokens: ReadonlyArray<Token>;
    passersStart: number;
    passersEnd: number;
    refuterKw: RegExpMatchInfo | null;
}): ActiveSlot => {
    const { caret, keywords, cards, cardTokens, totalCardSlots } = params;

    // Inside suggester region?
    if (!keywords.suggests || caret <= keywords.suggests.start) {
        return { kind: "suggester" };
    }
    // Inside cards region?
    const cardsRegionEnd = keywords.passers
        ? keywords.passers.start
        : keywords.refuter
        ? keywords.refuter.start
        : params.text.length;
    if (caret <= cardsRegionEnd) {
        // Pick the index of the token the caret is inside, or the next
        // empty slot if caret is past all existing tokens.
        for (let i = 0; i < cardTokens.length; i++) {
            const t = cardTokens[i]!;
            if (caret >= t.trimStart && caret <= t.trimEnd) {
                return { kind: "card", index: i };
            }
        }
        const nextEmpty = cards.findIndex(c => c._tag === "Empty");
        return {
            kind: "card",
            index:
                nextEmpty === -1
                    ? Math.max(0, Math.min(totalCardSlots - 1, cardTokens.length))
                    : nextEmpty,
        };
    }
    // Inside passers region?
    if (
        keywords.passers &&
        caret >= keywords.passers.end &&
        (!keywords.refuter || caret <= keywords.refuter.start)
    ) {
        for (let i = 0; i < params.passerTokens.length; i++) {
            const t = params.passerTokens[i]!;
            if (caret >= t.trimStart && caret <= t.trimEnd) {
                return { kind: "passer", index: i };
            }
        }
        return { kind: "passer", index: params.passerTokens.length };
    }
    // Inside refuter region?
    if (keywords.refuter && caret >= keywords.refuter.end) {
        const withMatch = WITH_RE.exec(
            params.text.slice(keywords.refuter.end),
        );
        if (withMatch) {
            const withStart = keywords.refuter.end + withMatch.index;
            const withEnd = withStart + withMatch[0].length;
            if (caret >= withEnd) return { kind: "seenCard" };
            if (caret <= withStart) return { kind: "refuter" };
            return { kind: "refuter" };
        }
        return { kind: "refuter" };
    }
    return { kind: "done" };
};

const buildDraft = (params: {
    suggester: SlotState<Player>;
    cards: ReadonlyArray<SlotState<Card>>;
    nonRefuters: ReadonlyArray<SlotState<Player>>;
    refuter: SlotState<Player>;
    seenCard: SlotState<Card>;
    totalCardSlots: number;
    setup: GameSetup;
}): DraftSuggestion | null => {
    const { suggester, cards, nonRefuters, refuter, seenCard, totalCardSlots } =
        params;
    if (suggester._tag !== "Resolved") return null;
    if (cards.length < totalCardSlots) return null;
    const resolvedCards: Array<Card> = [];
    for (const c of cards) {
        if (c._tag !== "Resolved") return null;
        resolvedCards.push(c.value);
    }
    const resolvedPassers: Array<Player> = [];
    for (const p of nonRefuters) {
        // Optional section — empty is fine. But if the user typed a
        // token, it must resolve.
        if (p._tag !== "Resolved") return null;
        resolvedPassers.push(p.value);
    }
    let refuterValue: Player | undefined;
    let seenCardValue: Card | undefined;
    if (refuter._tag === "Resolved") {
        refuterValue = refuter.value;
        // seenCard is optional, but if user typed it, it must resolve.
        if (seenCard._tag === "Resolved") {
            seenCardValue = seenCard.value;
        } else if (seenCard._tag !== "Empty") {
            return null;
        }
    } else if (refuter._tag !== "Empty") {
        return null;
    }
    return {
        id: newSuggestionId(),
        suggester: suggester.value,
        cards: resolvedCards,
        nonRefuters: resolvedPassers,
        refuter: refuterValue,
        seenCard: seenCardValue,
    };
};

// ---- Autocomplete ------------------------------------------------------

interface AutocompleteState {
    readonly slot: ActiveSlot;
    readonly raw: string;
    readonly range: Range | null;
    readonly candidates: ReadonlyArray<Candidate<unknown>>;
}

/**
 * Given a parsed suggestion and the current setup, return the dropdown
 * state for the slot under the caret: what the user is typing, what
 * range to replace on accept, and what candidates to render. The
 * combobox component keys off this.
 */
export const autocompleteFor = (
    parsed: ParsedSuggestion,
    setup: GameSetup,
): AutocompleteState => {
    const { activeSlot } = parsed;
    const { playerCandidates, cardCandidatesByCategory, allCardCandidates } =
        buildCandidates(setup);
    const asUnknown = <T>(
        cs: ReadonlyArray<Candidate<T>>,
    ): ReadonlyArray<Candidate<unknown>> => cs;

    switch (activeSlot.kind) {
        case "suggester": {
            const slot = parsed.suggester;
            return {
                slot: activeSlot,
                ...extractRaw(slot),
                candidates: filterCandidates(
                    slot,
                    asUnknown(playerCandidates),
                ),
            };
        }
        case "card": {
            const slot =
                parsed.cards[activeSlot.index] ?? ({ _tag: "Empty" } as const);
            const scoped =
                cardCandidatesByCategory[activeSlot.index] ?? allCardCandidates;
            return {
                slot: activeSlot,
                ...extractRaw(slot),
                candidates: filterCandidates(slot, asUnknown(scoped)),
            };
        }
        case "passer": {
            const slot =
                parsed.nonRefuters[activeSlot.index] ??
                ({ _tag: "Empty" } as const);
            return {
                slot: activeSlot,
                ...extractRaw(slot),
                candidates: filterCandidates(
                    slot,
                    asUnknown(playerCandidates),
                ),
            };
        }
        case "refuter": {
            const slot = parsed.refuter;
            return {
                slot: activeSlot,
                ...extractRaw(slot),
                candidates: filterCandidates(
                    slot,
                    asUnknown(playerCandidates),
                ),
            };
        }
        case "seenCard": {
            const slot = parsed.seenCard;
            // Seen card must be one of the three cards that were
            // actually suggested — those are the only ones a refuter
            // could show.
            const scoped: ReadonlyArray<Candidate<unknown>> = parsed.cards
                .flatMap(c => (c._tag === "Resolved" ? [c] : []))
                .map(c => ({
                    value: c.value,
                    label: cardName(setup, c.value),
                }));
            return {
                slot: activeSlot,
                ...extractRaw(slot),
                candidates: filterCandidates(slot, scoped),
            };
        }
        case "done":
            return {
                slot: activeSlot,
                raw: "",
                range: null,
                candidates: [],
            };
    }
};

const extractRaw = <T>(
    slot: SlotState<T>,
): { raw: string; range: Range | null } => {
    switch (slot._tag) {
        case "Empty":
            return { raw: "", range: null };
        default:
            return { raw: slot.raw, range: slot.range };
    }
};

const filterCandidates = <T>(
    slot: SlotState<T>,
    all: ReadonlyArray<Candidate<unknown>>,
): ReadonlyArray<Candidate<unknown>> => {
    const raw = slot._tag === "Empty" ? "" : slot.raw.trim();
    if (raw.length === 0) return all;
    const needle = normalize(raw);
    return all.filter(c => {
        const hay = normalize(c.label);
        if (hay.startsWith(needle)) return true;
        const words = hay.split(/[^a-z0-9]+/).filter(w => w.length > 0);
        return words.some(w => w.startsWith(needle));
    });
};
