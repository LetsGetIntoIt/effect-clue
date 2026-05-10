"use client";

import { Duration, Effect, Fiber, Layer, Result } from "effect";
import { newAccusationId } from "../../logic/Accusation";
import type { Card } from "../../logic/GameObjects";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    accusationFormOpened,
    accusationLogged,
    accusationRemoved,
    priorAccusationEdited,
    suggestionMade,
} from "../../analytics/events";
import { Player } from "../../logic/GameObjects";
import { footnotesForCell } from "../../logic/Footnotes";
import {
    cardName,
    categoryName as resolveCategoryName,
} from "../../logic/GameSetup";
import { chainFor } from "../../logic/Provenance";
import {
    consolidateRecommendations,
    describeRecommendation,
    isAnySlot,
    recommendAction,
} from "../../logic/Recommender";
import type {
    ActionRecommendation,
    AnySlot,
    RecommendationDescription,
} from "../../logic/Recommender";
import {
    makeAccusationsLayer,
    makeKnowledgeLayer,
    makeSetupLayer,
    makeSuggestionsLayer,
} from "../../logic/services";
import { useConfirm } from "../hooks/useConfirm";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { useListFormatter } from "../hooks/useListFormatter";
import { useSelection } from "../SelectionContext";
import { BehavioralInsights } from "./BehavioralInsights";
import { TrashIcon, XIcon } from "./Icons";
import { InfoPopover } from "./InfoPopover";
import { AccusationForm, type AccusationFormHandle } from "./AccusationForm";
import { RefuteHint } from "./MyHandPanel";
import {
    SuggestionForm,
    type SuggestionFormHandle,
} from "./SuggestionForm";
import { isInsideSuggestionPopover } from "./SuggestionPills";
import type { DraftAccusation } from "../../logic/ClueState";
import {
    DraftSuggestion,
    useClue,
} from "../state";
import { registerAddFormFocusHandler } from "../addFormFocus";
import {
    T_FAST,
    T_SPRING_SOFT,
    T_STANDARD,
    useReducedTransition,
} from "../motion";
import { label, matches, shortcutSuffix } from "../keyMap";

const SECTION_TITLE = "mt-0 mb-2 text-[14px] font-semibold";
// Non user-facing glyph rendered as the rotating caret on
// the Recommendations expand/collapse header.
const CARET_GLYPH = "\u25B8";
const HEIGHT_AUTO = "auto";
// Kept for the recommendations chooser below — the suggestion form
// no longer uses these classes (it renders pills, not <select>s).
const SELECT_CLASS =
    "flex-1 rounded border border-border p-1.5 text-[13px]";
const LABEL_ROW = "flex items-center gap-1.5 text-[13px]";

/**
 * Consolidated card for everything the solver's primary loop touches:
 * adding a suggestion, getting recommendations for the next one, and
 * reviewing / editing the log of prior suggestions.
 */
export function SuggestionLogPanel() {
    const t = useTranslations("suggestions");
    return (
        <section className="min-w-0 contain-inline-size rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="m-0 mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                {t("title")}
            </h2>
            <div className="mb-5">
                <Recommendations />
            </div>
            <AddSuggestion />
            <PriorLog />
            <BehavioralInsights />
        </section>
    );
}

/**
 * Inactivity timeout that flips the accusation form back to the
 * suggestion form. Matches the user's mental model of "I switched,
 * then got distracted". Reset on every discrete user interaction
 * inside the form (hover, click, focus change, keypress); explicitly
 * NOT reset by mere focus residency, so leaving focus parked on a
 * pill for longer than this window correctly reverts to suggestion
 * mode.
 */
const ACCUSATION_IDLE_TIMEOUT: Duration.Duration = Duration.seconds(15);

// Module-level mode sentinels — kept as `as const` so the lint rule's
// type-narrowing exemption applies and no inline literal warnings.
const SUGGESTION_MODE = "suggestion" as const;
const ACCUSATION_MODE = "accusation" as const;

type Mode = typeof SUGGESTION_MODE | typeof ACCUSATION_MODE;

// Stable Framer Motion `layoutId` for the active-tab indicator. The
// indicator is rendered as a child of whichever tab is active; the
// shared id makes Framer auto-FLIP its background between the two.
const TAB_INDICATOR_LAYOUT_ID = "addForm-tab-indicator";

// AnimatePresence presence-mode that defers the entering form's mount
// until the exiting form's transition has completed. Constant kept at
// module scope so the i18next/no-literal-string lint exemption applies.
const PRESENCE_WAIT_MODE = "wait" as const;

/**
 * Top of the log: the pill-driven form for composing a new
 * suggestion or a failed accusation. Two modes share this slot,
 * presented as a tab-strip header (`Add a [suggestion (⌘K)]
 * [accusation (⌘I)]`) above the active form. Switching tabs slides
 * a sliding accent indicator between the two buttons; the form area
 * cross-fades + slides on the same axis.
 *
 * Auto-revert: while in accusation mode, any 15-second window with
 * no discrete interaction (hover, click, focus change, keypress)
 * flips back to suggestion mode. Submitting an accusation also
 * flips immediately.
 *
 * Programmatic mode entry (e.g. from the ⌘K / ⌘I keyboard shortcuts
 * or the recommender's "log this accusation" banner) goes through
 * the `addFormFocus` bus, which writes both `setMode(target)` and
 * `setPendingFocus(...)` so the new form's first pill is auto-opened
 * once it has finished mounting (AnimatePresence's mode="wait" can
 * delay mount past a microtask).
 */
