"use client";

import { Equal, Result } from "effect";
import { useTranslations } from "next-intl";
import { playerAdded, whyTooltipOpened } from "../../analytics/events";
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Card, Owner, Player, ownerLabel } from "../../logic/GameObjects";
import {
    allCardIds,
    allOwners,
    cardName,
    caseFileSize,
    categoryName,
    categoryOfCard,
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
import { Accusation } from "../../logic/Accusation";
import { Suggestion } from "../../logic/Suggestion";
import { useConfirm } from "../hooks/useConfirm";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useSelection } from "../SelectionContext";
import { useClue } from "../state";
import { useWhyHoverIntent } from "../checklistPopoverIntent";
import {
    registerChecklistFocusHandler,
    rememberChecklistCell,
} from "../checklistFocus";
import { label, matches, shortcutSuffix } from "../keyMap";
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
 * Box around the grid nav ring. Setup mode extends the ring to
 * include the player-name (row -2), hand-size (row -1), and
 * card-name (col -1) input cells; Play mode collapses to the
 * body-cell rectangle (0..rows-1, 0..cols-1).
 */
type GridBounds = {
    readonly minRow: number;
    readonly maxRow: number;
    readonly minCol: number;
    readonly maxCol: number;
};

function findNavCell(r: number, c: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        `[data-cell-row="${r}"][data-cell-col="${c}"]`,
    );
}

/**
 * Arrow-key grid navigation. Up/Down/Left/Right walk to the nearest
 * neighbour cell published with `data-cell-row` / `data-cell-col`.
 * Cmd/Ctrl + Arrow jumps to the edge of the grid in that direction;
 * if the exact edge cell is empty (e.g. Case File column has no
 * player-name row), it walks back toward the origin and picks the
 * first cell found.
 *
 * When `isTextInput` is true, Left/Right only navigate at the text
 * boundary (cursor at pos 0 or end, no selection) so mid-string
 * editing feels normal. Up/Down always navigate (single-line
 * inputs). Cmd+Arrow always navigates (overrides browser Home/End).
 */
