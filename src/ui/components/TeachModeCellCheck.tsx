"use client";

import { HashMap, Result } from "effect";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { findCardEntry, type GameSetup } from "../../logic/GameSetup";
import { ownerLabel } from "../../logic/GameObjects";
import {
    Cell,
    getCell,
    N,
    Y,
    type CellValue,
} from "../../logic/Knowledge";
import {
    cellKey,
    classifyCell,
    type TeachModeVerdict,
    type UserDeductionValue,
} from "../../logic/TeachMode";
import { teachModeCellCheckUsed } from "../../analytics/events";
import { useClue } from "../state";
import { AlertIcon, CheckIcon, LightbulbIcon } from "./Icons";
import { ProseChecklistIcon } from "./CellGlyph";
import { buildCellWhy } from "./cellWhy";

/**
 * Teach-mode body for the cell explanation panel. Replaces the
 * deductions / leads / hypothesis sections with a single-purpose
 * "Check this cell" affordance: press the button, see how your mark
 * compares to the deducer's verdict.
 *
 * The verdict is one of five states (see {@link TeachModeVerdict}):
 *
 * - **Verifiable** — your mark matches the deducer's verdict.
 * - **Falsifiable** — your mark contradicts the deducer's verdict.
 * - **Plausible** — you marked something the deducer can't prove yet.
 * - **Missed deduction** — you left this blank, but the deducer can
 *   prove a value here.
 * - **Inconsistent** — your mark contradicts another mark you made
 *   (e.g. two players marked Y for the same card).
 *
 * The reasoning chain for verifiable / falsifiable / missed verdicts
 * comes from the standard `buildCellWhy` over the real-only deducer
 * output, so the user reads the same "Given / Reasoning" explanation
 * the non-teach-mode panel would have shown.
 */
export function TeachModeCellCheck({
    cell,
    setup,
}: {
    readonly cell: Cell;
    readonly setup: GameSetup;
}) {
    const t = useTranslations("teachMode");
    const tDeduce = useTranslations("deduce");
    const tReasons = useTranslations("reasons");
    const { state, derived, dispatch } = useClue();
    const [revealed, setRevealed] = useState(false);

    const cardLabel =
        findCardEntry(setup, cell.card)?.name ?? String(cell.card);

    const userMarkOpt = HashMap.get(state.userDeductions, cell);
    const userMark =
        userMarkOpt._tag === "Some" ? userMarkOpt.value : undefined;
    const deducerVerdict: CellValue | undefined = Result.isSuccess(
        derived.deductionResult,
    )
        ? getCell(derived.deductionResult.success, cell)
        : undefined;
    const conflictingCells =
        derived.intrinsicContradictions.conflictsByCell.get(cellKey(cell))
        ?? [];

    const verdict: TeachModeVerdict = classifyCell(
        cell,
        userMark,
        deducerVerdict,
        () => conflictingCells,
    );

    const onCheckClick = () => {
        setRevealed(true);
        teachModeCellCheckUsed({ verdict: verdict.kind });
    };

    const setMark = (next: UserDeductionValue | null) => {
        dispatch({ type: "setUserDeduction", cell, value: next });
        // Setting a new value invalidates the previously-shown verdict
        // — collapse the reveal so the user has to press "Check this
        // cell" again to see the updated verdict.
        setRevealed(false);
    };

    return (
        <section className="flex flex-col gap-3 px-4 py-3">
            <div className="text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                {t("yourMarkLabel")}
            </div>
            <MarkPicker value={userMark} onChange={setMark} />
            <div className="border-t border-border" />
            {revealed ? (
                <VerdictDisplay
                    verdict={verdict}
                    cell={cell}
                    setup={setup}
                    tDeduce={tDeduce}
                    tReasons={tReasons}
                    knownCards={state.knownCards}
                    hypotheses={state.hypotheses}
                    suggestionsAsData={derived.suggestionsAsData}
                    accusationsAsData={derived.accusationsAsData}
                    provenance={derived.provenance}
                />
            ) : (
                <button
                    type="button"
                    onClick={onCheckClick}
                    className="self-start cursor-pointer rounded border border-accent bg-accent px-3 py-1.5 text-[1.125rem] font-semibold text-panel hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                    {t("checkThisCellButton", { card: cardLabel })}
                </button>
            )}
        </section>
    );
}

/**
 * Three-option Y/N/off picker that writes to `userDeductions`. Mirrors
 * the visual shape of `HypothesisControl` but the value semantics are
 * the cell's actual mark, not a what-if guess. No status-derived
 * styling — in teach-mode the deducer's verdict is hidden until Check.
 */
