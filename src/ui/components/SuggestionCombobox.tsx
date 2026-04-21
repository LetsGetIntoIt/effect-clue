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
    type SlotState,
} from "../../logic/SuggestionParser";

/**
 * Keyboard-first input for adding a suggestion. One `<input>` where
 * the user types a sentence-shaped suggestion; a combobox dropdown
 * proposes autocompletions for the slot at the caret; a row of chips
 * shows what's already been parsed; and Enter submits when the
 * required slots (suggester + one card per category) are all resolved.
 *
 * Accept keys (Tab / Enter) replace the current raw fragment with the
 * canonical candidate label and add a trailing separator that advances
 * the user to the next slot — so a flow like
 *
 *   "an <Tab> mus <Tab> kn <Tab> kit <Tab> pas bo <Tab> ref ch <Tab> kn <Enter>"
 *
 * lands a full suggestion without leaving the keyboard.
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
            if (e.key === "Enter") {
                e.preventDefault();
                // Prefer submit when the draft is complete AND there's
                // no typing-in-progress ambiguity — so "An<Enter>" would
                // resolve the unique prefix and submit in one stroke.
                if (parsed.draft) {
                    doSubmit();
                    return;
                }
                if (hasCandidates) {
                    const cand = candidates[highlightedIndex]!;
                    acceptCandidate(cand.label);
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

    return (
        <div>
            <h3 className="mt-0 mb-2 text-[14px] font-semibold">
                {t("addTitle")}
            </h3>
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
                        className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded border border-border bg-white p-0 shadow-lg"
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
            <SlotHint parsed={parsed} setup={setup} />
            <ChipPreview parsed={parsed} setup={setup} />
            <SuggestionChecklist parsed={parsed} />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent p-2 text-white disabled:cursor-not-allowed disabled:bg-unknown"
                    disabled={parsed.draft === null}
                    onClick={doSubmit}
                >
                    {t("streamlined.submit")}
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
                    {t("streamlined.keyboardHint")}
                </span>
            </div>
        </div>
    );
}

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
 * A one-line helper under the input that tells the user what the
 * parser is currently waiting for, or surfaces a friendly error when
 * the active slot can't resolve. Tightens the feedback loop: the user
 * doesn't have to scan the chip preview to know why Enter is disabled.
 */
function SlotHint({
    parsed,
    setup,
}: {
    readonly parsed: ParsedSuggestion;
    readonly setup: GameSetup;
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

    // Priority 2: the draft is ready — tell the user to hit Enter.
    if (parsed.draft !== null) {
        return (
            <div className="mt-1 text-[12px] text-accent">
                {t("streamlined.hintReady")}
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
                t("streamlined.chipCardFallback");
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
 * this feature (see plan "Out of scope"), so the strings stay raw.
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
/* eslint-enable i18next/no-literal-string */

function ChipPreview({
    parsed,
    setup,
}: {
    readonly parsed: ParsedSuggestion;
    readonly setup: GameSetup;
}): React.ReactElement | null {
    const t = useTranslations("suggestions");
    const slots: Array<{ label: string; slot: SlotState<unknown> }> = [];

    slots.push({
        label: t("streamlined.chipSuggester"),
        slot: parsed.suggester,
    });
    parsed.cards.forEach((c, i) => {
        slots.push({
            label: t("streamlined.chipCard", {
                category:
                    setup.categories[i]?.name ??
                    t("streamlined.chipCardFallback"),
            }),
            slot: c,
        });
    });
    parsed.nonRefuters.forEach(p => {
        slots.push({
            label: t("streamlined.chipPasser"),
            slot: p,
        });
    });
    if (parsed.refuter._tag !== "Empty") {
        slots.push({
            label: t("streamlined.chipRefuter"),
            slot: parsed.refuter,
        });
    }
    if (parsed.seenCard._tag !== "Empty") {
        slots.push({
            label: t("streamlined.chipSeenCard"),
            slot: parsed.seenCard,
        });
    }

    const hasContent = slots.some(s => s.slot._tag !== "Empty");
    if (!hasContent) return null;

    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {slots.map(({ label, slot }, i) => (
                <Chip key={i} label={label} slot={slot} />
            ))}
        </div>
    );
}

function Chip({
    label,
    slot,
}: {
    readonly label: string;
    readonly slot: SlotState<unknown>;
}): React.ReactElement | null {
    const t = useTranslations("suggestions");
    if (slot._tag === "Empty") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-2 py-0.5 text-[12px] text-muted">
                {label}
            </span>
        );
    }
    const tone =
        slot._tag === "Resolved"
            ? "bg-accent text-white border-accent"
            : slot._tag === "Unknown"
              ? "bg-danger/10 text-danger border-danger"
              : "bg-panel text-foreground border-border";
    const display =
        slot._tag === "Resolved"
            ? slot.label
            : slot._tag === "Typing"
              ? slot.raw
              : slot._tag === "Ambiguous"
                ? slot.raw
                : slot.raw;
    const extra =
        slot._tag === "Typing" || slot._tag === "Ambiguous"
            ? ` ${t("streamlined.chipTyping")}`
            : slot._tag === "Unknown"
              ? ` ${t("streamlined.chipUnknown")}`
              : "";
    return (
        <span
            className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] " +
                tone
            }
        >
            <span className="font-semibold">{label}:</span>
            <span>{display}</span>
            {extra && <span className="opacity-75">{extra}</span>}
        </span>
    );
}

