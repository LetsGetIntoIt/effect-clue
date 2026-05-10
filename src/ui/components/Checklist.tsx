"use client";

import { Duration, Equal, HashMap, Result } from "effect";
import {
    displayFor,
    statusFor,
    type CellDisplay,
    type HypothesisStatus,
    type HypothesisValue,
} from "../../logic/Hypothesis";
import { CellLayout } from "./CellLayout";
import { CellExplanationRow, hypothesisValueFor } from "./CellExplanationRow";
import {
    CELL_TONE_NEUTRAL_CLASS,
    CELL_TONE_Y_CLASS,
    GLYPH_BLANK,
    glyphKindFor,
    ProseChecklistIcon,
    renderGlyphNode,
} from "./CellGlyph";

// Analytics enum tag for the "no hypothesis" baseline. Module-scope
// so the `no-literal-string` lint rule reads it as code, not UI text.
const ANALYTICS_PREV_OFF = "off" as const;
import { useTranslations } from "next-intl";
import {
    hypothesisCleared,
    hypothesisSet,
    whyTooltipOpened,
    type CellHypothesisStatus,
} from "../../analytics/events";
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
    allOwners,
    cardName,
    categoryName,
    categoryOfCard,
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
import { KnownCard } from "../../logic/InitialKnowledge";
import { Suggestion } from "../../logic/Suggestion";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useSelection } from "../SelectionContext";
import { useClue } from "../state";
import {
    registerChecklistFocusHandler,
    rememberChecklistCell,
} from "../checklistFocus";
import { label, matches } from "../keyMap";
import { AnimatePresence, motion, type Transition } from "motion/react";
import {
    T_CELEBRATE,
    T_FAST,
    T_STANDARD,
    T_WIGGLE,
    useReducedTransition,
} from "../motion";
import { useConfetti } from "../hooks/useConfetti";
import { Envelope, LightbulbIcon } from "./Icons";

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
 * Play-mode deduction grid: the read-only checklist where the user
 * tracks who-has-what across the game. Setup mode is owned by the
 * M6 `<SetupWizard>` accordion (see `src/ui/setup/`); this component
 * focuses on the post-setup play surface — Y / N / blank cells,
 * cross-highlighting, footnotes, the per-cell "why" popover, and
 * the case-file column.
 */