function AddSuggestion() {
    const { dispatch, state } = useClue();
    const t = useTranslations("suggestions");
    const tAcc = useTranslations("accusations");
    const suggestionFormRef = useRef<SuggestionFormHandle>(null);
    const accusationFormRef = useRef<AccusationFormHandle>(null);

    const [mode, setMode] = useState<Mode>(SUGGESTION_MODE);
    // Tracks whether the *active* form has any pill filled. Drives the
    // section header's conditional copy ("Add a suggestion" vs "Add a
    // suggestion or accusation") and the right-aligned X button.
    // Each form mirrors its empty-vs-non-empty state into this via
    // `onHasAnyInputChange`; the inactive form is unmounted by
    // `AnimatePresence`, so only the active form drives the value.
    const [hasAnyInput, setHasAnyInput] = useState(false);
    const handleClearInputs = useCallback(() => {
        if (mode === SUGGESTION_MODE) {
            suggestionFormRef.current?.clearInputs();
        } else {
            accusationFormRef.current?.clearInputs();
        }
    }, [mode]);
    const [pendingFocus, setPendingFocus] = useState<{
        readonly target: Mode;
        readonly clear: boolean;
    } | null>(null);

    useEffect(
        () =>
            registerAddFormFocusHandler((target, { clear }) => {
                const targetMode: Mode =
                    target === "accusation" ? ACCUSATION_MODE : SUGGESTION_MODE;
                setMode(targetMode);
                setPendingFocus({ target: targetMode, clear });
            }),
        [],
    );

    // Drive the deferred focus-first-pill once the new form has
    // mounted. `AnimatePresence mode="wait"` holds off the mount
    // until the exiting form's transition completes, so a microtask
    // alone isn't enough — poll on requestAnimationFrame until the
    // matching ref is populated (with an upper bound so we don't
    // leak rAF callbacks if the form never mounts for some reason).
    useEffect(() => {
        if (pendingFocus === null) return;
        if (pendingFocus.target !== mode) return;
        let rafId = 0;
        let attempts = 0;
        const tryFocus = (): void => {
            const ref =
                mode === SUGGESTION_MODE
                    ? suggestionFormRef
                    : accusationFormRef;
            if (ref.current !== null) {
                ref.current.focusFirstPill({ clear: pendingFocus.clear });
                setPendingFocus(null);
                return;
            }
            attempts += 1;
            // ~30 frames @ 60fps ≈ 500ms — generous upper bound for
            // AnimatePresence's mode="wait" exit-then-enter sequence
            // (the actual transition is ~120ms).
            if (attempts > 30) {
                setPendingFocus(null);
                return;
            }
            rafId = requestAnimationFrame(tryFocus);
        };
        rafId = requestAnimationFrame(tryFocus);
        return () => cancelAnimationFrame(rafId);
    }, [pendingFocus, mode]);

    // Idle-timer ref. Reset on every pointer / key / focus event
    // inside the wrapper while in accusation mode. Cleared when we
    // flip back.
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearIdleTimer = () => {
        if (idleTimerRef.current !== null) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    };
    const armIdleTimer = () => {
        clearIdleTimer();
        idleTimerRef.current = setTimeout(
            () => setMode(SUGGESTION_MODE),
            Duration.toMillis(ACCUSATION_IDLE_TIMEOUT),
        );
    };
    useEffect(() => {
        if (mode === ACCUSATION_MODE) armIdleTimer();
        else clearIdleTimer();
        return clearIdleTimer;
        // armIdleTimer / clearIdleTimer are intentionally re-created on
        // every render without joining the dep array — they only read
        // refs and the stable setMode callback.
    }, [mode]);

    const onWrapperActivity = () => {
        if (mode === ACCUSATION_MODE) armIdleTimer();
    };

    return (
        <div
            // Spotlight target for the wrap-up step of the
            // checklist+suggest tour. The popover anchors to the
            // smaller `suggest-add-form-header` (the section title)
            // so it stays in viewport on tall layouts; the spotlight
            // unions the two and ends up covering the entire form.
            data-tour-anchor="suggest-add-form"
            onPointerDown={onWrapperActivity}
            onPointerMove={onWrapperActivity}
            onKeyDown={onWrapperActivity}
            onFocus={onWrapperActivity}
        >
            <AddFormTabHeader
                mode={mode}
                setMode={setMode}
                hasAnyInput={hasAnyInput}
                onClearInputs={handleClearInputs}
            />
            <AnimatePresence mode={PRESENCE_WAIT_MODE} initial={false}>
                {mode === SUGGESTION_MODE ? (
                    <FormSlide key="suggestion" direction={-1}>
                        <SuggestionForm
                            ref={suggestionFormRef}
                            setup={state.setup}
                            showHeader={false}
                            showClearInputs={false}
                            onHasAnyInputChange={setHasAnyInput}
                            pendingDraft={state.pendingSuggestion}
                            onPendingDraftChange={draft =>
                                dispatch({
                                    type: "setPendingSuggestion",
                                    draft,
                                })
                            }
                            onSubmit={draft => {
                                dispatch({
                                    type: "addSuggestion",
                                    suggestion: draft,
                                });
                                const setup = state.setup;
                                const [c0, c1, c2] = draft.cards;
                                suggestionMade({
                                    turnNumber: state.suggestions.length + 1,
                                    suspect: c0
                                        ? cardName(setup.cardSet, c0)
                                        : "",
                                    weapon: c1
                                        ? cardName(setup.cardSet, c1)
                                        : "",
                                    room: c2
                                        ? cardName(setup.cardSet, c2)
                                        : "",
                                    suggestingPlayer: String(draft.suggester),
                                });
                            }}
                        />
                        <RefuteHint />
                    </FormSlide>
                ) : (
                    <FormSlide key="accusation" direction={1}>
                        <p className="mt-0 mb-2 text-[12px] leading-snug text-muted">
                            {tAcc("addHelpText")}
                        </p>
                        <AccusationForm
                            ref={accusationFormRef}
                            setup={state.setup}
                            showHeader={false}
                            onHasAnyInputChange={setHasAnyInput}
                            onSubmit={draft => {
                                dispatch({
                                    type: "addAccusation",
                                    accusation: draft,
                                });
                                accusationLogged({
                                    accusationCount:
                                        state.accusations.length + 1,
                                    accuser: String(draft.accuser),
                                    source: "manual",
                                });
                                // Submission flips back so the next thing
                                // the user types is a regular suggestion.
                                setMode(SUGGESTION_MODE);
                            }}
                        />
                    </FormSlide>
                )}
            </AnimatePresence>
        </div>
    );

    // ---- Inner components -----------------------------------------
    //
    // Defined inside `AddSuggestion` so they can close over `t` /
    // `setMode` without prop-drilling. Re-mount cost is fine — these
    // are tiny presentational shells; React's reconciler keeps the
    // children steady because the JSX shape is stable.

    function AddFormTabHeader({
        mode,
        setMode,
        hasAnyInput,
        onClearInputs,
    }: {
        readonly mode: Mode;
        readonly setMode: (m: Mode) => void;
        readonly hasAnyInput: boolean;
        readonly onClearInputs: () => void;
    }): React.ReactElement {
        const hasKeyboard = useHasKeyboard();
        const tabIndicatorTransition = useReducedTransition({
            ...T_STANDARD,
            duration: 0.22,
        });
        const titleTransition = useReducedTransition({
            ...T_STANDARD,
            duration: 0.18,
        });
        const onTabKeyDown = (
            e: React.KeyboardEvent<HTMLButtonElement>,
        ): void => {
            // Arrow-key navigation between the two tabs, scoped to the
            // tab buttons themselves so the per-form pill arrow-keys
            // are unaffected (those listeners scope to `[data-pill-id]`
            // elements).
            const native = e.nativeEvent;
            const isLeft = matches("nav.left", native);
            const isRight = matches("nav.right", native);
            if (!isLeft && !isRight) return;
            e.preventDefault();
            const next: Mode =
                mode === SUGGESTION_MODE ? ACCUSATION_MODE : SUGGESTION_MODE;
            if (next === ACCUSATION_MODE) {
                accusationFormOpened({ source: "toggle_link" });
            }
            setMode(next);
        };

        // Three render states the user perceives:
        //   - empty: both tabs visible, "Add a [suggestion] or [accusation]"
        //   - suggesting (active form has any pill filled): "Add a [suggestion]" + X
        //   - accusing  (active form has any pill filled): "Add an [accusation]" + X
        // Each visible piece is its own `motion.span` with `layout`, so
        // when siblings come/go (the inactive tab + " or " connector
        // collapse out, the X fades in) the active tab slides smoothly
        // to its new position rather than crossfading. Pieces that
        // mount/unmount go through `<AnimatePresence>`.
        const showSuggestionTab = !hasAnyInput || mode === SUGGESTION_MODE;
        const showAccusationTab = !hasAnyInput || mode === ACCUSATION_MODE;
        const showConnector = !hasAnyInput;
        const articleKey:
            | "addTitleArticleA"
            | "addTitleArticleAn" =
            hasAnyInput && mode === ACCUSATION_MODE
                // eslint-disable-next-line i18next/no-literal-string -- ICU template key
                ? "addTitleArticleAn"
                // eslint-disable-next-line i18next/no-literal-string -- ICU template key
                : "addTitleArticleA";
        const tabRichHandlers = {
            suggestionKey: label("global.gotoPlay"),
            accusationKey: label("global.gotoAccusation"),
            kbd: hasKeyboard
                ? (chunks: React.ReactNode) => (
                      <span className="ml-0.5 font-normal text-muted">
                          {chunks}
                      </span>
                  )
                : () => null,
        };

        return (
            <h3
                className={`${SECTION_TITLE} leading-[1.5] mb-3 flex items-center justify-between gap-2`}
                // Tour anchor: the wrap-up step of the
                // checklist+suggest tour anchors its popover here
                // (rather than the full form below) so the popover
                // stays inside the viewport on layouts where the
                // form sits at the bottom of the panel.
                data-tour-anchor="suggest-add-form-header"
            >
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <AnimatePresence
                        // eslint-disable-next-line i18next/no-literal-string -- AnimatePresence mode value
                        mode="popLayout"
                        initial={false}
                    >
                        <motion.span
                            key={articleKey}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={titleTransition}
                        >
                            {t(articleKey)}
                        </motion.span>
                        {showSuggestionTab && (
                            <motion.span
                                key="suggestion-tab"
                                // `layoutId` (instead of `layout`)
                                // tracks the tab's position across
                                // mount/unmount cycles — when the
                                // tab re-mounts after the inactive
                                // sibling went away, it slides from
                                // its last-known position.
                                layoutId="suggestion-tab"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={titleTransition}
                            >
                                <TabButton
                                    isActive={mode === SUGGESTION_MODE}
                                    indicatorTransition={
                                        tabIndicatorTransition
                                    }
                                    onClick={() => setMode(SUGGESTION_MODE)}
                                    onKeyDown={onTabKeyDown}
                                >
                                    {t.rich(
                                        "addTitleSuggestionTab",
                                        tabRichHandlers,
                                    )}
                                </TabButton>
                            </motion.span>
                        )}
                        {showConnector && (
                            <motion.span
                                key="connector"
                                layout
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={titleTransition}
                            >
                                {t("addTitleConnector")}
                            </motion.span>
                        )}
                        {showAccusationTab && (
                            <motion.span
                                key="accusation-tab"
                                layoutId="accusation-tab"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={titleTransition}
                            >
                                <TabButton
                                    isActive={mode === ACCUSATION_MODE}
                                    indicatorTransition={
                                        tabIndicatorTransition
                                    }
                                    onClick={() => {
                                        setMode(ACCUSATION_MODE);
                                        accusationFormOpened({
                                            source: "toggle_link",
                                        });
                                    }}
                                    onKeyDown={onTabKeyDown}
                                >
                                    {t.rich(
                                        "addTitleAccusationTab",
                                        tabRichHandlers,
                                    )}
                                </TabButton>
                            </motion.span>
                        )}
                    </AnimatePresence>
                </span>
                <AnimatePresence initial={false}>
                    {hasAnyInput && (
                        <motion.button
                            key="clear-inputs"
                            type="button"
                            aria-label={t("clearInputs")}
                            onClick={onClearInputs}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={titleTransition}
                            // Visually fits the heading line-height —
                            // the icon is the only content; an
                            // invisible `before:` pseudo-element
                            // extends the hit target outward to a
                            // mobile-friendly ~40px without inflating
                            // the header's intrinsic height.
                            className="relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0.5 text-muted hover:text-accent before:absolute before:inset-[-10px] before:content-['']"
                        >
                            <XIcon size={16} />
                        </motion.button>
                    )}
                </AnimatePresence>
            </h3>
        );
    }
}

