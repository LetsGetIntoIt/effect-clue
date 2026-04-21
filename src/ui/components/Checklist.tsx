"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card, Owner, Player, ownerLabel } from "../../logic/GameObjects";
import {
    allCardIds,
    allOwners,
    cardName,
    caseFileSize,
    defaultHandSizes,
} from "../../logic/GameSetup";
import {
    Cell,
    CellValue,
    emptyKnowledge,
    getCellByOwnerCard,
    Knowledge,
    N,
    Y,
} from "../../logic/Knowledge";
import { footnotesForCell } from "../../logic/Footnotes";
import { KnownCard } from "../../logic/InitialKnowledge";
import {
    chainFor,
    describeReason,
    Provenance,
    ReasonDescription,
} from "../../logic/Provenance";
import {
    caseFileAnswerFor,
    caseFileCandidatesFor,
    caseFileProgress,
} from "../../logic/Recommender";
import { Suggestion } from "../../logic/Suggestion";
import { useHover } from "../HoverContext";
import { useClue } from "../state";
import { Envelope } from "./Icons";
import { Tooltip } from "./Tooltip";

/**
 * Unified tabbed checklist: the single surface for both editing the
 * deck / roster (Setup mode) and tracking deductions (Play mode).
 * State-slice ownership is one tab-gate deep: `inSetup` controls
 * whether player name inputs, hand-size row, add / remove affordances,
 * and the trailing "+" column render. The cell grid (Y / N / blank,
 * tooltips, cross-highlighting, footnotes) is identical in both.
 *
 * The GameSetupPanel + ChecklistGrid pair this replaces is still
 * mounted during commits 17–18 as a safety net and gets deleted in
 * commit 19.
 */
