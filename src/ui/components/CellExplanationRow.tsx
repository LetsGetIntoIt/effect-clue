"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
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
import { AlertIcon, CheckIcon, LightbulbIcon, XIcon } from "./Icons";
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
// Observations help-text keys — same hoisting reason. Default copy
// covers any cell; the self-flavoured copy fires when the row is
// opened on the user's own player row.
const KEY_OBS_HELP_DEFAULT = "observationsHelpDefault" as const;
const KEY_OBS_HELP_SELF = "observationsHelpSelf" as const;

// React keys for the body sections array. Hoisted to module scope so
// the `no-literal-string` lint rule reads them as code identifiers.
const SECTION_KEY_OBSERVATIONS = "observations" as const;
const SECTION_KEY_DEDUCTIONS = "deductions" as const;
const SECTION_KEY_LEADS = "leads" as const;
const SECTION_KEY_HYPOTHESIS = "hypothesis" as const;

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
 * any other rows. Sections (Heading, Observations, Deductions, Leads,
 * Hypothesis) map 1:1 to the same three visual badges on the cell so
 * users learn to read the badges without opening the row. All four
 * body sections render unconditionally — sections without content
 * show null-state copy so the layout doesn't shift when content
 * appears (e.g., switching on a hypothesis turns the Deductions
 * section's null state into a populated derivation in place, instead
 * of pushing the Hypothesis section down by adding a new section
 * above it).
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
    const observationsHelpKey =
        observationOwner !== null && observationOwner === selfPlayerId
            ? KEY_OBS_HELP_SELF
            : KEY_OBS_HELP_DEFAULT;

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
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-2 text-[12px] text-danger">
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
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[12px] text-yes">
            <CheckIcon size={14} className="mt-[1px] flex-shrink-0" />
            <span>{longStatusMessage}</span>
        </div>
    );

    const renderHypothesisHelp = () => {
        if (hypothesisValue === undefined) {
            return (
                <p className="text-[12px] leading-snug text-muted">
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
            <div className="flex items-center gap-2 text-[12px] leading-snug text-fg">
                <ProseChecklistIcon
                    value={hypothesisValue}
                    isHypothesis
                    invertedStyle
                    className="!h-5 !w-5 text-[20px]"
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

    const observationsSection = (
        <section className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                {t("observationsLabel")}
            </div>
            {showObservations ? (
                <>
                    <p className="m-0 text-[12px] leading-snug text-muted">
                        {t(observationsHelpKey)}
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                        <input
                            type="checkbox"
                            checked={observed}
                            onChange={e =>
                                onObservationChange(e.currentTarget.checked)
                            }
                            aria-label={t("observationsCheckboxLabel", {
                                owner: ownerLabel(cell.owner),
                                card: cardLabel,
                            })}
                        />
                        <span>
                            {t("observationsCheckboxLabel", {
                                owner: ownerLabel(cell.owner),
                                card: cardLabel,
                            })}
                        </span>
                    </label>
                </>
            ) : (
                <p className="m-0 text-[12px] leading-snug text-muted">
                    {t("observationsEmptyCaseFile")}
                </p>
            )}
        </section>
    );

    const deductionsSection = (
        <section className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                {t("deductionsLabel")}
            </div>
            {showDeductions ? (
                <div className="flex items-start gap-2">
                    <span
                        aria-hidden
                        className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center border border-border text-[12px] font-semibold leading-none ${cellToneClass(display)}`}
                        data-glyph={glyphKindFor(display, status)}
                    >
                        {renderGlyphNode(
                            glyphKindFor(display, status),
                            { compact: true },
                        )}
                    </span>
                    <div className="flex flex-col gap-1">
                        {status.kind === "derived" && (
                            <div className="text-[12px] text-muted">
                                {t(
                                    isDerivedSingular
                                        ? "statusDerivedSingular"
                                        : "statusDerived",
                                )}
                            </div>
                        )}
                        {whyText !== undefined && (
                            <div className="whitespace-pre-line text-[12px] text-muted">
                                {whyText}
                            </div>
                        )}
                        {display.tag === "hypothesis" &&
                            status.kind !== "derived" && (
                                <div className="text-[12px] text-muted">
                                    {t("statusActiveHypothesisCell")}
                                </div>
                            )}
                    </div>
                </div>
            ) : (
                <p className="m-0 text-[12px] leading-snug text-muted">
                    {t("deductionsEmpty")}
                </p>
            )}
        </section>
    );

    const leadsSection = (
        <section className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                {t("leadsLabel")}
            </div>
            {showLeads ? (
                <div className="flex items-start gap-2 text-accent">
                    <span
                        aria-hidden
                        className="inline-flex h-5 flex-shrink-0 items-center gap-[3px] rounded border border-accent/40 px-1.5 text-[12px] font-semibold leading-none text-accent tabular-nums"
                    >
                        <LightbulbIcon size={12} />
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
                <p className="m-0 text-[12px] leading-snug text-muted">
                    {t("leadsEmpty")}
                </p>
            )}
        </section>
    );

    const hypothesisSection = (
        <section className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
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
                    <div className="text-[12px] text-muted">
                        {t("emptyHint")}
                    </div>
                )}
        </section>
    );

    // Layout: centered title strip on top with the close button
    // anchored to the right edge, then all four sections laid out
    // side-by-side with vertical separator lines between them. Every
    // section renders unconditionally — empty ones show null-state
    // copy — so the layout doesn't shift when content fills in. The
    // flex row wraps on narrow viewports so each section keeps a
    // usable minimum width.
    interface BodySection {
        readonly key: string;
        readonly node: ReactNode;
    }
    const bodySections: ReadonlyArray<BodySection> = [
        { key: SECTION_KEY_OBSERVATIONS, node: observationsSection },
        { key: SECTION_KEY_DEDUCTIONS, node: deductionsSection },
        { key: SECTION_KEY_LEADS, node: leadsSection },
        { key: SECTION_KEY_HYPOTHESIS, node: hypothesisSection },
    ];

    return (
        <div className="flex flex-col">
            <div className="relative px-4 py-2">
                <h3 className="m-0 text-center text-[14px] font-semibold uppercase tracking-wide text-fg">
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

                Two-column max with the `:last-child:nth-child(odd)`
                rule (in `globals.css`) spanning the full row when the
                last item is alone — keeps the layout filling cleanly
                without leaving an empty grid cell. Container query
                drops to a single column under 400px wide.
            */}
            <div className="@container/sections">
                <div className="cell-section-grid grid grid-cols-1 gap-px bg-border @[400px]/sections:grid-cols-2">
                    {bodySections.map(section => (
                        <div
                            key={section.key}
                            className="flex flex-col gap-2 bg-panel px-4 py-3"
                        >
                            {section.node}
                        </div>
                    ))}
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