// Tailwind class strings, hoisted so the `i18next/no-literal-string`
// lint rule reads them as code identifiers rather than UI text.
const MARK_PICKER_BASE_CLASS =
     
    "flex-1 cursor-pointer border-2 border-border bg-panel px-3 py-1 text-[1.125rem] font-semibold text-muted transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const MARK_PICKER_OFF_SELECTED =
     
    " !border-muted !bg-row-header text-fg";
const MARK_PICKER_Y_SELECTED =
     
    " !border-yes bg-yes-bg text-yes";
const MARK_PICKER_N_SELECTED =
     
    " !border-no !bg-no-bg text-no";
 
const MARK_PICKER_OFF_SHAPE = " rounded-l border-r-0";
 
const MARK_PICKER_Y_SHAPE = " border-r-0";
 
const MARK_PICKER_N_SHAPE = " rounded-r";

function MarkPicker({
    value,
    onChange,
}: {
    readonly value: UserDeductionValue | undefined;
    readonly onChange: (next: UserDeductionValue | null) => void;
}) {
    const t = useTranslations("teachMode");
    const offSelected = value === undefined ? MARK_PICKER_OFF_SELECTED : "";
    const ySelected = value === Y ? MARK_PICKER_Y_SELECTED : "";
    const nSelected = value === N ? MARK_PICKER_N_SELECTED : "";
    return (
        <div className="flex w-full" role="radiogroup" aria-label={t("yourMarkLabel")}>
            <button
                type="button"
                role="radio"
                aria-checked={value === undefined}
                onClick={() => onChange(null)}
                className={MARK_PICKER_BASE_CLASS + offSelected + MARK_PICKER_OFF_SHAPE}
            >
                {t("markOff")}
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={value === Y}
                onClick={() => onChange(Y)}
                className={MARK_PICKER_BASE_CLASS + ySelected + MARK_PICKER_Y_SHAPE}
            >
                <ProseChecklistIcon value={Y} />
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={value === N}
                onClick={() => onChange(N)}
                className={MARK_PICKER_BASE_CLASS + nSelected + MARK_PICKER_N_SHAPE}
            >
                <ProseChecklistIcon value={N} />
            </button>
        </div>
    );
}

function VerdictDisplay({
    verdict,
    cell,
    setup,
    tDeduce,
    tReasons,
    knownCards,
    hypotheses,
    suggestionsAsData,
    accusationsAsData,
    provenance,
}: {
    readonly verdict: TeachModeVerdict;
    readonly cell: Cell;
    readonly setup: GameSetup;
    readonly tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    readonly tReasons: ReturnType<typeof useTranslations<"reasons">>;
    readonly knownCards: ReturnType<typeof useClue>["state"]["knownCards"];
    readonly hypotheses: ReturnType<typeof useClue>["state"]["hypotheses"];
    readonly suggestionsAsData: ReturnType<typeof useClue>["derived"]["suggestionsAsData"];
    readonly accusationsAsData: ReturnType<typeof useClue>["derived"]["accusationsAsData"];
    readonly provenance: ReturnType<typeof useClue>["derived"]["provenance"];
}) {
    const t = useTranslations("teachMode");

    const why =
        verdict.kind === "verifiable"
        || verdict.kind === "falsifiable"
        || verdict.kind === "missed"
            ? buildCellWhy({
                  provenance,
                  suggestions: suggestionsAsData,
                  accusations: accusationsAsData,
                  setup,
                  owner: cell.owner,
                  card: cell.card,
                  knownCards,
                  hypotheses,
                  tDeduce,
                  tReasons,
              })
            : undefined;

    if (verdict.kind === "verifiable") {
        return (
            <div className="flex flex-col gap-2">
                <Headline
                    tone={TONE_SUCCESS}
                    icon={<CheckIcon size={14} className="mt-[1px] flex-shrink-0" />}
                >
                    {t("verdictVerifiable")}
                </Headline>
                {why && (
                    <WhyBlock
                        why={why}
                        tDeduce={tDeduce}
                    />
                )}
            </div>
        );
    }

    if (verdict.kind === "falsifiable") {
        return (
            <div className="flex flex-col gap-2">
                <Headline
                    tone={TONE_DANGER}
                    icon={<AlertIcon size={14} className="mt-[1px] flex-shrink-0" />}
                >
                    {t.rich("verdictFalsifiable", {
                        deducerVerdict: () => (
                            <ProseChecklistIcon value={verdict.deducerVerdict} />
                        ),
                    })}
                </Headline>
                {why && (
                    <WhyBlock why={why} tDeduce={tDeduce} />
                )}
            </div>
        );
    }

    if (verdict.kind === "plausible") {
        return (
            <Headline
                tone={TONE_MUTED}
                icon={<LightbulbIcon size={14} className="mt-[1px] flex-shrink-0" />}
            >
                {t("verdictPlausible")}
            </Headline>
        );
    }

    if (verdict.kind === "missed") {
        return (
            <div className="flex flex-col gap-2">
                <Headline
                    tone={TONE_WARNING}
                    icon={<LightbulbIcon size={14} className="mt-[1px] flex-shrink-0" />}
                >
                    {t.rich("verdictMissed", {
                        deducerVerdict: () => (
                            <ProseChecklistIcon value={verdict.deducerVerdict} />
                        ),
                    })}
                </Headline>
                {why && (
                    <WhyBlock why={why} tDeduce={tDeduce} />
                )}
            </div>
        );
    }

    if (verdict.kind === "inconsistent") {
        const conflictLabels = verdict.conflictingCells.map(c => {
            const cardLabel =
                findCardEntry(setup, c.card)?.name ?? String(c.card);
            return `${ownerLabel(c.owner)} / ${cardLabel}`;
        });
        return (
            <div className="flex flex-col gap-2">
                <Headline
                    tone={TONE_DANGER}
                    icon={<AlertIcon size={14} className="mt-[1px] flex-shrink-0" />}
                >
                    {t("verdictInconsistent")}
                </Headline>
                {conflictLabels.length > 0 && (
                    <ul className="ml-3 list-disc text-[1.125rem] text-muted">
                        {conflictLabels.map(label => (
                            <li key={label}>{label}</li>
                        ))}
                    </ul>
                )}
            </div>
        );
    }

    // unknown (no mark, no deducer verdict) — encourage exploration.
    return (
        <Headline
            tone={TONE_MUTED}
            icon={<LightbulbIcon size={14} className="mt-[1px] flex-shrink-0" />}
        >
            {t("verdictUnknown")}
        </Headline>
    );
}