export function Checklist() {
    const t = useTranslations("deduce");
    const tSetup = useTranslations("setup");
    const tReasons = useTranslations("reasons");
    const { state, dispatch, derived } = useClue();
    const { hoveredSuggestionIndex } = useHover();
    const inSetup = state.uiMode === "setup";
    const setup = state.setup;
    const knownCards = state.knownCards;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;
    const provenance = derived.provenance;
    const suggestions = derived.suggestionsAsData;

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    const handSizeMap = new Map(state.handSizes);
    const defaults = new Map(defaultHandSizes(setup));
    const totalDealt = allCardIds(setup).length - caseFileSize(setup);
    const setHandSizesArr = setup.players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allHandSizesSet =
        setHandSizesArr.length === setup.players.length &&
        setup.players.length > 0;
    const handSizesTotal = setHandSizesArr.reduce((a, b) => a + b, 0);
    const handSizeMismatch =
        allHandSizesSet && handSizesTotal !== totalDealt;

    const onHandSizeChange = (player: Player, raw: string) => {
        if (raw === "") {
            dispatch({ type: "setHandSize", player, size: undefined });
            return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
            dispatch({ type: "setHandSize", player, size: n });
        }
    };

    /**
     * Cross-highlight: when the user hovers a suggestion row in
     * PriorSuggestions, highlight every cell whose provenance chain
     * referenced that suggestion's index.
     */
    const cellIsHighlighted = (owner: Owner, card: Card): boolean => {
        if (hoveredSuggestionIndex === null) return false;
        if (!provenance) return false;
        const chain = chainFor(provenance, Cell(owner, card));
        for (const reason of chain) {
            const tag = reason.kind._tag;
            const idx =
                tag === "NonRefuters"
                || tag === "RefuterShowed"
                || tag === "RefuterOwnsOneOf"
                    ? reason.kind.suggestionIndex
                    : undefined;
            if (idx === hoveredSuggestionIndex) return true;
        }
        return false;
    };

    /**
     * Toggle a known-card entry for (player, card) when the user clicks
     * a cell. Only player columns are interactive — the case-file
     * column is computed by the deducer.
     */
    const toggleKnownCard = (owner: Owner, card: Card) => {
        if (owner._tag !== "Player") return;
        const player = owner.player;
        const index = knownCards.findIndex(
            kc => kc.player === player && kc.card === card,
        );
        if (index >= 0) {
            dispatch({ type: "removeKnownCard", index });
        } else {
            dispatch({
                type: "addKnownCard",
                card: KnownCard({ player, card }),
            });
        }
    };

    const knowledge: Knowledge =
        Result.getOrUndefined(result) ?? emptyKnowledge;

    // Column count for <th colSpan> on category / card-name / add-* rows.
    // In Setup mode the trailing "+ add player" column adds one more.
    const cardSpan = 1 + owners.length + (inSetup ? 1 : 0);

    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                {t("title")}
            </h2>
            <CaseFileHeader knowledge={knowledge} />
            {inSetup && handSizeMismatch && (
                <div className="mb-3 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
                    {tSetup("handSizeMismatch", {
                        total: handSizesTotal,
                        expected: totalDealt,
                        caseFileCount: caseFileSize(setup),
                    })}
                </div>
            )}
            <table className="w-full border-collapse text-[13px]">
                <thead>
                    <tr>
                        <th className="sticky top-0 z-10 border border-border bg-row-header px-2 py-1 text-center font-semibold"></th>
                        {owners.map(owner => (
                            <th
                                key={ownerKey(owner)}
                                className="sticky top-0 z-10 border border-border bg-row-header px-2 py-1 text-center align-top font-semibold"
                            >
                                {inSetup && owner._tag === "Player" ? (
                                    <PlayerNameInput
                                        player={owner.player}
                                        allPlayers={setup.players}
                                    />
                                ) : (
                                    ownerLabel(owner)
                                )}
                            </th>
                        ))}
                        {inSetup && (
                            <th className="w-8 border border-border bg-row-header px-1.5 py-1 text-center">
                                <button
                                    type="button"
                                    className="h-6 w-6 cursor-pointer rounded border-none bg-accent text-[16px] leading-none text-white hover:bg-accent-hover"
                                    title={tSetup("addPlayerTitle")}
                                    onClick={() =>
                                        dispatch({ type: "addPlayer" })
                                    }
                                >
                                    +
                                </button>
                            </th>
                        )}
                    </tr>
                    {inSetup && (
                        <tr>
                            <th className="whitespace-nowrap border border-border bg-row-header px-1.5 py-1 text-left font-semibold">
                                {tSetup("handSize")}
                            </th>
                            {owners.map(owner => {
                                if (owner._tag !== "Player") {
                                    return (
                                        <td
                                            key={ownerKey(owner)}
                                            className="border border-border"
                                        />
                                    );
                                }
                                const current = handSizeMap.get(owner.player);
                                const def = defaults.get(owner.player);
                                return (
                                    <td
                                        key={ownerKey(owner)}
                                        className="border border-border px-1.5 py-1 text-center"
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            max={allCardIds(setup).length}
                                            className="w-14 rounded border border-border p-0.5 text-center text-[12px]"
                                            value={
                                                current === undefined
                                                    ? ""
                                                    : String(current)
                                            }
                                            placeholder={
                                                def === undefined
                                                    ? ""
                                                    : String(def)
                                            }
                                            onChange={e =>
                                                onHandSizeChange(
                                                    owner.player,
                                                    e.currentTarget.value,
                                                )
                                            }
                                        />
                                    </td>
                                );
                            })}
                            <td className="border border-border" />
                        </tr>
                    )}
                </thead>
                <tbody>
                    {setup.categories.flatMap(category => {
                        const canRemoveCategory = setup.categories.length > 1;
                        const canRemoveCard = category.cards.length > 1;
                        return [
                            <tr key={`h-${String(category.id)}`}>
                                <th
                                    colSpan={cardSpan}
                                    className="border border-border bg-accent px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-white"
                                >
                                    {inSetup ? (
                                        <div className="flex items-center justify-between gap-2">
                                            <InlineTextEdit
                                                value={category.name}
                                                className="min-w-0 flex-1 rounded border border-white/30 bg-transparent px-1 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-white focus:bg-white/10 focus:outline-none"
                                                title={tSetup("renameCategoryTitle")}
                                                onCommit={next =>
                                                    dispatch({
                                                        type: "renameCategory",
                                                        categoryId: category.id,
                                                        name: next,
                                                    })
                                                }
                                            />
                                            <button
                                                type="button"
                                                title={
                                                    canRemoveCategory
                                                        ? tSetup("removeCategoryTitle", {
                                                              name: category.name,
                                                          })
                                                        : tSetup("removeCategoryMin")
                                                }
                                                disabled={!canRemoveCategory}
                                                className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                                onClick={() =>
                                                    dispatch({
                                                        type: "removeCategoryById",
                                                        categoryId: category.id,
                                                    })
                                                }
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    ) : (
                                        category.name
                                    )}
                                </th>
                            </tr>,
                            ...category.cards.map(entry => (
                                <tr key={String(entry.id)}>
                                    <th className="border border-border px-2 py-1 text-left font-normal">
                                        {inSetup ? (
                                            <div className="flex items-center justify-between gap-2">
                                                <InlineTextEdit
                                                    value={entry.name}
                                                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] hover:border-border focus:border-accent focus:outline-none"
                                                    title={tSetup("renameCardTitle")}
                                                    onCommit={next =>
                                                        dispatch({
                                                            type: "renameCard",
                                                            cardId: entry.id,
                                                            name: next,
                                                        })
                                                    }
                                                />
                                                <button
                                                    type="button"
                                                    title={
                                                        canRemoveCard
                                                            ? tSetup("removeCardTitle", {
                                                                  name: entry.name,
                                                              })
                                                            : tSetup("removeCardMin")
                                                    }
                                                    disabled={!canRemoveCard}
                                                    className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={() =>
                                                        dispatch({
                                                            type: "removeCardById",
                                                            cardId: entry.id,
                                                        })
                                                    }
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        ) : (
                                            entry.name
                                        )}
                                    </th>
                                    {owners.map(owner => {
                                        const value = getCellByOwnerCard(
                                            knowledge,
                                            owner,
                                            entry.id,
                                        );
                                        const footnoteNumbers = footnotesForCell(
                                            footnotes,
                                            Cell(owner, entry.id),
                                        );
                                        const isPlayerCell = owner._tag === "Player";
                                        const isHighlighted = cellIsHighlighted(
                                            owner,
                                            entry.id,
                                        );
                                        const tooltipText = buildCellTitle({
                                            provenance,
                                            suggestions,
                                            setup,
                                            owner,
                                            card: entry.id,
                                            footnoteNumbers,
                                            tDeduce: t,
                                            tReasons,
                                        });
                                        const tooltipContent = tooltipText ? (
                                            <div className="whitespace-pre-line">
                                                {tooltipText}
                                            </div>
                                        ) : undefined;
                                        return (
                                            <Tooltip
                                                key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                content={tooltipContent}
                                            >
                                                <td
                                                    className={cellClass(
                                                        value,
                                                        isPlayerCell,
                                                        isHighlighted,
                                                    )}
                                                    onClick={
                                                        isPlayerCell
                                                            ? () =>
                                                                  toggleKnownCard(
                                                                      owner,
                                                                      entry.id,
                                                                  )
                                                            : undefined
                                                    }
                                                    role={isPlayerCell ? "button" : undefined}
                                                    tabIndex={isPlayerCell ? 0 : undefined}
                                                    onKeyDown={
                                                        isPlayerCell
                                                            ? e => {
                                                                  if (
                                                                      e.key === "Enter" ||
                                                                      e.key === " "
                                                                  ) {
                                                                      e.preventDefault();
                                                                      toggleKnownCard(
                                                                          owner,
                                                                          entry.id,
                                                                      );
                                                                  }
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    {cellLabel(value)}
                                                    {footnoteNumbers.length > 0 &&
                                                        value === undefined && (
                                                            <sup className="ml-0.5 text-[9px] font-normal text-accent">
                                                                {footnoteNumbers.join(",")}
                                                            </sup>
                                                        )}
                                                </td>
                                            </Tooltip>
                                        );
                                    })}
                                    {inSetup && (
                                        <td className="border border-border" />
                                    )}
                                </tr>
                            )),
                            ...(inSetup
                                ? [
                                      <tr key={`add-card-${String(category.id)}`}>
                                          <th
                                              colSpan={cardSpan}
                                              className="border border-border bg-row-alt px-1.5 py-1 text-left"
                                          >
                                              <button
                                                  type="button"
                                                  className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                                                  onClick={() =>
                                                      dispatch({
                                                          type: "addCardToCategoryById",
                                                          categoryId: category.id,
                                                      })
                                                  }
                                              >
                                                  {tSetup("addCard")}
                                              </button>
                                          </th>
                                      </tr>,
                                  ]
                                : []),
                        ];
                    })}
                    {inSetup && (
                        <tr>
                            <th
                                colSpan={cardSpan}
                                className="border border-border bg-row-alt px-1.5 py-2 text-center"
                            >
                                <button
                                    type="button"
                                    className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover"
                                    onClick={() =>
                                        dispatch({ type: "addCategory" })
                                    }
                                >
                                    {tSetup("addCategory")}
                                </button>
                            </th>
                        </tr>
                    )}
                </tbody>
            </table>
        </section>
    );
}

