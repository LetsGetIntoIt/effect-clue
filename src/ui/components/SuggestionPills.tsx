"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "motion/react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { Card, Player } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import { T_FAST, T_SPRING_SOFT, useReducedTransition } from "../motion";

const MOTION_POP_LAYOUT: "popLayout" = "popLayout";
import { Tooltip } from "./Tooltip";
import { matches } from "../keyMap";

/**
 * Shared pill primitives for both the Add-a-suggestion form and the
 * inline-edit pills on prior suggestion rows. Pulled out of
 * `SuggestionForm.tsx` so both surfaces render the same chip + popover
 * + keyboard-driven list.
 *
 * The form-specific state machine (pill sequence, auto-advance,
 * Cmd+Enter submit) stays in `SuggestionForm`; this module is the
 * dumb, reusable half.
 */

// ---- "Nobody" sentinel ------------------------------------------------

/**
 * Explicit "no one / no card" marker for optional slots. Distinct
 * from `null` ("not decided yet"): `NOBODY` means the user made an
 * active choice not to name anyone, so the pill renders with a `✓`
 * rather than the dashed-outline optional-empty style.
 */
export const NOBODY = Object.freeze({ kind: "nobody" as const });
export type Nobody = typeof NOBODY;

export const isNobody = (v: unknown): v is Nobody => v === NOBODY;

// ---- Pill status ------------------------------------------------------

type PillStatus =
    | "done"
    | "pendingRequired"
    | "pendingOptional"
    | "error";

const STATUS_DONE: PillStatus = "done";
const STATUS_PENDING_REQ: PillStatus = "pendingRequired";
const STATUS_PENDING_OPT: PillStatus = "pendingOptional";

export const pillStatusForPlayer = (
    value: Player | Nobody | null,
    optional: boolean,
): PillStatus =>
    value === null
        ? optional
            ? STATUS_PENDING_OPT
            : STATUS_PENDING_REQ
        : STATUS_DONE;

export const pillStatusForCard = (
    value: Card | Nobody | null,
    optional: boolean,
): PillStatus =>
    value === null
        ? optional
            ? STATUS_PENDING_OPT
            : STATUS_PENDING_REQ
        : STATUS_DONE;

export const pillStatusForPassers = (
    value: ReadonlyArray<Player> | Nobody | null,
): PillStatus =>
    value === null
        ? STATUS_PENDING_OPT
        : Array.isArray(value) && value.length === 0
          ? STATUS_PENDING_OPT
          : STATUS_DONE;

// ---- Display helpers --------------------------------------------------

type TFn = (key: string, values?: Record<string, string>) => string;

export const displayPlayer = (value: Player | null): string | undefined =>
    value === null ? undefined : String(value);

export const displayCard = (
    value: Card | null,
    setup: GameSetup,
): string | undefined => {
    if (value === null) return undefined;
    for (const cat of setup.categories) {
        const entry = cat.cards.find(e => e.id === value);
        if (entry !== undefined) return entry.name;
    }
    return String(value);
};

// Pill value-chip text ("...: nobody" / "...: unknown") is
// intentionally shorter than the popover row label ("Nobody
// refuted", "Unknown / unseen"). The pill's own label already
// supplies the context ("Refuted by:", "Shown card:") so the chip
// only needs the noun.
export const displayPlayerOpt = (
    value: Player | Nobody | null,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueNobody");
    return String(value);
};

export const displayCardOpt = (
    value: Card | Nobody | null,
    setup: GameSetup,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueUnknown");
    return displayCard(value, setup);
};

export const displayPassers = (
    value: ReadonlyArray<Player> | Nobody | null,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueNobody");
    if (value.length === 0) return undefined;
    return Array.from(new Set(value.map(String))).join(", ");
};

// ---- Candidate options ------------------------------------------------

export interface Option<T> {
    readonly value: T;
    readonly label: string;
}

/**
 * Walk up from the given element to check whether it lives inside one
 * of this module's popover portals. Useful for document-level
 * keydown listeners in caller components that want to scope a
 * shortcut to "focus is in our form or its popover".
 */
