"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { ownerLabel, type Player } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import type { Cell } from "../../logic/Knowledge";
import { findCardEntry } from "../../logic/GameSetup";
import {
    type CellDisplay,
    type HypothesisMap,
    type HypothesisStatus,
    type HypothesisValue,
} from "../../logic/Hypothesis";
import { HashMap } from "effect";
import {
    AlertIcon,
    CheckIcon,
    ChevronRightIcon,
    LightbulbIcon,
    XIcon,
} from "./Icons";
import { HypothesisControl } from "./HypothesisControl";
import {
    cellToneClass,
    glyphKindFor,
    ProseChecklistIcon,
    renderGlyphNode,
} from "./CellGlyph";

// i18n key tags hoisted to module scope so the `no-literal-string`
// lint rule reads them as code identifiers, not UI text. Each maps a
// hypothesis status to the short above-the-toggle help line that
// echoes the cell's top-right hypothesis badge.
const KEY_HELP_ACTIVE = "selectedHelpActive" as const;
const KEY_HELP_CONFIRMED = "selectedHelpConfirmed" as const;
const KEY_HELP_CONTRADICTED = "selectedHelpContradicted" as const;
const KEY_HELP_JOINTLY_CONFLICTS = "selectedHelpJointlyConflicts" as const;

// Inline style for the observation-disclosure motion.div. Hoisted so
// the object identity is stable across renders, and so the literal
// `"hidden"` value isn't picked up by the `no-literal-string` lint
// rule inside JSX.
const STYLE_OBSERVATION_OVERFLOW = { overflow: "hidden" } as const;

interface CellExplanationRowProps {
    readonly cell: Cell;
    readonly setup: GameSetup;
    readonly display: CellDisplay;
    readonly status: HypothesisStatus;
    readonly hypotheses: HypothesisMap;
    readonly hypothesisValue: HypothesisValue | undefined;
    readonly onHypothesisChange: (next: HypothesisValue | undefined) => void;
    /** Multi-line "why" chain text rendered as the Deductions body. */
    readonly whyText: string | undefined;
    /**
     * Suggestion numbers driving the in-cell top-left lightbulb chip
     * (refuter-candidate footnote). When non-empty, the row renders
     * a Leads section with the same chip + the translated explanation.
     */
    readonly footnoteNumbers: ReadonlyArray<number>;
    /**
     * Observations section state. Mirrors `state.knownCards` for the
     * `(player, card)` pair. Only meaningful for player-owned cells —
     * case-file owners can't be observed.
     */
    readonly observed: boolean;
    readonly onObservationChange: (next: boolean) => void;
    readonly selfPlayerId: Player | null;
    /** Closes the row. Wired to the row's [×] button. */
    readonly onClose: () => void;
}

/**
 * Full-width inline-row content for the checklist's "explain a cell"
 * disclosure. Replaced the per-cell Radix popover so the explanation
 * can take up real estate spanning the whole table without hiding
 * any other rows.
 *
 * Renders three sections in a stable arrangement that never reflows:
 *
 *   - **Deductions** — full-width on row 1 (desktop) or top of stack
 *     (mobile). Hosts the derivation chain / why-text plus a small
 *     "Did you observe this card directly?" disclosure (player-owned
 *     cells only) that wraps the knownCards checkbox. The disclosure
 *     is the only place the user can mark a cell as directly observed;
 *     it lives inside Deductions because direct observation and
 *     deduction together describe everything the solver knows about
 *     the cell.
 *   - **Leads** — row 2 left (desktop) or middle of stack (mobile).
 *   - **Hypothesis** — row 2 right (desktop) or bottom of stack
 *     (mobile). Hosts the Off / Y / N picker + status box.
 *
 * Every section renders unconditionally — sections without content
 * show null-state copy so the layout doesn't shift when content
 * appears (e.g., switching on a hypothesis turns the Deductions
 * section's null state into a populated derivation in place, instead
 * of pushing the Hypothesis section down by adding a new section
 * above it). The same three sections render for player-owned cells
 * and case-file cells alike — only the inner content differs.
 */