// Headline tone discriminators + their tailwind classes, hoisted so
// the `i18next/no-literal-string` lint rule reads them as code.
const TONE_SUCCESS = "success" as const;
const TONE_DANGER = "danger" as const;
const TONE_WARNING = "warning" as const;
const TONE_MUTED = "muted" as const;
type HeadlineTone =
    | typeof TONE_SUCCESS
    | typeof TONE_DANGER
    | typeof TONE_WARNING
    | typeof TONE_MUTED;

const HEADLINE_CLASS_BY_TONE: Record<HeadlineTone, string> = {
     
    [TONE_SUCCESS]: "flex items-start gap-2 rounded-[var(--radius)] border border-yes/40 bg-yes-bg p-2 text-[1.125rem] text-yes",
     
    [TONE_DANGER]: "flex items-start gap-2 rounded-[var(--radius)] border border-danger-border bg-danger-bg p-2 text-[1.125rem] text-danger",
     
    [TONE_WARNING]: "flex items-start gap-2 rounded-[var(--radius)] border border-accent/40 bg-row-header p-2 text-[1.125rem] text-fg",
     
    [TONE_MUTED]: "flex items-start gap-2 rounded-[var(--radius)] border border-border bg-row-header p-2 text-[1.125rem] text-muted",
};

function Headline({
    tone,
    icon,
    children,
}: {
    readonly tone: HeadlineTone;
    readonly icon: React.ReactNode;
    readonly children: React.ReactNode;
}) {
    return (
        <div className={HEADLINE_CLASS_BY_TONE[tone]}>
            {icon}
            <span>{children}</span>
        </div>
    );
}

function WhyBlock({
    why,
    tDeduce,
}: {
    readonly why: { readonly headline: string | undefined; readonly givens: ReadonlyArray<string>; readonly reasoning: ReadonlyArray<string> };
    readonly tDeduce: ReturnType<typeof useTranslations<"deduce">>;
}) {
    if (
        why.headline === undefined
        && why.givens.length === 0
        && why.reasoning.length === 0
    ) {
        return null;
    }
    return (
        <div className="flex flex-col gap-2">
            {why.headline !== undefined && (
                <div className="text-[1.125rem] font-semibold text-fg">
                    {why.headline}
                </div>
            )}
            {why.givens.length > 0 && (
                <div className="flex flex-col gap-1 text-[1.125rem] text-muted">
                    <div className="font-semibold uppercase tracking-wide text-fg">
                        {tDeduce("givenSectionLabel")}
                    </div>
                    <ul className="m-0 ml-4 list-disc">
                        {why.givens.map(line => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                </div>
            )}
            {why.reasoning.length > 0 && (
                <div className="flex flex-col gap-1 text-[1.125rem] text-muted">
                    <div className="font-semibold uppercase tracking-wide text-fg">
                        {tDeduce("reasoningSectionLabel")}
                    </div>
                    {why.reasoning.length === 1 ? (
                        <p className="m-0">{why.reasoning[0]}</p>
                    ) : (
                        <ol className="m-0 ml-5 list-decimal">
                            {why.reasoning.map(line => (
                                <li key={line}>{line}</li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </div>
    );
}