/**
 * Editable text cell. Commits the new value on blur or Enter; resets
 * to the external value on Escape or if the input is cleared.
 */
function InlineTextEdit({
    value,
    onCommit,
    className,
    title,
}: {
    value: string;
    onCommit: (next: string) => void;
    className?: string;
    title?: string;
}) {
    const [local, setLocal] = useState(value);
    useEffect(() => {
        setLocal(value);
    }, [value]);

    const commit = () => {
        const trimmed = local.trim();
        if (trimmed.length === 0) {
            setLocal(value);
            return;
        }
        if (trimmed !== value) onCommit(trimmed);
    };

    return (
        <input
            type="text"
            value={local}
            className={className}
            title={title}
            onChange={e => setLocal(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                    setLocal(value);
                    (e.currentTarget as HTMLInputElement).blur();
                }
            }}
        />
    );
}

/**
 * Editable player-name header with remove-× button. Handles the
 * duplicate-name check locally so the reducer doesn't have to.
 */
function PlayerNameInput({
    player,
    allPlayers,
}: {
    player: Player;
    allPlayers: ReadonlyArray<Player>;
}) {
    const t = useTranslations("setup");
    const { dispatch } = useClue();
    const [editing, setEditing] = useState(String(player));
    const [error, setError] = useState("");

    useEffect(() => {
        setEditing(String(player));
        setError("");
    }, [player]);

    const commit = () => {
        const trimmed = editing.trim();
        if (!trimmed) {
            setEditing(String(player));
            setError("");
            return;
        }
        if (trimmed === String(player)) {
            setError("");
            return;
        }
        if (allPlayers.some(p => String(p) === trimmed)) {
            setError(t("duplicateName"));
            return;
        }
        dispatch({
            type: "renamePlayer",
            oldName: player,
            newName: Player(trimmed),
        });
        setError("");
    };

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <input
                type="text"
                className="box-border w-full rounded border border-border px-1.5 py-1 text-[12px]"
                value={editing}
                onChange={e => {
                    setEditing(e.currentTarget.value);
                    setError("");
                }}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === "Enter") commit();
                }}
            />
            {error && (
                <span className="whitespace-nowrap text-[11px] text-danger">
                    {error}
                </span>
            )}
            <button
                type="button"
                className="self-center border-none bg-transparent px-1 text-[14px] leading-none text-muted hover:text-danger"
                title={t("removePlayerTitle", { player: String(player) })}
                onClick={() => dispatch({ type: "removePlayer", player })}
            >
                &times;
            </button>
        </div>
    );
}