/**
 * Wrapper that maps the rich-text chunk into a single tab-button
 * element. The active button hosts the shared sliding indicator
 * (`layoutId={TAB_INDICATOR_LAYOUT_ID}`); inactive buttons retain
 * their hover affordance so they always read as clickable.
 */
function TabButton({
    isActive,
    indicatorTransition,
    onClick,
    onKeyDown,
    children,
}: {
    readonly isActive: boolean;
    readonly indicatorTransition: import("motion/react").Transition;
    readonly onClick: () => void;
    readonly onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    readonly children: React.ReactNode;
}): React.ReactElement {
    // Both tabs render with the same lightly-tinted accent fill +
    // dark text, so the noun looks like part of the surrounding
    // "Add a …" sentence. Active state adds an outlined ring (the
    // shared sliding `motion.span layoutId`) on top — text colour
    // doesn't change between states. Inline-flex + `align-baseline`
    // keeps the button glued to the baseline of "Add a", and
    // `mx-0.5` is the only inter-word margin (the natural
    // whitespace between rich-text chunks already separates them).
    return (
        <button
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={onClick}
            onKeyDown={onKeyDown}
            className={
                "relative mx-px inline-flex cursor-pointer items-baseline " +
                "rounded-[6px] border-none bg-accent/10 px-1.5 py-1 " +
                "align-baseline text-[14px] font-semibold text-text " +
                "transition-colors hover:bg-accent/20 " +
                "focus-visible:outline-2 focus-visible:outline-accent " +
                "focus-visible:outline-offset-1"
            }
        >
            {isActive && (
                <motion.span
                    layoutId={TAB_INDICATOR_LAYOUT_ID}
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[6px] border-2 border-accent"
                    transition={indicatorTransition}
                />
            )}
            <span className="relative z-[var(--z-local-raised)]">{children}</span>
        </button>
    );
}

/**
 * Per-form slide-in / slide-out wrapper used inside AnimatePresence.
 * `direction` is `-1` for the suggestion form (enters from the left)
 * and `+1` for the accusation form (enters from the right) — same
 * axis as the tab indicator's slide.
 */
function FormSlide({
    direction,
    children,
}: {
    readonly direction: -1 | 1;
    readonly children: React.ReactNode;
}): React.ReactElement {
    const transition = useReducedTransition(T_FAST);
    return (
        <motion.div
            initial={{ x: direction * 16, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -direction * 16, opacity: 0 }}
            transition={transition}
        >
            {children}
        </motion.div>
    );
}

/**
 * Pick the ICU `select` branch for the refutation-summary template
 * in `suggestions.refutationLine`. Combining the refuted/nobody axis
 * with the seen-card and non-refuters axes via select keeps the copy
 * as a single translatable sentence per case rather than a
 * concatenation of fragments.
 *
 * Exported for unit-test coverage of all six branches.
 */
export const refutationStatus = (
    s: DraftSuggestion,
):
    | "refutedSeenPassed"
    | "refutedSeen"
    | "refutedPassed"
    | "refuted"
    | "nobodyPassed"
    | "nobody" => {
    const hasRefuter = s.refuter !== undefined;
    const hasSeen = s.seenCard !== undefined;
    const hasPassers = s.nonRefuters.length > 0;
    if (hasRefuter && hasSeen && hasPassers) return "refutedSeenPassed";
    if (hasRefuter && hasSeen) return "refutedSeen";
    if (hasRefuter && hasPassers) return "refutedPassed";
    if (hasRefuter) return "refuted";
    if (hasPassers) return "nobodyPassed";
    return "nobody";
};

/**
 * Render a collapsed `AnySlot` (e.g. "any weapon owned by Green") into
 * a localized phrase. Keyed off `AnySlot.kind` so adding a new variant
 * is a compile error here — forcing us to supply a translation.
 */
const renderAnySlot = (
    t: ReturnType<typeof useTranslations<"suggestions">>,
    slot: AnySlot,
    singular: string,
): string => {
    switch (slot.kind) {
        case "any":
            return t("anyCategory", { category: singular });
        case "anyYouOwn":
            return t("anyCategoryYouOwn", { category: singular });
        case "anyYouDontOwn":
            return t("anyCategoryYouDontOwn", { category: singular });
        case "anyYouDontKnow":
            return t("anyCategoryYouDontKnow", { category: singular });
        case "anyNotInCaseFile":
            return t("anyCategoryNotInCaseFile", { category: singular });
        case "anyOwnedBy":
            return t("anyCategoryOwnedBy", {
                category: singular,
                player: String(slot.player),
            });
        case "anyNotOwnedBy":
            return t("anyCategoryNotOwnedBy", {
                category: singular,
                player: String(slot.player),
            });
    }
};

function RecommendationInfoIcon({ content }: { readonly content: React.ReactNode }) {
    const tCommon = useTranslations("common");
    return (
        <InfoPopover asButton content={content} side="left">
            {tCommon("infoGlyph")}
        </InfoPopover>
    );
}

