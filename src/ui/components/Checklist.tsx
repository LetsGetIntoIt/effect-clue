"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useConfirm } from "../hooks/useConfirm";
import { useSelection } from "../SelectionContext";
import { useClue } from "../state";
import {
    registerChecklistFocusHandler,
    rememberChecklistCell,
} from "../checklistFocus";
import { label, matches } from "../keyMap";
import { AnimatePresence, motion } from "motion/react";
import {
    T_CELEBRATE,
    T_FAST,
    T_STANDARD,
    T_WIGGLE,
    useReducedTransition,
} from "../motion";
import { useConfetti } from "../hooks/useConfetti";
import { CardPackRow } from "./CardPackRow";
import { Envelope } from "./Icons";
import { InfoPopover } from "./InfoPopover";

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
    const {
        activeSuggestionIndex,
        setHoveredCell,
        setSelectedCell,
    } = useSelection();
    const confirm = useConfirm();
    const inSetup = state.uiMode === "setup";
    const setup = state.setup;
    const knownCards = state.knownCards;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;
    const provenance = derived.provenance;
    const suggestions = derived.suggestionsAsData;

    const owners: ReadonlyArray<Owner> = allOwners(setup);

    // Flat (card → row) index used for arrow-key grid navigation.
    // Row 0 is the first card in the first category; rows run
    // contiguously across all categories. Cells publish their
    // row/col via data attrs so neighbors can be queried by
    // `[data-cell-row="N"][data-cell-col="M"]`.
    const rowIdxByCard = useMemo(() => {
        const m = new Map<Card, number>();
        let i = 0;
        for (const cat of setup.categories) {
            for (const entry of cat.cards) m.set(entry.id, i++);
        }
        return m;
    }, [setup.categories]);
    const totalRows = rowIdxByCard.size;
    const totalCols = owners.length;

    // Handle ⌘J focus requests: locate a cell by (row,col) and
    // focus it. "first" falls back to the first interactive cell.
    useEffect(() => {
        const unregister = registerChecklistFocusHandler(target => {
            const findAt = (row: number, col: number): HTMLElement | null => {
                const el = document.querySelector<HTMLElement>(
                    `[data-cell-row="${row}"][data-cell-col="${col}"]`,
                );
                return el;
            };
            const findFirst = (): HTMLElement | null => {
                for (let r = 0; r < totalRows; r++) {
                    for (let c = 0; c < totalCols; c++) {
                        const el = findAt(r, c);
                        if (el) return el;
                    }
                }
                return null;
            };
            queueMicrotask(() => {
                let el: HTMLElement | null = null;
                if (target === "first") {
                    el = findFirst();
                } else if (target === "last") {
                    el = findFirst();
                } else {
                    el = findAt(target.row, target.col) ?? findFirst();
                }
                if (el) {
                    el.scrollIntoView(
                        // eslint-disable-next-line i18next/no-literal-string -- DOM enum values
                        { block: "nearest", inline: "nearest" },
                    );
                    el.focus({ preventScroll: false });
                }
            });
        });
        return unregister;
    }, [totalRows, totalCols]);

    // In Setup mode the add-player column sits between the players and
    // the case file — clicking + spawns the new player where its column
    // would naturally appear. Each of the three owner-axis rows below
    // injects the matching header/cell right before the case-file
    // column; Play mode skips the cell entirely (unchanged column
    // count).
    const addPlayerHeaderCell = (
        <th
            key="add-player-col"
            className="w-px whitespace-nowrap border border-border bg-row-header px-1.5 py-1 text-center"
        >
            <button
                type="button"
                className="cursor-pointer whitespace-nowrap rounded border-none bg-accent px-2 py-1 text-[12px] font-semibold leading-none text-white hover:bg-accent-hover"
                title={tSetup("addPlayerTitle")}
                onClick={() => dispatch({ type: "addPlayer" })}
            >
                {tSetup("addPlayerLabel")}
            </button>
        </th>
    );
    const addPlayerEmptyCell = (
        <td key="add-player-col" className="border border-border" />
    );

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
        if (activeSuggestionIndex === null) return false;
        if (!provenance) return false;
        const chain = chainFor(provenance, Cell(owner, card));
        for (const { reason } of chain) {
            const tag = reason.kind._tag;
            const idx =
                tag === "NonRefuters"
                || tag === "RefuterShowed"
                || tag === "RefuterOwnsOneOf"
                    ? reason.kind.suggestionIndex
                    : undefined;
            if (idx === activeSuggestionIndex) return true;
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
        <section
            id="checklist"
            className="flex h-full min-w-0 flex-col rounded-[var(--radius)] border border-border bg-panel p-4"
        >
            {inSetup && (
                <div className="mb-3 flex shrink-0 justify-end">
                    <button
                        type="button"
                        data-setup-cta
                        className="cursor-pointer rounded-[var(--radius)] border-none bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                        onClick={() =>
                            dispatch({ type: "setUiMode", mode: "checklist" })
                        }
                    >
                        {suggestions.length > 0
                            ? tSetup("continuePlaying", {
                                  shortcut: label("global.gotoPlay"),
                              })
                            : tSetup("startPlaying", {
                                  shortcut: label("global.gotoPlay"),
                              })}
                    </button>
                </div>
            )}
            <div className="shrink-0">
                {inSetup ? <CardPackRow /> : <CaseFileHeader knowledge={knowledge} />}
            </div>
            {inSetup && handSizeMismatch && (
                <div className="mb-3 shrink-0 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning">
                    {tSetup("handSizeMismatch", {
                        total: handSizesTotal,
                        expected: totalDealt,
                        caseFileCount: caseFileSize(setup),
                    })}
                </div>
            )}
            <div className="-mx-4 min-h-0 flex-1 overflow-auto px-4">
            <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-20 bg-row-header">
                    <tr>
                        <th className="border border-border bg-row-header px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                            {inSetup ? null : label("global.gotoChecklist")}
                        </th>
                        {owners.flatMap(owner => {
                            const cell = (
                                <th
                                    key={ownerKey(owner)}
                                    className="border border-border bg-row-header px-2 py-1 text-center align-top font-semibold"
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
                            );
                            return inSetup && owner._tag === "CaseFile"
                                ? [addPlayerHeaderCell, cell]
                                : [cell];
                        })}
                    </tr>
                    {inSetup && (
                        <tr>
                            <th className="whitespace-nowrap border border-border bg-row-header px-1.5 py-1 text-left font-semibold">
                                {tSetup("handSize")}
                            </th>
                            {owners.flatMap(owner => {
                                let cell: ReactNode;
                                if (owner._tag !== "Player") {
                                    cell = (
                                        <td
                                            key={ownerKey(owner)}
                                            className="border border-border"
                                        />
                                    );
                                } else {
                                    const current = handSizeMap.get(owner.player);
                                    const def = defaults.get(owner.player);
                                    cell = (
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
                                }
                                return inSetup && owner._tag === "CaseFile"
                                    ? [addPlayerEmptyCell, cell]
                                    : [cell];
                            })}
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
                                    className="border border-border bg-category-header px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-white"
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
                                                aria-label={
                                                    canRemoveCategory
                                                        ? tSetup("removeCategoryTitle", {
                                                              name: category.name,
                                                          })
                                                        : tSetup("removeCategoryMin")
                                                }
                                                disabled={!canRemoveCategory}
                                                className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-white/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                                onClick={async () => {
                                                    const categoryCardIds = new Set(
                                                        category.cards.map(c => c.id),
                                                    );
                                                    const hasKnownCards = knownCards.some(
                                                        kc => categoryCardIds.has(kc.card),
                                                    );
                                                    const hasSuggestions = state.suggestions.some(
                                                        s =>
                                                            s.cards.some(c =>
                                                                categoryCardIds.has(c),
                                                            ) ||
                                                            (s.seenCard !== undefined &&
                                                                categoryCardIds.has(
                                                                    s.seenCard,
                                                                )),
                                                    );
                                                    if (
                                                        (hasKnownCards || hasSuggestions) &&
                                                        !(await confirm({
                                                            message: tSetup(
                                                                "removeCategoryConfirm",
                                                                {
                                                                    name: category.name,
                                                                },
                                                            ),
                                                        }))
                                                    ) {
                                                        return;
                                                    }
                                                    dispatch({
                                                        type: "removeCategoryById",
                                                        categoryId: category.id,
                                                    });
                                                }}
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
                                    <th className="w-px whitespace-nowrap border border-border px-2 py-1 text-left font-normal">
                                        {inSetup ? (
                                            <div className="flex items-center justify-between gap-2">
                                                <InlineTextEdit
                                                    value={entry.name}
                                                    className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-1 py-0.5 text-[12px] focus:border-accent focus:outline-none"
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
                                                    aria-label={
                                                        canRemoveCard
                                                            ? tSetup("removeCardTitle", {
                                                                  name: entry.name,
                                                              })
                                                            : tSetup("removeCardMin")
                                                    }
                                                    disabled={!canRemoveCard}
                                                    className="cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                                                    onClick={async () => {
                                                        const hasKnownCards = knownCards.some(
                                                            kc => kc.card === entry.id,
                                                        );
                                                        const hasSuggestions = state.suggestions.some(
                                                            s =>
                                                                s.cards.some(
                                                                    c => c === entry.id,
                                                                ) ||
                                                                s.seenCard === entry.id,
                                                        );
                                                        if (
                                                            (hasKnownCards || hasSuggestions) &&
                                                            !(await confirm({
                                                                message: tSetup(
                                                                    "removeCardConfirm",
                                                                    {
                                                                        card: entry.name,
                                                                    },
                                                                ),
                                                            }))
                                                        ) {
                                                            return;
                                                        }
                                                        dispatch({
                                                            type: "removeCardById",
                                                            cardId: entry.id,
                                                        });
                                                    }}
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        ) : (
                                            entry.name
                                        )}
                                    </th>
                                    {owners.flatMap((owner, colIdx) => {
                                        const rowIdx =
                                            rowIdxByCard.get(entry.id) ?? -1;
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
                                        // In Setup mode, player cells show a native
                                        // checkbox bound to the *manual* knownCards
                                        // slice — not the deduced value. The cell
                                        // background still reflects the deduced Y/N,
                                        // so a green-background cell with an
                                        // unchecked box means "solver derived this,
                                        // you didn't enter it."
                                        const isKnownY =
                                            isPlayerCell &&
                                            knownCards.some(
                                                kc =>
                                                    kc.player ===
                                                        (owner._tag === "Player"
                                                            ? owner.player
                                                            : undefined) &&
                                                    kc.card === entry.id,
                                            );
                                        const setupCheckbox =
                                            inSetup && isPlayerCell;
                                        // Setup mode: the whole cell is the
                                        // toggle target (easier to hit on
                                        // touch than a bare checkbox).
                                        const setupInteractive =
                                            inSetup && isPlayerCell;
                                        // Play mode: the cell is read-only
                                        // w.r.t. known-card toggling, but it
                                        // pins the cell selection (for
                                        // cross-panel highlighting) and
                                        // opens the deduction-chain popover.
                                        const playInteractive =
                                            !inSetup && isPlayerCell;
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
                                        const cellContent = setupCheckbox ? (
                                            <input
                                                type="checkbox"
                                                aria-hidden
                                                tabIndex={-1}
                                                className="pointer-events-none h-4 w-4 accent-accent"
                                                checked={isKnownY}
                                                readOnly
                                            />
                                        ) : (
                                            <>
                                                <AnimatedCellGlyph value={value} />
                                                {footnoteNumbers.length > 0 &&
                                                    value === undefined && (
                                                        <sup className="ml-0.5 text-[9px] font-normal text-accent">
                                                            {footnoteNumbers.join(
                                                                ",",
                                                            )}
                                                        </sup>
                                                    )}
                                            </>
                                        );
                                        const tdClassName = cellClass(
                                            value,
                                            setupInteractive || playInteractive,
                                            isHighlighted,
                                        );
                                        const hoverHandlers = {
                                            onPointerEnter: (
                                                e: React.PointerEvent<HTMLTableCellElement>,
                                            ) => {
                                                if (e.pointerType !== "mouse")
                                                    return;
                                                setHoveredCell(
                                                    Cell(owner, entry.id),
                                                );
                                            },
                                            onPointerLeave: (
                                                e: React.PointerEvent<HTMLTableCellElement>,
                                            ) => {
                                                if (e.pointerType !== "mouse")
                                                    return;
                                                setHoveredCell(null);
                                            },
                                        };
                                        // Arrow-key grid navigation: walk to
                                        // the nearest neighbour cell with a
                                        // data-cell-row/col pair. Shared by
                                        // Setup (toggle) and Play (popover)
                                        // cells so keyboard users can sweep
                                        // through the whole grid.
                                        const onGridArrowKey = (
                                            e: React.KeyboardEvent<HTMLTableCellElement>,
                                        ) => {
                                            const native = e.nativeEvent;
                                            const dr = matches("nav.up", native)
                                                ? -1
                                                : matches("nav.down", native)
                                                  ? 1
                                                  : 0;
                                            const dc = matches("nav.left", native)
                                                ? -1
                                                : matches("nav.right", native)
                                                  ? 1
                                                  : 0;
                                            if (dr === 0 && dc === 0) return;
                                            e.preventDefault();
                                            let r = rowIdx + dr;
                                            let c = colIdx + dc;
                                            let next: HTMLElement | null = null;
                                            while (
                                                r >= 0 &&
                                                r < totalRows &&
                                                c >= 0 &&
                                                c < totalCols
                                            ) {
                                                next = document.querySelector<HTMLElement>(
                                                    `[data-cell-row="${r}"][data-cell-col="${c}"]`,
                                                );
                                                if (next) break;
                                                r += dr;
                                                c += dc;
                                            }
                                            if (next) next.focus();
                                        };
                                        const onCellFocus = () =>
                                            rememberChecklistCell(
                                                rowIdx,
                                                colIdx,
                                            );
                                        let cell: ReactNode;
                                        if (setupInteractive) {
                                            const ariaLabel = tSetup(
                                                "knownCardCheckboxAria",
                                                {
                                                    player: String(
                                                        owner._tag === "Player"
                                                            ? owner.player
                                                            : "",
                                                    ),
                                                    card: entry.name,
                                                },
                                            );
                                            cell = (
                                                <td
                                                    key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                    className={tdClassName}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-pressed={isKnownY}
                                                    aria-label={ariaLabel}
                                                    data-animated-focus
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    onFocus={onCellFocus}
                                                    onClick={() =>
                                                        toggleKnownCard(
                                                            owner,
                                                            entry.id,
                                                        )
                                                    }
                                                    onKeyDown={e => {
                                                        if (
                                                            matches(
                                                                "action.toggle",
                                                                e.nativeEvent,
                                                            )
                                                        ) {
                                                            e.preventDefault();
                                                            toggleKnownCard(
                                                                owner,
                                                                entry.id,
                                                            );
                                                            return;
                                                        }
                                                        onGridArrowKey(e);
                                                    }}
                                                    {...hoverHandlers}
                                                >
                                                    {cellContent}
                                                </td>
                                            );
                                        } else if (
                                            playInteractive &&
                                            tooltipContent
                                        ) {
                                            const thisCell = Cell(
                                                owner,
                                                entry.id,
                                            );
                                            cell = (
                                                <InfoPopover
                                                    key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                    content={tooltipContent}
                                                    variant="accent"
                                                    onOpenChange={open => {
                                                        setSelectedCell(
                                                            open
                                                                ? thisCell
                                                                : null,
                                                        );
                                                    }}
                                                >
                                                    <td
                                                        className={tdClassName}
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-haspopup="dialog"
                                                        data-animated-focus
                                                        data-cell-row={rowIdx}
                                                        data-cell-col={colIdx}
                                                        onFocus={onCellFocus}
                                                        onKeyDown={e => {
                                                            // Enter/Space should open the
                                                            // info popover. Radix binds
                                                            // click-to-toggle via asChild,
                                                            // so we synthesize a click.
                                                            if (
                                                                matches(
                                                                    "action.toggle",
                                                                    e.nativeEvent,
                                                                )
                                                            ) {
                                                                e.preventDefault();
                                                                e.currentTarget.click();
                                                                return;
                                                            }
                                                            onGridArrowKey(e);
                                                        }}
                                                        {...hoverHandlers}
                                                    >
                                                        {cellContent}
                                                    </td>
                                                </InfoPopover>
                                            );
                                        } else if (isPlayerCell) {
                                            // Play-mode player cell with no
                                            // deduction: not clickable, but
                                            // still focusable so keyboard
                                            // arrow navigation doesn't skip
                                            // blank cells.
                                            cell = (
                                                <td
                                                    key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                    className={tdClassName}
                                                    tabIndex={0}
                                                    data-animated-focus
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    onFocus={onCellFocus}
                                                    onKeyDown={onGridArrowKey}
                                                    {...hoverHandlers}
                                                >
                                                    {cellContent}
                                                </td>
                                            );
                                        } else {
                                            cell = (
                                                <td
                                                    key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                    className={tdClassName}
                                                    {...hoverHandlers}
                                                >
                                                    {cellContent}
                                                </td>
                                            );
                                        }
                                        const emptyCell = (
                                            <td
                                                key={`add-player-col-${String(entry.id)}`}
                                                className="border border-border"
                                            />
                                        );
                                        return inSetup && owner._tag === "CaseFile"
                                            ? [emptyCell, cell]
                                            : [cell];
                                    })}
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
            </div>
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
    const { state, dispatch } = useClue();
    const confirm = useConfirm();
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

    // Removing a player also drops their known cards and any suggestions
    // that reference them (see the reducer's `removePlayer` branch).
    // Prompt first when that's destructive — we skip the confirm otherwise
    // so a freshly-added empty slot doesn't feel chatty.
    const onRemove = async () => {
        const hasKnownCards = state.knownCards.some(
            kc => kc.player === player,
        );
        const hasSuggestions = state.suggestions.some(
            s =>
                s.suggester === player ||
                s.refuter === player ||
                s.nonRefuters.some(p => p === player),
        );
        if (hasKnownCards || hasSuggestions) {
            const ok = await confirm({
                message: t("removePlayerConfirm", {
                    player: String(player),
                }),
            });
            if (!ok) return;
        }
        dispatch({ type: "removePlayer", player });
    };

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    className="box-border min-w-0 flex-1 rounded border border-border px-1.5 py-1 text-[12px]"
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
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent px-2 py-1 text-[12px] font-semibold leading-none text-white hover:bg-accent-hover"
                    aria-label={t("removePlayerTitle", {
                        player: String(player),
                    })}
                    onClick={onRemove}
                >
                    &times;
                </button>
            </div>
            {error && (
                <span className="whitespace-nowrap text-[11px] text-danger">
                    {error}
                </span>
            )}
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
                detail: tReasons(`${desc.kind}.detail`, { ...desc.params }),
            };
        case "card-ownership":
        case "player-hand":
        case "case-file-category":
            return {
                headline: tReasons(`${desc.kind}.headline`),
                detail: tReasons(`${desc.kind}.detail`, { ...desc.params }),
            };
        case "non-refuters": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            const detail =
                desc.params.suggester !== undefined
                    ? tReasons("non-refuters.detailKnown", {
                          cellPlayer: desc.params.cellPlayer,
                          cellCard: desc.params.cellCard,
                          suggester: desc.params.suggester,
                          number: desc.params.suggestionIndex + 1,
                      })
                    : tReasons("non-refuters.detailUnknown", {
                          cellPlayer: desc.params.cellPlayer,
                          cellCard: desc.params.cellCard,
                          number: desc.params.suggestionIndex + 1,
                      });
            return { headline, detail };
        }
        case "refuter-showed": {
            const headline = tReasons("suggestionHeadline", {
                number: desc.params.suggestionIndex + 1,
            });
            if (desc.params.refuter === undefined) {
                return {
                    headline,
                    detail: tReasons("refuter-showed.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.suggestionIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail:
                    desc.params.seen !== undefined
                        ? tReasons("refuter-showed.detailKnown", {
                              cellPlayer: desc.params.cellPlayer,
                              cellCard: desc.params.cellCard,
                              refuter: desc.params.refuter,
                              seen: desc.params.seen,
                              number: desc.params.suggestionIndex + 1,
                          })
                        : tReasons("refuter-showed.detailKnownNoCard", {
                              cellPlayer: desc.params.cellPlayer,
                              cellCard: desc.params.cellCard,
                              refuter: desc.params.refuter,
                              number: desc.params.suggestionIndex + 1,
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
                    detail: tReasons("refuter-owns-one-of.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.suggestionIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail: tReasons("refuter-owns-one-of.detailKnown", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    refuter: desc.params.refuter,
                    suggester: desc.params.suggester,
                    cardLabels: desc.params.cardLabels,
                    number: desc.params.suggestionIndex + 1,
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
    const chainLines: string[] = chain.map(({ cell: entryCell, reason }, i) => {
        const desc = describeReason(reason, entryCell, setup, suggestions);
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

// Motion-only constants (non user-facing). The "unsolved" color
// is the app's body ink; motion can't animate "inherit" so we
// resolve it here.
const CSS_ACCENT = "var(--color-accent)";
const CSS_BORDER = "var(--color-border)";
const CSS_WHITE = "#ffffff";
const CSS_INK = "#2a1f12";
const MOTION_WAIT: "wait" = "wait";
const MOTION_POP_LAYOUT: "popLayout" = "popLayout";

function CaseFileHeader({ knowledge }: { knowledge: Knowledge }) {
    const t = useTranslations("deduce");
    const { state } = useClue();
    const setup = state.setup;
    const progress = caseFileProgress(setup, knowledge);
    const headerRef = useRef<HTMLDivElement>(null);
    const fireConfetti = useConfetti();
    const wiggleTransition = useReducedTransition(T_WIGGLE);
    const celebrateTransition = useReducedTransition(T_CELEBRATE);
    const crossfadeTransition = useReducedTransition(T_STANDARD);

    // Per-category solved state (map keyed by category id). Used to
    // detect the false→true transition that fires the wiggle.
    const solvedByCategory = useMemo(() => {
        const m = new Map<string, boolean>();
        for (const cat of setup.categories) {
            m.set(
                String(cat.id),
                caseFileAnswerFor(setup, knowledge, cat.id) !== undefined,
            );
        }
        return m;
    }, [setup, knowledge]);

    // Seed `prevSolvedRef` with the initial snapshot so a reload
    // (or first mount) of an in-progress game does NOT treat every
    // already-solved category as a fresh solve and wiggle the
    // whole header on load.
    const prevSolvedRef = useRef<Map<string, boolean> | null>(null);
    if (prevSolvedRef.current === null) {
        prevSolvedRef.current = new Map(solvedByCategory);
    }
    const [wigglingIds, setWigglingIds] = useState<ReadonlySet<string>>(
        new Set(),
    );

    useEffect(() => {
        const prev = prevSolvedRef.current;
        const newlySolved: string[] = [];
        for (const [id, isSolved] of solvedByCategory) {
            if (isSolved && !prev?.get(id)) newlySolved.push(id);
        }
        prevSolvedRef.current = new Map(solvedByCategory);
        if (newlySolved.length === 0) return;
        setWigglingIds(new Set(newlySolved));
        const timeout = setTimeout(() => setWigglingIds(new Set()), 700);
        return () => clearTimeout(timeout);
    }, [solvedByCategory]);

    // Accuse-ready: every category has a solved answer.
    const allSolved = setup.categories.length > 0 &&
        setup.categories.every(cat => solvedByCategory.get(String(cat.id)));
    // Same reasoning as `prevSolvedRef`: seed from the initial
    // render so loading a fully-solved game doesn't re-confetti.
    const wasAllSolvedRef = useRef<boolean | null>(null);
    if (wasAllSolvedRef.current === null) {
        wasAllSolvedRef.current = allSolved;
    }
    const [isCelebrating, setIsCelebrating] = useState(false);
    useEffect(() => {
        if (allSolved && !wasAllSolvedRef.current) {
            setIsCelebrating(true);
            fireConfetti(headerRef.current);
            const timeout = setTimeout(() => setIsCelebrating(false), 900);
            wasAllSolvedRef.current = true;
            return () => clearTimeout(timeout);
        }
        if (!allSolved) wasAllSolvedRef.current = false;
        return undefined;
    }, [allSolved, fireConfetti]);

    const headerAnimate = isCelebrating
        ? { scale: [1, 1.04, 1], boxShadow: [
            "0 0 0 0 rgba(122, 28, 28, 0)",
            "0 0 0 14px rgba(122, 28, 28, 0.22)",
            "0 0 0 0 rgba(122, 28, 28, 0)",
        ] }
        : { scale: 1, boxShadow: "0 0 0 0 rgba(122, 28, 28, 0)" };

    return (
        <motion.div
            ref={headerRef}
            className="mb-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3"
            animate={headerAnimate}
            transition={isCelebrating ? wiggleTransition : celebrateTransition}
        >
            <div className="mb-2.5 flex items-center gap-3 text-[13px]">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-accent">
                    <motion.span
                        animate={
                            wigglingIds.size > 0 || isCelebrating
                                ? { rotate: [0, -8, 8, -4, 0], scale: [1, 1.15, 1, 1.15, 1] }
                                : { rotate: 0, scale: 1 }
                        }
                        transition={
                            wigglingIds.size > 0 || isCelebrating
                                ? wiggleTransition
                                : celebrateTransition
                        }
                        className="inline-flex"
                    >
                        <Envelope size={16} />
                    </motion.span>
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
                    const isWiggling = wigglingIds.has(String(category.id));
                    const wiggleAnim = isWiggling
                        ? { scale: [1, 1.08, 1], rotate: [0, -2, 2, 0] }
                        : { scale: 1, rotate: 0 };
                    return (
                        <motion.div
                            key={String(category.id)}
                            className="rounded-[var(--radius)] border p-2 text-center"
                            animate={{
                                ...wiggleAnim,
                                backgroundColor: solved
                                    ? CSS_ACCENT
                                    : CSS_WHITE,
                                borderColor: solved
                                    ? CSS_ACCENT
                                    : CSS_BORDER,
                                color: solved ? CSS_WHITE : CSS_INK,
                            }}
                            transition={
                                isWiggling ? wiggleTransition : crossfadeTransition
                            }
                        >
                            <div
                                className={
                                    "mb-1 text-[11px] uppercase tracking-[0.05em] " +
                                    (solved ? "text-white/80" : "text-muted")
                                }
                            >
                                {category.name}
                            </div>
                            <AnimatePresence mode={MOTION_WAIT} initial={false}>
                                {solved ? (
                                    <motion.div
                                        key="solved"
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        transition={crossfadeTransition}
                                        className="text-[14px] font-semibold"
                                    >
                                        {cardName(setup, solved)}
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="candidates"
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 4 }}
                                        transition={crossfadeTransition}
                                        className="text-[13px] text-muted"
                                    >
                                        {t("candidatesCount", {
                                            count: candidates.length,
                                        })}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </div>
        </motion.div>
    );
}

const ownerKey = (owner: Owner): string =>
    owner._tag === "Player" ? `p-${owner.player}` : "case-file";

const cellLabel = (value: CellValue | undefined): string => {
    if (value === Y) return "✓";
    if (value === N) return "·";
    return "";
};

/**
 * Cell Y/N/blank glyph with a short pop-in/out as the value changes.
 * Using `AnimatePresence` keyed on the glyph means each state swap
 * renders a fresh `<motion.span>` that scales in while the outgoing
 * one scales out — the tween is fast (120ms) so the cell still feels
 * snappy, not animated-heavy. The cell background transition stays
 * in CSS (`transition-colors`) so motion only owns the glyph.
 */
function AnimatedCellGlyph({ value }: { readonly value: CellValue | undefined }) {
    const transition = useReducedTransition(T_FAST);
    const glyph = cellLabel(value);
    return (
        <AnimatePresence mode={MOTION_POP_LAYOUT} initial={false}>
            {glyph !== "" && (
                <motion.span
                    key={glyph}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={transition}
                    className="inline-block"
                >
                    {glyph}
                </motion.span>
            )}
        </AnimatePresence>
    );
}

const CELL_BASE =
    "w-9 min-w-9 border border-border px-2 py-1 text-center font-semibold relative";

const CELL_INTERACTIVE =
    " cursor-pointer hover:z-10 hover:ring-2 hover:ring-accent/40 focus:z-10 focus:outline-none focus:ring-2 focus:ring-accent";

const CELL_HIGHLIGHTED =
    " z-10 ring-2 ring-accent ring-offset-1 ring-offset-panel";

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