export function Checklist() {
    const t = useTranslations("deduce");
    const tReasons = useTranslations("reasons");
    const hasKeyboard = useHasKeyboard();
    const { state, dispatch, derived } = useClue();
    const {
        activeSuggestionIndex,
        activeAccusationIndex,
        popoverCell,
        setPopoverCell,
    } = useSelection();
    // Local alias — the SelectionContext field is named for the old
    // popover, but its meaning ("which cell's explanation is currently
    // exposed") still fits the inline-row model.
    const expandedCell = popoverCell;
    const setExpandedCell = setPopoverCell;
    const setup = state.setup;
    const result = derived.deductionResult;
    const footnotes = derived.footnotes;
    const provenance = derived.provenance;
    const jointProvenance = derived.jointProvenance;
    const suggestions = derived.suggestionsAsData;
    const accusations = derived.accusationsAsData;
    const hypotheses = derived.hypotheses;
    const jointDeductionResult = derived.jointDeductionResult;
    const realKnowledge = Result.isSuccess(result) ? result.success : undefined;
    const jointKnowledge =
        jointDeductionResult !== undefined &&
        Result.isSuccess(jointDeductionResult)
            ? jointDeductionResult.success
            : undefined;
    const jointFailed =
        jointDeductionResult !== undefined &&
        Result.isFailure(jointDeductionResult);
    // When the popover is open on a derived-from-hypothesis cell, we
    // light up every direct-hypothesis cell so the user can see the
    // assumption(s) that produced the value they're inspecting.
    const popoverIsOnDerivedCell =
        popoverCell !== null &&
        statusFor(
            popoverCell,
            realKnowledge,
            jointKnowledge,
            hypotheses,
            jointFailed,
        ).kind === "derived";

    // Hypothesis keyboard shortcuts (bare letter keys: O / Y / N).
    // Implemented as a single window-level listener instead of three
    // `useGlobalShortcut` calls so the gates run BEFORE
    // `e.preventDefault()`. The shared helper unconditionally
    // preventDefault's any matching event, which would swallow plain
    // typing in setup-mode inputs (e.g. renaming "Miss Scarlet" to
    // "Ms. Scarlet" — the "n" / "o" / "y" characters never reach the
    // input).
    //
    // The handler bails early — without preventDefault — when:
    //   - the keystroke target is a text input / textarea / content-
    //     editable element (defensive: a focused suggestion-form input
    //     could share the page with an open popover);
    //   - no why popover is open (`popoverCell === null`).
    const popoverCellRef = useRef<Cell | null>(popoverCell);
    popoverCellRef.current = popoverCell;
    // Touch two-tap protocol. On touch devices, the first tap on a
    // cell only focuses it; a second tap on the already-focused cell
    // is what opens its explanation row. Mouse and keyboard remain
    // single-action: clicking or pressing Enter/Space immediately
    // toggles the row.
    //
    // `pointerdown` fires before the browser moves focus to the tapped
    // element, so checking `document.activeElement === currentTarget`
    // at that moment tells us whether THIS cell was already focused
    // before this tap (i.e. the second tap of a two-tap sequence). The
    // value is consumed by the cell's onClick handler. We set `null`
    // for non-touch pointers so onClick can detect "mouse / keyboard"
    // and skip the two-tap gating.
    const wasTouchSecondTapRef = useRef<boolean | null>(null);
    // DOM ref for the currently-open explanation row. Used by the
    // outside-click effect below to decide whether a click should
    // close the row.
    const explainRowNodeRef = useRef<HTMLElement | null>(null);
    // Map from `ownerCellKey` to the popover-interactive cell's DOM
    // node. Each such cell registers itself via a callback ref. The
    // popover-cell-changed effect below uses this map to move focus
    // onto the cell whose popover just opened — important for the
    // mouse hover-intent path, which sets `popoverCell` after a
    // 300 ms hover but never naturally moves focus. With the cell
    // focused, the `:focus` ring outlines the popover's anchor cell
    // even when the popover content is portaled away from it.
    const cellNodesByKeyRef = useRef<Map<string, HTMLElement>>(new Map());
    // Analytics context: snapshot the inputs `statusFor` needs so the
    // keyboard handler can read them at action time without bloating
    // the useEffect dep list.
    const analyticsCtxRef = useRef({
        hypotheses,
        realKnowledge,
        jointKnowledge,
        jointFailed,
    });
    analyticsCtxRef.current = {
        hypotheses,
        realKnowledge,
        jointKnowledge,
        jointFailed,
    };
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as Element | null;
            if (
                target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || (target instanceof HTMLElement && target.isContentEditable)
            ) {
                return;
            }
            const cell = popoverCellRef.current;
            if (cell === null) return;
            const ctx = analyticsCtxRef.current;
            const prevValue = hypothesisValueFor(ctx.hypotheses, cell);
            const cellStatus = statusFor(
                cell,
                ctx.realKnowledge,
                ctx.jointKnowledge,
                ctx.hypotheses,
                ctx.jointFailed,
            ).kind as CellHypothesisStatus;
            if (matches("hypothesis.setOff", e)) {
                e.preventDefault();
                dispatch({ type: "clearHypothesis", cell });
                if (prevValue !== undefined) {
                    hypothesisCleared({
                        previousValue: prevValue,
                        cellStatus,
                        source: "keyboard",
                    });
                }
            } else if (matches("hypothesis.setY", e)) {
                e.preventDefault();
                dispatch({ type: "setHypothesis", cell, value: Y });
                hypothesisSet({
                    value: Y,
                    previousValue: prevValue ?? ANALYTICS_PREV_OFF,
                    cellStatus,
                    source: "keyboard",
                });
            } else if (matches("hypothesis.setN", e)) {
                e.preventDefault();
                dispatch({ type: "setHypothesis", cell, value: N });
                hypothesisSet({
                    value: N,
                    previousValue: prevValue ?? ANALYTICS_PREV_OFF,
                    cellStatus,
                    source: "keyboard",
                });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [dispatch]);

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
            const popoverStatus = statusFor(
                popoverCell,
                realKnowledge,
                jointKnowledge,
                hypotheses,
                jointFailed,
            );
            const realValue = realKnowledge
                ? getCellByOwnerCard(
                      realKnowledge,
                      popoverCell.owner,
                      popoverCell.card,
                  )
                : undefined;
            whyTooltipOpened({
                categoryName: catId
                    ? categoryName(setup.cardSet, catId)
                    : "",
                hasDeduction: realValue !== undefined,
                hasHypothesis:
                    hypothesisValueFor(hypotheses, popoverCell) !== undefined,
                status: popoverStatus.kind as CellHypothesisStatus,
            });
        }
    }, [
        popoverCell,
        setup.cardSet,
        realKnowledge,
        jointKnowledge,
        hypotheses,
        jointFailed,
    ]);

    const playerColumnKeys = useStablePlayerColumnKeys(setup.players);

    // When `popoverCell` becomes (or changes to) a non-null cell,
    // move focus onto its trigger `<td>` if it isn't already there.
    // The hover-intent path opens the popover from a mouse hover,
    // which doesn't naturally move focus; without this effect the
    // popover would float without a visible cell anchor (the popover
    // content is portaled into `document.body`, so the visual link
    // back to the trigger comes entirely from the cell's `:focus`
    // ring). `preventScroll: true` keeps the page from jumping —
    // the user is already looking at the cell.
    useEffect(() => {
        if (popoverCell === null) return;
        const key = `${ownerKey(popoverCell.owner, playerColumnKeys)}-${String(popoverCell.card)}`;
        const node = cellNodesByKeyRef.current.get(key);
        if (node && document.activeElement !== node) {
            node.focus({ preventScroll: true });
        }
    }, [popoverCell, playerColumnKeys]);

    // Open-cell metrics for the cell-to-details visual seam. The
    // explanation row's accent border-t paints across the entire row,
    // including the slice directly below the open cell — that 2px
    // line breaks the "one continuous outline" feel. We measure the
    // open cell's left/width relative to the explanation row's
    // content td (`explainRowNodeRef`) and render a `bg-panel` cover
    // strip at exactly that horizontal range, masking the border at
    // the cell's column. ResizeObservers on both nodes keep the
    // metrics current through table resizes / layout shifts.
    interface CellMetrics {
        readonly left: number;
        readonly width: number;
    }
    const [openCellMetrics, setOpenCellMetrics] =
        useState<CellMetrics | null>(null);
    useLayoutEffect(() => {
        if (popoverCell === null) {
            setOpenCellMetrics(null);
            return;
        }
        const key = `${ownerKey(popoverCell.owner, playerColumnKeys)}-${String(popoverCell.card)}`;
        const cellNode = cellNodesByKeyRef.current.get(key);
        const rowNode = explainRowNodeRef.current;
        if (!cellNode || !rowNode) {
            setOpenCellMetrics(null);
            return;
        }
        const measure = () => {
            const cellRect = cellNode.getBoundingClientRect();
            const rowRect = rowNode.getBoundingClientRect();
            setOpenCellMetrics({
                left: cellRect.left - rowRect.left,
                width: cellRect.width,
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(cellNode);
        observer.observe(rowNode);
        return () => observer.disconnect();
    }, [popoverCell, playerColumnKeys]);

    // Close on Escape, regardless of where focus is currently parked
    // (the open cell, a control inside the explanation row, or any
    // other element). Only active while a row is open so we don't
    // shadow Esc handling elsewhere.
    useEffect(() => {
        if (expandedCell === null) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setExpandedCell(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [expandedCell, setExpandedCell]);

    // Close on click outside the open cell + explanation row.
    //
    // We listen for `click` (not `pointerdown`) so that touch
    // scrolls — which fire `pointerdown` at the start of every drag —
    // do NOT dismiss the panel. The page (and the table inside it)
    // must stay scrollable while details are open: a `click` only
    // fires on a tap that didn't move significantly, which is the
    // gesture we actually want to count as "outside dismiss".
    //
    // The cell node lookup is by the same key the focus-restore
    // effect uses; the row node is captured by the explanation row's
    // callback ref. A click landing inside either node is "still
    // engaged" and does not close.
    useEffect(() => {
        if (expandedCell === null) return;
        const onClickOutside = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (target === null) return;
            const key = `${ownerKey(expandedCell.owner, playerColumnKeys)}-${String(expandedCell.card)}`;
            const cellNode = cellNodesByKeyRef.current.get(key);
            const rowNode = explainRowNodeRef.current;
            if (cellNode && cellNode.contains(target)) return;
            if (rowNode && rowNode.contains(target)) return;
            setExpandedCell(null);
        };
        // Capture phase so we run before any React onClick inside the
        // table (e.g. tapping a different cell) — the closure's stale
        // `expandedCell` would otherwise dismiss after the cell's own
        // handler reopened on the new target. Capture-then-bubble
        // means React's batched setExpandedCell(null)→setExpandedCell(
        // newCell) collapses to `newCell`.
        window.addEventListener("click", onClickOutside, true);
        return () =>
            window.removeEventListener("click", onClickOutside, true);
    }, [expandedCell, playerColumnKeys, setExpandedCell]);

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
    const bounds: GridBounds = {
        minRow: 0,
        maxRow: totalRows - 1,
        minCol: 0,
        maxCol: totalCols - 1,
    };

    const tableEntryTransition = useReducedTransition(TABLE_ENTRY_TRANSITION);
    const tableRowEntryTransition = useReducedTransition(
        TABLE_ROW_ENTRY_TRANSITION,
    );
    const explainRowTransition = useReducedTransition(EXPLAIN_ROW_TRANSITION);
    const tableCollapseTransition = useReducedTransition(
        TABLE_COLLAPSE_TRANSITION,
    );
    const tableDangerTransition = useReducedTransition(
        TABLE_DANGER_TRANSITION,
        { fadeMs: TABLE_REDUCED_DANGER_FADE_MS },
    );
    const tableExitFadeSeconds =
        typeof tableDangerTransition.duration === "number"
            ? tableDangerTransition.duration
            : TABLE_DANGER_FADE_SECONDS;
    const tableExitRedSeconds =
        tableExitFadeSeconds + TABLE_DANGER_HOLD_SECONDS;
    const tableExitCollapseSeconds =
        typeof tableCollapseTransition.duration === "number"
            ? tableCollapseTransition.duration
            : Duration.toSeconds(TABLE_COLLAPSE_DURATION);
    const tableExitTotalSeconds =
        tableExitRedSeconds + tableExitCollapseSeconds;
    const tableExitRedRatio =
        tableExitTotalSeconds === 0
            ? 1
            : tableExitRedSeconds / tableExitTotalSeconds;
    const rowExit = {
        maxHeight: [CELL_EXPAND_CAP_PX, CELL_EXPAND_CAP_PX, 0],
        opacity: 1,
        backgroundColor: CSS_DANGER,
        color: CSS_WHITE,
        transition: {
            maxHeight: {
                duration: tableExitTotalSeconds,
                times: [0, tableExitRedRatio, 1],
                ease: TABLE_EASE,
            },
            backgroundColor: tableDangerTransition,
            color: tableDangerTransition,
        },
    };
    const columnExit = {
        ...TABLE_COLUMN_HIDDEN,
        opacity: 1,
        transition: {
            ...tableCollapseTransition,
            delay: tableExitRedSeconds,
        },
    } as const;
    const cellExitTone = {
        backgroundColor: CSS_DANGER,
        color: CSS_WHITE,
        transition: {
            backgroundColor: tableDangerTransition,
            color: tableDangerTransition,
        },
    } as const;
    const columnCellExit = {
        maxWidth: 0,
        opacity: 1,
        backgroundColor: CSS_DANGER,
        color: CSS_WHITE,
        transition: {
            maxWidth: {
                ...tableCollapseTransition,
                delay: tableExitRedSeconds,
            },
            backgroundColor: tableDangerTransition,
            color: tableDangerTransition,
        },
    } as const;
    const rowPresenceExit = {
        opacity: 1,
        transition: { duration: tableExitTotalSeconds },
    } as const;
    const tableRowMotionProps = {
        exit: rowPresenceExit,
    } as const;
    const renderDimensionReveal = (
        axis: TableAnimationAxis,
        children: ReactNode,
        className?: string,
        transition: Transition = axis === TABLE_AXIS_ROW
            ? tableRowEntryTransition
            : tableEntryTransition,
    ) => (
        <motion.div
            className={className}
            initial={
                axis === TABLE_AXIS_ROW ? TABLE_ROW_HIDDEN : TABLE_COLUMN_HIDDEN
            }
            animate={
                axis === TABLE_AXIS_ROW
                    ? TABLE_ROW_VISIBLE
                    : TABLE_COLUMN_VISIBLE
            }
            exit={axis === TABLE_AXIS_ROW ? rowExit : columnExit}
            transition={transition}
            style={STYLE_OVERFLOW_HIDDEN}
        >
            {children}
        </motion.div>
    );
    const renderRowReveal = (
        children: ReactNode,
        className?: string,
        transition?: Transition,
    ) => (
        renderDimensionReveal(TABLE_AXIS_ROW, children, className, transition)
    );
    const renderColumnReveal = (children: ReactNode, className?: string) => (
        renderDimensionReveal(TABLE_AXIS_COLUMN, children, className)
    );
    // Body cells pass a `<CellLayout />` here, which already provides
    // the grid container — so this helper just wraps the content in
    // the row/column reveal animations. Empty cells (e.g. the setup-
    // mode add-player case-file slot) pass `null`.
    const renderTableCellContent = (children: ReactNode) =>
        renderColumnReveal(
            renderRowReveal(
                children,
                undefined,
                tableEntryTransition,
            ),
            "mx-auto",
        );

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

    /**
     * Cross-highlight: when the user hovers a row in the prior
     * suggestion or accusation log, highlight every cell whose
     * provenance chain references that row's index. Suggestions can
     * additionally be pinned via tap/click; accusations are
     * hover-only today.
     */
    const cellIsHighlighted = (owner: Owner, card: Card): boolean => {
        // Hypothesis cross-highlight: when the popover is open on a
        // cell whose value follows from an active hypothesis, light up
        // every cell the user has pinned a hypothesis on.
        if (
            popoverIsOnDerivedCell &&
            HashMap.has(hypotheses, Cell(owner, card))
        ) {
            return true;
        }
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

    const knowledge: Knowledge =
        Result.getOrUndefined(result) ?? emptyKnowledge;

    // Column count for <th colSpan> on category / card-name / add-* rows.
    // In Setup mode the trailing "+ add player" column adds one more.
    const cardSpan = 1 + owners.length;

    // Build the contents of the inline explanation row. Computed once
    // for the currently-expanded cell (if any) instead of per-cell so
    // the heavy `buildCellWhy` chain only runs once. The wrapping row
    // is rendered inside the per-card-row loop below; this `useMemo`
    // produces only the body element.
    const explainContent = useMemo(() => {
        if (popoverCell === null) return null;
        const value = getCellByOwnerCard(
            knowledge,
            popoverCell.owner,
            popoverCell.card,
        );
        const explainHypothesisValue = hypothesisValueFor(
            hypotheses,
            popoverCell,
        );
        const explainStatus = statusFor(
            popoverCell,
            realKnowledge,
            jointKnowledge,
            hypotheses,
            jointFailed,
        );
        const explainDisplay = displayFor(value, explainStatus);
        const explainFootnotes = footnotesForCell(footnotes, popoverCell);
        const explainCellWhy = buildCellWhy({
            provenance:
                explainStatus.kind === "derived"
                    ? jointProvenance
                    : provenance,
            suggestions,
            accusations,
            setup,
            owner: popoverCell.owner,
            card: popoverCell.card,
            tDeduce: t,
            tReasons,
        });
        const observedForCell =
            popoverCell.owner._tag === "Player" &&
            state.knownCards.some(
                kc =>
                    popoverCell.owner._tag === "Player" &&
                    kc.player === popoverCell.owner.player &&
                    kc.card === popoverCell.card,
            );
        return (
            <CellExplanationRow
                cell={popoverCell}
                setup={setup}
                status={explainStatus}
                hypotheses={hypotheses}
                hypothesisValue={explainHypothesisValue}
                onHypothesisChange={(
                    next: HypothesisValue | undefined,
                ) => {
                    const prevValue = explainHypothesisValue;
                    const cellStatusKind =
                        explainStatus.kind as CellHypothesisStatus;
                    if (next === undefined) {
                        dispatch({
                            type: "clearHypothesis",
                            cell: popoverCell,
                        });
                        if (prevValue !== undefined) {
                            hypothesisCleared({
                                previousValue: prevValue,
                                cellStatus: cellStatusKind,
                                source: "click",
                            });
                        }
                    } else {
                        dispatch({
                            type: "setHypothesis",
                            cell: popoverCell,
                            value: next,
                        });
                        hypothesisSet({
                            value: next,
                            previousValue:
                                prevValue ?? ANALYTICS_PREV_OFF,
                            cellStatus: cellStatusKind,
                            source: "click",
                        });
                    }
                }}
                whyText={explainCellWhy.chainText}
                footnoteNumbers={explainFootnotes}
                display={explainDisplay}
                observed={observedForCell}
                onObservationChange={(next: boolean) => {
                    if (popoverCell.owner._tag !== "Player") return;
                    const ownerPlayer = popoverCell.owner.player;
                    if (next) {
                        dispatch({
                            type: "addKnownCard",
                            card: KnownCard({
                                player: ownerPlayer,
                                card: popoverCell.card,
                            }),
                        });
                    } else {
                        const idx = state.knownCards.findIndex(
                            kc =>
                                kc.player === ownerPlayer &&
                                kc.card === popoverCell.card,
                        );
                        if (idx >= 0) {
                            dispatch({
                                type: "removeKnownCard",
                                index: idx,
                            });
                        }
                    }
                }}
                selfPlayerId={state.selfPlayerId}
                onClose={() => setExpandedCell(null)}
            />
        );
    }, [
        popoverCell,
        knowledge,
        hypotheses,
        realKnowledge,
        jointKnowledge,
        jointFailed,
        footnotes,
        provenance,
        jointProvenance,
        suggestions,
        accusations,
        setup,
        state.knownCards,
        state.selfPlayerId,
        dispatch,
        setExpandedCell,
        t,
        tReasons,
    ]);

    return (
        <section
            ref={rootRef}
            id="checklist"
            // M22 firstSuggestion tour anchor (desktop variant). On
            // mobile the same step instead points at the BottomNav's
            // Checklist tab; the `anchorByViewport` resolver on
            // `TourStep` picks the right token at popover-render
            // time. Both anchors live in the DOM unconditionally;
            // the resolver simply queries for whichever side of the
            // breakpoint is active.
            data-tour-anchor="desktop-checklist-area"
            className="min-w-max rounded-[var(--radius)] border border-border bg-panel p-4"
        >
            <div className="shrink-0 [@media(min-width:800px)]:sticky [@media(min-width:800px)]:left-9 [@media(min-width:800px)]:max-w-[calc(100vw-4.5rem)]">
                <CaseFileHeader knowledge={knowledge} />
            </div>
            <div className="-mx-4 px-4">
            <table className="w-full border-separate border-spacing-0 border-t border-l border-border text-[13px]">
                <thead className="sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] z-[var(--z-checklist-sticky-header)] bg-row-header">
                    <tr>
                        <th
                            className={`${STICKY_FIRST_COL_HEADER} border-r border-b border-border bg-row-header px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.05em] text-muted`}
                            data-tour-sticky-left=""
                        >
                            {!hasKeyboard ? null : label("global.gotoChecklist")}
                        </th>
                        <AnimatePresence initial={false} mode={MOTION_SYNC}>
                        {owners.flatMap(owner => {
                            const cell = (
                                <motion.th
                                    key={ownerKey(owner, playerColumnKeys)}
                                    className={`${COLUMN_HEADER_STACK} overflow-hidden border-r border-b border-border bg-row-header p-0 text-center align-top font-semibold`}
                                    layout={LAYOUT_POSITION}
                                    initial={TABLE_COLUMN_HIDDEN}
                                    animate={TABLE_COLUMN_VISIBLE}
                                    exit={columnCellExit}
                                    transition={tableEntryTransition}
                                >
                                    {renderColumnReveal(
                                        <div className="px-2 py-1">
                                            {ownerLabel(owner)}
                                        </div>,
                                    )}
                                </motion.th>
                            );
                            return [cell];
                        })}
                        </AnimatePresence>
                    </tr>
                </thead>
                <tbody>
                    <AnimatePresence initial={false} mode={MOTION_SYNC}>
                    {setup.categories.flatMap(category => {
                        return [
                            <motion.tr
                                key={`h-${String(category.id)}`}
                                {...tableRowMotionProps}
                            >
                                <motion.th
                                    className={`${STICKY_FIRST_COL} overflow-hidden border-r border-b border-border bg-category-header p-0 text-left text-[11px] uppercase tracking-[0.05em] text-white`}
                                    data-tour-sticky-left=""
                                    exit={cellExitTone}
                                >
                                    {renderRowReveal(
                                        <div className="px-2 py-1.5">
                                            {category.name}
                                        </div>,
                                    )}
                                </motion.th>
                                <td
                                    colSpan={cardSpan - 1}
                                    className="border-r border-b border-border bg-category-header"
                                />
                            </motion.tr>,
                            ...category.cards.flatMap(entry => {
                                const showExplain =
                                    popoverCell !== null &&
                                    popoverCell.card === entry.id;
                                // Inline expansion row, inserted directly
                                // BELOW the open cell's row. Two td's:
                                //   - First td continues the sticky-left
                                //     card-name column visually (blank,
                                //     bg-panel, no right border).
                                //   - Second td spans the rest of the
                                //     row and holds the height-animated
                                //     details box. The accent border on
                                //     the box is open on the LEFT so it
                                //     reads as connected to the empty
                                //     leftmost area, with text starting
                                //     aligned with the second column.
                                const explainTr = showExplain ? (
                                    <motion.tr
                                        key={`explain-${String(entry.id)}`}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={explainRowTransition}
                                        className="relative z-[var(--z-checklist-explain-row)]"
                                    >
                                        <td
                                            className={`${STICKY_FIRST_COL} bg-panel border-b border-border p-0`}
                                            data-tour-sticky-left=""
                                        />
                                        <td
                                            colSpan={cardSpan - 1}
                                            className="relative p-0"
                                            ref={(
                                                el: HTMLTableCellElement | null,
                                            ) => {
                                                explainRowNodeRef.current = el;
                                            }}
                                        >
                                            <AnimatePresence propagate>
                                                <motion.div
                                                    key="content"
                                                    initial={{
                                                        height: 0,
                                                        opacity: 0,
                                                    }}
                                                    animate={{
                                                        // eslint-disable-next-line i18next/no-literal-string -- CSS auto value
                                                        height: "auto",
                                                        opacity: 1,
                                                    }}
                                                    exit={{
                                                        height: 0,
                                                        opacity: 0,
                                                    }}
                                                    transition={
                                                        explainRowTransition
                                                    }
                                                    style={
                                                        STYLE_OVERFLOW_HIDDEN
                                                    }
                                                    // `contain-inline-size`
                                                    // stops the inner
                                                    // sections' min-widths
                                                    // from propagating up
                                                    // into <main>'s
                                                    // min-w-max calculation
                                                    // and pushing the
                                                    // checklist past the
                                                    // SuggestionLogPanel.
                                                    className="border-t-2 border-r-2 border-b-2 border-accent bg-panel contain-inline-size"
                                                >
                                                    {explainContent}
                                                </motion.div>
                                            </AnimatePresence>
                                            {/* Mask the 2px accent border
                                                directly under the open cell
                                                so the cell flows seamlessly
                                                into the details box. Lives
                                                outside the height-animated
                                                motion.div (which has
                                                `overflow: hidden` and would
                                                otherwise clip the cover) so
                                                it can paint over the
                                                motion.div's `border-t`. */}
                                            {openCellMetrics !== null && (
                                                <div
                                                    aria-hidden
                                                    className="pointer-events-none absolute h-[2px] bg-panel"
                                                    style={{
                                                        top: 0,
                                                        left: `${openCellMetrics.left}px`,
                                                        width: `${openCellMetrics.width}px`,
                                                    }}
                                                />
                                            )}
                                        </td>
                                    </motion.tr>
                                ) : null;
                                const cardRow = (
                                <motion.tr
                                    key={String(entry.id)}
                                    {...tableRowMotionProps}
                                >
                                    <motion.th
                                        className={`${STICKY_FIRST_COL} w-px overflow-hidden whitespace-nowrap border-r border-b border-border bg-panel p-0 text-left font-normal`}
                                        data-tour-sticky-left=""
                                        exit={cellExitTone}
                                    >
                                        {renderRowReveal(
                                            <div className="px-2 py-1">
                                                {entry.name}
                                            </div>,
                                        )}
                                    </motion.th>
                                    <AnimatePresence
                                        initial={false}
                                        mode={MOTION_SYNC}
                                        propagate
                                    >
                                    {owners.flatMap((owner, colIdx) => {
                                        const rowIdx =
                                            rowIdxByCard.get(entry.id) ?? -1;
                                        const value = getCellByOwnerCard(
                                            knowledge,
                                            owner,
                                            entry.id,
                                        );
                                        const cellRef = Cell(owner, entry.id);
                                        const hypothesisValue = hypothesisValueFor(
                                            hypotheses,
                                            cellRef,
                                        );
                                        const hypothesisStatus = statusFor(
                                            cellRef,
                                            realKnowledge,
                                            jointKnowledge,
                                            hypotheses,
                                            jointFailed,
                                        );
                                        const display = displayFor(
                                            value,
                                            hypothesisStatus,
                                        );
                                        const footnoteNumbers = footnotesForCell(
                                            footnotes,
                                            cellRef,
                                        );
                                        const isPlayerCell = owner._tag === "Player";
                                        const isHighlighted = cellIsHighlighted(
                                            owner,
                                            entry.id,
                                        );
                                        // Player cells host the deduction
                                        // popover on click — they don't
                                        // toggle known-cards directly anymore
                                        // (the wizard's PlayerColumnCardList
                                        // owns that flow).
                                        const playInteractive = isPlayerCell;
                                        const showChip =
                                            footnoteNumbers.length > 0
                                            && value === undefined;
                                        const topLeft = showChip ? (
                                            <span
                                                aria-hidden
                                                className="inline-flex items-center gap-[2px] rounded-[3px] border border-accent/40 px-[3px] py-px text-[10px] font-semibold leading-none text-accent tabular-nums"
                                            >
                                                <LightbulbIcon size={9} />
                                                {footnoteNumbers.join(",")}
                                            </span>
                                        ) : null;
                                        // Corner badge marking the cell as
                                        // the source of a hypothesis (vs. a
                                        // cell whose value follows from one).
                                        // Tone reflects the HYPOTHESIS value,
                                        // not the cell's displayed value: a
                                        // cell that's been deduced Y but
                                        // hypothesised N shows a red badge
                                        // against a green cell, making the
                                        // disagreement visible at a glance.
                                        // The cell's rejected-badge pulse
                                        // stays on whether or not the popover
                                        // is open — the matching popover
                                        // status-box badge also pulses, so the
                                        // cell and popover read together when
                                        // the user is looking at one or the
                                        // other.
                                        const topRight =
                                            hypothesisValue !== undefined ? (
                                                <ProseChecklistIcon
                                                    value={hypothesisValue}
                                                    isHypothesis
                                                    invertedStyle
                                                />
                                            ) : null;
                                        const center = (
                                            <AnimatedCellGlyph
                                                display={display}
                                                status={hypothesisStatus}
                                            />
                                        );
                                        const cellContent = (
                                            <CellLayout
                                                topLeft={topLeft}
                                                topRight={topRight}
                                                center={center}
                                            />
                                        );
                                        // Every cell hosts the deduction-
                                        // chain popover via `<CellWhyPopover>`
                                        // — even blank ones, because the
                                        // hypothesis control still lives there.
                                        const popoverInteractive =
                                            playInteractive || !isPlayerCell;
                                        const tdClassName = cellClass(
                                            display,
                                            playInteractive
                                                || popoverInteractive,
                                            isHighlighted,
                                            hypothesisStatus,
                                        );
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
                                        const ownerCellKey = `${ownerKey(owner, playerColumnKeys)}-${String(entry.id)}`;
                                        let cell: ReactNode;
                                        if (popoverInteractive) {
                                            // Play-mode cell (player or
                                            // case file). Click / tap /
                                            // Enter / Space toggles the
                                            // inline explanation row above
                                            // this cell's table row. Setup
                                            // mode skips this branch — the
                                            // checklist there is for input,
                                            // not exploration.
                                            const thisCell = Cell(
                                                owner,
                                                entry.id,
                                            );
                                            const isOpen = Equal.equals(
                                                popoverCell,
                                                thisCell,
                                            );
                                            const interactiveTdClassName =
                                                isOpen
                                                    ? `${tdClassName}${CELL_EXPANDED}${cellExpandedToneClass(display)}`
                                                    : tdClassName;
                                            cell = (
                                                <motion.td
                                                    key={ownerCellKey}
                                                    ref={(el: HTMLElement | null) => {
                                                        if (el) {
                                                            cellNodesByKeyRef.current.set(
                                                                ownerCellKey,
                                                                el,
                                                            );
                                                        } else {
                                                            cellNodesByKeyRef.current.delete(
                                                                ownerCellKey,
                                                            );
                                                        }
                                                    }}
                                                    className={interactiveTdClassName}
                                                    layout={LAYOUT_POSITION}
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-expanded={isOpen}
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    {...firstCellAnchorAttr}
                                                    onFocus={onCellFocus}
                                                    onPointerDown={(
                                                        e: React.PointerEvent<HTMLTableCellElement>,
                                                    ) => {
                                                        if (
                                                            e.pointerType !==
                                                            "touch"
                                                        ) {
                                                            wasTouchSecondTapRef.current =
                                                                null;
                                                            return;
                                                        }
                                                        // pointerdown fires
                                                        // before the browser
                                                        // moves focus on
                                                        // touch, so the
                                                        // pre-tap focus is
                                                        // still in effect.
                                                        // If THIS cell was
                                                        // already focused,
                                                        // this tap is the
                                                        // second of a
                                                        // two-tap sequence
                                                        // on it.
                                                        wasTouchSecondTapRef.current =
                                                            document.activeElement ===
                                                            e.currentTarget;
                                                    }}
                                                    onClick={() => {
                                                        const wasTouchSecondTap =
                                                            wasTouchSecondTapRef.current;
                                                        wasTouchSecondTapRef.current =
                                                            null;
                                                        const wasOpen = Equal.equals(
                                                            popoverCellRef.current,
                                                            thisCell,
                                                        );
                                                        if (
                                                            wasTouchSecondTap ===
                                                            null
                                                        ) {
                                                            // Mouse, pen,
                                                            // or keyboard-
                                                            // synthesized
                                                            // click — single
                                                            // action toggle.
                                                            setExpandedCell(
                                                                wasOpen
                                                                    ? null
                                                                    : thisCell,
                                                            );
                                                            return;
                                                        }
                                                        // Touch protocol.
                                                        if (wasOpen) {
                                                            // Tap open cell
                                                            // again → close.
                                                            setExpandedCell(
                                                                null,
                                                            );
                                                            return;
                                                        }
                                                        if (
                                                            popoverCellRef.current !==
                                                            null
                                                        ) {
                                                            // Tap on a
                                                            // different cell
                                                            // while a row
                                                            // is open →
                                                            // close. Browser
                                                            // focus moves to
                                                            // thisCell during
                                                            // the click; the
                                                            // next tap is the
                                                            // second tap that
                                                            // opens it.
                                                            setExpandedCell(
                                                                null,
                                                            );
                                                            return;
                                                        }
                                                        if (
                                                            wasTouchSecondTap
                                                        ) {
                                                            // Second tap on
                                                            // already-focused
                                                            // cell with no
                                                            // open row →
                                                            // open this cell.
                                                            setExpandedCell(
                                                                thisCell,
                                                            );
                                                            return;
                                                        }
                                                        // First tap on an
                                                        // unfocused cell with
                                                        // no open row → just
                                                        // focus (default
                                                        // browser behavior),
                                                        // don't open.
                                                    }}
                                                    onKeyDown={(
                                                        e: React.KeyboardEvent<HTMLTableCellElement>,
                                                    ) => {
                                                        // Enter / Space
                                                        // synthesizes a
                                                        // click → goes
                                                        // through the
                                                        // single-action
                                                        // toggle path above.
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
                                                >
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
                                            );
                                        } else if (isPlayerCell) {
                                            // Play-mode player cell with no
                                            // deduction: not clickable, but
                                            // still focusable so keyboard
                                            // arrow navigation doesn't skip
                                            // blank cells.
                                            cell = (
                                                <motion.td
                                                    key={ownerCellKey}
                                                    className={tdClassName}
                                                    layout={LAYOUT_POSITION}
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
                                                    tabIndex={0}
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    {...firstCellAnchorAttr}
                                                    onFocus={onCellFocus}
                                                    onKeyDown={onGridArrowKey}
                                                >
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
                                            );
                                        } else {
                                            cell = (
                                                <motion.td
                                                    key={ownerCellKey}
                                                    className={tdClassName}
                                                    layout={LAYOUT_POSITION}
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
                                                    {...firstCellAnchorAttr}
                                                >
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
                                            );
                                        }
                                        return [cell];
                                    })}
                                    </AnimatePresence>
                                </motion.tr>
                                );
                                return explainTr !== null
                                    ? [cardRow, explainTr]
                                    : [cardRow];
                            }),
                        ];
                    })}
                    </AnimatePresence>
                </tbody>
            </table>
            </div>
        </section>
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

interface CellWhy {
    /** "Deductions" chain — rendered as plain text in the popover. */
    readonly chainText: string | undefined;
}

const buildCellWhy = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    setup: ReturnType<typeof useClue>["state"]["setup"];
    owner: Owner;
    card: Card;
    tDeduce: ReturnType<typeof useTranslations<"deduce">>;
    tReasons: ReturnType<typeof useTranslations<"reasons">>;
}): CellWhy => {
    const {
        provenance,
        suggestions,
        accusations,
        setup,
        owner,
        card,
        tDeduce,
        tReasons,
    } = args;

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

    // The popover now renders a "Deductions" section heading above
    // this chain (with a glyph that mirrors the cell), so we don't
    // repeat the value in the prefix.
    const chainText = chainLines.length > 0 ? chainLines.join("\n") : undefined;

    return { chainText };
};

// Motion-only constants (non user-facing). The "unsolved" color
// is the app's body ink; motion can't animate "inherit" so we
// resolve it here.
const CSS_ACCENT = "var(--color-accent)";
const CSS_BORDER = "var(--color-border)";
const CSS_WHITE = "#ffffff";
const CSS_INK = "#2a1f12";
const CSS_DANGER = "var(--color-danger)";
const MOTION_SYNC: "sync" = "sync";
const MOTION_WAIT: "wait" = "wait";
const MOTION_POP_LAYOUT: "popLayout" = "popLayout";
const LAYOUT_POSITION: "position" = "position";
const TABLE_AXIS_ROW = "row";
const TABLE_AXIS_COLUMN = "column";
type TableAnimationAxis = typeof TABLE_AXIS_ROW | typeof TABLE_AXIS_COLUMN;
const CELL_EXPAND_CAP_PX = 320;
const TABLE_ENTRY_DURATION = Duration.millis(220);
const TABLE_ROW_ENTRY_DURATION = Duration.millis(300);
const TABLE_DANGER_FADE_DURATION = Duration.millis(120);
const TABLE_DANGER_HOLD_DURATION = Duration.millis(240);
const TABLE_COLLAPSE_DURATION = Duration.millis(180);
const TABLE_REDUCED_DANGER_FADE_MS = Duration.toMillis(
    Duration.millis(80),
);
const TABLE_DANGER_FADE_SECONDS = Duration.toSeconds(TABLE_DANGER_FADE_DURATION);
const TABLE_DANGER_HOLD_SECONDS = Duration.toSeconds(TABLE_DANGER_HOLD_DURATION);
const TABLE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const TABLE_ENTRY_TRANSITION: Transition = {
    duration: Duration.toSeconds(TABLE_ENTRY_DURATION),
    ease: TABLE_EASE,
};
const TABLE_ROW_ENTRY_TRANSITION: Transition = {
    duration: Duration.toSeconds(TABLE_ROW_ENTRY_DURATION),
    ease: TABLE_EASE,
};
const TABLE_DANGER_TRANSITION: Transition = {
    duration: Duration.toSeconds(TABLE_DANGER_FADE_DURATION),
    ease: "easeOut",
};
const TABLE_COLLAPSE_TRANSITION: Transition = {
    duration: Duration.toSeconds(TABLE_COLLAPSE_DURATION),
    ease: TABLE_EASE,
};
const TABLE_ROW_HIDDEN = { maxHeight: 0, opacity: 0 } as const;
const TABLE_ROW_VISIBLE = { maxHeight: CELL_EXPAND_CAP_PX, opacity: 1 } as const;
const TABLE_COLUMN_HIDDEN = { maxWidth: 0, opacity: 0 } as const;
const TABLE_COLUMN_VISIBLE = { maxWidth: CELL_EXPAND_CAP_PX, opacity: 1 } as const;
const STYLE_OVERFLOW_HIDDEN = { overflow: "hidden" } as const;
const STYLE_COLUMN_CELL_VISIBLE = { maxWidth: CELL_EXPAND_CAP_PX } as const;

/**
 * Inline explanation row animation. The row is inserted above the
 * tapped cell's table row and animates its content from height 0 to
 * auto on enter (and back on exit). Duration matches `TABLE_ENTRY_DURATION`
 * so the row reads as part of the same family of table animations.
 */
const EXPLAIN_ROW_DURATION = Duration.millis(220);
const EXPLAIN_ROW_TRANSITION: Transition = {
    duration: Duration.toSeconds(EXPLAIN_ROW_DURATION),
    ease: TABLE_EASE,
};

/**
 * Class added to the open cell's `<motion.td>`. Replaces the 1px tone
 * borders with a 2px accent border on the three sides that aren't
 * shared with the details row; the bottom border is dropped entirely
 * so the cell flows seamlessly into the details box's `border-t-2`.
 *
 * Background is set per-cell via `cellExpandedToneClass(display)` so
 * Y / N cells keep their green / red tone but fade to the panel color
 * at the very bottom, while blank cells get the flat panel color
 * directly.
 *
 * The `cell-expanded-focus` utility (defined in `globals.css`) replaces
 * the standard 4-sided focus ring with a 3-sided box-shadow on
 * `:focus`, so even with the cell focused there's no horizontal line
 * across its bottom edge. The bottom corners are kept sharp (no
 * `rounded-b`) so the ring's left and right ends drop cleanly down to
 * the explanation row.
 */
const CELL_EXPANDED =
    " !border-2 !border-accent !border-b-0 !rounded-none cell-expanded-focus focus:!ring-0 focus:!ring-offset-0 z-[var(--z-checklist-cell-focus)]";

const CELL_EXPANDED_TONE_BLANK = " !bg-panel" as const;
const CELL_EXPANDED_TONE_Y = " cell-expanded-tone-yes" as const;
const CELL_EXPANDED_TONE_N = " cell-expanded-tone-no" as const;

const cellExpandedToneClass = (display: CellDisplay): string => {
    const tone: CellValue | undefined =
        display.tag === "real"
            ? display.value
            : display.tag === "hypothesis"
              ? display.value
              : display.tag === "derived"
                ? display.value
                : undefined;
    if (tone === Y) return CELL_EXPANDED_TONE_Y;
    if (tone === N) return CELL_EXPANDED_TONE_N;
    return CELL_EXPANDED_TONE_BLANK;
};

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

const ownerKey = (
    owner: Owner,
    playerColumnKeys?: ReadonlyMap<Player, string>,
): string =>
    owner._tag === "Player"
        ? (playerColumnKeys?.get(owner.player) ?? `p-${String(owner.player)}`)
        : "case-file";

interface PlayerColumnKeyEntry {
    readonly player: Player;
    readonly key: string;
}

function useStablePlayerColumnKeys(
    players: ReadonlyArray<Player>,
): ReadonlyMap<Player, string> {
    const previousRef = useRef<ReadonlyArray<PlayerColumnKeyEntry>>([]);
    const nextIdRef = useRef(0);
    return useMemo(() => {
        const previous = previousRef.current;
        const unusedByName = new Map<string, Array<PlayerColumnKeyEntry>>();
        for (const entry of previous) {
            const name = String(entry.player);
            const bucket = unusedByName.get(name) ?? [];
            bucket.push(entry);
            unusedByName.set(name, bucket);
        }

        const claimedKeys = new Set<string>();
        const next = players.map((player, index): PlayerColumnKeyEntry => {
            const name = String(player);
            const exact = unusedByName.get(name)?.shift();
            if (exact) {
                claimedKeys.add(exact.key);
                return { player, key: exact.key };
            }

            const previousAtIndex = previous[index];
            if (
                previousAtIndex !== undefined &&
                !claimedKeys.has(previousAtIndex.key)
            ) {
                claimedKeys.add(previousAtIndex.key);
                return { player, key: previousAtIndex.key };
            }

            const key = `player-col-${nextIdRef.current}`;
            nextIdRef.current += 1;
            claimedKeys.add(key);
            return { player, key };
        });

        previousRef.current = next;
        return new Map(next.map(entry => [entry.player, entry.key] as const));
    }, [players]);
}

// Glyph helpers (`glyphKindFor`, `renderGlyphNode`, `GLYPH_*`) are
// shared with `CellWhyPopover`'s mini glyph box so the popover renders
// the same icon as the live cell for any given (display, status).
// They live in `./CellGlyph`.

/**
 * Cell glyph with a short pop-in/out as the value changes.
 * Using `AnimatePresence` keyed on the glyph kind means each state
 * swap renders a fresh `<motion.span>` that scales in while the
 * outgoing one scales out — the tween is fast (120ms) so the cell
 * still feels snappy, not animated-heavy. The cell background
 * transition stays in CSS (`transition-colors`) so motion only owns
 * the glyph.
 */
function AnimatedCellGlyph({
    display,
    status,
}: {
    readonly display: CellDisplay;
    readonly status: HypothesisStatus;
}) {
    const transition = useReducedTransition(T_FAST);
    const kind = glyphKindFor(display, status);
    return (
        <AnimatePresence mode={MOTION_POP_LAYOUT} initial={false}>
            {kind !== GLYPH_BLANK && (
                <motion.span
                    key={kind}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={transition}
                    // p-1 gives the glyph a 4px gutter so it doesn't
                    // visually crash into the corner badges when the
                    // cell is tight. The setup-mode checkbox renders
                    // through a separate code path and intentionally
                    // skips this padding.
                    className="inline-flex items-center justify-center p-1"
                >
                    {renderGlyphNode(kind)}
                </motion.span>
            )}
        </AnimatePresence>
    );
}

// `align-top` (vertical-align: top) anchors the row/column reveal
// motion.div — and thus CellLayout's grid — to the cell's top edge.
// Table-cell percentage-height inheritance is unreliable (CSS spec
// treats `height: 100%` on a td as a min-height rather than a real
// height), so we can't make the inner wrappers stretch to fill;
// instead, we let them content-size and pin them to the top so the
// corner badges in CellLayout's row 1 sit at the cell's true top
// edge with the grid's 2px padding as their corner inset.
const CELL_BASE =
    "border-r border-b border-border text-center font-semibold relative overflow-hidden align-top";
const STICKY_FIRST_COL =
    "sticky left-0 z-[var(--z-checklist-sticky-column)]";

const STICKY_FIRST_COL_HEADER =
    "sticky left-0 z-[var(--z-checklist-sticky-top-left)]";

// `relative z-[…]` on every non-corner thead cell so they escape
// document-order layering and stack within the thead's stacking
// context above the sticky-left first-column cells. Without this,
// the sticky-left cells' own positive z-index (step 7 of the thead
// context) would render over non-positioned siblings (step 3) — i.e.
// the player-name cells would slide UNDER the top-left and hand-size
// label during horizontal scroll, the opposite of the desired
// behavior. Player-name headers and hand-size inputs use different
// values so the inputs tuck under the hand-size label while the
// player names cover both.
const COLUMN_HEADER_STACK =
    "relative z-[var(--z-checklist-sticky-header)]";

// Z-index ladder for the checklist (bottom → top):
//   - body cell hover ring       : --z-checklist-cell-hover
//   - body cell focus            : --z-checklist-cell-focus
//   - sticky body first column   : --z-checklist-sticky-column
//     (card category + card name cells)
//   - sticky hand-size inputs    : --z-checklist-sticky-handsize-input
//   - sticky top-left cells      : --z-checklist-sticky-top-left
//     (top-left corner + the hand-size label cell, which is also
//     sticky-left in the thead)
//   - sticky player-name headers : --z-checklist-sticky-header
// The body's sticky first column sits at the bottom of the sticky
// tiers so the entire thead — player names, hand-size label, and
// hand-size inputs — covers it during scroll. Within the thead the
// hand-size inputs tuck under the hand-size label, and the player
// names cover both the hand-size label and the top-left corner as
// they slide left during horizontal scroll.
//
// Focus indicator: `ring-[3px] ring-offset-2` (box-shadow) instead of
// `outline-3 outline-offset-2`. Outlines on `<td>` cells in
// `border-collapse: separate` get clipped at the cell's left edge —
// reproducible on the case-file column whose left neighbour ends at
// the column boundary. Box-shadow paints with the element's own
// stacking context and respects z-index escape, so the ring renders
// on all four sides regardless of which cell its neighbour is.
//
// 3px ring width matches the global `*:focus-visible` outline width
// set in `app/globals.css` so checklist cells read at the same weight
// as every other focusable element on the page (inputs, buttons, etc.).
//
// `:focus` (NOT `:focus-visible`): when a touch user taps a cell to
// open its popover, we want the ring to make the trigger cell visible
// — the popover is portaled into `document.body`, so without the ring
// the user can't tell which cell anchors it. `:focus-visible` skips
// touch and mouse focus, which would leave the popover floating
// without a visible source. The slight cost is a ring after every
// mouse click on a cell; that's acceptable here because the popover
// it pairs with is the primary feedback anyway.
//
// The ring-offset color is set per-cell to match the cell's own
// background (`ring-offset-yes-bg`, `ring-offset-no-bg`, or
// `ring-offset-white`) so the 2px offset blends into the cell —
// visually equivalent to the transparent offset CSS outlines have.
// Without that match the offset would render as a solid panel band
// and the focus indicator would look like a thick double-ring.
// `hover:` modifiers are gated by `not-focus:` so the soft hover
// ring (2px, accent/30) yields to the focus ring (3px, accent)
// whenever the cell is focused. Without that gate, both rules
// write `--tw-ring-shadow` and the hover-pseudo wins while the
// pointer is still over the focused cell — so opening the popover
// via hover would show a faint hint until the cursor moved away,
// at which point the strong focus ring would finally appear.
const CELL_INTERACTIVE =
    " cursor-pointer hover:not-focus:z-[var(--z-checklist-cell-hover)] hover:not-focus:rounded-[2px] hover:not-focus:ring-2 hover:not-focus:ring-accent/30 focus:z-[var(--z-checklist-cell-focus)] focus:ring-[3px] focus:ring-accent focus:ring-offset-2 focus:rounded-[2px] focus:outline-none";

const CELL_HIGHLIGHTED =
    " z-[var(--z-checklist-cell-hover)] ring-2 ring-accent ring-offset-1 ring-offset-panel";

const cellClass = (
    display: CellDisplay,
    interactive: boolean,
    highlighted: boolean,
    status: HypothesisStatus,
): string => {
    let base = interactive ? `${CELL_BASE}${CELL_INTERACTIVE}` : CELL_BASE;
    if (highlighted) base += CELL_HIGHLIGHTED;
    // Contradiction states are conveyed by the alert icon + pulse on
    // the popover's status box (`directlyContradicted` and
    // `jointlyConflicts` both surface there), so no extra cell ring
    // is needed here.
    void status;
    // Pick the color tone from the displayed value (real wins; otherwise
    // the hypothesis or derived-from-hypothesis value).
    const tone: CellValue | undefined =
        display.tag === "real"
            ? display.value
            : display.tag === "hypothesis"
              ? display.value
              : display.tag === "derived"
                ? display.value
                : undefined;
    if (tone === Y) {
        return `${base} ${CELL_TONE_Y_CLASS} focus:ring-offset-yes-bg`;
    }
    if (tone === N) {
        // Live-grid override: use the softened `--color-no-cell`
        // instead of the full-strength `--color-no` so a wall of N
        // cells reads less aggressively. The popover / prose chip
        // version of CELL_TONE_N_CLASS still uses the strong red
        // (intentional — chips are inline, not at a wall scale).
        return `${base} bg-no-bg text-no-cell focus:ring-offset-no-bg`;
    }
    return `${base} ${CELL_TONE_NEUTRAL_CLASS} focus:ring-offset-white`;
};