function navigateGrid(
    e: React.KeyboardEvent<HTMLElement>,
    rowIdx: number,
    colIdx: number,
    bounds: GridBounds,
    opts: { readonly isTextInput?: boolean } = {},
): void {
    const native = e.nativeEvent;
    // Shift/alt + arrow is reserved for browser selection / word-skip
    // inside text inputs and has no existing grid-nav semantics.
    if (native.shiftKey || native.altKey) return;
    const isArrowKey =
        native.key === "ArrowUp" ||
        native.key === "ArrowDown" ||
        native.key === "ArrowLeft" ||
        native.key === "ArrowRight";
    const isMod = (native.metaKey || native.ctrlKey) && isArrowKey;
    // Text inputs restrict nav to actual arrow keys (+ Cmd+Arrow).
    // WASD / IJKL alternates would hijack typing otherwise.
    const allowAlt = !opts.isTextInput;
    const up =
        (allowAlt && matches("nav.up", native)) ||
        native.key === "ArrowUp";
    const down =
        (allowAlt && matches("nav.down", native)) ||
        native.key === "ArrowDown";
    const left =
        (allowAlt && matches("nav.left", native)) ||
        native.key === "ArrowLeft";
    const right =
        (allowAlt && matches("nav.right", native)) ||
        native.key === "ArrowRight";
    if (!up && !down && !left && !right) return;

    const dr = up ? -1 : down ? 1 : 0;
    const dc = left ? -1 : right ? 1 : 0;

    if (opts.isTextInput && !isMod && (left || right)) {
        const el = e.currentTarget as HTMLInputElement;
        const selStart = el.selectionStart ?? 0;
        const selEnd = el.selectionEnd ?? 0;
        const len = el.value.length;
        if (selStart !== selEnd) return;
        if (left && selStart > 0) return;
        if (right && selEnd < len) return;
    }

    const current = e.currentTarget as HTMLElement;
    let target: HTMLElement | null = null;
    if (isMod) {
        // Start at the far edge along each active axis; walk back
        // toward origin by (-dr, -dc).
        let r = dr !== 0 ? (dr > 0 ? bounds.maxRow : bounds.minRow) : rowIdx;
        let c = dc !== 0 ? (dc > 0 ? bounds.maxCol : bounds.minCol) : colIdx;
        while (
            r >= bounds.minRow &&
            r <= bounds.maxRow &&
            c >= bounds.minCol &&
            c <= bounds.maxCol
        ) {
            const found = findNavCell(r, c);
            if (found && found !== current) {
                target = found;
                break;
            }
            if (dr < 0 && r >= rowIdx) break;
            if (dr > 0 && r <= rowIdx) break;
            if (dc < 0 && c >= colIdx) break;
            if (dc > 0 && c <= colIdx) break;
            r -= dr;
            c -= dc;
        }
    } else {
        let r = rowIdx + dr;
        let c = colIdx + dc;
        while (
            r >= bounds.minRow &&
            r <= bounds.maxRow &&
            c >= bounds.minCol &&
            c <= bounds.maxCol
        ) {
            const found = findNavCell(r, c);
            if (found) {
                target = found;
                break;
            }
            r += dr;
            c += dc;
        }
    }

    if (target) {
        e.preventDefault();
        target.focus();
    }
}

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
    const hasKeyboard = useHasKeyboard();
    const { state, dispatch, derived } = useClue();
    const {
        activeSuggestionIndex,
        activeAccusationIndex,
        popoverCell,
        setPopoverCell,
    } = useSelection();
    const {
        onCellPointerEnter,
        onCellPointerLeave,
        onGridLeave,
        cancelExitTimer,
    } = useWhyHoverIntent();
    const confirm = useConfirm();
    const inSetup = state.uiMode === "setup";
    const setup = state.setup;
    const knownCards = state.knownCards;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;
    const provenance = derived.provenance;
    const suggestions = derived.suggestionsAsData;
    const accusations = derived.accusationsAsData;

    // Fire `why_tooltip_opened` whenever the popover transitions from
    // closed (or another cell) to open on a new cell. Cells are fresh
    // `Cell(owner, card)` instances on each open, so reference equality
    // is the right dedupe — a re-open of the same coordinates after a
    // close still produces a new instance and counts as a new event.
    const prevPopoverCellRef = useRef<Cell | null>(null);
    useEffect(() => {
        const prev = prevPopoverCellRef.current;
        prevPopoverCellRef.current = popoverCell;
        if (popoverCell !== null && popoverCell !== prev) {
            const catId = categoryOfCard(setup.cardSet, popoverCell.card);
            whyTooltipOpened({
                categoryName: catId
                    ? categoryName(setup.cardSet, catId)
                    : "",
            });
        }
    }, [popoverCell, setup.cardSet]);

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
    // Setup mode extends the nav ring up (player-name row -2,
    // hand-size row -1) and left (card-name col -1).
    const bounds: GridBounds = {
        minRow: inSetup ? -2 : 0,
        maxRow: totalRows - 1,
        minCol: inSetup ? -1 : 0,
        maxCol: totalCols - 1,
    };

    // Handle ⌘J / ⌘H focus requests: locate a cell by (row,col) and
    // focus it. "first" falls back to the first interactive cell.
    //
    // Registered via `useLayoutEffect` (not `useEffect`) so the
    // handler is in place before any `queueMicrotask` queued by the
    // Cmd+H/J shortcut runs — a useEffect runs after paint, by which
    // point the focus call has already fired against the previously-
    // registered (exiting) Checklist.
    //
    // Cell lookups are scoped to `rootRef` so during the
    // AnimatePresence swap (both Checklists briefly in the DOM) the
    // handler can't grab the exiting pane's cell via a global
    // `document.querySelector`.
    //
    // Deps are empty (register once on mount) so this Checklist
    // can't re-register itself when its `bounds` change. Otherwise
    // the swap goes "old mount → new mount → old re-register" — the
    // exiting Checklist's `bounds` flip when `uiMode` changes and it
    // would re-register last, winning the `current` slot. Bounds and
    // the root are read through refs at handler-call time instead.
    const rootRef = useRef<HTMLElement>(null);
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;
    useLayoutEffect(() => {
        const findInRoot = (r: number, c: number): HTMLElement | null =>
            rootRef.current?.querySelector<HTMLElement>(
                `[data-cell-row="${r}"][data-cell-col="${c}"]`,
            ) ?? null;
        const unregister = registerChecklistFocusHandler(target => {
            const b = boundsRef.current;
            const findFirst = (): HTMLElement | null => {
                for (let r = b.minRow; r <= b.maxRow; r++) {
                    for (let c = b.minCol; c <= b.maxCol; c++) {
                        const el = findInRoot(r, c);
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
                    el = findInRoot(target.row, target.col) ?? findFirst();
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
    }, []);

    // In Setup mode the add-player column sits between the players and
    // the case file — clicking + spawns the new player where its column
    // would naturally appear. Each of the three owner-axis rows below
    // injects the matching header/cell right before the case-file
    // column; Play mode skips the cell entirely (unchanged column
    // count).
    const addPlayerHeaderCell = (
        <th
            key="add-player-col"
            className="w-px whitespace-nowrap border-r border-b border-border bg-row-header px-1.5 py-1 text-center"
        >
            <button
                type="button"
                className="cursor-pointer whitespace-nowrap rounded border-none bg-accent px-2 py-1 text-[12px] font-semibold leading-none text-white hover:bg-accent-hover"
                title={tSetup("addPlayerTitle")}
                onClick={() => {
                    const position = state.setup.players.length;
                    dispatch({ type: "addPlayer" });
                    playerAdded({
                        playerCount: position + 1,
                        position,
                    });
                }}
            >
                {tSetup("addPlayerLabel")}
            </button>
        </th>
    );
    const addPlayerEmptyCell = (
        <td key="add-player-col" className="border-r border-b border-border" />
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
     * Cross-highlight: when the user hovers a row in the prior
     * suggestion or accusation log, highlight every cell whose
     * provenance chain references that row's index. Suggestions can
     * additionally be pinned via tap/click; accusations are
     * hover-only today.
     */
    const cellIsHighlighted = (owner: Owner, card: Card): boolean => {
        if (activeSuggestionIndex === null && activeAccusationIndex === null) {
            return false;
        }
        if (!provenance) return false;
        const chain = chainFor(provenance, Cell(owner, card));
        for (const { reason } of chain) {
            const tag = reason.kind._tag;
            if (activeSuggestionIndex !== null) {
                const idx =
                    tag === "NonRefuters"
                    || tag === "RefuterShowed"
                    || tag === "RefuterOwnsOneOf"
                        ? reason.kind.suggestionIndex
                        : undefined;
                if (idx === activeSuggestionIndex) return true;
            }
            if (activeAccusationIndex !== null) {
                if (
                    tag === "FailedAccusation"
                    && reason.kind.accusationIndex === activeAccusationIndex
                ) {
                    return true;
                }
                if (
                    tag === "FailedAccusationPairwiseNarrowing"
                    && reason.kind.accusationIndices.includes(
                        activeAccusationIndex,
                    )
                ) {
                    return true;
                }
            }
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
            ref={rootRef}
            id="checklist"
            className="min-w-max rounded-[var(--radius)] border border-border bg-panel p-4"
            onMouseLeave={onGridLeave}
            onBlur={e => {
                // Focus left the checklist root entirely (relatedTarget
                // is outside the section). Exit popovers mode so the
                // tab key moving focus away from the grid doesn't
                // leave a stranded popover + suggestion highlight.
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                onGridLeave();
            }}
        >
            {inSetup && (
                <div className="mb-4 shrink-0 rounded-[var(--radius)] border border-accent/40 bg-accent/5 px-4 py-3 [@media(min-width:800px)]:sticky [@media(min-width:800px)]:left-9 [@media(min-width:800px)]:max-w-[calc(100vw-4.5rem)]">
                    <h2 className="m-0 font-display text-[20px] text-accent">
                        {tSetup("title")}
                    </h2>
                    <p className="m-0 mt-1.5 text-[14px] leading-relaxed">
                        {tSetup("description")}
                    </p>
                    <div className="mt-3 flex justify-start [@media(min-width:800px)]:justify-end">
                        <button
                            type="button"
                            data-setup-cta
                            data-tour-anchor="setup-start-playing"
                            className="cursor-pointer rounded-[var(--radius)] border-none bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                            onClick={() =>
                                dispatch({
                                    type: "setUiMode",
                                    mode: "checklist",
                                })
                            }
                        >
                            {suggestions.length > 0
                                ? tSetup("continuePlaying", {
                                      shortcut: shortcutSuffix("global.gotoPlay", hasKeyboard),
                                  })
                                : tSetup("startPlaying", {
                                      shortcut: shortcutSuffix("global.gotoPlay", hasKeyboard),
                                  })}
                        </button>
                    </div>
                </div>
            )}
            <div className="shrink-0 [@media(min-width:800px)]:sticky [@media(min-width:800px)]:left-9 [@media(min-width:800px)]:max-w-[calc(100vw-4.5rem)]">
                {inSetup ? <CardPackRow /> : <CaseFileHeader knowledge={knowledge} />}
            </div>
            {inSetup && handSizeMismatch && (
                <div className="mb-3 shrink-0 rounded-[var(--radius)] border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning [@media(min-width:800px)]:sticky [@media(min-width:800px)]:left-9 [@media(min-width:800px)]:max-w-[calc(100vw-4.5rem)]">
                    {tSetup("handSizeMismatch", {
                        total: handSizesTotal,
                        expected: totalDealt,
                        caseFileCount: caseFileSize(setup),
                    })}
                </div>
            )}
            <div className="-mx-4 px-4">
            <table className="w-full border-separate border-spacing-0 border-t border-l border-border text-[13px]">
                <thead className="sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] z-20 bg-row-header">
                    <tr>
                        <th className="border-r border-b border-border bg-row-header px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.05em] text-muted">
                            {inSetup || !hasKeyboard ? null : label("global.gotoChecklist")}
                        </th>
                        {owners.flatMap((owner, ownerIdx) => {
                            const cell = (
                                <th
                                    key={ownerKey(owner)}
                                    className="border-r border-b border-border bg-row-header px-2 py-1 text-center align-top font-semibold"
                                >
                                    {inSetup && owner._tag === "Player" ? (
                                        <PlayerNameInput
                                            player={owner.player}
                                            allPlayers={setup.players}
                                            colIdx={ownerIdx}
                                            bounds={bounds}
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
                            <th className="whitespace-nowrap border-r border-b border-border bg-row-header px-1.5 py-1 text-left font-semibold">
                                {tSetup("handSize")}
                            </th>
                            {owners.flatMap((owner, ownerIdx) => {
                                let cell: ReactNode;
                                if (owner._tag !== "Player") {
                                    cell = (
                                        <td
                                            key={ownerKey(owner)}
                                            className="border-r border-b border-border"
                                        />
                                    );
                                } else {
                                    const current = handSizeMap.get(owner.player);
                                    const def = defaults.get(owner.player);
                                    // Anchor the setup tour's hand-size step
                                    // to EVERY player's hand-size cell so the
                                    // spotlight highlights the whole row, not
                                    // just one cell. The TourPopover unions
                                    // the matched rects.
                                    cell = (
                                        <td
                                            key={ownerKey(owner)}
                                            className="border-r border-b border-border px-1.5 py-1 text-center"
                                            data-tour-anchor="setup-hand-size"
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
                                                data-cell-row={-1}
                                                data-cell-col={ownerIdx}
                                                onFocus={() =>
                                                    rememberChecklistCell(
                                                        -1,
                                                        ownerIdx,
                                                    )
                                                }
                                                onKeyDown={e =>
                                                    navigateGrid(
                                                        e,
                                                        -1,
                                                        ownerIdx,
                                                        bounds,
                                                        { isTextInput: true },
                                                    )
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
                                    className="border-r border-b border-border bg-category-header px-2 py-1.5 text-left text-[11px] uppercase tracking-[0.05em] text-white"
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
                            ...category.cards.map(entry => {
                                const cardRowIdx =
                                    rowIdxByCard.get(entry.id) ?? -1;
                                return (
                                <tr key={String(entry.id)}>
                                    <th className="w-px whitespace-nowrap border-r border-b border-border px-2 py-1 text-left font-normal">
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
                                                    navCell={{
                                                        rowIdx: cardRowIdx,
                                                        colIdx: -1,
                                                        bounds,
                                                    }}
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
                                            accusations,
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
                                        // A cell needs the interactive
                                        // ring style when the user can
                                        // focus or hover it: Setup-mode
                                        // toggleable cells, Play-mode
                                        // player cells with a deduction,
                                        // and Play-mode case-file cells
                                        // with a deduction. Setup mode
                                        // intentionally gives case-file
                                        // cells NO popover affordance —
                                        // setup is for entering inputs,
                                        // not exploring the deduction
                                        // chain.
                                        const popoverInteractive =
                                            tooltipContent !== undefined
                                            && !inSetup
                                            && (playInteractive || !isPlayerCell);
                                        const tdClassName = cellClass(
                                            value,
                                            setupInteractive
                                                || playInteractive
                                                || popoverInteractive,
                                            isHighlighted,
                                        );
                                        const thisCellForHover = Cell(
                                            owner,
                                            entry.id,
                                        );
                                        // Hover handlers are provided for
                                        // every cell so the grid-leave /
                                        // decay accounting stays consistent
                                        // whether or not this particular
                                        // cell has a deduction to show.
                                        // Non-deducible cells never satisfy
                                        // the "open a popover" path, but
                                        // moving onto them still resets the
                                        // decay timer so sweeping across a
                                        // mix of deducible and empty cells
                                        // behaves intuitively.
                                        const hoverHandlers = {
                                            onPointerEnter: (
                                                e: React.PointerEvent<HTMLTableCellElement>,
                                            ) => {
                                                if (e.pointerType !== "mouse")
                                                    return;
                                                onCellPointerEnter(
                                                    thisCellForHover,
                                                );
                                            },
                                            onPointerLeave: (
                                                e: React.PointerEvent<HTMLTableCellElement>,
                                            ) => {
                                                if (e.pointerType !== "mouse")
                                                    return;
                                                onCellPointerLeave();
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
                                        ) => navigateGrid(e, rowIdx, colIdx, bounds);
                                        const onCellFocus = () =>
                                            rememberChecklistCell(
                                                rowIdx,
                                                colIdx,
                                            );
                                        // Tour anchors:
                                        //   - `setup-known-cell` ("Mark
                                        //     the cards you were dealt")
                                        //     applies to every cell in
                                        //     the first player column so
                                        //     the spotlight highlights the
                                        //     whole column the user fills
                                        //     in.
                                        //   - `checklist-cell` ("Click a
                                        //     cell to record what you
                                        //     know") applies only to the
                                        //     top-left cell — a
                                        //     teach-the-click anchor for
                                        //     the play-mode tour.
                                        // The TourPopover unions all
                                        // matched rects via the `~=`
                                        // attribute selector.
                                        const firstColAnchor =
                                            colIdx === 0
                                                ? "setup-known-cell"
                                                : undefined;
                                        const firstCellAnchor =
                                            rowIdx === 0 && colIdx === 0
                                                ? "checklist-cell"
                                                : undefined;
                                        const anchorTokens = [
                                            firstColAnchor,
                                            firstCellAnchor,
                                        ].filter(
                                            (t): t is string => t !== undefined,
                                        );
                                        const firstCellAnchorAttr:
                                            | Record<string, string>
                                            | undefined =
                                            anchorTokens.length > 0
                                                ? {
                                                      "data-tour-anchor":
                                                          anchorTokens.join(" "),
                                                  }
                                                : undefined;
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
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    {...firstCellAnchorAttr}
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
                                        } else if (popoverInteractive) {
                                            // Either:
                                            //   - Play-mode player cell with
                                            //     a deduction (the original
                                            //     case), OR
                                            //   - Play-mode case-file cell
                                            //     with a deduction (the
                                            //     case file is read-only
                                            //     and the value is always
                                            //     derived).
                                            //
                                            // Setup mode intentionally
                                            // skips this branch: the
                                            // checklist there is for
                                            // entering inputs, not
                                            // exploring deductions.
                                            //
                                            // Both render the same
                                            // InfoPopover wrapper so the
                                            // deduction chain is reachable
                                            // by hover, click, tap, and
                                            // keyboard (Enter / Space) with
                                            // arrow-key grid navigation.
                                            const thisCell = Cell(
                                                owner,
                                                entry.id,
                                            );
                                            const isOpen = Equal.equals(
                                                popoverCell,
                                                thisCell,
                                            );
                                            cell = (
                                                <InfoPopover
                                                    key={`${ownerKey(owner)}-${String(entry.id)}`}
                                                    content={tooltipContent}
                                                    variant="accent"
                                                    open={isOpen}
                                                    onOpenChange={open => {
                                                        if (open) {
                                                            // Explicit
                                                            // activation
                                                            // (click /
                                                            // tap /
                                                            // keyboard) —
                                                            // overrides
                                                            // any
                                                            // in-flight
                                                            // exit
                                                            // timer.
                                                            cancelExitTimer();
                                                            setPopoverCell(
                                                                thisCell,
                                                            );
                                                        } else {
                                                            setPopoverCell(
                                                                null,
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <td
                                                        className={tdClassName}
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-haspopup="dialog"
                                                        data-cell-row={rowIdx}
                                                        data-cell-col={colIdx}
                                                        {...firstCellAnchorAttr}
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
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    {...firstCellAnchorAttr}
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
                                                    {...firstCellAnchorAttr}
                                                    {...hoverHandlers}
                                                >
                                                    {cellContent}
                                                </td>
                                            );
                                        }
                                        const emptyCell = (
                                            <td
                                                key={`add-player-col-${String(entry.id)}`}
                                                className="border-r border-b border-border"
                                            />
                                        );
                                        return inSetup && owner._tag === "CaseFile"
                                            ? [emptyCell, cell]
                                            : [cell];
                                    })}
                                </tr>
                                );
                            }),
                            ...(inSetup
                                ? [
                                      <tr key={`add-card-${String(category.id)}`}>
                                          <th
                                              colSpan={cardSpan}
                                              className="border-r border-b border-border bg-row-alt px-1.5 py-1 text-left"
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
                                className="border-r border-b border-border bg-row-alt px-1.5 py-2 text-center"
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
 *
 * If `navCell` is provided the input joins the Checklist grid nav
 * ring at that (row, col): arrow keys walk to neighbour cells
 * (Left/Right only at the text boundary), Cmd/Ctrl+Arrow jumps to
 * the edge.
 */
function InlineTextEdit({
    value,
    onCommit,
    className,
    title,
    navCell,
}: {
    value: string;
    onCommit: (next: string) => void;
    className?: string;
    title?: string;
    navCell?: {
        readonly rowIdx: number;
        readonly colIdx: number;
        readonly bounds: GridBounds;
    };
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
            {...(navCell
                ? {
                      "data-cell-row": navCell.rowIdx,
                      "data-cell-col": navCell.colIdx,
                  }
                : {})}
            onFocus={
                navCell
                    ? () =>
                          rememberChecklistCell(
                              navCell.rowIdx,
                              navCell.colIdx,
                          )
                    : undefined
            }
            onChange={e => setLocal(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (navCell) {
                    navigateGrid(
                        e,
                        navCell.rowIdx,
                        navCell.colIdx,
                        navCell.bounds,
                        { isTextInput: true },
                    );
                    if (e.defaultPrevented) return;
                }
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
 *
 * The input joins the Checklist grid nav ring at row -2 so arrow
 * keys sweep between player-name inputs and down into the hand-size
 * and card cells; Cmd/Ctrl+Arrow jumps to the grid edge.
 */
function PlayerNameInput({
    player,
    allPlayers,
    colIdx,
    bounds,
}: {
    player: Player;
    allPlayers: ReadonlyArray<Player>;
    colIdx: number;
    bounds: GridBounds;
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

    // Anchor the setup tour's "add players" step to the first
    // player-name input.
    const isFirstPlayer = colIdx === 0;
    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    className="box-border min-w-0 flex-1 rounded border border-border px-1.5 py-1 text-[12px]"
                    value={editing}
                    data-cell-row={-2}
                    data-cell-col={colIdx}
                    {...(isFirstPlayer
                        ? { "data-tour-anchor": "setup-player-column" }
                        : {})}
                    onFocus={() => rememberChecklistCell(-2, colIdx)}
                    onChange={e => {
                        setEditing(e.currentTarget.value);
                        setError("");
                    }}
                    onBlur={commit}
                    onKeyDown={e => {
                        navigateGrid(e, -2, colIdx, bounds, {
                            isTextInput: true,
                        });
                        if (e.defaultPrevented) return;
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
        case "disjoint-groups-hand-lock":
            return {
                headline: tReasons("disjoint-groups-hand-lock.headline"),
                detail: tReasons("disjoint-groups-hand-lock.detail", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    player: desc.params.player,
                    groupCount: desc.params.groupCount,
                    suggestionNumbers: desc.params.suggestionNumbers,
                }),
            };
        case "failed-accusation": {
            const headline = tReasons("accusationHeadline", {
                number: desc.params.accusationIndex + 1,
            });
            if (
                desc.params.accuser === undefined ||
                desc.params.cardLabels === undefined
            ) {
                return {
                    headline,
                    detail: tReasons("failed-accusation.detailUnknown", {
                        cellPlayer: desc.params.cellPlayer,
                        cellCard: desc.params.cellCard,
                        number: desc.params.accusationIndex + 1,
                    }),
                };
            }
            return {
                headline,
                detail: tReasons("failed-accusation.detailKnown", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    accuser: desc.params.accuser,
                    cardLabels: desc.params.cardLabels,
                    number: desc.params.accusationIndex + 1,
                }),
            };
        }
        case "failed-accusation-pairwise":
            return {
                headline: tReasons("failed-accusation-pairwise.headline"),
                detail: tReasons("failed-accusation-pairwise.detail", {
                    cellPlayer: desc.params.cellPlayer,
                    cellCard: desc.params.cellCard,
                    pinnedCardLabel: desc.params.pinnedCardLabel,
                    accusationCount: desc.params.accusationIndices.length,
                    accusationNumbers: desc.params.accusationNumbers,
                }),
            };
    }
};

const buildCellTitle = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
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
        accusations,
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
        const desc = describeReason(
            reason,
            entryCell,
            setup,
            suggestions,
            accusations,
        );
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
            data-tour-anchor="checklist-case-file"
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
    "w-9 min-w-9 border-r border-b border-border px-2 py-1 text-center font-semibold relative";

// Z-index ladder for the checklist:
//   - sticky <thead>            : z-20 (anchored at top during scroll)
//   - body cell hover ring      : z-30 (above thead so the hover ring
//                                 doesn't get clipped when the cell is
//                                 near the top of the viewport)
//   - cross-pane highlight ring : z-30 (same reason)
//   - body cell focus-visible   : z-40 (above hover so a hovered ring
//                                 doesn't obscure the focused outline,
//                                 and well above any neighboring cell
//                                 painted in document order)
// Without these bumps, a hovered cell sitting under the sticky thead
// got its top ring sheared off, and a focused cell's right/bottom
// outline was painted over by its neighbors (each cell has
// position:relative, so without z-index escape they stack in DOM
// order and the right neighbour wins).
//
// Focus indicator: `ring-[3px] ring-offset-2` (box-shadow) instead of
// `outline-3 outline-offset-2`. Outlines on `<td>` cells in
// `border-collapse: separate` get clipped at the cell's left edge —
// reproducible on the case-file column whose left neighbour ends at
// the column boundary. Box-shadow paints with the element's own
// stacking context and respects z-index escape, so the ring renders
// on all four sides regardless of which cell its neighbour is.
//
// 3px ring matches the global `*:focus-visible` outline width set
// in `app/globals.css` so checklist cells read at the same weight
// as every other focusable element on the page (inputs, buttons,
// etc.).
//
// The ring-offset color is set per-cell to match the cell's own
// background (`ring-offset-yes-bg`, `ring-offset-no-bg`, or
// `ring-offset-white`) so the 2px offset blends into the cell —
// visually equivalent to the transparent offset CSS outlines have.
// Without that match the offset would render as a solid panel band
// and the focus indicator would look like a thick double-ring.
const CELL_INTERACTIVE =
    " cursor-pointer hover:z-30 hover:rounded-[2px] hover:ring-2 hover:ring-accent/30 focus-visible:z-40 focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:rounded-[2px] focus-visible:outline-none";

const CELL_HIGHLIGHTED =
    " z-30 ring-2 ring-accent ring-offset-1 ring-offset-panel";

const cellClass = (
    value: CellValue | undefined,
    interactive: boolean,
    highlighted: boolean,
): string => {
    let base = interactive ? `${CELL_BASE}${CELL_INTERACTIVE}` : CELL_BASE;
    if (highlighted) base += CELL_HIGHLIGHTED;
    // Bg + matching ring-offset color so the focus ring's offset
    // blends into the cell's own background (mimics the transparent
    // gap of the outline-based indicator we replaced).
    if (value === Y) return `${base} bg-yes-bg text-yes focus-visible:ring-offset-yes-bg`;
    if (value === N) return `${base} bg-no-bg text-no focus-visible:ring-offset-no-bg`;
    return `${base} bg-white focus-visible:ring-offset-white`;
};
