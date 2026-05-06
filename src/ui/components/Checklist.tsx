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
import { CellWhyPopover, hypothesisValueFor } from "./CellWhyPopover";

// Analytics enum tag for the "no hypothesis" baseline. Module-scope
// so the `no-literal-string` lint rule reads it as code, not UI text.
const ANALYTICS_PREV_OFF = "off" as const;
import { useTranslations } from "next-intl";
import {
    hypothesisCleared,
    hypothesisSet,
    playerAdded,
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
import { AnimatePresence, motion, type Transition } from "motion/react";
import {
    T_CELEBRATE,
    T_FAST,
    T_STANDARD,
    T_WIGGLE,
    useReducedTransition,
} from "../motion";
import { useConfetti } from "../hooks/useConfetti";
import { useShareContext } from "../share/ShareProvider";
import { CardPackRow } from "./CardPackRow";
import { ShareIcon } from "./ShareIcon";
import { AlertIcon, Envelope, LightbulbIcon } from "./Icons";
import { HypothesisBadge } from "./HypothesisBadge";
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
    const tShare = useTranslations("share");
    const tReasons = useTranslations("reasons");
    const { openInvitePlayer } = useShareContext();
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
    // Touch-only "first tap dismisses, second tap opens" gate. On
    // touch, tapping a cell while a popover is already open on a
    // different cell should dismiss the open popover and NOT swap
    // it onto the freshly tapped cell — the user has to tap the new
    // cell a second time to see its popover. Mouse and keyboard
    // continue to swap on hover / open on click as before; on those
    // input types, peeking at adjacent cells is cheap and useful.
    //
    // The pointerdown handler on each popover-interactive cell sets
    // this flag when the conditions match. Radix's
    // `onPointerDownOutside` then closes the previously-open popover,
    // and the click that follows would normally fire `onOpenChange(true)`
    // on the freshly tapped cell — we consume the flag there to
    // suppress that open. The flag self-resets at the start of every
    // pointerdown so a stale value can never carry over.
    const dismissNextTouchOpenRef = useRef(false);
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

    const tableEntryTransition = useReducedTransition(TABLE_ENTRY_TRANSITION);
    const tableRowEntryTransition = useReducedTransition(
        TABLE_ROW_ENTRY_TRANSITION,
    );
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

    // In Setup mode the add-player column sits between the players and
    // the case file — clicking + spawns the new player where its column
    // would naturally appear. Each of the three owner-axis rows below
    // injects the matching header/cell right before the case-file
    // column; Play mode skips the cell entirely (unchanged column
    // count).
    const addPlayerHeaderCell = (
        <motion.th
            key={ADD_PLAYER_COLUMN_KEY}
            className="w-px overflow-hidden whitespace-nowrap border-r border-b border-border bg-row-header p-0 text-center"
            initial={TABLE_COLUMN_HIDDEN}
            animate={TABLE_COLUMN_VISIBLE}
            exit={columnCellExit}
            transition={tableEntryTransition}
            // The setup tour's "Add players" step highlights the
            // entire header row of player cells, including the
            // "+ Player" affordance, so the user can see all the
            // ways they manage the player set in one spotlight.
            data-tour-anchor="setup-player-column"
        >
            {renderColumnReveal(
                <div className="px-1.5 py-1">
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
                </div>,
            )}
        </motion.th>
    );
    const addPlayerEmptyCell = (
        <motion.td
            key={ADD_PLAYER_COLUMN_KEY}
            className="overflow-hidden border-r border-b border-border"
            initial={TABLE_COLUMN_HIDDEN}
            animate={TABLE_COLUMN_VISIBLE}
            exit={columnCellExit}
            transition={tableEntryTransition}
        >
            {renderColumnReveal(<div className="h-7 w-0" />)}
        </motion.td>
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
            // M22 firstSuggestion tour anchor (desktop variant). On
            // mobile the same step instead points at the BottomNav's
            // Checklist tab; the `anchorByViewport` resolver on
            // `TourStep` picks the right token at popover-render
            // time. Both anchors live in the DOM unconditionally;
            // the resolver simply queries for whichever side of the
            // breakpoint is active.
            data-tour-anchor="desktop-checklist-area"
            className="min-w-max rounded-[var(--radius)] border border-border bg-panel p-4"
            onMouseLeave={onCellPointerLeave}
            onBlur={e => {
                // Focus left the checklist root entirely (relatedTarget
                // is outside the section). Exit popovers mode so the
                // tab key moving focus away from the grid doesn't
                // leave a stranded popover + suggestion highlight.
                //
                // Special-case: focus moving INTO the portaled popover
                // content counts as still-engaged. The popover lives in
                // `document.body`, so `currentTarget.contains` returns
                // false even when the user is interacting with it; we
                // identify it via the `data-popover-zone="checklist"`
                // marker that the InfoPopover stamps on its Content.
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                if (
                    next instanceof Element
                    && next.closest('[data-popover-zone="checklist"]')
                ) {
                    return;
                }
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
                    <div className="mt-3 flex flex-wrap items-center justify-start gap-3 [@media(min-width:800px)]:justify-end">
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
                        <button
                            type="button"
                            className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius)] border-none bg-transparent px-1 py-1 text-[13px] text-muted hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            onClick={() => openInvitePlayer()}
                            data-share-invite-from-setup
                            data-tour-anchor="setup-invite-player"
                        >
                            <ShareIcon size={14} />
                            {tShare("entryInvitePlayer")}
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
                <thead className="sticky top-[calc(var(--contradiction-banner-offset,0px)+var(--header-offset,0px))] z-[var(--z-checklist-sticky-header)] bg-row-header">
                    <tr>
                        <th
                            className={`${STICKY_FIRST_COL_HEADER} border-r border-b border-border bg-row-header px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.05em] text-muted`}
                            data-tour-sticky-left=""
                        >
                            {inSetup || !hasKeyboard ? null : label("global.gotoChecklist")}
                        </th>
                        <AnimatePresence initial={false} mode={MOTION_SYNC}>
                        {owners.flatMap((owner, ownerIdx) => {
                            // Setup-tour anchors for player header cells:
                            //   - `setup-player-column` (every player
                            //     header) so the "Add players" step
                            //     spotlights the row of player names.
                            //   - `setup-known-cell-header` (FIRST
                            //     player only) so the "Mark cards"
                            //     step's popover anchors to the top
                            //     of the column rather than the full
                            //     column union (which is too tall to
                            //     position against on narrow viewports).
                            // The Case File header skips both since
                            // it's not a player.
                            const isFirstPlayer =
                                owner._tag === "Player" && ownerIdx === 0;
                            const playerHeaderAnchor =
                                inSetup && owner._tag === "Player"
                                    ? {
                                          "data-tour-anchor": isFirstPlayer
                                              ? "setup-player-column setup-known-cell-header"
                                              : "setup-player-column",
                                      }
                                    : {};
                            const cell = (
                                <motion.th
                                    key={ownerKey(owner, playerColumnKeys)}
                                    className="overflow-hidden border-r border-b border-border bg-row-header p-0 text-center align-top font-semibold"
                                    initial={TABLE_COLUMN_HIDDEN}
                                    animate={TABLE_COLUMN_VISIBLE}
                                    exit={columnCellExit}
                                    transition={tableEntryTransition}
                                    {...playerHeaderAnchor}
                                >
                                    {renderColumnReveal(
                                        <div className="px-2 py-1">
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
                                        </div>,
                                    )}
                                </motion.th>
                            );
                            return inSetup && owner._tag === "CaseFile"
                                ? [addPlayerHeaderCell, cell]
                                : [cell];
                        })}
                        </AnimatePresence>
                    </tr>
                    {inSetup && (
                        <tr>
                            <th
                                className={`${STICKY_FIRST_COL_HEADER} whitespace-nowrap border-r border-b border-border bg-row-header px-1.5 py-1 text-left font-semibold`}
                                data-tour-sticky-left=""
                                // The setup tour's "Set hand sizes"
                                // step highlights the row label cell
                                // alongside every player's input so
                                // the spotlight covers the whole row.
                                data-tour-anchor="setup-hand-size"
                            >
                                {tSetup("handSize")}
                            </th>
                            <AnimatePresence initial={false} mode={MOTION_SYNC}>
                            {owners.flatMap((owner, ownerIdx) => {
                                let cell: ReactNode;
                                if (owner._tag !== "Player") {
                                    cell = (
                                        <motion.td
                                            key={ownerKey(owner, playerColumnKeys)}
                                            className="overflow-hidden border-r border-b border-border"
                                            initial={TABLE_COLUMN_HIDDEN}
                                            animate={TABLE_COLUMN_VISIBLE}
                                            exit={columnCellExit}
                                            transition={tableEntryTransition}
                                        >
                                            {renderColumnReveal(<div className="h-7 w-0" />)}
                                        </motion.td>
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
                                        <motion.td
                                            key={ownerKey(owner, playerColumnKeys)}
                                            className="overflow-hidden border-r border-b border-border p-0 text-center"
                                            initial={TABLE_COLUMN_HIDDEN}
                                            animate={TABLE_COLUMN_VISIBLE}
                                            exit={columnCellExit}
                                            transition={tableEntryTransition}
                                            data-tour-anchor="setup-hand-size"
                                        >
                                            {renderColumnReveal(
                                                <div className="px-1.5 py-1">
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
                                                </div>,
                                            )}
                                        </motion.td>
                                    );
                                }
                                return inSetup && owner._tag === "CaseFile"
                                    ? [addPlayerEmptyCell, cell]
                                    : [cell];
                            })}
                            </AnimatePresence>
                        </tr>
                    )}
                </thead>
                <tbody>
                    <AnimatePresence initial={false} mode={MOTION_SYNC}>
                    {setup.categories.flatMap(category => {
                        const canRemoveCategory = setup.categories.length > 1;
                        const canRemoveCard = category.cards.length > 1;
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
                                        inSetup ? (
                                            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
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
                                            <div className="px-2 py-1.5">
                                                {category.name}
                                            </div>
                                        ),
                                    )}
                                </motion.th>
                                <td
                                    colSpan={cardSpan - 1}
                                    className="border-r border-b border-border bg-category-header"
                                />
                            </motion.tr>,
                            ...category.cards.map(entry => {
                                const cardRowIdx =
                                    rowIdxByCard.get(entry.id) ?? -1;
                                return (
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
                                            inSetup ? (
                                                <div className="flex items-center justify-between gap-2 px-2 py-1">
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
                                                <div className="px-2 py-1">
                                                    {entry.name}
                                                </div>
                                            ),
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
                                        const cellWhy = buildCellWhy({
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
                                        const topRight =
                                            hypothesisValue !== undefined ? (
                                                <HypothesisBadge
                                                    value={hypothesisValue}
                                                    status={hypothesisStatus}
                                                />
                                            ) : null;
                                        const center = setupCheckbox ? (
                                            <input
                                                type="checkbox"
                                                aria-hidden
                                                tabIndex={-1}
                                                className="pointer-events-none h-4 w-4 accent-accent"
                                                checked={isKnownY}
                                                readOnly
                                            />
                                        ) : (
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
                                        // Drop the deduction-content gate so the
                                        // popover opens on every play-mode player
                                        // cell (and play-mode case-file cell). Even
                                        // a blank cell now hosts the hypothesis
                                        // control via `<CellWhyPopover>`, so the
                                        // popover always has something to show.
                                        const popoverInteractive =
                                            !inSetup
                                            && (playInteractive || !isPlayerCell);
                                        const tdClassName = cellClass(
                                            display,
                                            setupInteractive
                                                || playInteractive
                                                || popoverInteractive,
                                            isHighlighted,
                                            hypothesisStatus,
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
                                        const ownerCellKey = `${ownerKey(owner, playerColumnKeys)}-${String(entry.id)}`;
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
                                                <motion.td
                                                    key={ownerCellKey}
                                                    className={tdClassName}
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
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
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
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
                                            const popoverBody = (
                                                <CellWhyPopover
                                                    cell={thisCell}
                                                    setup={setup}
                                                    status={hypothesisStatus}
                                                    hypotheses={hypotheses}
                                                    hypothesisValue={hypothesisValue}
                                                    onHypothesisChange={(
                                                        next: HypothesisValue | undefined,
                                                    ) => {
                                                        const prevValue = hypothesisValue;
                                                        const cellStatusKind = hypothesisStatus.kind as CellHypothesisStatus;
                                                        if (next === undefined) {
                                                            dispatch({
                                                                type: "clearHypothesis",
                                                                cell: thisCell,
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
                                                                cell: thisCell,
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
                                                    whyText={cellWhy.chainText}
                                                    footnoteText={cellWhy.footnoteText}
                                                />
                                            );
                                            cell = (
                                                <InfoPopover
                                                    key={ownerCellKey}
                                                    content={popoverBody}
                                                    variant="default"
                                                    open={isOpen}
                                                    onOpenChange={open => {
                                                        if (open) {
                                                            if (
                                                                dismissNextTouchOpenRef.current
                                                            ) {
                                                                // Touch tap
                                                                // on a different
                                                                // cell while a
                                                                // popover was
                                                                // open: the
                                                                // open popover
                                                                // already closed
                                                                // via Radix's
                                                                // pointerdown-outside
                                                                // path; suppress
                                                                // this open so
                                                                // the user has
                                                                // to tap again
                                                                // to see the
                                                                // new cell's
                                                                // popover.
                                                                dismissNextTouchOpenRef.current = false;
                                                                return;
                                                            }
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
                                                    onContentPointerEnter={
                                                        cancelExitTimer
                                                    }
                                                    onContentPointerLeave={
                                                        onCellPointerLeave
                                                    }
                                                    popoverZone="checklist"
                                                >
                                                    <motion.td
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
                                                        className={tdClassName}
                                                        exit={columnCellExit}
                                                        style={STYLE_COLUMN_CELL_VISIBLE}
                                                        role="button"
                                                        tabIndex={0}
                                                        aria-haspopup={ARIA_HASPOPUP_DIALOG}
                                                        data-cell-row={rowIdx}
                                                        data-cell-col={colIdx}
                                                        {...firstCellAnchorAttr}
                                                        onFocus={onCellFocus}
                                                        onPointerDown={e => {
                                                            // Reset any stale
                                                            // flag from a prior
                                                            // gesture that
                                                            // didn't complete a
                                                            // click.
                                                            dismissNextTouchOpenRef.current =
                                                                false;
                                                            if (
                                                                e.pointerType
                                                                    !== "touch"
                                                            )
                                                                return;
                                                            // Touch tap on a
                                                            // different cell
                                                            // while a popover
                                                            // is open: arm the
                                                            // dismiss-not-open
                                                            // gate. The flag
                                                            // is consumed by
                                                            // this cell's
                                                            // onOpenChange a
                                                            // few events later
                                                            // when the click
                                                            // would otherwise
                                                            // open the new
                                                            // popover.
                                                            if (
                                                                popoverCellRef.current
                                                                    !== null
                                                                && !Equal.equals(
                                                                    popoverCellRef.current,
                                                                    thisCell,
                                                                )
                                                            ) {
                                                                dismissNextTouchOpenRef.current =
                                                                    true;
                                                            }
                                                        }}
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
                                                        {renderTableCellContent(cellContent)}
                                                    </motion.td>
                                                </InfoPopover>
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
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
                                                    tabIndex={0}
                                                    data-cell-row={rowIdx}
                                                    data-cell-col={colIdx}
                                                    {...firstCellAnchorAttr}
                                                    onFocus={onCellFocus}
                                                    onKeyDown={onGridArrowKey}
                                                    {...hoverHandlers}
                                                >
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
                                            );
                                        } else {
                                            cell = (
                                                <motion.td
                                                    key={ownerCellKey}
                                                    className={tdClassName}
                                                    exit={columnCellExit}
                                                    style={STYLE_COLUMN_CELL_VISIBLE}
                                                    {...firstCellAnchorAttr}
                                                    {...hoverHandlers}
                                                >
                                                    {renderTableCellContent(cellContent)}
                                                </motion.td>
                                            );
                                        }
                                        const emptyCell = (
                                            <motion.td
                                                key={`${ADD_PLAYER_COLUMN_KEY}-${String(entry.id)}`}
                                                className="overflow-hidden border-r border-b border-border"
                                                exit={columnCellExit}
                                                style={STYLE_COLUMN_CELL_VISIBLE}
                                            >
                                                {renderTableCellContent(null)}
                                            </motion.td>
                                        );
                                        return inSetup && owner._tag === "CaseFile"
                                            ? [emptyCell, cell]
                                            : [cell];
                                    })}
                                    </AnimatePresence>
                                </motion.tr>
                                );
                            }),
                            ...(inSetup
                                ? [
                                      <motion.tr
                                          key={`add-card-${String(category.id)}`}
                                          {...tableRowMotionProps}
                                      >
                                          <motion.th
                                              className={`${STICKY_FIRST_COL} overflow-hidden border-r border-b border-border bg-row-alt p-0 text-left`}
                                              data-tour-sticky-left=""
                                              exit={cellExitTone}
                                          >
                                              {renderRowReveal(
                                                  <div className="px-1.5 py-1">
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
                                                  </div>,
                                              )}
                                          </motion.th>
                                          <td
                                              colSpan={cardSpan - 1}
                                              className="border-r border-b border-border bg-row-alt"
                                          />
                                      </motion.tr>,
                                  ]
                                : []),
                        ];
                    })}
                    {inSetup && (
                        <motion.tr key="add-category" {...tableRowMotionProps}>
                            <motion.th
                                className={`${STICKY_FIRST_COL} overflow-hidden border-r border-b border-border bg-row-alt p-0 text-left`}
                                data-tour-sticky-left=""
                                exit={cellExitTone}
                            >
                                {renderRowReveal(
                                    <div className="px-1.5 py-2">
                                        <button
                                            type="button"
                                            className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover"
                                            onClick={() =>
                                                dispatch({ type: "addCategory" })
                                            }
                                        >
                                            {tSetup("addCategory")}
                                        </button>
                                    </div>,
                                )}
                            </motion.th>
                            <td
                                colSpan={cardSpan - 1}
                                className="border-r border-b border-border bg-row-alt"
                            />
                        </motion.tr>
                    )}
                    </AnimatePresence>
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

    return (
        <div className="flex flex-col items-stretch gap-0.5">
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    className="box-border min-w-0 flex-1 rounded border border-border px-1.5 py-1 text-[12px]"
                    value={editing}
                    data-cell-row={-2}
                    data-cell-col={colIdx}
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

interface CellWhy {
    /** "Hard facts" deduction chain — rendered as plain text in the popover. */
    readonly chainText: string | undefined;
    /** Footnote candidate-for-suggestion line — rendered with a lightbulb icon. */
    readonly footnoteText: string | undefined;
}

const buildCellWhy = (args: {
    provenance: Provenance | undefined;
    suggestions: ReadonlyArray<Suggestion>;
    accusations: ReadonlyArray<Accusation>;
    setup: ReturnType<typeof useClue>["state"]["setup"];
    owner: Owner;
    card: Card;
    footnoteNumbers: ReadonlyArray<number>;
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
        footnoteNumbers,
        tDeduce,
        tReasons,
    } = args;

    const footnoteText =
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

    // The "Why this value:" prefix used to lead the chain text, but the
    // popover now renders a "Hard facts" section heading above it
    // (parallel to the "Hypothesis" heading), so the prefix is
    // redundant here.
    const chainText = chainLines.length > 0 ? chainLines.join("\n") : undefined;

    return { chainText, footnoteText };
};

// Motion-only constants (non user-facing). The "unsolved" color
// is the app's body ink; motion can't animate "inherit" so we
// resolve it here.
const CSS_ACCENT = "var(--color-accent)";
const CSS_BORDER = "var(--color-border)";
const CSS_WHITE = "#ffffff";
const CSS_INK = "#2a1f12";
const CSS_DANGER = "var(--color-danger)";
const ARIA_HASPOPUP_DIALOG = "dialog";
const MOTION_SYNC: "sync" = "sync";
const MOTION_WAIT: "wait" = "wait";
const MOTION_POP_LAYOUT: "popLayout" = "popLayout";
const TABLE_AXIS_ROW = "row";
const TABLE_AXIS_COLUMN = "column";
type TableAnimationAxis = typeof TABLE_AXIS_ROW | typeof TABLE_AXIS_COLUMN;
const CELL_EXPAND_CAP_PX = 200;
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

// Discriminator constants for the cell's primary glyph slot. Module-
// scope so the `no-literal-string` lint rule reads them as code, not
// UI text. The matching presentation lives in `renderGlyphNode`.
//
// Direct-hypothesis cells use the same "?" glyph as derived cells —
// the visual distinction lives in a separate corner badge rendered
// alongside the glyph (see `cellContent` below).
const GLYPH_YES = "yes" as const;
const GLYPH_NO = "no" as const;
const GLYPH_QUESTION = "question" as const;
const GLYPH_ALERT = "alert" as const;
const GLYPH_BLANK = "blank" as const;
type GlyphKind =
    | typeof GLYPH_YES
    | typeof GLYPH_NO
    | typeof GLYPH_QUESTION
    | typeof GLYPH_ALERT
    | typeof GLYPH_BLANK;

const glyphKindFor = (
    display: CellDisplay,
    status: HypothesisStatus,
): GlyphKind => {
    // Contradicted hypotheses (directly or jointly) replace whatever
    // glyph would have rendered with the alert icon, so the conflict
    // reads at a glance.
    if (
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts"
    ) {
        return GLYPH_ALERT;
    }
    switch (display.tag) {
        case "real":
            if (display.value === Y) return GLYPH_YES;
            if (display.value === N) return GLYPH_NO;
            return GLYPH_BLANK;
        case "hypothesis":
        case "derived":
            return GLYPH_QUESTION;
        case "blank":
            return GLYPH_BLANK;
    }
};

const renderGlyphNode = (kind: GlyphKind): ReactNode => {
    switch (kind) {
        case GLYPH_YES:
            return "✓";
        case GLYPH_NO:
            return "·";
        case GLYPH_QUESTION:
            return "?";
        case GLYPH_ALERT:
            return <AlertIcon size={14} className="text-danger" />;
        case GLYPH_BLANK:
            return null;
    }
};

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
                    className="inline-flex items-center justify-center"
                >
                    {renderGlyphNode(kind)}
                </motion.span>
            )}
        </AnimatePresence>
    );
}

const ADD_PLAYER_COLUMN_KEY = "add-player-col";
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
    "sticky left-0 z-[var(--z-checklist-sticky-header)]";

// Z-index ladder for the checklist:
//   - body cell hover ring      : --z-checklist-cell-hover
//   - body cell focus           : --z-checklist-cell-focus
//   - sticky first column       : --z-checklist-sticky-column
//   - sticky <thead>            : --z-checklist-sticky-header
// The body-cell z-index escape keeps rings from being painted under
// neighboring cells in document order. The sticky first column and
// sticky header deliberately sit higher so horizontal / vertical
// scroll never hides the card/category labels or column labels under
// an active body cell.
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
    // Contradiction states are conveyed by the AlertIcon that
    // replaces the central glyph (`directlyContradicted` and
    // `jointlyConflicts` both render `<AlertIcon>`) and by the
    // boxed status panel inside the popover, so no extra cell ring
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
        return `${base} bg-yes-bg text-yes focus:ring-offset-yes-bg`;
    }
    if (tone === N) {
        return `${base} bg-no-bg text-no focus:ring-offset-no-bg`;
    }
    return `${base} bg-white focus:ring-offset-white`;
};
