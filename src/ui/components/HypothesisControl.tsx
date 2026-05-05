"use client";

import { useTranslations } from "next-intl";
import { useCallback, useId, useRef } from "react";
import type { HypothesisStatus, HypothesisValue } from "../../logic/Hypothesis";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { label } from "../keyMap";

interface HypothesisControlProps {
    readonly value: HypothesisValue | undefined;
    readonly onChange: (next: HypothesisValue | undefined) => void;
    readonly status: HypothesisStatus;
    readonly disabled?: boolean;
}

// Internal tags for the three option positions. Module-scope so the
// `no-literal-string` lint rule sees them as code identifiers, not UI
// text — the user-visible labels come from the i18n namespace below.
const OPT_OFF = "off" as const;
const OPT_Y = "Y" as const;
const OPT_N = "N" as const;
type Option = typeof OPT_OFF | typeof OPT_Y | typeof OPT_N;

// Keymap binding IDs. Hoisted so the `no-literal-string` lint rule
// reads them as code, not UI text.
const SHORTCUT_OFF = "hypothesis.setOff" as const;
const SHORTCUT_Y = "hypothesis.setY" as const;
const SHORTCUT_N = "hypothesis.setN" as const;

const OPTIONS: ReadonlyArray<Option> = [OPT_OFF, OPT_Y, OPT_N];

const optionFromValue = (value: HypothesisValue | undefined): Option =>
    value === undefined ? OPT_OFF : value;

const valueFromOption = (option: Option): HypothesisValue | undefined =>
    option === OPT_OFF ? undefined : option;

const baseButtonClass =
    "flex-1 px-3 py-1 text-[12px] font-semibold cursor-pointer " +
    "border-2 border-border bg-panel text-muted " +
    "transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:z-10 " +
    "disabled:cursor-default disabled:opacity-50";

// The `!` prefix forces these utilities to !important. Without it,
// Tailwind's CSS source order has `.bg-panel` (from the base class)
// win against `.bg-no-bg` and `.bg-row-header`, since `--color-panel`
// is declared earlier in the @theme block than those tokens —
// same-specificity ties go to the later rule, but here our overrides
// come earlier. `bg-yes-bg` happens to be declared after `bg-panel`
// so it wins naturally; the `!` on the other two just makes them
// consistent.
const SELECTED_Y_CLASSES = " bg-yes-bg text-yes !border-yes";
const SELECTED_N_CLASSES = " !bg-no-bg text-no !border-no";
const SELECTED_OFF_CLASSES = " !bg-row-header text-fg !border-muted";

// Border-collapse helpers (extracted so the no-literal-string lint
// rule reads them as code rather than UI text).
const COLLAPSE_CLASS_FIRST = " relative";
const COLLAPSE_CLASS_INNER = " -ml-[2px] relative";
const STACK_CLASS_SELECTED = " z-[1]";

const selectedClassFor = (option: Option): string => {
    switch (option) {
        case OPT_Y:
            return SELECTED_Y_CLASSES;
        case OPT_N:
            return SELECTED_N_CLASSES;
        case OPT_OFF:
            return SELECTED_OFF_CLASSES;
    }
};

/**
 * Three-button segmented control for the per-cell hypothesis value:
 * `—` (off — no hypothesis), `Y` (assume the cell is Y), `N` (assume
 * the cell is N).
 *
 * Implements the WAI-ARIA radiogroup pattern: tab into the group lands
 * on the currently-selected option, ArrowLeft/Right cycle through
 * options, Home/End jump to the ends, Space/Enter commit the focused
 * option (and a click acts the same).
 */
export function HypothesisControl({
    value,
    onChange,
    status,
    disabled = false,
}: HypothesisControlProps) {
    const t = useTranslations("hypothesis");
    const groupId = useId();
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const current = optionFromValue(value);
    const hasKeyboard = useHasKeyboard();

    const focusOption = useCallback((option: Option) => {
        const idx = OPTIONS.indexOf(option);
        const el = buttonRefs.current[idx];
        if (el) el.focus();
    }, []);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLButtonElement>, option: Option) => {
            const idx = OPTIONS.indexOf(option);
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const next = OPTIONS[(idx - 1 + OPTIONS.length) % OPTIONS.length]!;
                onChange(valueFromOption(next));
                focusOption(next);
            } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const next = OPTIONS[(idx + 1) % OPTIONS.length]!;
                onChange(valueFromOption(next));
                focusOption(next);
            } else if (e.key === "Home") {
                e.preventDefault();
                const next = OPTIONS[0]!;
                onChange(valueFromOption(next));
                focusOption(next);
            } else if (e.key === "End") {
                e.preventDefault();
                const next = OPTIONS[OPTIONS.length - 1]!;
                onChange(valueFromOption(next));
                focusOption(next);
            }
        },
        [onChange, focusOption],
    );

    const labelFor = (option: Option): string => {
        if (option === OPT_OFF) return t("optionOff");
        if (option === OPT_Y) return t("optionY");
        return t("optionN");
    };

    const isContradicted =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";

    return (
        <div className="flex flex-col gap-1">
            <div
                role="radiogroup"
                aria-label={t("groupLabel")}
                aria-describedby={`${groupId}-status`}
                className="inline-flex w-full overflow-hidden rounded-[var(--radius)]"
            >
                {OPTIONS.map((option, idx) => {
                    const isSelected = current === option;
                    // Border-collapse: pull each button after the
                    // first 2px to the left so adjacent borders
                    // overlap (no double-thick seam between buttons).
                    // The selected button needs `z-10` so its
                    // coloured border paints on top of its neighbours'
                    // grey borders.
                    const collapseClass =
                        idx > 0 ? COLLAPSE_CLASS_INNER : COLLAPSE_CLASS_FIRST;
                    const stackClass = isSelected ? STACK_CLASS_SELECTED : "";
                    const className =
                        baseButtonClass +
                        (isSelected ? selectedClassFor(option) : "") +
                        (isSelected && isContradicted
                            ? " ring-2 ring-danger ring-inset"
                            : "") +
                        collapseClass +
                        stackClass;
                    return (
                        <button
                            key={option}
                            ref={el => {
                                buttonRefs.current[idx] = el;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            tabIndex={isSelected ? 0 : -1}
                            disabled={disabled}
                            className={className}
                            onClick={() => onChange(valueFromOption(option))}
                            onKeyDown={e => onKeyDown(e, option)}
                        >
                            {labelFor(option)}
                        </button>
                    );
                })}
            </div>
            {hasKeyboard && (
                <p className="text-[11px] text-muted">
                    {t("shortcutHint", {
                        off: label(SHORTCUT_OFF),
                        y: label(SHORTCUT_Y),
                        n: label(SHORTCUT_N),
                    })}
                </p>
            )}
        </div>
    );
}