export const isInsideSuggestionPopover = (el: Element): boolean =>
    el.closest("[data-suggestion-form-popover='true']") !== null;

// ---- PillPopover — pill body + Radix wrapper ------------------------

/**
 * One pill + its popover, bound together. The pill itself is the
 * Radix Popover Trigger; the candidate list lives inside Radix
 * Popover Content (portalled to `document.body`).
 *
 * `variant`:
 *   - "default": regular parchment theme
 *   - "onAccent": used when the pill is sitting on a red-accent
 *     background (hovered prior-suggestion card); inverts colours so
 *     filled pills are light-on-red and empty ones read as light
 *     placeholders.
 *
 * `onClear`: optional clear-affordance. When provided AND the pill
 * is in `STATUS_DONE`, renders a tiny × after the value. Used by
 * the prior-suggestion edit pills so users can unset an optional
 * field (refuter / shown card / passers) without opening the
 * popover.
 */
export function PillPopover({
    pillId,
    label,
    status,
    valueDisplay,
    disabled,
    disabledHint,
    open,
    onOpenChange,
    variant = "default",
    onClear,
    children,
}: {
    readonly pillId: string;
    readonly label: string;
    readonly status: PillStatus;
    readonly valueDisplay: string | undefined;
    readonly disabled?: boolean;
    readonly disabledHint?: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly variant?: "default" | "onAccent";
    readonly onClear?: () => void;
    readonly children: React.ReactNode;
}): React.ReactElement {
    // Pill visual classes by status. Required vs. optional is
    // distinguished by the OUTLINE style (solid vs. dashed) — NOT by
    // the icon. Both empty-required and empty-optional pills show a
    // `+` glyph to invite the user to fill them in. A disabled
    // optional pill (e.g. Shown card without a refuter) fades and
    // swaps to `–` to signal it's currently unavailable.
    //
    // Matrix (default variant):
    //   status            | outline       | icon
    //   ------------------+---------------+-----
    //   done              | solid accent  | ✓
    //   pendingRequired   | solid border  | +
    //   pendingOptional   | dashed border | +      (disabled → "–")
    //   error (reserved)  | danger        | !
    const tone =
        variant === "onAccent"
            ? status === STATUS_DONE
                ? "bg-panel text-accent border-panel"
                : status === STATUS_PENDING_REQ
                  ? "bg-transparent text-white/80 border-white/60"
                  : disabled
                    ? "bg-transparent text-white/40 border-dashed border-white/40 cursor-not-allowed"
                    : "bg-transparent text-white/80 border-dashed border-white/70"
            : status === STATUS_DONE
              ? "bg-accent text-white border-accent"
              : status === STATUS_PENDING_REQ
                ? "bg-transparent text-muted border-border"
                : disabled
                  ? "bg-transparent text-muted/60 border-dashed border-border/50 cursor-not-allowed"
                  : "bg-transparent text-muted border-dashed border-border";
    const iconGlyph =
        status === STATUS_DONE
            ? "✓"
            : status === STATUS_PENDING_OPT && disabled
              ? "–"
              : "+";
    const showClear = onClear !== undefined && status === STATUS_DONE;
    const iconTransition = useReducedTransition(T_FAST);
    const widthTransition = useReducedTransition(T_SPRING_SOFT);
    const pillBody = (
        <motion.span
            layout
            transition={widthTransition}
            className={
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] " +
                tone
            }
        >
            <span
                aria-hidden
                className="relative inline-block w-3 overflow-hidden text-center text-[10px] leading-3"
            >
                <AnimatePresence mode={MOTION_POP_LAYOUT} initial={false}>
                    <motion.span
                        key={iconGlyph}
                        initial={{ y: -8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 8, opacity: 0 }}
                        transition={iconTransition}
                        className="inline-block"
                    >
                        {iconGlyph}
                    </motion.span>
                </AnimatePresence>
            </span>
            <span className="font-semibold">{label}</span>
            {valueDisplay !== undefined && (
                <span className="font-normal">: {valueDisplay}</span>
            )}
            {showClear && (
                <span
                    role="button"
                    aria-label={`Clear ${label}`}
                    tabIndex={-1}
                    className="ml-0.5 inline-block w-3 cursor-pointer text-center text-[12px] leading-3 opacity-70 hover:opacity-100"
                    onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClear!();
                    }}
                    onMouseDown={e => {
                        // Prevent Radix Trigger from toggling the
                        // popover when the × is clicked.
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                >
                    ×
                </span>
            )}
        </motion.span>
    );

    if (disabled) {
        // Disabled: don't mount the popover at all. Render the pill
        // as a span so hover can still surface the disabledHint
        // tooltip via the project Tooltip wrapper.
        return (
            <Tooltip content={disabledHint}>
                <span className="cursor-not-allowed">{pillBody}</span>
            </Tooltip>
        );
    }

    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger
                data-pill-id={pillId}
                data-animated-focus
                className={
                    "cursor-pointer rounded-full border-none bg-transparent p-0 " +
                    "hover:opacity-80 " +
                    "focus:outline-none " +
                    // While the dropdown is open, real focus is inside
                    // the list — pin the ring on the trigger anyway so
                    // the user can see which pill they're editing.
                    (open
                        ? "ring-2 ring-accent ring-offset-2 ring-offset-panel"
                        : "")
                }
            >
                {pillBody}
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    data-suggestion-form-popover="true"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => {
                        // Let our own list focus its first option —
                        // Radix's default is "focus the content
                        // container" which traps arrow keys.
                        e.preventDefault();
                    }}
                    onCloseAutoFocus={e => {
                        // During auto-advance, the next popover's
                        // list is already focused by the time our
                        // close fires; if we let Radix restore focus
                        // to *this* trigger now it would steal focus
                        // from that list. Detect by checking whether
                        // the active element is inside another of
                        // our popovers — if yes, suppress Radix's
                        // default. If no (Esc / outside click /
                        // selection with no next pill), let Radix
                        // do its thing so the user lands back on
                        // the trigger with a visible focus ring.
                        const active = document.activeElement;
                        if (
                            active instanceof HTMLElement &&
                            active.closest(
                                "[data-suggestion-form-popover='true']",
                            ) !== null
                        ) {
                            e.preventDefault();
                        }
                    }}
                    onInteractOutside={e => {
                        // Auto-advance triggers a stray "outside
                        // interaction" on the newly-opened popover
                        // (as the prior one unmounts). Swallow the
                        // close only when the interaction's target
                        // is another pill trigger or another of our
                        // popovers — anything genuinely outside the
                        // form still closes naturally via Radix.
                        const target = e.target as Element | null;
                        if (
                            target !== null &&
                            target.closest(
                                "[data-pill-id],[data-suggestion-form-popover='true']",
                            ) !== null
                        ) {
                            e.preventDefault();
                        }
                    }}
                    className="z-50 min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[13px] shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                >
                    {children}
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}

