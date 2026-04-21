"use client";

import { useTranslations } from "next-intl";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { DraftSuggestion } from "../../logic/ClueState";
import type { GameSetup } from "../../logic/GameSetup";
import {
    autocompleteFor,
    parseSuggestionInput,
    type ActiveSlot,
    type ParsedSuggestion,
    type Range,
    type SlotState,
} from "../../logic/SuggestionParser";

/**
 * Keyboard-first streamlined input for adding a suggestion.
 *
 * Layout regions (top to bottom):
 *   1. `<SlotPills>` — one pill per sentence slot (suggester, one card
 *      per category, and the three optional sections: Passed by,
 *      Refuted by, Shown card). Pills are clickable; clicking a pill
 *      jumps the caret to that slot so the input-anchored dropdown
 *      surfaces the right candidates. Pills double as the live
 *      checklist — status icon + label + resolved value all in one.
 *   2. `<SlotHint>` — one-line helper that tells the user what the
 *      parser is currently waiting for, or surfaces Unknown /
 *      Ambiguous errors with nearest candidates.
 *   3. `<input>` + dropdown `<ul>` — the single text field where the
 *      user types a sentence-shaped suggestion. Tab / Enter within
 *      the dropdown accept the highlighted candidate.
 *   4. Action row — "Add (⌘↵)" submit button, "Use example" helper,
 *      and the keyboard-shortcut hint. Submit label + hint are
 *      platform-aware (Cmd on Mac, Ctrl elsewhere).
 *
 * Submit contract:
 *   - Plain `Enter` NEVER submits. It either accepts the highlighted
 *     candidate (if the dropdown is open) or closes the dropdown.
 *     This is a deliberate divergence from an earlier iteration where
 *     Enter committed the draft as soon as the required slots
 *     resolved — that surprised users who wanted to continue typing
 *     the optional sections (passers / refuter / shown card).
 *   - `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows / Linux) submits.
 *     The "Add" button mirrors this with a platform-aware label.
 *
 * Pill-click contract:
 *   - Clicking any pill re-contextualises the main input-anchored
 *     dropdown rather than rendering its own popover. The pill moves
 *     the caret (or inserts a grammar fragment), focuses the input,
 *     and opens the dropdown. Reusing one dropdown instance keeps the
 *     pill row visually simple and the component count flat.
 */