export function CellExplanationRow({
    cell,
    setup,
    display,
    status,
    hypotheses,
    hypothesisValue,
    onHypothesisChange,
    whyText,
    footnoteNumbers,
    observed,
    onObservationChange,
    selfPlayerId,
    onClose,
}: CellExplanationRowProps) {
    const t = useTranslations("hypothesis");
    const tDeduce = useTranslations("deduce");

    const cardLabel =
        findCardEntry(setup, cell.card)?.name ?? String(cell.card);

    // Disclosure state for the "Did you observe this card directly?"
    // toggle inside Deductions. Seeded from `observed` so a
    // previously-marked cell shows the checked checkbox without
    // requiring a tap; the user's first interaction with a fresh
    // cell starts collapsed.
    const [observationOpen, setObservationOpen] = useState<boolean>(observed);

    interface ActiveHypothesisEntry {
        readonly ownerName: string;
        readonly cardLabel: string;
        readonly value: HypothesisValue;
    }
    const showHypothesisList = status.kind === "jointlyConflicts";
    const activeHypothesisEntries: ReadonlyArray<ActiveHypothesisEntry> = (() => {
        if (!showHypothesisList) return [];
        const out: Array<ActiveHypothesisEntry> = [];
        for (const [c, v] of hypotheses) {
            const cardLabel =
                findCardEntry(setup, c.card)?.name ?? String(c.card);
            out.push({
                ownerName: ownerLabel(c.owner),
                cardLabel,
                value: v,
            });
        }
        return out;
    })();
    const renderHypothesisEntry = (entry: ActiveHypothesisEntry) => (
        <>
            {entry.ownerName} / {entry.cardLabel}{" "}
            <ProseChecklistIcon value={entry.value} />
        </>
    );
    const entryKey = (entry: ActiveHypothesisEntry): string =>
        `${entry.ownerName}/${entry.cardLabel}/${entry.value}`;

    const isDerivedSingular =
        status.kind === "derived" && HashMap.size(hypotheses) === 1;

    const isContradicted =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";
    const isJointConflict = status.kind === "jointlyConflicts";

    const showDeductions =
        whyText !== undefined ||
        status.kind === "derived" ||
        display.tag === "hypothesis";
    const showLeads = footnoteNumbers.length > 0;
    const showObservations = cell.owner._tag === "Player";
    const observationOwner =
        cell.owner._tag === "Player" ? cell.owner.player : null;
    const isOwnPlayer =
        observationOwner !== null
        && selfPlayerId !== null
        && observationOwner === selfPlayerId;
    const observationCheckboxLabel = isOwnPlayer
        ? t("observationsCheckboxLabelOwn")
        : t("observationsCheckboxLabelOther", {
              player: ownerLabel(cell.owner),
              card: cardLabel,
          });

    const longStatusMessage = (() => {
        switch (status.kind) {
            case "confirmed":
                return t("statusConfirmed");
            case "directlyContradicted":
                return t("statusDirectlyContradicted");
            case "jointlyConflicts":
                return t("statusJointlyConflicts");
            default:
                return undefined;
        }
    })();

    const statusBox = longStatusMessage === undefined ? null : isContradicted &&
      hypothesisValue !== undefined ? (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-2 text-[1.125rem] text-danger">
            <AlertIcon size={14} className="mt-[1px] flex-shrink-0" />
            <div className="flex flex-col gap-1">
                <span>{longStatusMessage}</span>
                {isJointConflict && activeHypothesisEntries.length > 0 && (
                    <ul className="ml-3 list-disc">
                        {activeHypothesisEntries.map(entry => (
                            <li key={entryKey(entry)}>
                                {renderHypothesisEntry(entry)}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    ) : isContradicted ? null : (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[1.125rem] text-yes">
            <CheckIcon size={14} className="mt-[1px] flex-shrink-0" />
            <span>{longStatusMessage}</span>
        </div>
    );

    const renderHypothesisHelp = () => {
        if (hypothesisValue === undefined) {
            return (
                <p className="text-[1.125rem] leading-snug text-muted">
                    {t("helpText")}
                </p>
            );
        }
        const shortKey = (() => {
            switch (status.kind) {
                case "confirmed":
                    return KEY_HELP_CONFIRMED;
                case "directlyContradicted":
                    return KEY_HELP_CONTRADICTED;
                case "jointlyConflicts":
                    return KEY_HELP_JOINTLY_CONFLICTS;
                case "off":
                case "active":
                case "derived":
                default:
                    return KEY_HELP_ACTIVE;
            }
        })();
        return (
            <div className="flex items-center gap-2 text-[1.125rem] leading-snug text-fg">
                <ProseChecklistIcon
                    value={hypothesisValue}
                    isHypothesis
                    invertedStyle
                    className="!h-[24px] !w-[24px] text-[14px]"
                />
                <span>
                    {t.rich(shortKey, {
                        value: hypothesisValue,
                        chip: () => (
                            <ProseChecklistIcon
                                value={hypothesisValue}
                            />
                        ),
                    })}
                </span>
            </div>
        );
    };

    const observationDisclosure = !showObservations ? null : (
        <div className="mt-1">
            <button
                type="button"
                onClick={() => setObservationOpen(o => !o)}
                aria-expanded={observationOpen}
                aria-controls="cell-observation-disclosure"
                className="-ml-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[1.125rem] text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ChevronRightIcon
                    size={12}
                    className={`transition-transform ${observationOpen ? "rotate-90" : ""}`}
                />
                <span>{t("observationsExpandLabel")}</span>
            </button>
            <AnimatePresence initial={false}>
                {observationOpen && (
                    <motion.div
                        key="content"
                        id="cell-observation-disclosure"
                        initial={{ height: 0, opacity: 0 }}
                        // eslint-disable-next-line i18next/no-literal-string -- CSS auto value
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={STYLE_OBSERVATION_OVERFLOW}
                    >
                        <label className="flex cursor-pointer items-center gap-2 pt-2 text-[1.125rem]">
                            <input
                                type="checkbox"
                                checked={observed}
                                onChange={e =>
                                    onObservationChange(
                                        e.currentTarget.checked,
                                    )
                                }
                                aria-label={observationCheckboxLabel}
                            />
                            <span>{observationCheckboxLabel}</span>
                        </label>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    const deductionsSection = (
        <section
            className="flex flex-col gap-2"
            data-tour-anchor="cell-explanation-deductions"
        >
            <div className="text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                {t("deductionsLabel")}
            </div>
            {showDeductions ? (
                <div className="flex items-start gap-2">
                    <span
                        aria-hidden
                        className={`inline-flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center border border-border text-[14px] font-semibold leading-none ${cellToneClass(display)}`}
                        data-glyph={glyphKindFor(display, status)}
                    >
                        {renderGlyphNode(
                            glyphKindFor(display, status),
                            { compact: true },
                        )}
                    </span>
                    <div className="flex flex-col gap-1">
                        {status.kind === "derived" && (
                            <div className="text-[1.125rem] text-muted">
                                {t(
                                    isDerivedSingular
                                        ? "statusDerivedSingular"
                                        : "statusDerived",
                                )}
                            </div>
                        )}
                        {whyText !== undefined && (
                            <div className="whitespace-pre-line text-[1.125rem] text-muted">
                                {whyText}
                            </div>
                        )}
                        {display.tag === "hypothesis" &&
                            status.kind !== "derived" && (
                                <div className="text-[1.125rem] text-muted">
                                    {t("statusActiveHypothesisCell")}
                                </div>
                            )}
                    </div>
                </div>
            ) : (
                <p className="m-0 text-[1.125rem] leading-snug text-muted">
                    {t("deductionsEmpty")}
                </p>
            )}
            {observationDisclosure}
        </section>
    );

    const leadsSection = (
        <section
            className="flex flex-col gap-2"
            data-tour-anchor="cell-explanation-leads"
        >
            <div className="text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                {t("leadsLabel")}
            </div>
            {showLeads ? (
                <div className="flex items-start gap-2 text-accent">
                    <span
                        aria-hidden
                        className="inline-flex h-[24px] flex-shrink-0 items-center gap-[3px] rounded border border-accent/40 px-1.5 text-[12px] font-semibold leading-none text-accent tabular-nums"
                    >
                        <LightbulbIcon size={14} />
                        {footnoteNumbers.join(",")}
                    </span>
                    <span>
                        {tDeduce("footnoteLine", {
                            labels: footnoteNumbers
                                .map(n => `#${n}`)
                                .join(", "),
                        })}
                    </span>
                </div>
            ) : (
                <p className="m-0 text-[1.125rem] leading-snug text-muted">
                    {t("leadsEmpty")}
                </p>
            )}
        </section>
    );

    const hypothesisSection = (
        <section
            className="flex flex-col gap-2"
            data-tour-anchor="cell-explanation-hypothesis"
        >
            <div className="text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                {t("hypothesisLabel")}
            </div>
            {renderHypothesisHelp()}
            <HypothesisControl
                value={hypothesisValue}
                onChange={onHypothesisChange}
                status={status}
            />
            {statusBox}
            {!showDeductions &&
                !showLeads &&
                hypothesisValue === undefined && (
                    <div className="text-[1.125rem] text-muted">
                        {t("emptyHint")}
                    </div>
                )}
        </section>
    );

    // Layout: centered title strip on top with the close button
    // anchored to the right edge, then a fixed 3-section grid.
    // Mobile (1-col, container query <400px): Deductions → Leads →
    // Hypothesis stacked. Desktop (2-col, ≥400px): Deductions
    // full-width on row 1, Leads + Hypothesis side-by-side on row 2.
    // Every section renders unconditionally with null-state copy when
    // empty so the grid never reflows when content fills in.
    return (
        <div className="flex flex-col">
            <div className="relative px-4 py-2">
                <h3 className="m-0 text-center text-[1.25rem] uppercase tracking-[0.05em] text-accent">
                    {t("cellHeading", {
                        owner: ownerLabel(cell.owner),
                        card: cardLabel,
                    })}
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t("closeAria")}
                    className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                >
                    <XIcon size={16} />
                </button>
            </div>
            {/*
                Section grid. The dividers between sections are the
                grid's `gap-px` showing through the parent's `bg-border`
                color — so no section needs its own border, which means
                no "first-in-row" / "leftmost-on-narrow" CSS detection
                problem. Outer edges of the grid sit flush against the
                motion.div's accent border (the gap fills only between
                items, never around them).

                Deductions explicitly spans both columns at the desktop
                breakpoint via `@[400px]/sections:col-span-2`. With a
                fixed 3-section count and Deductions always full-width,
                Leads + Hypothesis always sit side-by-side on row 2 at
                desktop and stacked at mobile — the layout never
                reflows in response to content changes.
            */}
            <div className="@container/sections">
                <div className="grid grid-cols-1 gap-px bg-border @[400px]/sections:grid-cols-2">
                    <div className="flex flex-col gap-2 bg-panel px-4 py-3 @[400px]/sections:col-span-2">
                        {deductionsSection}
                    </div>
                    <div className="flex flex-col gap-2 bg-panel px-4 py-3">
                        {leadsSection}
                    </div>
                    <div className="flex flex-col gap-2 bg-panel px-4 py-3">
                        {hypothesisSection}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Re-export so Checklist consumers can import the helper from one
// place rather than digging for the in-list direct lookup.
export const hypothesisValueFor = (
    hypotheses: HypothesisMap,
    cell: Cell,
): HypothesisValue | undefined => {
    const opt = HashMap.get(hypotheses, cell);
    return opt._tag === "Some" ? opt.value : undefined;
};