/**
 * Resolve a single `ReasonDescription` (from `describeReason`) into
 * `{ headline, detail }` strings via the "reasons" i18n namespace.
 */
const resolveReasonCopy = (
    desc: ReasonDescription,
    tReasons: ReturnType<typeof useTranslations<"reasons">>,
): { readonly headline: string; readonly detail: string } => {
    switch (desc.kind) {
        case "initial-known-card":
        case "initial-hand-size":
            return {
                headline: tReasons(`${desc.kind}.headline`),
                detail: tReasons(`${desc.kind}.detail`),
            };
        case "card-ownership":
        case "player-hand":
        case "case-file-category":
            return {
                headline: tReasons(`${desc.kind}.headline`),
                detail: tReasons(`${desc.kind}.detail`, desc.params),
            };
        case "non-refuters": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            const detail =
                desc.params.suggester !== undefined
                    ? tReasons("non-refuters.detailKnown", {
                          suggester: desc.params.suggester,
                      })
                    : tReasons("non-refuters.detailUnknown");
            return { headline, detail };
        }
        case "refuter-showed": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            if (desc.params.refuter === undefined) {
                return {
                    headline,
                    detail: tReasons("refuter-showed.detailUnknown"),
                };
            }
            return {
                headline,
                detail:
                    desc.params.seen !== undefined
                        ? tReasons("refuter-showed.detailKnown", {
                              refuter: desc.params.refuter,
                              seen: desc.params.seen,
                          })
                        : tReasons("refuter-showed.detailKnownNoCard", {
                              refuter: desc.params.refuter,
                          }),
            };
        }
        case "refuter-owns-one-of": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            if (
                desc.params.refuter === undefined ||
                desc.params.suggester === undefined ||
                desc.params.cardLabels === undefined
            ) {
                return {
                    headline,
                    detail: tReasons("refuter-owns-one-of.detailUnknown"),
                };
            }
            return {
                headline,
                detail: tReasons("refuter-owns-one-of.detailKnown", {
                    refuter: desc.params.refuter,
                    suggester: desc.params.suggester,
                    cardLabels: desc.params.cardLabels,
                }),
            };
        }
    }
};