function SuggestionChecklist({
    parsed,
}: {
    readonly parsed: ParsedSuggestion;
}): React.ReactElement {
    const t = useTranslations("suggestions");
    const total = parsed.cards.length;
    const resolvedCards = parsed.cards.filter(
        c => c._tag === "Resolved",
    ).length;

    const suggesterDone = parsed.suggester._tag === "Resolved";
    const cardsDone = resolvedCards === total && total > 0;
    const passersDone =
        parsed.nonRefuters.length === 0 ||
        parsed.nonRefuters.every(p => p._tag === "Resolved");
    const refuterResolved = parsed.refuter._tag === "Resolved";
    const seenResolved = parsed.seenCard._tag === "Resolved";
    const refuterDone =
        parsed.refuter._tag === "Empty" ||
        (refuterResolved &&
            (parsed.seenCard._tag === "Empty" || seenResolved));

    return (
        <ul className="mt-2 m-0 list-none p-0 text-[12px]">
            <ChecklistItem
                done={suggesterDone}
                label={t("streamlined.checklist.suggester")}
            />
            <ChecklistItem
                done={cardsDone}
                label={t("streamlined.checklist.cards", {
                    filled: resolvedCards,
                    total,
                })}
            />
            <ChecklistItem
                done={passersDone}
                label={t("streamlined.checklist.passers", {
                    count: parsed.nonRefuters.length,
                })}
            />
            <ChecklistItem
                done={refuterDone}
                label={
                    parsed.refuter._tag === "Empty"
                        ? t("streamlined.checklist.refuterOptional")
                        : seenResolved
                          ? t("streamlined.checklist.refuterWithCard")
                          : refuterResolved
                            ? t("streamlined.checklist.refuterNeedsCard")
                            : t("streamlined.checklist.refuterPartial")
                }
            />
        </ul>
    );
}

function ChecklistItem({
    done,
    label,
}: {
    readonly done: boolean;
    readonly label: string;
}): React.ReactElement {
    return (
        <li className="flex items-center gap-1.5 py-0.5">
            <span
                aria-hidden
                className={
                    "inline-block h-3.5 w-3.5 rounded-sm border text-center leading-3 " +
                    (done
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-transparent text-transparent")
                }
            >
                {done ? "✓" : ""}
            </span>
            <span className={done ? "text-foreground" : "text-muted"}>
                {label}
            </span>
        </li>
    );
}