export function SuggestionCombobox({
    setup,
    onSubmit,
}: {
    readonly setup: GameSetup;
    readonly onSubmit: (draft: DraftSuggestion) => void;
}): React.ReactElement {
    const t = useTranslations("suggestions");
    const inputRef = useRef<HTMLInputElement>(null);
    const [text, setText] = useState("");
    const [caret, setCaret] = useState(0);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    /**
     * Platform detection for the submit modifier key. Mac uses ⌘
     * (metaKey); Windows / Linux use Ctrl (ctrlKey). The key handler
     * accepts either modifier regardless of detected platform, so
     * users on misconfigured machines aren't locked out — detection
     * only drives display copy.
     *
     * SSR-safe: `navigator` is undefined on the server, so we default
     * to `false` (non-Mac label) on first render and correct on the
     * client in a layout effect. This gives a deterministic initial
     * HTML so Next's hydration check doesn't warn.
     */
    const [isMac, setIsMac] = useState(false);
    useEffect(() => {
        if (typeof navigator === "undefined") return;
        setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    }, []);
    const platformKey = isMac ? PLATFORM_MAC : PLATFORM_OTHER;

    const parsed = useMemo(
        () => parseSuggestionInput(text, caret, setup),
        [text, caret, setup],
    );
    const autocomplete = useMemo(
        () => autocompleteFor(parsed, setup),
        [parsed, setup],
    );

    // Clamp highlight when the candidate list shrinks underneath us.
    useEffect(() => {
        if (autocomplete.candidates.length === 0) {
            setHighlightedIndex(0);
        } else if (highlightedIndex >= autocomplete.candidates.length) {
            setHighlightedIndex(autocomplete.candidates.length - 1);
        }
    }, [autocomplete.candidates.length, highlightedIndex]);

    // Autofocus on mount.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const next = e.currentTarget.value;
        setText(next);
        setCaret(e.currentTarget.selectionStart ?? next.length);
        setDropdownOpen(true);
        setHighlightedIndex(0);
    }, []);

    const handleSelect = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
        setCaret(e.currentTarget.selectionStart ?? text.length);
    }, [text.length]);

    const acceptCandidate = useCallback(
        (label: string) => {
            const range = autocomplete.range;
            const start = range ? range[0] : caret;
            const end = range ? range[1] : caret;
            const trailing = trailingSeparatorFor(autocomplete.slot);
            const next =
                text.slice(0, start) + label + trailing + text.slice(end);
            const nextCaret = start + label.length + trailing.length;
            setText(next);
            setCaret(nextCaret);
            setHighlightedIndex(0);
            // Re-open for the next slot (the parser will tell the
            // dropdown what to show).
            setDropdownOpen(true);
            // Defer DOM caret move until after React flushes the new
            // input value.
            queueMicrotask(() => {
                const el = inputRef.current;
                if (!el) return;
                el.focus();
                el.setSelectionRange(nextCaret, nextCaret);
            });
        },
        [autocomplete.range, autocomplete.slot, caret, text],
    );

    const doSubmit = useCallback(() => {
        if (!parsed.draft) return;
        onSubmit(parsed.draft);
        setText("");
        setCaret(0);
        setDropdownOpen(false);
        setHighlightedIndex(0);
        queueMicrotask(() => inputRef.current?.focus());
    }, [onSubmit, parsed.draft]);

    /**
     * Keyboard behaviour:
     *
     *   Key            | Dropdown open         | Dropdown closed
     *   ---------------+-----------------------+-----------------------
     *   Enter          | Accept highlighted    | Close dropdown (no-op)
     *   Tab            | Accept highlighted    | Let browser handle
     *   Cmd/Ctrl+Enter | Submit (if valid)     | Submit (if valid)
     *   Escape         | Close dropdown        | No-op
     *   ArrowDown / Up | Move highlight        | Open + move highlight
     *
     * Enter NEVER submits. This is a deliberate divergence from an
     * earlier iteration where Enter would commit the draft as soon as
     * the required slots resolved — which surprised users who wanted
     * to continue typing the optional sections. In the current model
     * Enter is a typing-affordance key (accept autocomplete or
     * dismiss the dropdown) and Cmd/Ctrl+Enter is the explicit commit
     * gesture. The "Add (⌘↵)" button mirrors this.
     */
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            const candidates = autocomplete.candidates;
            const hasCandidates = dropdownOpen && candidates.length > 0;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (candidates.length === 0) return;
                setDropdownOpen(true);
                setHighlightedIndex(i => (i + 1) % candidates.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                if (candidates.length === 0) return;
                setDropdownOpen(true);
                setHighlightedIndex(
                    i => (i - 1 + candidates.length) % candidates.length,
                );
                return;
            }
            if (e.key === "Escape") {
                if (dropdownOpen) {
                    e.preventDefault();
                    setDropdownOpen(false);
                }
                return;
            }
            if (e.key === "Tab") {
                if (hasCandidates) {
                    e.preventDefault();
                    const cand = candidates[highlightedIndex]!;
                    acceptCandidate(cand.label);
                }
                return;
            }
            // Cmd+Enter (Mac) or Ctrl+Enter (Windows / Linux) is the
            // explicit submit gesture. We accept either modifier
            // regardless of platform detection so misconfigured
            // machines aren't locked out.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (parsed.draft) doSubmit();
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                if (hasCandidates) {
                    const cand = candidates[highlightedIndex]!;
                    acceptCandidate(cand.label);
                } else {
                    setDropdownOpen(false);
                }
                return;
            }
        },
        [
            acceptCandidate,
            autocomplete.candidates,
            doSubmit,
            dropdownOpen,
            highlightedIndex,
            parsed.draft,
        ],
    );

    const placeholder = t("streamlined.placeholder");
    const activeDescId =
        dropdownOpen && autocomplete.candidates.length > 0
            ? `suggestion-combobox-option-${highlightedIndex}`
            : undefined;

    /**
     * Insert a grammar fragment (". Passed by " / ". Refuted by " /
     * " with ") at the end of the input and move the caret there.
     * Used by pill clicks for empty optional slots.
     *
     * The tail is normalised before appending so clicking "Passed by"
     * twice doesn't produce ".. Passed by .. Passed by .." — any
     * existing trailing whitespace or period is trimmed first.
     */
    const insertFragment = useCallback(
        (fragment: string) => {
            const base = text.replace(/[\s.]+$/, "");
            const next = base + fragment;
            setText(next);
            setCaret(next.length);
            setDropdownOpen(true);
            queueMicrotask(() => {
                const el = inputRef.current;
                if (!el) return;
                el.focus();
                el.setSelectionRange(next.length, next.length);
            });
        },
        [text],
    );

    /**
     * Select an existing slot's character range in the input.
     *
     * Why select-range instead of caret-only? A user clicking on a
     * resolved pill almost always wants to REPLACE the value, not
     * insert in the middle of "Player 3". A full selection turns
     * Backspace or any typed character into an immediate replacement.
     */
    const selectSlotRange = useCallback((range: Range) => {
        queueMicrotask(() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(range[0], range[1]);
            setCaret(range[1]);
            setDropdownOpen(true);
        });
    }, []);

    /**
     * Pill click dispatch. Branches on the slot's current state:
     *   - Empty optional (Passed by / Refuted by / Shown card):
     *     insert the grammar fragment at end of input, focus input,
     *     open dropdown. `fallbackFragment` is the hook.
     *   - Empty required (e.g. next card): focus the input at end
     *     (caret will follow typing naturally).
     *   - Non-empty (Resolved / Error / Typing / Ambiguous): select
     *     the slot's range in the input so typing replaces it.
     */
    const onPillClick = useCallback(
        (slot: SlotState<unknown>, fallbackFragment: string | undefined) => {
            if (slot._tag === "Empty") {
                if (fallbackFragment !== undefined) {
                    insertFragment(fallbackFragment);
                    return;
                }
                // Empty required slot — just focus the input. The user
                // is expected to type naturally into it.
                queueMicrotask(() => inputRef.current?.focus());
                setDropdownOpen(true);
                return;
            }
            selectSlotRange(slot.range);
        },
        [insertFragment, selectSlotRange],
    );

    return (
        <div>
            <h3 className="mt-0 mb-2 text-[14px] font-semibold">
                {t("addTitle")}
            </h3>
            <SlotPills
                parsed={parsed}
                setup={setup}
                onPillClick={onPillClick}
            />
            <SlotHint parsed={parsed} setup={setup} platform={platformKey} />
            <div className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={text}
                    onChange={handleInput}
                    onSelect={handleSelect}
                    onKeyUp={handleSelect}
                    onClick={handleSelect}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setDropdownOpen(true)}
                    onBlur={() => setDropdownOpen(false)}
                    placeholder={placeholder}
                    className="w-full rounded border border-border bg-white p-2 font-mono text-[13px] outline-none focus:border-accent"
                    role="combobox"
                    aria-expanded={
                        dropdownOpen && autocomplete.candidates.length > 0
                    }
                    aria-controls="suggestion-combobox-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={activeDescId}
                />
                {dropdownOpen && autocomplete.candidates.length > 0 && (
                    <ul
                        id="suggestion-combobox-listbox"
                        role="listbox"
                        className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-border bg-white p-0 shadow-lg"
                    >
                        {autocomplete.candidates.map((c, i) => (
                            <li
                                key={c.label}
                                id={`suggestion-combobox-option-${i}`}
                                role="option"
                                aria-selected={i === highlightedIndex}
                                className={
                                    "cursor-pointer list-none px-2 py-1 text-[13px]" +
                                    (i === highlightedIndex
                                        ? " bg-accent/15"
                                        : "")
                                }
                                onMouseDown={e => {
                                    e.preventDefault();
                                    acceptCandidate(c.label);
                                }}
                                onMouseEnter={() => setHighlightedIndex(i)}
                            >
                                {c.label}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent p-2 text-white disabled:cursor-not-allowed disabled:bg-unknown"
                    disabled={parsed.draft === null}
                    onClick={doSubmit}
                >
                    {t("streamlined.submit", { platform: platformKey })}
                </button>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[12px] text-muted hover:text-accent"
                    onClick={() => {
                        const example = buildExampleSentence(setup);
                        setText(example);
                        setCaret(example.length);
                        setDropdownOpen(true);
                        queueMicrotask(() => {
                            const el = inputRef.current;
                            if (!el) return;
                            el.focus();
                            el.setSelectionRange(example.length, example.length);
                        });
                    }}
                >
                    {t("streamlined.useExample")}
                </button>
                <span className="text-[12px] text-muted">
                    {t("streamlined.keyboardHint", { platform: platformKey })}
                </span>
            </div>
        </div>
    );
}

 
// Platform discriminator values passed to next-intl ICU `select`
// messages. The strings have to match the `{platform, select, ...}`
// cases in messages/en.json exactly — keeping them as named constants
// gives us a single source of truth and silences no-literal-string.
const PLATFORM_MAC = "mac";
const PLATFORM_OTHER = "other";
 

/**
 * Build a fully-formed example sentence keyed to the current setup.
 * Picks the first available player, first card from each category,
 * and the second + third players as refuter / passer respectively.
 * Falls back gracefully if the setup is too small to populate every
 * optional slot.
 */
const buildExampleSentence = (setup: GameSetup): string => {
    const players = setup.players.map(String);
    const categoryFirstCards = setup.categories.map(c => c.cards[0]?.name);
    if (players.length === 0) return "";
    if (categoryFirstCards.some(n => n === undefined)) return "";
    const suggester = players[0]!;
    const cards = categoryFirstCards.join(", ");
    const passer = players[1];
    const refuter = players[2];
    const seenCard = categoryFirstCards[0]!;
    let out = `${suggester} suggests ${cards}`;
    if (passer !== undefined) out += `. Passed by ${passer}`;
    if (refuter !== undefined) out += `. Refuted by ${refuter} with ${seenCard}`;
    return out;
};

/**
 * One-line helper under the input that tells the user what the
 * parser is currently waiting for, or surfaces a friendly error when
 * the active slot can't resolve. Tightens the feedback loop: the user
 * doesn't have to re-scan the pill row to know why submit is
 * disabled.
 */
function SlotHint({
    parsed,
    setup,
    platform,
}: {
    readonly parsed: ParsedSuggestion;
    readonly setup: GameSetup;
    readonly platform: string;
}): React.ReactElement | null {
    const t = useTranslations("suggestions");

    // Priority 1: an active slot is Unknown or Ambiguous — show the
    // error with nearest candidates / alternative candidates.
    const activeSlotState = getActiveSlotState(parsed);
    if (activeSlotState?._tag === "Unknown") {
        const candidates = activeSlotState.nearestCandidates
            .map(c => c.label)
            .slice(0, 3);
        const joined = candidates.join(", ");
        return (
            <div className="mt-1 text-[12px] text-danger">
                {candidates.length > 0
                    ? t("streamlined.hintUnknownWith", {
                          raw: activeSlotState.raw,
                          suggestions: joined,
                      })
                    : t("streamlined.hintUnknown", {
                          raw: activeSlotState.raw,
                      })}
            </div>
        );
    }
    if (activeSlotState?._tag === "Ambiguous") {
        const candidates = activeSlotState.candidates
            .map(c => c.label)
            .slice(0, 3);
        return (
            <div className="mt-1 text-[12px] text-muted">
                {t("streamlined.hintAmbiguous", {
                    raw: activeSlotState.raw,
                    options: candidates.join(", "),
                })}
            </div>
        );
    }

    // Priority 2: the draft is ready — tell the user the submit
    // shortcut for their platform.
    if (parsed.draft !== null) {
        return (
            <div className="mt-1 text-[12px] text-accent">
                {t("streamlined.hintReady", { platform })}
            </div>
        );
    }

    // Priority 3: show what's expected next based on the active slot.
    const nextHint = nextHintMessage(parsed, setup, t);
    if (nextHint === null) return null;
    return (
        <div className="mt-1 text-[12px] text-muted">{nextHint}</div>
    );
}

const getActiveSlotState = (
    parsed: ParsedSuggestion,
): SlotState<unknown> | null => {
    const { activeSlot } = parsed;
    switch (activeSlot.kind) {
        case "suggester":
            return parsed.suggester;
        case "card":
            return parsed.cards[activeSlot.index] ?? null;
        case "passer":
            return parsed.nonRefuters[activeSlot.index] ?? null;
        case "refuter":
            return parsed.refuter;
        case "seenCard":
            return parsed.seenCard;
        case "done":
            return null;
    }
};

type TFn = (key: string, values?: Record<string, string>) => string;

const nextHintMessage = (
    parsed: ParsedSuggestion,
    setup: GameSetup,
    t: TFn,
): string | null => {
    const { activeSlot } = parsed;
    switch (activeSlot.kind) {
        case "suggester":
            return t("streamlined.hintNextSuggester");
        case "card": {
            const category =
                setup.categories[activeSlot.index]?.name ??
                t("streamlined.pillCardFallback");
            return t("streamlined.hintNextCard", { category });
        }
        case "passer":
            return t("streamlined.hintNextPasser");
        case "refuter":
            return t("streamlined.hintNextRefuter");
        case "seenCard":
            return t("streamlined.hintNextSeenCard");
        case "done":
            return null;
    }
};

/**
 * Separator inserted after a successful autocomplete-accept, based on
 * which slot the user just filled. Chosen to advance the caret into
 * the natural next slot. These are sentence-grammar fragments, not
 * translatable copy — locale routing is explicitly out of scope for
 * this feature, so the strings stay raw.
 */
/* eslint-disable i18next/no-literal-string */
const trailingSeparatorFor = (slot: ActiveSlot): string => {
    switch (slot.kind) {
        case "suggester":
            return " suggests ";
        case "card":
            return ", ";
        case "passer":
            return ", ";
        case "refuter":
            return " with ";
        case "seenCard":
            return "";
        case "done":
            return "";
    }
};

// Grammar fragments inserted by pill clicks on empty optional slots.
// Raw English; see the `trailingSeparatorFor` comment above.
const PASSED_BY_FRAGMENT = ". Passed by ";
const REFUTED_BY_FRAGMENT = ". Refuted by ";
const WITH_FRAGMENT = " with ";
/* eslint-enable i18next/no-literal-string */

/**
 * Four discrete status values for a slot pill. Distinguishing
 * "required but not done" from "optional and not set" is what stops
 * optional pills from looking like they're "already done" when
 * empty.
 */
 
type PillStatus = "done" | "pendingRequired" | "pendingOptional" | "error";

const STATUS_DONE: PillStatus = "done";
const STATUS_PENDING_REQ: PillStatus = "pendingRequired";
const STATUS_PENDING_OPT: PillStatus = "pendingOptional";
const STATUS_ERROR: PillStatus = "error";
 

const statusOfSlot = (
    slot: SlotState<unknown>,
    optional: boolean,
): PillStatus => {
    if (slot._tag === "Resolved") return STATUS_DONE;
    if (slot._tag === "Unknown" || slot._tag === "Ambiguous")
        return STATUS_ERROR;
    return optional ? STATUS_PENDING_OPT : STATUS_PENDING_REQ;
};

/**
 * Unified pill row. Replaces the older "separate checklist + chip
 * preview" layout; the pill now carries both the status icon and the
 * resolved value. Pills render in sentence order (suggester → cards
 * → optional sections) and wrap onto multiple rows on narrow
 * viewports.
 *
 * Visual / state matrix for one pill:
 *
 *   State                        | Icon | Border        | Background   | Text
 *   -----------------------------+------+---------------+--------------+-----
 *   Resolved (required or opt.)  | ✓    | accent solid  | accent solid | white
 *   Required empty               | (∅)  | border solid  | transparent  | muted
 *   Optional empty (enabled)     | +    | border dashed | transparent  | muted
 *   Optional empty (disabled)    | –    | lighter dash  | transparent  | lightest
 *   Error (Unknown / Ambiguous)  | !    | danger        | danger/10    | danger
 *   Typing / partial             | …    | accent dashed | transparent  | muted
 *
 * Optional pills are always rendered (even when empty) so the user
 * can see at a glance what *could* still be added to the suggestion.
 * That discoverability is the core reason the earlier separate
 * checklist existed — now folded into the pill row itself.
 *
 * Optional pills are gated: Passed by / Refuted by become clickable
 * once the required slots (suggester + all cards) resolve, and Shown
 * card additionally waits for the refuter. Gating prevents inserting
 * ". Refuted by " at the top of an empty input (where the parser
 * would treat it as the suggester).
 */
function SlotPills({
    parsed,
    setup,
    onPillClick,
}: {
    readonly parsed: ParsedSuggestion;
    readonly setup: GameSetup;
    readonly onPillClick: (
        slot: SlotState<unknown>,
        fallbackFragment: string | undefined,
    ) => void;
}): React.ReactElement {
    const t = useTranslations("suggestions");

    const suggesterStatus = statusOfSlot(parsed.suggester, false);
    const cardsStatuses = parsed.cards.map(c => statusOfSlot(c, false));
    const refuterStatus = statusOfSlot(parsed.refuter, true);
    const seenStatus = statusOfSlot(parsed.seenCard, true);

    const requiredDone =
        suggesterStatus === STATUS_DONE &&
        cardsStatuses.every(s => s === STATUS_DONE);
    const canAddPassers = requiredDone;
    const canAddRefuter = requiredDone;
    const canAddSeen =
        requiredDone && parsed.refuter._tag === "Resolved";

    // Passers is a list — represent it as a single "Passed by" pill
    // summarising its state. Individual non-refuter tokens show up in
    // the input text itself; the pill is a rollup.
    const passersStatus: PillStatus =
        parsed.nonRefuters.length === 0
            ? STATUS_PENDING_OPT
            : parsed.nonRefuters.some(
                    p => p._tag === "Unknown" || p._tag === "Ambiguous",
                )
              ? STATUS_ERROR
              : parsed.nonRefuters.every(p => p._tag === "Resolved")
                ? STATUS_DONE
                : STATUS_ERROR;
    const passersValue =
        passersStatus === STATUS_DONE
            ? parsed.nonRefuters
                  .map(p => (p._tag === "Resolved" ? p.label : ""))
                  .filter(s => s.length > 0)
                  .join(", ")
            : undefined;

    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            <SlotPill
                status={suggesterStatus}
                label={t("streamlined.pillSuggester")}
                {...(parsed.suggester._tag === "Resolved" && {
                    value: parsed.suggester.label,
                })}
                onClick={() => onPillClick(parsed.suggester, undefined)}
            />
            {parsed.cards.map((slot, i) => (
                <SlotPill
                    key={i}
                    status={cardsStatuses[i]!}
                    label={
                        setup.categories[i]?.name ??
                        t("streamlined.pillCardFallback")
                    }
                    {...(slot._tag === "Resolved" && { value: slot.label })}
                    onClick={() => onPillClick(slot, undefined)}
                />
            ))}
            <SlotPill
                status={passersStatus}
                label={t("streamlined.pillPassers")}
                {...(passersValue !== undefined && { value: passersValue })}
                disabled={!canAddPassers}
                {...(canAddPassers && {
                    onClick: () =>
                        parsed.nonRefuters.length === 0
                            ? onPillClick(EMPTY_SLOT, PASSED_BY_FRAGMENT)
                            : onPillClick(
                                  parsed.nonRefuters[0]!,
                                  PASSED_BY_FRAGMENT,
                              ),
                })}
            />
            <SlotPill
                status={refuterStatus}
                label={t("streamlined.pillRefuter")}
                {...(parsed.refuter._tag === "Resolved" && {
                    value: parsed.refuter.label,
                })}
                disabled={!canAddRefuter}
                {...(canAddRefuter && {
                    onClick: () =>
                        onPillClick(parsed.refuter, REFUTED_BY_FRAGMENT),
                })}
            />
            <SlotPill
                status={seenStatus}
                label={t("streamlined.pillSeen")}
                {...(parsed.seenCard._tag === "Resolved" && {
                    value: parsed.seenCard.label,
                })}
                disabled={!canAddSeen && seenStatus !== STATUS_DONE}
                {...(canAddSeen && {
                    onClick: () => onPillClick(parsed.seenCard, WITH_FRAGMENT),
                })}
                {...(parsed.refuter._tag !== "Resolved" && {
                    disabledHint: t("streamlined.pillSeenDisabledHint"),
                })}
            />
        </div>
    );
}

// Sentinel used when the passers pill is clicked but no tokens exist
// yet — `onPillClick` only needs the `_tag` to decide the
// insert-vs-select branch, not a real range.
const EMPTY_SLOT: SlotState<unknown> = { _tag: "Empty" } as const;

/**
 * Individual pill renderer. See `SlotPills` JSDoc for the full
 * visual / state matrix.
 *
 * Click-target is the whole pill: wrapped in a `<button>` when
 * clickable, or a `<span>` when disabled / inert. `disabledHint`
 * surfaces as a `title=` tooltip when the pill is disabled — e.g.
 * "Add a refuter first" for Shown card.
 */
function SlotPill({
    status,
    label,
    value,
    onClick,
    disabled,
    disabledHint,
}: {
    readonly status: PillStatus;
    readonly label: string;
    readonly value?: string;
    readonly onClick?: () => void;
    readonly disabled?: boolean;
    readonly disabledHint?: string;
}): React.ReactElement {
    const tone =
        status === STATUS_DONE
            ? "bg-accent text-white border-accent"
            : status === STATUS_ERROR
              ? "bg-danger/10 text-danger border-danger"
              : status === STATUS_PENDING_REQ
                ? "bg-transparent text-muted border-border"
                : disabled
                  ? "bg-transparent text-muted/60 border-dashed border-border/50"
                  : "bg-transparent text-muted border-dashed border-border";
    // Icon glyph mirrors the status matrix in the SlotPills JSDoc.
    const iconGlyph =
        status === STATUS_DONE
            ? "✓"
            : status === STATUS_ERROR
              ? "!"
              : status === STATUS_PENDING_OPT
                ? disabled
                    ? "–"
                    : "+"
                : "";
    const pillBody = (
        <span
            className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] " +
                tone
            }
        >
            <span
                aria-hidden
                className="inline-block w-3 text-center text-[10px] leading-3"
            >
                {iconGlyph}
            </span>
            <span className="font-semibold">{label}</span>
            {value !== undefined && (
                <span className="font-normal">: {value}</span>
            )}
        </span>
    );

    if (onClick !== undefined && !disabled) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="cursor-pointer border-none bg-transparent p-0 hover:opacity-80"
            >
                {pillBody}
            </button>
        );
    }
    // Disabled or inert: render as a plain span with an optional
    // tooltip explaining why it can't be clicked yet.
    return (
        <span
            className="cursor-not-allowed"
            title={disabled ? disabledHint : undefined}
        >
            {pillBody}
        </span>
    );
}
