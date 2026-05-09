"use client";

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
import { AlertIcon, CheckIcon, LightbulbIcon } from "./Icons";
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
// covers any cell; the self-flavoured copy fires when the popover is
// opened on the user's own row.
const KEY_OBS_HELP_DEFAULT = "observationsHelpDefault" as const;
const KEY_OBS_HELP_SELF = "observationsHelpSelf" as const;

interface CellWhyPopoverProps {
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
     * (refuter-candidate footnote). When non-empty, the popover renders
     * a Leads section with the same chip + the translated explanation.
     */
    readonly footnoteNumbers: ReadonlyArray<number>;
    /**
     * Observations section state (M9). The cell shows whether the
     * user has manually marked this `(player, card)` pair as a fact
     * — pre-populated from Game Setup, kept separate from suggestion-
     * derived knowledge.
     *
     * `observed` mirrors `state.knownCards.some(kc => kc.player === ...
     * && kc.card === ...)`. `onObservationChange(true)` dispatches
     * `addKnownCard`; `onObservationChange(false)` dispatches
     * `removeKnownCard` with the matching index. Both wired by the
     * Checklist parent.
     *
     * Hidden entirely for case-file owner cells — only the deducer
     * concludes about the case file; observations don't apply.
     *
     * `selfPlayerId` lets the help-text swap to the friendlier
     * "Mark cards you have here" wording when the popover is on the
     * user's own row.
     */
    readonly observed: boolean;
    readonly onObservationChange: (next: boolean) => void;
    readonly selfPlayerId: Player | null;
}

/**
 * Structured content for the why popover. Three sections — Deductions,
 * Leads, Hypothesis — map 1:1 to the three visual badges on the cell
 * (center glyph, top-left chip, top-right hypothesis badge), and each
 * section embeds the same exact badge styling next to its explanation
 * so users learn to read the in-cell badges without opening the
 * popover. Sections without content hide themselves entirely.
 */