// ---- SingleSelectList ------------------------------------------------

/**
 * Keyboard-driven single-select list for popover content.
 *
 *   Up / Down — move focus
 *   Enter / Space — commit highlighted option (or Nobody row)
 *   Home / End — jump to first / last
 *
 * Auto-focuses the currently-selected option on mount (or the first
 * option if nothing is selected yet). `nobodyLabel` + `nobodyValue`
 * add a trailing "none" row for optional slots; pass `null` for both
 * to omit.
 */
export function SingleSelectList<T>({
    options,
    selected,
    onCommit,
    nobodyLabel,
    nobodyValue,
}: {
    readonly options: ReadonlyArray<Option<T>>;
    readonly selected: T | null;
    readonly onCommit: (value: T | Nobody) => void;
    readonly nobodyLabel: string | null;
    readonly nobodyValue: Nobody | null;
}): React.ReactElement {
    const rows = useMemo<
        ReadonlyArray<
            | { readonly kind: "option"; readonly option: Option<T> }
            | {
                  readonly kind: "nobody";
                  readonly label: string;
                  readonly value: Nobody;
              }
        >
    >(
        () => [
            ...options.map(o => ({ kind: "option" as const, option: o })),
            ...(nobodyLabel !== null && nobodyValue !== null
                ? [
                      {
                          kind: "nobody" as const,
                          label: nobodyLabel,
                          value: nobodyValue,
                      },
                  ]
                : []),
        ],
        [options, nobodyLabel, nobodyValue],
    );

    const initialIdx = useMemo(() => {
        if (selected !== null) {
            const idx = options.findIndex(o => o.value === selected);
            if (idx >= 0) return idx;
        }
        return 0;
    }, [selected, options]);
    const [focusedIdx, setFocusedIdx] = useState(initialIdx);

    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        listRef.current?.focus();
    }, []);

    const commitAt = useCallback(
        (i: number) => {
            const row = rows[i];
            if (row === undefined) return;
            if (row.kind === "option") onCommit(row.option.value);
            else onCommit(row.value);
        },
        [rows, onCommit],
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
        const native = e.nativeEvent;
        if (matches("nav.down", native)) {
            e.preventDefault();
            setFocusedIdx(i => (i + 1) % Math.max(rows.length, 1));
            return;
        }
        if (matches("nav.up", native)) {
            e.preventDefault();
            setFocusedIdx(i =>
                (i - 1 + rows.length) % Math.max(rows.length, 1),
            );
            return;
        }
        if (matches("nav.home", native)) {
            e.preventDefault();
            setFocusedIdx(0);
            return;
        }
        if (matches("nav.end", native)) {
            e.preventDefault();
            setFocusedIdx(Math.max(rows.length - 1, 0));
            return;
        }
        if (matches("action.toggle", native)) {
            e.preventDefault();
            commitAt(focusedIdx);
            return;
        }
    };

    return (
        <ul
            ref={listRef}
            role="listbox"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="m-0 max-h-[240px] list-none overflow-y-auto p-0 outline-none"
        >
            {rows.map((row, i) => {
                const isSelected =
                    row.kind === "option"
                        ? row.option.value === selected
                        : selected === null && nobodyValue !== null;
                const highlighted = i === focusedIdx;
                return (
                    <li
                        key={i}
                        role="option"
                        aria-selected={isSelected}
                        className={
                            "flex cursor-pointer items-center gap-1.5 rounded px-3 py-2 text-[13px]" +
                            (highlighted ? " bg-accent/15" : "") +
                            (row.kind === "nobody"
                                ? " border-t border-border/60 text-muted"
                                : "")
                        }
                        onMouseEnter={() => setFocusedIdx(i)}
                        onMouseDown={e => {
                            e.preventDefault();
                            commitAt(i);
                        }}
                    >
                        {row.kind === "option" ? row.option.label : row.label}
                    </li>
                );
            })}
        </ul>
    );
}