function Recommendations() {
    const t = useTranslations("suggestions");
    const { state, derived } = useClue();
    const setup = state.setup;
    const result = derived.deductionResult;
    const [asPlayer, setAsPlayer] = useState<string>(
        setup.players[0] ?? "",
    );
    // Collapsed by default — the recommendation body runs a non-trivial
    // Effect.runSync per render, so skipping it while closed keeps the
    // suggestion-log panel snappy for users who don't need the hint.
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (asPlayer && setup.players.some(p => String(p) === asPlayer))
            return;
        setAsPlayer(setup.players[0] ?? "");
    }, [setup.players, asPlayer]);

    // Wrapping the button in an <h3> matches the sibling "Add a
    // suggestion" header: globals.css applies the display font to all
    // h1–h3 (and SECTION_TITLE sets shared size/weight), so the two
    // headings render identically. The button owns aria-expanded and
    // the click behaviour; the caret is trailing so every header in
    // this pane starts at the same x.
    const caretTransition = useReducedTransition(T_STANDARD);
    const bodyTransition = useReducedTransition(T_STANDARD);
    // Smaller / lighter than `SECTION_TITLE` so the recommendations
    // heading reads as a secondary affordance — the primary heading
    // is "Add a suggestion" right below.
    const header = (
        <h3 className="mt-0 mb-1 text-[12px] font-normal text-muted">
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
                className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left font-[inherit] text-[inherit] hover:text-accent"
            >
                <span>{t("recommendationsTitle")}</span>
                <motion.span
                    aria-hidden
                    animate={{ rotate: expanded ? 90 : 0 }}
                    transition={caretTransition}
                    className="inline-block text-[12px] leading-none"
                >
                    {CARET_GLYPH}
                </motion.span>
            </button>
        </h3>
    );

    return (
        <div>
            {header}
            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        key="recommendations-body"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: HEIGHT_AUTO, opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={bodyTransition}
                        style={{ overflow: "hidden" }}
                    >
                        <RecommendationsBody
                            setup={setup}
                            result={result}
                            asPlayer={asPlayer}
                            setAsPlayer={setAsPlayer}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/**
 * "Log this accusation" button rendered inside the accuse-now banner.
 * Dispatches `addAccusation` with the deduced triple + the player the
 * recommender is targeting, then mints a fresh id via the reducer's
 * standard path. If the accusation later turns out wrong, the
 * `failedAccusationEliminate` rule + ContradictionBanner will
 * surface the inconsistency.
 */
function LogAccusationButton({
    accuser,
    cards,
}: {
    readonly accuser: Player;
    readonly cards: ReadonlyArray<Card>;
}) {
    const tRecs = useTranslations("recommendations");
    const { dispatch, state } = useClue();
    return (
        <button
            type="button"
            title={tRecs("accuseNowLogTitle")}
            className="tap-target-compact text-tap-compact cursor-pointer rounded border border-accent bg-transparent text-accent hover:bg-accent hover:text-white"
            onClick={() => {
                dispatch({
                    type: "addAccusation",
                    accusation: {
                        // Reducer mints a stable id when this empty
                        // sentinel comes through `replaceSession`-style
                        // hydration; for direct dispatch we mint one
                        // here instead.
                        id: newAccusationId(),
                        accuser,
                        cards: [...cards],
                        loggedAt: Date.now(),
                    },
                });
                // Two events fire — `accusation_form_opened` so the
                // banner-driven path counts in the same funnel as the
                // toggle-link path, and `accusation_logged` for the
                // actual write. `source: "deduced_triple"` distinguishes
                // it from manual entries.
                accusationFormOpened({ source: "accuse_now_banner" });
                accusationLogged({
                    accusationCount: state.accusations.length + 1,
                    accuser: String(accuser),
                    source: "deduced_triple",
                });
            }}
        >
            {tRecs("accuseNowLog")}
        </button>
    );
}

/**
 * Inline 14×14 SVG spinner shown while the recommender is working.
 * Tailwind's `animate-spin` powers the rotation; the colour follows
 * the muted ink so it's unobtrusive next to the "Calculating…"
 * caption. Marked aria-hidden because the surrounding role="status"
 * + aria-live="polite" wrapper reads the caption to assistive
 * technology.
 */
function Spinner() {
    return (
        <svg
            className="h-3.5 w-3.5 animate-spin text-muted"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="3"
            />
            <path
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
            />
        </svg>
    );
}

/**
 * One row in the rendered recommendations list. Pre-computed in the
 * async pipeline below so the render path is purely declarative — no
 * Effect.runSync inside the JSX.
 */
interface RecommendationItem {
    readonly cards: ReadonlyArray<Card | AnySlot>;
    readonly score: number;
    readonly groupSize: number;
    readonly description: RecommendationDescription;
}

/**
 * Async state machine driving the recommendations panel. The
 * recommender's heavy work (info-gain scoring across ~324 candidate
 * triples × ~5 outcomes each) runs off the React render path so a
 * stale fiber can be interrupted when inputs change and React paints
 * a loading state in between.
 *
 * `pending` is the bootstrap state and the state we revert to whenever
 * inputs change. `ready` carries the resolved action + pre-described
 * items so the JSX is purely declarative.
 */
type RecommendationsState =
    | { readonly kind: "pending" }
    | {
          readonly kind: "ready";
          readonly action: ActionRecommendation;
          readonly items: ReadonlyArray<RecommendationItem>;
      };

function RecommendationsBody({
    setup,
    result,
    asPlayer,
    setAsPlayer,
}: {
    readonly setup: ReturnType<typeof useClue>["state"]["setup"];
    readonly result: ReturnType<typeof useClue>["derived"]["deductionResult"];
    readonly asPlayer: string;
    readonly setAsPlayer: (v: string) => void;
}) {
    const t = useTranslations("suggestions");
    const tRecs = useTranslations("recommendations");
    const { derived } = useClue();
    const suggestionsAsData = derived.suggestionsAsData;
    const accusationsAsData = derived.accusationsAsData;

    const knowledge = Result.getOrUndefined(result);

    // Shared service layer for the recommender pipeline below. The
    // info-gain scorer reads setup + knowledge + suggestions +
    // accusations from services, so the full clue layer is plumbed
    // in. Rebuilt only when one of the inputs changes (memoised).
    const recommendLayer = useMemo(
        () =>
            knowledge === undefined
                ? null
                : Layer.mergeAll(
                      makeSetupLayer(setup),
                      makeKnowledgeLayer(knowledge),
                      makeSuggestionsLayer(suggestionsAsData),
                      makeAccusationsLayer(accusationsAsData),
                  ),
        [setup, knowledge, suggestionsAsData, accusationsAsData],
    );

    const [recState, setRecState] = useState<RecommendationsState>({
        kind: "pending",
    });

    // Drive the async pipeline. Whenever the layer or asPlayer changes
    // we kick off a new fiber via `Effect.runFork`; the cleanup
    // callback interrupts the in-flight fiber so a stale calculation
    // doesn't overwrite a fresher one.
    useEffect(() => {
        if (recommendLayer === null || !asPlayer) {
            setRecState({ kind: "pending" });
            return;
        }
        let cancelled = false;
        setRecState({ kind: "pending" });

        const program = Effect.gen(function* () {
            const action = yield* recommendAction(Player(asPlayer), 50);
            const recs =
                action._tag === "Suggest" || action._tag === "NearlySolved"
                    ? action.suggestions.recommendations
                    : [];
            const consolidated = (
                yield* consolidateRecommendations(recs)
            ).slice(0, 5);
            const items = yield* Effect.forEach(consolidated, row =>
                Effect.gen(function* () {
                    const description = yield* describeRecommendation({
                        cards: row.cards.flatMap(c =>
                            isAnySlot(c) ? [] : [c],
                        ),
                        score: row.score,
                    });
                    return {
                        cards: row.cards,
                        score: row.score,
                        groupSize: row.groupSize,
                        description,
                    };
                }),
            );
            return { action, items };
        });

        const fiber = Effect.runFork(
            program.pipe(
                Effect.provide(recommendLayer),
                Effect.tap(out =>
                    Effect.sync(() => {
                        if (cancelled) return;
                        setRecState({
                            kind: "ready",
                            action: out.action,
                            items: out.items,
                        });
                    }),
                ),
            ),
        );

        return () => {
            cancelled = true;
            // Fiber.interrupt is itself an Effect — fire-and-forget via
            // runFork so stale fibers actually wind down. The fiber may
            // have already completed; interrupting a finished fiber is
            // a no-op.
            Effect.runFork(Fiber.interrupt(fiber));
        };
    }, [recommendLayer, asPlayer]);

    if (knowledge === undefined || !asPlayer || recommendLayer === null) {
        return (
            <div className="mt-2 text-[13px] text-muted">
                {knowledge === undefined
                    ? t("resolveContradictionFirst")
                    : t("addPlayersFirst")}
            </div>
        );
    }

    if (recState.kind === "pending") {
        return (
            <>
                <label className={`${LABEL_ROW} mt-2`}>
                    {t("suggestingAs")}
                    <select
                        value={asPlayer}
                        onChange={e => setAsPlayer(e.currentTarget.value)}
                        className={SELECT_CLASS}
                    >
                        {setup.players.map(p => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </label>
                <div
                    className="mt-2 flex items-center gap-2 text-[13px] text-muted"
                    role="status"
                    aria-live="polite"
                >
                    <Spinner />
                    <span>{t("recommendationsCalculating")}</span>
                </div>
            </>
        );
    }

    const { action, items } = recState;

    const accuseBanner =
        action._tag === "Accuse" ? (
            <div
                className="mt-2 rounded border border-accent bg-panel p-3 text-[13px]"
                role="status"
            >
                <div className="font-semibold text-accent">
                    {tRecs("accuseNowTitle")}
                </div>
                <div className="mt-1">
                    {tRecs("accuseNowBody", {
                        cards: action.cards
                            .map(c => cardName(setup, c))
                            .join(" + "),
                    })}
                </div>
                {/* "Log this accusation" — drops the deduced triple
                    into the failed-accusation log so the user can
                    follow it up if the accusation turns out wrong.
                    The banner only appears when the case file is
                    fully pinned, so the cards are guaranteed
                    one-per-category. */}
                <div className="mt-2">
                    <LogAccusationButton
                        accuser={action.accuser}
                        cards={action.cards}
                    />
                </div>
            </div>
        ) : null;

    const nearlySolvedBanner =
        action._tag === "NearlySolved" ? (
            <div
                className="mt-2 rounded border border-border bg-panel p-3 text-[13px]"
                role="status"
            >
                <div className="font-semibold">
                    {tRecs("nearlySolvedTitle")}
                </div>
                <div className="mt-1">
                    {tRecs("nearlySolvedBody", {
                        category: resolveCategoryName(
                            setup,
                            action.openCategory,
                        ).toLowerCase(),
                    })}
                </div>
            </div>
        ) : null;

    return (
        <>
            {accuseBanner}
            {nearlySolvedBanner}
            <label className={`${LABEL_ROW} mt-2`}>
                {t("suggestingAs")}
                <select
                    value={asPlayer}
                    onChange={e => setAsPlayer(e.currentTarget.value)}
                    className={SELECT_CLASS}
                >
                    {setup.players.map(p => (
                        <option key={p} value={p}>
                            {p}
                        </option>
                    ))}
                </select>
            </label>
            {items.length === 0 ? (
                <div className="mt-2 text-[13px] text-muted">
                    {action._tag === "Accuse" ? null : t("nothingUseful")}
                </div>
            ) : (
                <ol className="mt-2 list-decimal pl-6 text-[13px]">
                    {items.map((r, i) => {
                        const explanation = tRecs(
                            r.description.kind,
                            r.description.params,
                        );
                        // Score is the expected number of unknown cells
                        // a refutation of this triple would reveal —
                        // already a probability-weighted average. Show
                        // it raw (one decimal) and, when consolidated,
                        // how many specific triples the row covers.
                        const scoreBreakdown = (
                            <div>
                                <div className="font-semibold">
                                    {t("scoreBreakdownHeader", {
                                        score: r.score.toFixed(1),
                                    })}
                                </div>
                                <div className="mt-1 text-muted">
                                    {t("scoreBreakdownDetails", {
                                        cells: Math.round(r.score),
                                    })}
                                </div>
                                {r.groupSize > 1 && (
                                    <div className="mt-1 text-muted">
                                        {t("scoreBreakdownCoverage", {
                                            count: r.groupSize,
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                        return (
                            <li key={i} className="py-1.5">
                                <div className="flex items-start gap-1.5">
                                    <div className="min-w-0 flex-1">
                                        <div>
                                            {r.cards.map((c, ci) => {
                                                const rawName =
                                                    setup.categories[ci]?.name ??
                                                    t("defaultCategorySingular");
                                                const categoryLabel =
                                                    rawName.toLowerCase();
                                                return (
                                                    <span key={ci}>
                                                        {ci > 0 && " + "}
                                                        {isAnySlot(c) ? (
                                                            <em className="text-muted">
                                                                {renderAnySlot(
                                                                    t,
                                                                    c,
                                                                    categoryLabel,
                                                                )}
                                                            </em>
                                                        ) : (
                                                            <strong>
                                                                {cardName(
                                                                    setup,
                                                                    c,
                                                                )}
                                                            </strong>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                            <span className="ml-1 text-muted">
                                                {t("score", {
                                                    score: r.score.toFixed(1),
                                                })}
                                            </span>
                                        </div>
                                        <div className="text-[12px] text-muted">
                                            {explanation}
                                        </div>
                                    </div>
                                    <RecommendationInfoIcon
                                        content={scoreBreakdown}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </>
    );
}

/**
 * Combined chronological log of every suggestion + failed accusation
 * the user has logged this game. Entries are interleaved in `loggedAt`
 * order so users see the timeline in the order things actually
 * happened, with the most recent at the top (matches the existing
 * "newest first" reverse-render of the suggestion log).
 *
 * The heading still reads "Prior suggestions" because that's the bulk
 * of what lands here — accusations are rare events.
 */
function PriorLog() {
    const t = useTranslations("suggestions");
    const { state } = useClue();
    const hasKeyboard = useHasKeyboard();

    // Merge suggestions + accusations by `loggedAt`. Domain indices
    // (`suggestionIdx` / `accusationIdx`) are preserved so the row's
    // dispatched action and the cross-references in tooltips
    // ("Suggestion #5") all line up with `state.suggestions[5]` /
    // `state.accusations[5]`.
    type LogEntry =
        | {
              readonly kind: "suggestion";
              readonly id: string;
              readonly loggedAt: number;
              readonly idx: number;
              readonly suggestion: DraftSuggestion;
          }
        | {
              readonly kind: "accusation";
              readonly id: string;
              readonly loggedAt: number;
              readonly idx: number;
              readonly accusation: DraftAccusation;
          };

    const entries: ReadonlyArray<LogEntry> = useMemo(() => {
        const out: LogEntry[] = [
            ...state.suggestions.map((s, idx) => ({
                kind: "suggestion" as const,
                id: String(s.id),
                loggedAt: s.loggedAt ?? 0,
                idx,
                suggestion: s,
            })),
            ...state.accusations.map((a, idx) => ({
                kind: "accusation" as const,
                id: String(a.id),
                loggedAt: a.loggedAt ?? 0,
                idx,
                accusation: a,
            })),
        ];
        // Sort ascending by loggedAt; the renderer reverses for "newest
        // first" display. Tie-break by entry kind + idx so the order
        // is deterministic when two entries share a millisecond.
        out.sort((a, b) => {
            if (a.loggedAt !== b.loggedAt) return a.loggedAt - b.loggedAt;
            if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
            return a.idx - b.idx;
        });
        return out;
    }, [state.suggestions, state.accusations]);

    return (
        <div
            className="mt-4 border-t border-border pt-4"
            data-tour-anchor="suggest-prior-log"
        >
            <h3
                id="prior-suggestions"
                tabIndex={-1}
                className={`${SECTION_TITLE} rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
            >
                {t("priorTitle", {
                    count: entries.length,
                    shortcut: shortcutSuffix("global.gotoPriorLog", hasKeyboard),
                })}
            </h3>
            {entries.length === 0 ? (
                <div className="text-[13px] text-muted">
                    {t("priorEmpty")}
                </div>
            ) : (
                <>
                    {hasKeyboard && (
                        <div className="mb-1 text-[11px] text-muted">
                            {t("priorKeyboardHint")}
                        </div>
                    )}
                    <ol className="m-0 flex list-none flex-col gap-2 p-0">
                        <AnimatePresence initial={false}>
                            {entries
                                .slice()
                                .reverse()
                                .map(entry =>
                                    entry.kind === "suggestion" ? (
                                        <PriorSuggestionItem
                                            key={`s-${entry.id}`}
                                            suggestion={entry.suggestion}
                                            idx={entry.idx}
                                        />
                                    ) : (
                                        <PriorAccusationItem
                                            key={`a-${entry.id}`}
                                            accusation={entry.accusation}
                                            idx={entry.idx}
                                        />
                                    ),
                                )}
                        </AnimatePresence>
                    </ol>
                </>
            )}
        </div>
    );
}

/**
 * One row in the prior-suggestions list. Two display modes:
 *  - idle: renders the existing sentence pair ("Player 3 suggested …"
 *    + refutation summary). Hover / focus / cell-cross-highlight
 *    surface an outline ring but do NOT open the pill editor.
 *  - edit mode: explicitly entered via Enter on a focused row, a
 *    desktop click, or the mobile two-tap (row tap → Edit button).
 *    Renders the pill row and buffers changes in a local draft — the
 *    store is only mutated when the user clicks Update. Cancel via
 *    the × button, Esc, or any outside click.
 *
 * The outline styling (ring) is shared between idle hover/focus and
 * the cell-cross highlight. The red accent background is reserved for
 * edit mode so the two signals remain visually distinct.
 */
function PriorSuggestionItem({
    suggestion: s,
    idx,
}: {
    readonly suggestion: DraftSuggestion;
    readonly idx: number;
}) {
    const t = useTranslations("suggestions");
    const { state, dispatch, derived } = useClue();
    const {
        setHoveredSuggestion,
        activeCell,
        selectedSuggestionIndex,
        setSelectedSuggestion,
    } = useSelection();
    const confirm = useConfirm();
    const isDesktop = useIsDesktop();
    const hasKeyboard = useHasKeyboard();
    const setup = state.setup;
    const listFormatter = useListFormatter();

    // Explicit edit-mode flag. Decoupled from hover/focus — only set
    // by an unambiguous user gesture (Enter, desktop click, or the
    // mobile Edit button). Controls whether the row swaps its idle
    // sentence pair for the inline `<SuggestionForm>` editor.
    const [isEditing, setIsEditing] = useState(false);
    // Mobile-only two-step-to-edit state. First tap on a row flips
    // this on and reveals an Edit button; tapping the button is the
    // second step that actually enters edit mode. Irrelevant on
    // desktop (where click / Enter enter edit directly).
    const [showMobileEditButton, setShowMobileEditButton] = useState(false);
    // Row-level keyboard focus tracker. Only true while focus is on
    // the <li> itself (not descendant pills / ×) — drives the
    // "Press Enter to edit" cue on desktop.
    const [isRowFocused, setIsRowFocused] = useState(false);
    // Mouse hover (desktop only — touch is filtered out below). Drives
    // the visibility of the trash button so idle rows aren't crowded
    // with a delete affordance.
    const [isHovered, setIsHovered] = useState(false);

    const isSelected = selectedSuggestionIndex === idx;

    // Cell → suggestion cross-highlight (reverse of the Checklist's
    // `cellIsHighlighted`). Two ways a cell can reference a suggestion:
    //   1. Provenance chain: the cell was SET by a rule that consulted
    //      this suggestion. `chainFor` walks back through dependsOn.
    //   2. Footnote candidacy: the cell is still in the running as the
    //      refuter's shown card for this suggestion (the superscript
    //      numbers in the grid). `footnotesForCell` indexes those,
    //      1-based, against the cell.
    const isHighlightedByCell = useMemo(() => {
        if (!activeCell) return false;
        if (derived.provenance) {
            for (const { reason } of chainFor(derived.provenance, activeCell)) {
                const tag = reason.kind._tag;
                if (
                    tag === "NonRefuters" ||
                    tag === "RefuterShowed" ||
                    tag === "RefuterOwnsOneOf"
                ) {
                    if (reason.kind.suggestionIndex === idx) return true;
                }
            }
        }
        if (derived.footnotes) {
            const fnNumbers = footnotesForCell(
                derived.footnotes,
                activeCell,
            );
            if (fnNumbers.includes(idx + 1)) return true;
        }
        return false;
    }, [activeCell, derived.provenance, derived.footnotes, idx]);

    const onRemove = async () => {
        if (await confirm({ message: t("removeConfirm") })) {
            dispatch({ type: "removeSuggestion", id: s.id });
        }
    };

    const enterEdit = () => {
        setIsEditing(true);
        setShowMobileEditButton(false);
        // Pin the selection while editing so the grid highlights the
        // cells this suggestion contributed to (via the existing
        // `activeSuggestionIndex` reverse cross-highlight).
        setSelectedSuggestion(idx);
    };

    const exitEdit = () => {
        setIsEditing(false);
        setShowMobileEditButton(false);
        if (selectedSuggestionIndex === idx) setSelectedSuggestion(null);
    };

    // After the edit ends via commit (Update / Cmd+Enter) or the ×
    // cancel button, the just-active element (Update btn, ×, or a
    // pill) unmounts; without restoring focus, activeElement falls
    // back to <body>. Deferring via setTimeout lets React's commit
    // (and the form's own focus-restoration on unmount) settle first.
    const refocusRow = () =>
        setTimeout(() => rowRef.current?.focus(), 0);

    const onCommitEdit = (draft: DraftSuggestion) => {
        exitEdit();
        dispatch({ type: "updateSuggestion", suggestion: draft });
    };

    // Row ref for scoping the outside-click-cancel listener and for
    // querying open pill popovers (Radix triggers carry
    // `data-state="open"` so we can detect "any pill popover open in
    // this row" without subscribing to the form's internal state).
    const rowRef = useRef<HTMLLIElement>(null);

    const hasOpenPillPopover = (): boolean =>
        rowRef.current?.querySelector(
            '[data-pill-id][data-state="open"]',
        ) !== null;

    // Desktop hover preview. Touch never fires these (pointer-type
    // filter) because on iOS Safari tap synthesizes a pointerenter
    // that would otherwise highlight after every row tap. Feeds the
    // suggestion → cell cross-highlight (via `activeSuggestionIndex`)
    // without entering edit mode.
    const onPointerEnter = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        setHoveredSuggestion(idx);
        setIsHovered(true);
    };
    const onPointerLeave = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        // Keep the highlight while a popover (portalled outside the
        // row) is open — the user is mid-edit and the mouse may be
        // travelling through the portal back into the row.
        if (!hasOpenPillPopover()) setHoveredSuggestion(null);
        setIsHovered(false);
    };

    // Click / tap on the row itself. Desktop: one click → edit.
    // Mobile: two-tap path — first tap reveals the Edit button.
    const onRowClick = () => {
        if (isEditing) return;
        if (isDesktop) {
            enterEdit();
        } else if (!showMobileEditButton) {
            setShowMobileEditButton(true);
            setSelectedSuggestion(idx);
        }
    };

    // Outside-click cancel: while the row is "armed" — either in edit
    // mode (pills + Update + ×) OR in mobile pre-edit mode (Edit
    // button visible after first tap) — any pointerdown outside this
    // row and outside any Radix pill popover portal dismisses both
    // states. Capture phase so we observe the pointerdown before
    // other handlers react to it; we never stop propagation.
    // `exitEdit()` clears both `isEditing` and `showMobileEditButton`,
    // so a single dismiss path works for both cases.
    useEffect(() => {
        if (!isEditing && !showMobileEditButton) return;
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target;
            if (!(target instanceof Node)) return;
            const row = rowRef.current;
            if (row && row.contains(target)) return;
            if (
                target instanceof Element &&
                isInsideSuggestionPopover(target)
            ) {
                return;
            }
            exitEdit();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onPointerDown, true);
    }, [isEditing, showMobileEditButton]);

    const rowTransition = useReducedTransition(T_SPRING_SOFT);
    const pillStaggerTransition = useReducedTransition(T_FAST);

    return (
        <motion.li
            ref={rowRef}
            layout
            // Larger initial y offset so a newly-added suggestion
            // visually "drops in" from the Add-a-suggestion form
            // area above. Existing siblings have `layout` too, so
            // they slide down to make room. The scale+opacity
            // softens the drop so it reads as a card settling into
            // place, not a hard teleport.
            initial={{ y: -80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
            transition={rowTransition}
            tabIndex={0}
            role="button"
            aria-pressed={isSelected}
            data-suggestion-row={idx}
            className={
                // Edit mode and cell-cross-highlight share the same
                // outline-ring treatment so the inline form's pill
                // focus rings stay legible. Keyboard focus on the row
                // itself is covered by the app-wide `:focus-visible`
                // outline (see app/globals.css), so we don't add one
                // here.
                "relative flex items-start gap-2 rounded-[var(--radius)] border border-border px-3 py-2 text-[13px] transition-colors cursor-pointer overflow-hidden " +
                (isEditing || isHighlightedByCell
                    ? "ring-2 ring-accent ring-offset-1 ring-offset-panel "
                    : "hover:ring-2 hover:ring-accent hover:ring-offset-1 hover:ring-offset-panel ")
            }
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onClick={onRowClick}
            onFocus={e => {
                // Row itself gained focus (not a descendant).
                if (e.currentTarget === e.target) {
                    setHoveredSuggestion(idx);
                    setIsRowFocused(true);
                }
            }}
            onBlur={e => {
                // Row-level focus left (whether or not focus stays
                // inside the row via pills/×, the row itself is no
                // longer the focused element).
                if (e.target === e.currentTarget) {
                    setIsRowFocused(false);
                }
                // Keep the cross-panel highlight while focus stays
                // anywhere inside the row (pills / popovers / ×).
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setHoveredSuggestion(null);
            }}
            onKeyDown={e => {
                const native = e.nativeEvent;
                // Escape inside pills: bubble up here and cancel edit
                // mode entirely (discards the draft). Skip when a
                // popover was open — Radix's own dismiss-layer handles
                // that Esc by closing the popover, but the keydown can
                // still bubble; we don't want a second handler here
                // tearing down the whole edit too.
                if (e.currentTarget !== e.target) {
                    if (
                        matches("action.cancel", native) &&
                        isEditing &&
                        !hasOpenPillPopover()
                    ) {
                        e.preventDefault();
                        const row = e.currentTarget;
                        exitEdit();
                        row.focus();
                    }
                    return;
                }
                if (
                    matches("nav.down", native) ||
                    matches("nav.up", native)
                ) {
                    e.preventDefault();
                    const dir = matches("nav.down", native) ? 1 : -1;
                    let sib =
                        dir === 1
                            ? e.currentTarget.nextElementSibling
                            : e.currentTarget.previousElementSibling;
                    while (sib && !(sib instanceof HTMLLIElement)) {
                        sib =
                            dir === 1
                                ? sib.nextElementSibling
                                : sib.previousElementSibling;
                    }
                    if (sib instanceof HTMLElement) sib.focus();
                } else if (matches("action.toggle", native)) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    if (!isEditing) {
                        enterEdit();
                    }
                    queueMicrotask(() => {
                        const first = row.querySelector<HTMLElement>(
                            "[data-pill-id]",
                        );
                        first?.focus();
                    });
                } else if (matches("action.remove", native)) {
                    e.preventDefault();
                    void onRemove();
                } else if (
                    matches("action.cancel", native) &&
                    isEditing
                ) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    exitEdit();
                    row.focus();
                }
            }}
        >
            <span className="font-semibold">{t("numberPrefix", { n: idx + 1 })}</span>
            <div
                className="min-w-0 flex-1 pr-5"
                onClick={e => {
                    // Pills and the remove × live here; don't let their
                    // clicks toggle the row's pin state.
                    if (isEditing) e.stopPropagation();
                }}
            >
                {isEditing ? (
                    <motion.div
                        key="pill-mode"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={pillStaggerTransition}
                    >
                        <SuggestionForm
                            setup={setup}
                            suggestion={s}
                            onSubmit={onCommitEdit}
                            afterSubmit={refocusRow}
                            showHeader={false}
                            showClearInputs={false}
                            pillClearable={{
                                passers: true,
                                refuter: true,
                                seenCard: true,
                            }}
                            keyboardScopeRef={rowRef}
                        />
                    </motion.div>
                ) : (
                    <>
                        <div>
                            {t.rich("suggestedLine", {
                                suggester: String(s.suggester),
                                cards: s.cards
                                    .map(id => cardName(setup, id))
                                    .join(" + "),
                                strong: chunks => (
                                    <strong>{chunks}</strong>
                                ),
                            })}
                        </div>
                        <div className="text-[13px] text-muted">
                            {t.rich("refutationLine", {
                                status: refutationStatus(s),
                                refuter: s.refuter ? String(s.refuter) : "",
                                seen: s.seenCard
                                    ? cardName(setup, s.seenCard)
                                    : "",
                                passers: listFormatter.format(
                                    s.nonRefuters.map(String),
                                ),
                                strong: chunks => (
                                    <strong>{chunks}</strong>
                                ),
                            })}
                        </div>
                        {!hasKeyboard && !showMobileEditButton && (
                            <div className="mt-0.5 text-[11px] text-muted">
                                {t("priorRowHintMobile")}
                            </div>
                        )}
                        {!isDesktop && showMobileEditButton && (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        enterEdit();
                                    }}
                                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-accent bg-transparent font-semibold text-accent"
                                >
                                    {t("editAction")}
                                </button>
                            </div>
                        )}
                    </>
                )}
                {hasKeyboard && isRowFocused && !isEditing && (
                    <div className="mt-0.5 text-[11px] text-muted">
                        {t("priorRowHintDesktop")}
                    </div>
                )}
            </div>
            {isEditing ? (
                <button
                    type="button"
                    aria-label={t("cancelEditAria")}
                    onClick={e => {
                        e.stopPropagation();
                        exitEdit();
                        refocusRow();
                    }}
                    className="tap-icon absolute right-1 top-1 inline-flex cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:text-accent"
                >
                    <XIcon size={18} />
                </button>
            ) : (
                (isDesktop ? isHovered || isRowFocused : showMobileEditButton) && (
                    <button
                        type="button"
                        aria-label={t("removeAction")}
                        className="tap-icon absolute right-1 top-1 inline-flex cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:text-accent"
                        onClick={e => {
                            e.stopPropagation();
                            void onRemove();
                        }}
                    >
                        <TrashIcon size={18} />
                    </button>
                )
            )}
        </motion.li>
    );
}

/**
 * One row in the prior log for a failed accusation. Mirrors
 * `PriorSuggestionItem` for keyboard / mouse / mobile interactions —
 * Up/Down move between rows, Enter enters edit mode (renders an
 * inline `<AccusationForm>`), Backspace removes (with confirmation),
 * Esc exits edit. The body is a single line ("X accused Y + Z + W
 * (failed)") since accusations have no refuter / seen card.
 *
 * Cell-cross-highlight is intentionally simpler than the suggestion
 * row's: a `FailedAccusation` provenance reason that pinned a
 * case-file cell back-references this accusation by index, so we
 * surface the same outline ring when the user hovers / focuses such
 * a cell. Footnotes don't apply (accusations don't generate them).
 */
function PriorAccusationItem({
    accusation: a,
    idx,
}: {
    readonly accusation: DraftAccusation;
    readonly idx: number;
}) {
    const t = useTranslations("accusations");
    const tSug = useTranslations("suggestions");
    const { state, dispatch, derived } = useClue();
    const { activeCell, setHoveredAccusation } = useSelection();
    const confirm = useConfirm();
    const isDesktop = useIsDesktop();
    const hasKeyboard = useHasKeyboard();
    const setup = state.setup;

    const [isEditing, setIsEditing] = useState(false);
    const [showMobileEditButton, setShowMobileEditButton] = useState(false);
    const [isRowFocused, setIsRowFocused] = useState(false);
    // Mouse hover (desktop only — touch is filtered out below). Drives
    // the visibility of the trash button so idle rows aren't crowded
    // with a delete affordance.
    const [isHovered, setIsHovered] = useState(false);

    // Cell → accusation cross-highlight: when the active checklist
    // cell's provenance chain walks back to a `FailedAccusation`
    // reason whose accusation index matches this row, light up the
    // outline. Mirrors the suggestion-row pattern but only checks the
    // FailedAccusation tag.
    const isHighlightedByCell = useMemo(() => {
        if (!activeCell || !derived.provenance) return false;
        for (const { reason } of chainFor(derived.provenance, activeCell)) {
            if (
                reason.kind._tag === "FailedAccusation" &&
                reason.kind.accusationIndex === idx
            ) {
                return true;
            }
        }
        return false;
    }, [activeCell, derived.provenance, idx]);

    const onRemove = async () => {
        if (await confirm({ message: t("removeConfirm") })) {
            dispatch({ type: "removeAccusation", id: a.id });
            accusationRemoved({
                accusationCount: state.accusations.length - 1,
            });
        }
    };

    const enterEdit = () => {
        setIsEditing(true);
        setShowMobileEditButton(false);
    };
    const exitEdit = () => {
        setIsEditing(false);
        setShowMobileEditButton(false);
    };

    const rowRef = useRef<HTMLLIElement>(null);
    const refocusRow = () => setTimeout(() => rowRef.current?.focus(), 0);

    const onCommitEdit = (draft: DraftAccusation) => {
        exitEdit();
        dispatch({ type: "updateAccusation", accusation: draft });
        priorAccusationEdited({ accusationNumber: idx + 1 });
    };

    const hasOpenPillPopover = (): boolean =>
        rowRef.current?.querySelector(
            "[data-pill-id][data-state=\"open\"]",
        ) !== null;

    const onRowClick = () => {
        if (isEditing) return;
        if (isDesktop) enterEdit();
        else if (!showMobileEditButton) setShowMobileEditButton(true);
    };

    // Desktop hover preview, mirrors PriorSuggestionItem. Touch is
    // filtered out (pointerType !== "mouse") so iOS Safari's tap-as-
    // pointerenter doesn't ghost-highlight after every row tap. Feeds
    // the accusation → cell cross-highlight via `activeAccusationIndex`.
    const onPointerEnter = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        setHoveredAccusation(idx);
        setIsHovered(true);
    };
    const onPointerLeave = (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        // Keep the highlight while a pill popover (portalled outside
        // the row) is open — the user is mid-edit and the mouse may
        // be travelling through the portal back into the row.
        if (!hasOpenPillPopover()) setHoveredAccusation(null);
        setIsHovered(false);
    };

    // Outside-click cancel — same pattern as `PriorSuggestionItem`.
    // Armed while editing OR while the mobile pre-edit Edit button is
    // visible; `exitEdit()` clears both flags.
    useEffect(() => {
        if (!isEditing && !showMobileEditButton) return;
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target;
            if (!(target instanceof Node)) return;
            const row = rowRef.current;
            if (row && row.contains(target)) return;
            if (
                target instanceof Element &&
                isInsideSuggestionPopover(target)
            ) {
                return;
            }
            exitEdit();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onPointerDown, true);
    }, [isEditing, showMobileEditButton]);

    const rowTransition = useReducedTransition(T_SPRING_SOFT);
    const pillStaggerTransition = useReducedTransition(T_FAST);

    return (
        <motion.li
            ref={rowRef}
            layout
            initial={{ y: -80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{
                opacity: 0,
                height: 0,
                paddingTop: 0,
                paddingBottom: 0,
                marginTop: 0,
                marginBottom: 0,
            }}
            transition={rowTransition}
            tabIndex={0}
            role="button"
            data-accusation-row={idx}
            className={
                "relative flex items-start gap-2 rounded-[var(--radius)] border border-border px-3 py-2 text-[13px] transition-colors cursor-pointer overflow-hidden " +
                (isEditing || isHighlightedByCell
                    ? "ring-2 ring-accent ring-offset-1 ring-offset-panel "
                    : "hover:ring-2 hover:ring-accent hover:ring-offset-1 hover:ring-offset-panel ")
            }
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onClick={onRowClick}
            onFocus={e => {
                // Row itself gained focus (not a descendant) — feed
                // the cross-highlight so keyboard nav also lights up
                // the related cells.
                if (e.currentTarget === e.target) {
                    setHoveredAccusation(idx);
                    setIsRowFocused(true);
                }
            }}
            onBlur={e => {
                if (e.target === e.currentTarget) setIsRowFocused(false);
                // Keep the cross-panel highlight while focus stays
                // anywhere inside the row (pills / popovers / ×).
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setHoveredAccusation(null);
            }}
            onKeyDown={e => {
                const native = e.nativeEvent;
                if (e.currentTarget !== e.target) {
                    if (
                        matches("action.cancel", native) &&
                        isEditing &&
                        !hasOpenPillPopover()
                    ) {
                        e.preventDefault();
                        const row = e.currentTarget;
                        exitEdit();
                        row.focus();
                    }
                    return;
                }
                if (
                    matches("nav.down", native) ||
                    matches("nav.up", native)
                ) {
                    e.preventDefault();
                    const dir = matches("nav.down", native) ? 1 : -1;
                    let sib =
                        dir === 1
                            ? e.currentTarget.nextElementSibling
                            : e.currentTarget.previousElementSibling;
                    while (sib && !(sib instanceof HTMLLIElement)) {
                        sib =
                            dir === 1
                                ? sib.nextElementSibling
                                : sib.previousElementSibling;
                    }
                    if (sib instanceof HTMLElement) sib.focus();
                } else if (matches("action.toggle", native)) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    if (!isEditing) enterEdit();
                    queueMicrotask(() => {
                        const first = row.querySelector<HTMLElement>(
                            "[data-pill-id]",
                        );
                        first?.focus();
                    });
                } else if (matches("action.remove", native)) {
                    e.preventDefault();
                    void onRemove();
                } else if (
                    matches("action.cancel", native) &&
                    isEditing
                ) {
                    e.preventDefault();
                    const row = e.currentTarget;
                    exitEdit();
                    row.focus();
                }
            }}
        >
            <span className="font-semibold">{t("numberPrefix", { n: idx + 1 })}</span>
            <div
                className="min-w-0 flex-1 pr-5"
                onClick={e => {
                    if (isEditing) e.stopPropagation();
                }}
            >
                {isEditing ? (
                    <motion.div
                        key="pill-mode"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={pillStaggerTransition}
                    >
                        <AccusationForm
                            setup={setup}
                            accusation={a}
                            onSubmit={onCommitEdit}
                            showHeader={false}
                            keyboardScopeRef={rowRef}
                        />
                    </motion.div>
                ) : (
                    <>
                        <div>
                            {t.rich("accusedLine", {
                                accuser: String(a.accuser),
                                cards: a.cards
                                    .map(id => cardName(setup, id))
                                    .join(" + "),
                                strong: chunks => <strong>{chunks}</strong>,
                            })}
                        </div>
                        {!hasKeyboard && !showMobileEditButton && (
                            <div className="mt-0.5 text-[11px] text-muted">
                                {tSug("priorRowHintMobile")}
                            </div>
                        )}
                        {!isDesktop && showMobileEditButton && (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        enterEdit();
                                    }}
                                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-accent bg-transparent font-semibold text-accent"
                                >
                                    {t("editAction")}
                                </button>
                            </div>
                        )}
                    </>
                )}
                {hasKeyboard && isRowFocused && !isEditing && (
                    <div className="mt-0.5 text-[11px] text-muted">
                        {tSug("priorRowHintDesktop")}
                    </div>
                )}
            </div>
            {isEditing ? (
                <button
                    type="button"
                    aria-label={tSug("cancelEditAria")}
                    onClick={e => {
                        e.stopPropagation();
                        exitEdit();
                        refocusRow();
                    }}
                    className="tap-icon absolute right-1 top-1 inline-flex cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:text-accent"
                >
                    <XIcon size={18} />
                </button>
            ) : (
                (isDesktop ? isHovered || isRowFocused : showMobileEditButton) && (
                    <button
                        type="button"
                        aria-label={t("removeAction")}
                        className="tap-icon absolute right-1 top-1 inline-flex cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:text-accent"
                        onClick={e => {
                            e.stopPropagation();
                            void onRemove();
                        }}
                    >
                        <TrashIcon size={18} />
                    </button>
                )
            )}
        </motion.li>
    );
}