export function CellWhyPopover({
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
}: CellWhyPopoverProps) {
    const t = useTranslations("hypothesis");
    const tDeduce = useTranslations("deduce");

    const cardLabel =
        findCardEntry(setup, cell.card)?.name ?? String(cell.card);

    // For joint-conflict popovers, list every active hypothesis by
    // name so the user knows which assumptions are mutually
    // unsatisfiable. The deducer doesn't currently track per-cell
    // provenance for hypotheses, so we list the full active set
    // rather than narrowing to the specific subset that drives the
    // contradiction — good-enough until we wire up leave-one-out
    // attribution. Derived cells get their explanation via the
    // chain text (joint provenance) instead of a hypothesis list.
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
    // Inline JSX renderer for each entry — used in the joint-conflict
    // bullet list. The chip carries the value (Y / N) so the prose
    // drops the literal letter.
    const renderHypothesisEntry = (entry: ActiveHypothesisEntry) => (
        <>
            {entry.ownerName} / {entry.cardLabel}{" "}
            <ProseChecklistIcon value={entry.value} />
        </>
    );
    // Stable key for React lists.
    const entryKey = (entry: ActiveHypothesisEntry): string =>
        `${entry.ownerName}/${entry.cardLabel}/${entry.value}`;

    // Singular vs. plural copy for the derived-cell preamble. The
    // count comes from the hypothesis map directly — even if not
    // every active hypothesis contributed to this cell's value
    // (without leave-one-out attribution we can't know), the prose
    // is just "Based on your active hypothesis(es)" so the count
    // distinction is purely grammatical.
    const isDerivedSingular =
        status.kind === "derived" && HashMap.size(hypotheses) === 1;

    const isContradicted =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";
    const isJointConflict = status.kind === "jointlyConflicts";

    // Section visibility:
    //   - Deductions shows when the real-only deducer has a chain
    //     (`whyText`) OR when the cell is "derived" — i.e. its `?` value
    //     flows from the user's active hypotheses. Both cases describe
    //     why the center glyph is what it is.
    //   - Leads shows when there's at least one footnote number.
    //   - Hypothesis is always shown (the toggle is its content).
    const showDeductions =
        whyText !== undefined ||
        status.kind === "derived" ||
        display.tag === "hypothesis";
    const showLeads = footnoteNumbers.length > 0;

    // Long-form status box (rendered below the toggle) for the kinds
    // that warrant their own panel: confirmed (success), directly
    // contradicted / jointly conflicts (danger). The `derived` case
    // moved to the Deductions section above. `off` and `active` show
    // no status box at all.
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
        // Contradiction state — alert (triangle) icon, NOT an X.
        // The cell-grid uses X for "doesn't own", so reusing X for a
        // problem signal here would conflate two unrelated meanings.
        // The contradiction banner up top already grabs the user's
        // attention; this in-popover icon is a static label, not a
        // separate attention cue.
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
        // Confirmed — mirror the contradiction panel in success palette.
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[12px] text-yes">
            <CheckIcon size={14} className="mt-[1px] flex-shrink-0" />
            <span>{longStatusMessage}</span>
        </div>
    );

    // Short above-the-toggle help line that swaps based on the
    // selected hypothesis's status. The badge is the same one as the
    // cell's top-right corner, so the popover and cell read as
    // visually paired.
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
                // `off` for a value-set cell only fires when the global
                // contradiction banner is up; fall through to the
                // active wording so the row still renders something.
                case "off":
                case "active":
                case "derived":
                default:
                    return KEY_HELP_ACTIVE;
            }
        })();
        // Two chips on this row, with different roles:
        //   - The leading badge ALWAYS renders the inverted "?"
        //     variant — dark tone + white "?" — matching the
        //     deductions section's 20×20 leading icon size. The "?"
        //     means "this cell carries a hypothesis"; whether the
        //     hypothesis happens to be confirmed / contradicted is
        //     conveyed by the prose, not by swapping the glyph.
        //   - The inline-prose chip is about the user's chosen value,
        //     not its hypothesis state — always shows the concrete
        //     icon for Y / N. Default (light) style so it reads as
        //     part of the sentence rather than as another badge.
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

    // Observations section (M9). Above Deductions; below the heading.
    // Only meaningful for player-owned cells — the case-file owner
    // can't be "observed" in real life (only deduced).
    const showObservations = cell.owner._tag === "Player";
    const observationOwner =
        cell.owner._tag === "Player" ? cell.owner.player : null;
    const observationsHelpKey =
        observationOwner !== null && observationOwner === selfPlayerId
            ? KEY_OBS_HELP_SELF
            : KEY_OBS_HELP_DEFAULT;

    return (
        <div className="contents">
            <div className="flex flex-col gap-3">
                <div className="text-[14px] font-semibold uppercase tracking-wide text-fg">
                    {t("cellHeading", {
                        owner: ownerLabel(cell.owner),
                        card: cardLabel,
                    })}
                </div>
                {showObservations && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("observationsLabel")}
                        </div>
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
                    </div>
                )}
                {showDeductions && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("deductionsLabel")}
                        </div>
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
                                        // Cell directly carries a user
                                        // hypothesis (real-only didn't
                                        // conclude). The leftmost chip
                                        // already shows the parens-
                                        // wrapped icon; this line just
                                        // names what the leading badge
                                        // is communicating.
                                        <div className="text-[12px] text-muted">
                                            {t("statusActiveHypothesisCell")}
                                        </div>
                                    )}
                            </div>
                        </div>
                    </div>
                )}
                {showLeads && (
                    <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg">
                            {t("leadsLabel")}
                        </div>
                        <div className="flex items-start gap-2 text-accent">
                            {/* Leads chip in the popover matches the
                                Deductions and Hypothesis sections'
                                leftmost icon at 20px tall, so all
                                three sections share a consistent
                                left-column "this is the cell" reference.
                                Width is left to grow with the number
                                list — no square-aspect ratio because a
                                long footnote run (e.g. "1,2,3,4")
                                wouldn't fit. The cell-grid version of
                                this chip is rendered separately in
                                Checklist.tsx and stays small (text-
                                [10px]) — different context. */}
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
                    </div>
                )}
                <div
                    className={
                        showDeductions || showLeads
                            ? "flex flex-col gap-2 border-t border-border pt-3"
                            : "flex flex-col gap-2"
                    }
                >
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