// ---- MultiSelectList -------------------------------------------------

/**
 * Keyboard-driven multi-select list for the passers popover.
 *
 *   Up / Down — move focus
 *   Space — toggle focused option
 *   Enter — commit current set and advance to the next pill
 *   Esc / click-outside — commit current set WITHOUT advancing
 *
 * Commit-on-close semantics: the popover accumulates toggles locally
 * (unlike single-select which commits on the first click). Any way
 * of closing the popover — Enter, Esc, outside click, clicking
 * another pill — persists what was toggled so far. The difference
 * between Enter and the other close paths is whether we advance to
 * the next pill: Enter advances, the other paths just commit.
 *
 * A terminal "Nobody passed" radio-style row clears all toggles and
 * records the explicit NOBODY sentinel immediately.
 */
export function MultiSelectList({
    options,
    selected,
    nobodyChosen,
    nobodyLabel,
    commitHint,
    onCommit,
}: {
    readonly options: ReadonlyArray<Option<Player>>;
    readonly selected: ReadonlyArray<Player>;
    readonly nobodyChosen: boolean;
    readonly nobodyLabel: string;
    readonly commitHint: string;
    readonly onCommit: (
        value: ReadonlyArray<Player> | Nobody,
        opts?: { advance: boolean },
    ) => void;
}): React.ReactElement {
    const [toggled, setToggled] = useState<ReadonlyArray<Player>>(selected);
    const [focusedIdx, setFocusedIdx] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        listRef.current?.focus();
    }, []);

    // On unmount, persist the toggled set without advancing. Covers
    // Esc, outside-click, and clicking another pill. `committedRef`
    // is set by the Enter / Nobody commit paths to skip this cleanup
    // so those don't double-commit.
    const toggledRef = useRef<ReadonlyArray<Player>>(toggled);
    toggledRef.current = toggled;
    const committedRef = useRef(false);
    useEffect(
        () => () => {
            if (committedRef.current) return;
            onCommit(toggledRef.current, { advance: false });
        },
        [onCommit],
    );
    const commitAdvance = (
        value: ReadonlyArray<Player> | Nobody,
    ): void => {
        committedRef.current = true;
        onCommit(value);
    };

    const rowCount = options.length + 1; // + "nobody" row
    const isNobodyRow = (i: number) => i === options.length;

    const toggle = (player: Player) => {
        setToggled(prev =>
            prev.some(p => p === player)
                ? prev.filter(p => p !== player)
                : [...prev, player],
        );
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
        const native = e.nativeEvent;
        if (matches("nav.down", native)) {
            e.preventDefault();
            setFocusedIdx(i => (i + 1) % rowCount);
            return;
        }
        if (matches("nav.up", native)) {
            e.preventDefault();
            setFocusedIdx(i => (i - 1 + rowCount) % rowCount);
            return;
        }
        if (matches("nav.home", native)) {
            e.preventDefault();
            setFocusedIdx(0);
            return;
        }
        if (matches("nav.end", native)) {
            e.preventDefault();
            setFocusedIdx(rowCount - 1);
            return;
        }
        // Space toggles the focused row without advancing; Enter
        // commits the whole set and advances to the next pill. We
        // want those semantics to stay distinct, so check the raw
        // keys directly rather than using the combined action.toggle
        // binding.
        if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            if (isNobodyRow(focusedIdx)) {
                commitAdvance(NOBODY);
                return;
            }
            const opt = options[focusedIdx];
            if (opt !== undefined) toggle(opt.value);
            return;
        }
        if (matches("action.commit", native)) {
            e.preventDefault();
            if (isNobodyRow(focusedIdx)) {
                commitAdvance(NOBODY);
            } else {
                commitAdvance(toggled);
            }
            return;
        }
    };

    return (
        <div>
            <ul
                ref={listRef}
                role="listbox"
                aria-multiselectable
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="m-0 max-h-[240px] list-none overflow-y-auto p-0 outline-none"
            >
                {options.map((opt, i) => {
                    const checked = toggled.some(p => p === opt.value);
                    const highlighted = i === focusedIdx;
                    return (
                        <li
                            key={String(opt.value)}
                            role="option"
                            aria-selected={checked}
                            className={
                                "flex cursor-pointer items-center gap-1.5 rounded px-3 py-2 text-[13px]" +
                                (highlighted ? " bg-accent/15" : "")
                            }
                            onMouseEnter={() => setFocusedIdx(i)}
                            onMouseDown={e => {
                                e.preventDefault();
                                toggle(opt.value);
                            }}
                        >
                            <span
                                aria-hidden
                                className={
                                    "inline-block h-3.5 w-3.5 rounded-sm border text-center text-[10px] leading-3 " +
                                    (checked
                                        ? "border-accent bg-accent text-white"
                                        : "border-border bg-transparent text-transparent")
                                }
                            >
                                {checked ? "✓" : ""}
                            </span>
                            {opt.label}
                        </li>
                    );
                })}
                <li
                    role="option"
                    aria-selected={nobodyChosen}
                    className={
                        "flex cursor-pointer items-center gap-1.5 rounded border-t border-border/60 px-3 py-2 text-[13px] text-muted" +
                        (focusedIdx === options.length
                            ? " bg-accent/15"
                            : "")
                    }
                    onMouseEnter={() => setFocusedIdx(options.length)}
                    onMouseDown={e => {
                        e.preventDefault();
                        commitAdvance(NOBODY);
                    }}
                >
                    {nobodyLabel}
                </li>
            </ul>
            <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-muted">
                <span>{commitHint}</span>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-white px-2 py-0.5 text-[11px]"
                    onMouseDown={e => {
                        e.preventDefault();
                        commitAdvance(toggled);
                    }}
                >
                    OK
                </button>
            </div>
        </div>
    );
}