const buildCellTitle = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    setup: ReturnType<typeof useClue>["state"]["setup"];
    owner: Owner;
    card: Card;
    footnoteNumbers: ReadonlyArray<number>;
    tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    tReasons: ReturnType<typeof useTranslations<"reasons">>;
}): string | undefined => {
    const {
        provenance,
        suggestions,
        setup,
        owner,
        card,
        footnoteNumbers,
        tDeduce,
        tReasons,
    } = args;

    const footnoteLine =
        footnoteNumbers.length > 0
            ? tDeduce("footnoteLine", {
                  labels: footnoteNumbers.map(n => `#${n}`).join(", "),
              })
            : undefined;

    const chain = provenance
        ? chainFor(provenance, Cell(owner, card))
        : [];
    const chainLines: string[] = chain.map((reason, i) => {
        const desc = describeReason(reason, setup, suggestions);
        const { headline, detail } = resolveReasonCopy(desc, tReasons);
        return tDeduce("whyLine", {
            index: i + 1,
            headline,
            iter: reason.iteration > 0 ? reason.iteration : "none",
            detail,
        });
    });

    const parts: string[] = [];
    if (chainLines.length > 0) {
        parts.push(tDeduce("whyHeader"));
        parts.push(...chainLines);
    }
    if (footnoteLine) parts.push(footnoteLine);

    return parts.length > 0 ? parts.join("\n") : undefined;
};

function CaseFileHeader({ knowledge }: { knowledge: Knowledge }) {
    const t = useTranslations("deduce");
    const { state } = useClue();
    const setup = state.setup;
    const progress = caseFileProgress(setup, knowledge);
    return (
        <div className="mb-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3">
            <div className="mb-2.5 flex items-center gap-3 text-[13px]">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-accent">
                    <Envelope size={16} />
                    {t("caseFileProgress", {
                        percent: (progress * 100).toFixed(0),
                    })}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-border">
                    <div
                        className="h-full bg-accent transition-[width] duration-200"
                        style={{ width: `${progress * 100}%` }}
                    />
                </div>
            </div>
            <div
                className="grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${setup.categories.length || 1}, minmax(0, 1fr))`,
                }}
            >
                {setup.categories.map(category => {
                    const solved = caseFileAnswerFor(
                        setup,
                        knowledge,
                        category.id,
                    );
                    const candidates = caseFileCandidatesFor(
                        setup,
                        knowledge,
                        category.id,
                    );
                    return (
                        <div
                            key={String(category.id)}
                            className="rounded-[var(--radius)] border border-border bg-white p-2 text-center"
                        >
                            <div className="mb-1 text-[11px] uppercase tracking-[0.05em] text-muted">
                                {category.name}
                            </div>
                            {solved ? (
                                <div className="text-[14px] font-semibold text-yes">
                                    {cardName(setup, solved)}
                                </div>
                            ) : (
                                <div className="text-[13px] text-muted">
                                    {t("candidatesCount", {
                                        count: candidates.length,
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const ownerKey = (owner: Owner): string =>
    owner._tag === "Player" ? `p-${owner.player}` : "case-file";

const cellLabel = (value: CellValue | undefined): string => {
    if (value === Y) return "✓";
    if (value === N) return "·";
    return "";
};

const CELL_BASE =
    "w-9 min-w-9 border border-border px-2 py-1 text-center font-semibold relative";

const CELL_INTERACTIVE =
    " cursor-pointer hover:ring-2 hover:ring-accent/40 focus:outline-none focus:ring-2 focus:ring-accent";

const CELL_HIGHLIGHTED =
    " ring-2 ring-accent ring-offset-1 ring-offset-panel";

const cellClass = (
    value: CellValue | undefined,
    interactive: boolean,
    highlighted: boolean,
): string => {
    let base = interactive ? `${CELL_BASE}${CELL_INTERACTIVE}` : CELL_BASE;
    if (highlighted) base += CELL_HIGHLIGHTED;
    if (value === Y) return `${base} bg-yes-bg text-yes`;
    if (value === N) return `${base} bg-no-bg text-no`;
    return `${base} bg-white`;
};
