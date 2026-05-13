"use client";

import { Duration, HashMap } from "effect";
import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PANE_SETTLE } from "../motion";
import { startSetup } from "../../analytics/gameSession";
import {
    gameSetupStarted,
    setupWizardCompleted,
    setupWizardStepAdvanced,
    setupWizardStepReentered,
    setupWizardStepSkipped,
} from "../../analytics/events";
import type { ClueState } from "../../logic/ClueState";
import { cardSetEquals } from "../../logic/CardSet";
import { CARD_SETS, newGameSetup } from "../../logic/GameSetup";
import { getGamePhase, phaseAtLeast } from "../../logic/GamePhase";
import { useConfirm } from "../hooks/useConfirm";
import { useGamePhase } from "../hooks/useGamePhase";
import { useSetupWalkthroughDone } from "../hooks/useSetupWalkthroughDone";
import { resetScrollMemory } from "../scrollMemory";
import { useClue } from "../state";
import { useTour } from "../tour/TourProvider";
import {
    loadGameLifecycleState,
    markSetupWalkthroughDone,
} from "../../logic/GameLifecycleState";
import { DateTime } from "effect";
import { useSetupWizardFocus } from "./SetupWizardFocusContext";
import { SetupStepCardPack } from "./steps/SetupStepCardPack";
import { SetupStepHandSizes } from "./steps/SetupStepHandSizes";
import { SetupStepIdentity } from "./steps/SetupStepIdentity";
import { SetupStepInviteOtherPlayers } from "./steps/SetupStepInviteOtherPlayers";
import { SetupStepKnownCards } from "./steps/SetupStepKnownCards";
import { SetupStepMyCards } from "./steps/SetupStepMyCards";
import { SetupStepPlayers } from "./steps/SetupStepPlayers";
import {
    isStepDataComplete,
    stepIsSkippable,
    stepValidationLevel,
    visibleSteps,
    type StepValidationLevel,
    type WizardStepId,
} from "./wizardSteps";
import type { StepPanelState, WizardMode } from "./SetupStepPanel";

// Default Classic deck — used to detect "deck has not been touched."
const CLASSIC_CARD_SET = CARD_SETS[0]!.cardSet;
// Default roster from `newGameSetup` — used to detect "players
// have not been renamed or rearranged from defaults."
const DEFAULT_PLAYERS = newGameSetup().players.map(p => String(p));
// Wire-format scroll behaviors — module-scope so the
// i18next/no-literal-string lint reads them as identifiers.
const SCROLL_BEHAVIOR_AUTO = "auto" as const;
const SCROLL_BEHAVIOR_SMOOTH = "smooth" as const;

/**
 * Does the current state contain anything we'd lose by a `newGame`
 * dispatch? Used by the wizard's "Start over" button to decide
 * whether to no-op clear (just rewind the accordion) or pop a
 * confirm modal first.
 *
 * Counts as destructive: any game-progress entry (suggestions,
 * accusations, hypotheses, knownCards, handSizes, pendingSuggestion)
 * AND any setup-edit beyond the fresh-mount defaults (selfPlayerId,
 * firstDealtPlayerId, renamed players, swapped/edited deck).
 *
 * Module-internal — verified through the wizard's behavior tests
 * (no-op rewind on fresh mount, modal on edited state).
 */
function hasDestructiveState(state: ClueState): boolean {
    if (state.suggestions.length > 0) return true;
    if (state.accusations.length > 0) return true;
    if (HashMap.size(state.hypotheses) > 0) return true;
    if (state.knownCards.length > 0) return true;
    if (state.handSizes.length > 0) return true;
    if (state.selfPlayerId !== null) return true;
    if (state.firstDealtPlayerId !== null) return true;
    if (state.pendingSuggestion !== null) return true;
    const players = state.setup.players;
    const defaultRoster =
        players.length === DEFAULT_PLAYERS.length &&
        players.every((p, i) => String(p) === DEFAULT_PLAYERS[i]);
    if (!defaultRoster) return true;
    if (!cardSetEquals(state.setup.cardSet, CLASSIC_CARD_SET)) return true;
    return false;
}

// Module-scope discriminators so the i18next/no-literal-string lint
// rule treats these as identifiers, not user-facing copy.
const STEP_EDITING: StepPanelState = "editing";
const STEP_COMPLETE: StepPanelState = "complete";
const STEP_PENDING: StepPanelState = "pending";
const WIZARD_MODE_FLOW: WizardMode = "flow";
const WIZARD_MODE_EDIT: WizardMode = "edit";
// Phase discriminator used in this file's phaseAtLeast checks. Kept
// to module scope so the lint rule reads it as an identifier.
const PHASE_SETUP_COMPLETED = "setupCompleted" as const;
const PHASE_NEW = "new" as const;
const PHASE_GAME_STARTED = "gameStarted" as const;

/**
 * Tour anchors that live INSIDE a wizard step's expanded body, mapped
 * to the wizard step that must be open for the anchor to be in the
 * DOM. The wizard reads this table on tour-step transitions and
 * expands the required step as a pre-condition (per AGENTS.md
 * "Tour steps must set up the UI to their expected pre-condition").
 *
 * The two entries today come from the `sharing` tour
 * ([src/ui/tour/tours.ts]). If a future tour anchors at another
 * in-step element, add it here and verify in the next-dev preview.
 */
const TOUR_ANCHOR_REQUIRES_WIZARD_STEP: Readonly<
    Record<string, WizardStepId>
> = {
    "setup-share-pack-pill": "cardPack",
    "setup-invite-player": "inviteOtherPlayers",
};

/**
 * M6 setup wizard — accordion of step panels rendered when the
 * `setup-wizard` feature flag is on AND `state.uiMode === "setup"`.
 *
 * **Accordion shell** (per the plan's 0c decision): a vertical
 * stack of panels rendered identically at every breakpoint, max
 * width ~720px centered on desktop. Exactly one panel is in
 * `editing` state at a time; the others are `pending` (lock; below
 * the active step) or `complete` (collapsed; above the active
 * step). Clicking a complete panel re-enters editing for that step
 * and the previously-editing panel becomes complete.
 *
 * **Step set in PR-A2:** Players (step 2), Identity (step 3), Hand
 * sizes (step 4). The plan's full step list is six (Card pack, …,
 * My cards, Other players' cards) — those land in PR-A3. Until then
 * the wizard renders only the three implemented steps; the renumbering
 * is a no-op for review purposes since the flag stays off.
 *
 * **Sticky bottom CTA** kicks the user from setup to play once all
 * required (non-skippable) visible steps are complete OR the user
 * has already played at least one suggestion (mid-game edits don't
 * re-gate "Continue Playing"). The CTA dispatches
 * `setUiMode("checklist")`.
 *
 * **Wizard navigation state** (focusedStepId, completedSteps) lives
 * in local React state, NOT in `ClueState` — it's pure UI nav,
 * doesn't survive refresh meaningfully, doesn't go through undo/
 * redo. Only data the steps edit goes through dispatch.
 */
export function SetupWizard() {
    const t = useTranslations("setupWizard");
    const tSetup = useTranslations("setup");
    const tToolbar = useTranslations("toolbar");
    const { state, dispatch, hydrated } = useClue();
    const confirm = useConfirm();
    const focus = useSetupWizardFocus();

    // PR-A3 ships steps 1, 5, 6 alongside the existing 2-4 — every
    // step in `visibleSteps(state)` is now implemented, so the filter
    // is a no-op until a future PR adds steps that need a render-time
    // gate (e.g., shipped behind a sub-flag). Keep the filter wired
    // in so adding a stub step doesn't break the wizard.
    const steps = useMemo(() => visibleSteps(state), [state]);

    // Initial completed set: empty. Every wizard mount walks the
    // user through every step; nothing is auto-completed. Lets a
    // returning user revisit each decision instead of being dropped
    // into step 4 with the earlier ones silently locked.
    const [completed, setCompleted] = useState<ReadonlySet<WizardStepId>>(
        () => new Set(),
    );

    // Initial focused step. Three regimes:
    //   1. Explicit focus-hint (programmatic jump from an "edit this
    //      step" affordance somewhere else) — honor it if visible.
    //   2. Edit-mode mount (phase ≥ setupCompleted AND the user has
    //      already finished the walkthrough for this game): open NO
    //      step by default. The user picks what to edit.
    //   3. Otherwise (flow mode — first-time walkthrough): legacy
    //      "land on step 1" so first-time setup feels guided.
    //
    // Read phase + walkthrough flag directly (useState initializers
    // don't re-run on prop change; we want the value at mount).
    const [focusedStep, setFocusedStep] = useState<WizardStepId | null>(
        () => {
            const hinted = focus?.consumeFocusHint() ?? null;
            if (hinted !== null && steps.includes(hinted)) return hinted;
            const phaseAtMount = getGamePhase(state);
            // `loadGameLifecycleState` already guards SSR (returns
            // `{}` when window is undefined), so no extra check
            // needed here.
            const walkthroughDoneAtMount =
                loadGameLifecycleState().setupWalkthroughDoneAt !== undefined;
            if (
                phaseAtLeast(phaseAtMount, PHASE_SETUP_COMPLETED)
                && walkthroughDoneAtMount
            ) {
                return null;
            }
            return steps[0] ?? null;
        },
    );

    // If the visible-step set changes (e.g. selfPlayerId toggled to
    // null mid-wizard), drop any focusedStep / completed entries
    // that no longer apply.
    useEffect(() => {
        const visibleSet = new Set(steps);
        setCompleted(prev => {
            let next: Set<WizardStepId> | null = null;
            for (const id of prev) {
                if (!visibleSet.has(id)) {
                    if (next === null) next = new Set(prev);
                    next.delete(id);
                }
            }
            return next ?? prev;
        });
        setFocusedStep(prev =>
            prev !== null && visibleSet.has(prev) ? prev : (steps[0] ?? null),
        );
    }, [steps]);

    // When phase transitions to "new" while the wizard is still
    // mounted (e.g. user clicked "New game" in the overflow menu
    // while already in Setup mode, or "Start over" → confirm from
    // the wizard's own footer), snap the local nav state back to
    // step 1. The legacy reliance on a "newGame remounts the
    // wizard" effect was wishful — uiMode is already "setup", so
    // the wizard never unmounts/remounts on that dispatch. Driving
    // the reset off the phase machine handles every entry path with
    // one effect.
    //
    // Deps are kept to `[phase]` (the only signal we react to);
    // `steps` is captured via a ref so reducer ticks that produce
    // new state objects don't re-fire this effect spuriously. See
    // AGENTS.md "Effect deps in tour-driven entry effects."
    const phase = useGamePhase();
    const prevPhaseRef = useRef(phase);
    const stepsRefForPhaseReset = useRef(steps);
    useEffect(() => {
        stepsRefForPhaseReset.current = steps;
    }, [steps]);
    useEffect(() => {
        const prev = prevPhaseRef.current;
        prevPhaseRef.current = phase;
        if (phase !== PHASE_NEW) return;
        if (prev === PHASE_NEW) return;
        setCompleted(new Set());
        setFocusedStep(stepsRefForPhaseReset.current[0] ?? null);
    }, [phase]);

    // Wizard mode = "edit" once the user has:
    //   1. enough data to play (phase ≥ setupCompleted) AND
    //   2. finished the linear walkthrough at least once for this
    //      game (clicked Start playing on the wizard's last step,
    //      recorded as `setupWalkthroughDoneAt` on the lifecycle
    //      stamp). Resets on `newGame`.
    //
    // The double gate keeps the first-time experience strictly
    // linear: even after the user committed handSizes mid-walk
    // (which flips phase to setupCompleted), the wizard stays in
    // flow mode until they reach `inviteOtherPlayers` and click its
    // in-card Start playing button. Without #2, the global Play CTA
    // would appear mid-flow and compete with the wizard's flow CTA.
    const walkthroughDone = useSetupWalkthroughDone();
    const wizardMode: WizardMode =
        phaseAtLeast(phase, PHASE_SETUP_COMPLETED) && walkthroughDone
            ? WIZARD_MODE_EDIT
            : WIZARD_MODE_FLOW;

    // Hydration-aware initial-focused-step correction. The useState
    // initializer above evaluates phase off the pre-hydration state
    // (always "new"), so a user returning to a setupCompleted+ game
    // would otherwise land on the cardPack step "editing" — wrong for
    // edit mode, which wants no step open by default. Once hydration
    // completes, snap focusedStep to null IF (a) we're now in edit
    // mode (phase ≥ setupCompleted AND the user has already finished
    // the walkthrough for this game) AND (b) focusedStep is still
    // the default `steps[0]` (the user hasn't already picked another
    // step in the time between useState and the hydrated effect).
    // Runs once on the hydration edge.
    const correctedForHydratedEditModeRef = useRef(false);
    useEffect(() => {
        if (!hydrated) return;
        if (correctedForHydratedEditModeRef.current) return;
        correctedForHydratedEditModeRef.current = true;
        if (!phaseAtLeast(phase, PHASE_SETUP_COMPLETED)) return;
        if (!walkthroughDone) return;
        setFocusedStep((prev) =>
            prev === (stepsRefForPhaseReset.current[0] ?? null) ? null : prev,
        );
    }, [hydrated, phase, walkthroughDone]);

    // Tour pre-condition effect. Some tour steps (today: the sharing
    // tour's `setup-share-pack-pill` and `setup-invite-player`)
    // anchor at DOM nodes that live INSIDE an expanded wizard step's
    // body. In edit mode the wizard's default `focusedStep` is null
    // (no step open), so those anchors aren't in the DOM when the
    // tour fires — the popover would have nothing to point at.
    //
    // Per AGENTS.md "Tour steps must set up the UI to their expected
    // pre-condition," each step's entry should arrange the UI for
    // its anchor. We do that here from the consuming component (the
    // wizard) by mapping known tour anchors → the wizard step they
    // require, and expanding that step when the tour enters one.
    //
    // `steps` is captured via a ref so the effect's deps stay at
    // just `[currentStepAnchor]` — reducer ticks that produce new
    // state objects don't re-fire and overwrite the user's chosen
    // open step.
    const { currentStep } = useTour();
    const currentStepAnchor = currentStep?.anchor;
    const stepsRefForTour = useRef(steps);
    useEffect(() => {
        stepsRefForTour.current = steps;
    }, [steps]);
    useEffect(() => {
        if (currentStepAnchor === undefined) return;
        const required = TOUR_ANCHOR_REQUIRES_WIZARD_STEP[currentStepAnchor];
        if (required === undefined) return;
        if (!stepsRefForTour.current.includes(required)) return;
        setFocusedStep((prev) => (prev === required ? prev : required));
    }, [currentStepAnchor]);

    const stepStateFor = (id: WizardStepId): StepPanelState => {
        if (id === focusedStep) return STEP_EDITING;
        // Edit mode: the "completed" check derives from data presence,
        // not the local advance/skip-tracked `completed` set. That
        // way a returning user (who never walked the wizard linearly)
        // still sees check marks on the steps they have data for.
        // `pending` here is just "closed without data" — the panel
        // reads `wizardMode === "edit"` and renders it without the
        // dim/locked treatment.
        if (wizardMode === WIZARD_MODE_EDIT) {
            return isStepDataComplete(id, state)
                ? STEP_COMPLETE
                : STEP_PENDING;
        }
        if (completed.has(id)) return STEP_COMPLETE;
        return STEP_PENDING;
    };

    /**
     * Smooth-scroll the newly-focused step's heading toward the top
     * of the viewport whenever `focusedStep` changes — but only when
     * the change came from advance/skip (which set the
     * `scrollOnNextFocusRef` flag), not from the initial mount or
     * from re-entering a completed step via summary-click. Reduced-
     * motion users get an instant jump.
     *
     * The ~64px top offset leaves room for the page header + a
     * sliver of the previous step's bottom, confirming forward
     * progress without being jarring.
     *
     * Page-level scroll in this app lives on `<body>` (see
     * `app/globals.css` — `html { overflow: clip }`,
     * `body { overflow: auto; height: 100dvh }`). So scrollTo
     * goes through `document.body`, not `window`.
     */
    const scrollOnNextFocusRef = useRef<boolean>(false);
    const reducedMotion = useReducedMotion();
    useEffect(() => {
        if (!scrollOnNextFocusRef.current) return;
        if (focusedStep === null) return;
        // Defer to the next frame so the panel's expand animation
        // has begun pushing siblings down before we measure. Don't
        // clear the flag at the top of the effect — React StrictMode
        // in dev runs effects setup→cleanup→setup, and clearing
        // would leave the second setup with a stale `false` while
        // the first setup's rAF was canceled. Clearing inside the
        // rAF callback ensures whichever setup-pass survives runs
        // the scroll exactly once.
        // Wait for the accordion's height transition to complete
        // before measuring the new focused panel's position. If we
        // scrolled on the next animation frame, the cardPack body
        // would still be expanded and the players section would
        // measure ~200px too low, scrolling past where it ends up
        // settling. `PANE_SETTLE` already encodes the
        // `T_STANDARD.duration + 1 frame` rule used elsewhere for
        // "after a panel transition completes" timing.
        const settleMs = Duration.toMillis(PANE_SETTLE);
        const id = window.setTimeout(() => {
            scrollOnNextFocusRef.current = false;
            const el = panelElsRef.current.get(focusedStep);
            if (!el) return;
            const body = document.body;
            // jsdom doesn't implement `body.scrollTo`. Guard so the
            // unit-test environment doesn't throw — the scroll is
            // verified manually in the next-dev preview.
            if (typeof body.scrollTo !== "function") return;
            // Only scroll if the newly-focused step's top edge sits
            // in the bottom 20% of the viewport (or below it). When
            // the step is already comfortably in view, scrolling
            // every advance reads as jumpy — everything shifts while
            // the user is still mid-interaction. Leaving scroll alone
            // keeps the user's reading position stable.
            const viewportTop = el.getBoundingClientRect().top;
            const viewportHeight = window.innerHeight;
            if (viewportTop <= viewportHeight * 0.8) return;
            // The page header is `position: sticky` and its measured
            // height is published as `--header-offset` on `:root` by
            // a ResizeObserver in `Clue.tsx`. Reading it ensures the
            // scrolled-to heading isn't hidden behind the sticky
            // header on either breakpoint. Add a small extra gap
            // (16px) so a sliver of the previous step's bottom is
            // still visible — confirms forward progress.
            const rootStyle = window.getComputedStyle(
                document.documentElement,
            );
            const headerOffset =
                parseFloat(rootStyle.getPropertyValue("--header-offset")) || 0;
            const top = viewportTop + body.scrollTop;
            body.scrollTo({
                top: Math.max(0, top - headerOffset - 16),
                behavior: reducedMotion
                    ? SCROLL_BEHAVIOR_AUTO
                    : SCROLL_BEHAVIOR_SMOOTH,
            });
        }, settleMs);
        return () => window.clearTimeout(id);
    }, [focusedStep, reducedMotion]);

    /**
     * The currently-editing step can register two transition hooks
     * the wizard fires when the user advances or skips:
     *
     * - `beforeAdvance` runs on Next OR Skip, before the next step
     *   is focused. Hand-sizes uses this to commit placeholder
     *   defaults to state.handSizes (treating "accept the default"
     *   as an active choice).
     * - `beforeSkip` runs ONLY on Skip, before `beforeAdvance`.
     *   Identity uses this to clear `selfPlayerId` when the user
     *   skips the step after having set themselves — the legacy
     *   "Skip = un-set" behavior preserved across the unified bar.
     *
     * Stored in refs so registration doesn't trigger re-renders;
     * the focused step's `useEffect` populates them on mount and
     * clears them on unmount / focus change.
     */
    const beforeAdvanceRef = useRef<(() => void) | null>(null);
    const beforeSkipRef = useRef<(() => void) | null>(null);
    const registerBeforeAdvance = useCallback(
        (fn: (() => void) | null) => {
            beforeAdvanceRef.current = fn;
        },
        [],
    );
    const registerBeforeSkip = useCallback(
        (fn: (() => void) | null) => {
            beforeSkipRef.current = fn;
        },
        [],
    );

    /**
     * DOM-node registry for the smooth-scroll-on-advance behavior.
     * Each panel registers via `registerPanelEl(stepId, el)` on
     * mount and `registerPanelEl(stepId, null)` on unmount.
     */
    const panelElsRef = useRef<Map<WizardStepId, HTMLElement>>(new Map());
    const registerPanelEl = useCallback(
        (id: WizardStepId, el: HTMLElement | null) => {
            if (el === null) {
                panelElsRef.current.delete(id);
            } else {
                panelElsRef.current.set(id, el);
            }
        },
        [],
    );

    const advance = (currentId: WizardStepId) => {
        // Run any beforeAdvance the focused step registered (e.g.
        // hand-sizes commits placeholder defaults). Clear it before
        // the next render so the next focused step's beforeAdvance
        // doesn't accidentally fire if it hasn't registered yet.
        beforeAdvanceRef.current?.();
        beforeAdvanceRef.current = null;
        // Mark current step complete and advance to the literally-
        // next step in canonical order (regardless of completion
        // state). Re-entering a complete step + Next → still moves
        // forward by one.
        const nextCompleted = new Set(completed);
        nextCompleted.add(currentId);
        setCompleted(nextCompleted);
        const currentIdx = steps.indexOf(currentId);
        const nextStep = steps[currentIdx + 1] ?? null;
        scrollOnNextFocusRef.current = true;
        setFocusedStep(nextStep);
        setupWizardStepAdvanced({ step: currentId });
    };

    const skip = (currentId: WizardStepId) => {
        // Skip fires beforeSkip first (e.g. identity clears
        // `selfPlayerId`), then beforeAdvance (e.g. hand-sizes
        // commits placeholder defaults), then the canonical
        // advance.
        beforeSkipRef.current?.();
        beforeSkipRef.current = null;
        beforeAdvanceRef.current?.();
        beforeAdvanceRef.current = null;
        const nextCompleted = new Set(completed);
        nextCompleted.add(currentId);
        setCompleted(nextCompleted);
        const currentIdx = steps.indexOf(currentId);
        const nextStep = steps[currentIdx + 1] ?? null;
        scrollOnNextFocusRef.current = true;
        setFocusedStep(nextStep);
        setupWizardStepSkipped({ step: currentId });
    };

    const reEnter = (id: WizardStepId) => {
        // Clicking a complete step: collapse the previously-editing
        // panel into "complete" with current values, expand the
        // clicked one. The previously-editing panel may not have
        // been "really" complete yet (the user clicked away mid-
        // edit) — mark it complete anyway since they've moved on,
        // matching the accordion's "you can always come back" model.
        const nextCompleted = new Set(completed);
        if (focusedStep !== null && focusedStep !== id) {
            nextCompleted.add(focusedStep);
        }
        nextCompleted.delete(id);
        setCompleted(nextCompleted);
        setFocusedStep(id);
        setupWizardStepReentered({ step: id });
    };

    // Sticky CTA bar state — derived per render from the focused
    // step. With the new "always Next through every step" flow,
    // "Start playing" appears only once the user reaches the last
    // visible step (and validation isn't blocked). When already
    // mid-game, the label flips to "Continue playing" and the
    // semantic stays the same.
    const isLastStep =
        focusedStep !== null &&
        steps.indexOf(focusedStep) === steps.length - 1;
    const focusedValidationLevel: StepValidationLevel | null =
        focusedStep === null ? null : stepValidationLevel(focusedStep, state);
    const focusedSkippable: boolean =
        focusedStep === null ? false : stepIsSkippable(focusedStep);
    // Skip is always visible. Disabled only when a required step has
    // BLOCKED validation (defaults don't satisfy it) — Skip then
    // can't safely act as "accept defaults."
    const skipEnabled =
        focusedStep !== null &&
        (focusedSkippable || focusedValidationLevel !== "blocked");
    const nextEnabled =
        focusedStep !== null && focusedValidationLevel !== "blocked";
    const hasGameProgress = getGamePhase(state) === PHASE_GAME_STARTED;
    const startPlayingLabel = hasGameProgress
        ? tSetup("continuePlaying", { shortcut: "" })
        : tSetup("startPlaying", { shortcut: "" });

    const onClickNext = () => {
        if (focusedStep === null) return;
        if (!nextEnabled) return;
        if (isLastStep) {
            onClickStartPlaying();
            return;
        }
        advance(focusedStep);
    };

    const onClickSkip = () => {
        if (focusedStep === null) return;
        if (!skipEnabled) return;
        skip(focusedStep);
    };

    const onClickStartPlaying = () => {
        if (!nextEnabled) return;
        // Mark the last step complete (consistent with advance)
        // before transitioning out of setup.
        if (focusedStep !== null) {
            beforeSkipRef.current?.();
            beforeSkipRef.current = null;
            beforeAdvanceRef.current?.();
            beforeAdvanceRef.current = null;
            const nextCompleted = new Set(completed);
            nextCompleted.add(focusedStep);
            setCompleted(nextCompleted);
        }
        if (!hasGameProgress) {
            startSetup();
            gameSetupStarted();
        }
        setupWizardCompleted();
        // Persist "this game's setup walkthrough is done." Next time
        // the wizard mounts (e.g. user navigates back from Play), it
        // renders in spot-check edit mode and the global PlayCTA
        // becomes visible. Cleared on `newGame` via
        // `markGameCreated`'s clear list.
        markSetupWalkthroughDone(DateTime.nowUnsafe());
        dispatch({ type: "setUiMode", mode: "checklist" });
    };

    // Edit-mode footer action: collapse the open step. Per-input
    // changes already committed via dispatch; "Done" is a pure UI
    // close. Flush any beforeAdvance hook the step registered (e.g.
    // hand-sizes commits placeholder defaults) so the user's implicit
    // "accept default" is captured. beforeSkip is intentionally NOT
    // fired — edit mode has no skip semantics.
    const onClickDone = () => {
        if (focusedStep === null) return;
        beforeAdvanceRef.current?.();
        beforeAdvanceRef.current = null;
        setFocusedStep(null);
    };

    /**
     * "Start over" branches on whether anything destructive would be
     * lost. With a fresh wizard mount (default deck, default roster,
     * no game progress) the click is a no-op clear that just rewinds
     * the accordion to step 1. Otherwise pop a confirm — Cancel is
     * Radix-AlertDialog's default focus, so an accidental Enter
     * cancels and preserves state.
     */
    const onStartOver = async () => {
        if (!hasDestructiveState(state)) {
            setCompleted(new Set());
            const first = steps[0] ?? null;
            setFocusedStep(first);
            return;
        }
        const ok = await confirm({
            message: tToolbar("newGameConfirm"),
            confirmLabel: tToolbar("startNewGame"),
            destructive: true,
        });
        if (!ok) return;
        dispatch({ type: "newGame" });
        resetScrollMemory();
        // The newGame action resets phase to "new"; the phase-
        // transition effect above catches that and resets
        // focusedStep + completed back to step 1. (This path runs
        // while uiMode is already "setup", so the wizard does NOT
        // unmount/remount — the effect is what actually performs
        // the reset.)
    };

    /**
     * Footer JSX for the editing step. Styled to look like a clear
     * extension of the card body — same `bg-panel` as the section,
     * a top divider matching the body's separator, and rounded
     * bottom corners so it lines up with the card's outer
     * `rounded-[var(--radius)]` regardless of whether it's pinned
     * to the viewport (sticky) or sitting at the card's natural
     * bottom.
     *
     * `position: sticky; bottom: 0` does the dual-mode behavior:
     * pins to the visible viewport bottom while the card is taller
     * than the viewport, and settles at the card's natural bottom
     * when the card fits. Solid `bg-panel` (not translucent) so the
     * pinned state doesn't visually leak through to siblings below.
     *
     * The wizard generates the footer once per render and threads
     * it through every step component as a `footer` prop. Only the
     * step in `editing` state actually renders it (the panel hides
     * the footer in pending / complete state).
     */
    const stickyFooter = (
        <div
            className={
                "sticky bottom-0 z-[1] flex flex-wrap items-center gap-2 " +
                "rounded-b-[var(--radius)] border-t border-border/30 " +
                "bg-panel px-4 py-3 " +
                "[padding-bottom:calc(env(safe-area-inset-bottom,0px)+0.75rem)] " +
                // On mobile setup mode the BottomNav (~56px tall, plus the
                // device safe-area for the iOS home-bar) is fixed at the
                // viewport bottom. Without an offset the sticky footer's
                // Skip / Next buttons render UNDER the BottomNav and become
                // unclickable. Pin the footer above the BottomNav on mobile;
                // drop the in-footer safe-area padding too since the
                // BottomNav already inset its own (double-padding would
                // bloat the footer's height for no visual gain). Desktop
                // hides the BottomNav, so the original `bottom: 0` +
                // safe-area padding-bottom still applies there.
                "[@media(max-width:799px)]:[bottom:calc(56px+env(safe-area-inset-bottom,0px))] " +
                "[@media(max-width:799px)]:[padding-bottom:0.75rem]"
            }
        >
            <button
                type="button"
                className="tap-target-compact text-tap-compact shrink-0 cursor-pointer rounded border border-border bg-control hover:bg-hover"
                onClick={onStartOver}
            >
                {t("newGame")}
            </button>
            <div className="ml-auto flex items-center gap-2">
                {wizardMode === WIZARD_MODE_FLOW ? (
                    <>
                        <button
                            type="button"
                            className="tap-target-compact text-tap-compact cursor-pointer rounded border border-border bg-control hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={onClickSkip}
                            disabled={!skipEnabled}
                        >
                            {t("skip")}
                        </button>
                        <button
                            type="button"
                            className="tap-target text-tap cursor-pointer rounded border-none bg-accent font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={onClickNext}
                            disabled={!nextEnabled}
                            data-tour-anchor={
                                isLastStep ? "setup-start-playing" : undefined
                            }
                            data-setup-cta={isLastStep ? "" : undefined}
                        >
                            {isLastStep ? startPlayingLabel : t("next")}
                        </button>
                    </>
                ) : (
                    // Edit mode: single "Done" CTA. Collapses the
                    // open step; no advance, no skip. The global
                    // PlayCTAButton in the chrome carries the "go
                    // play" affordance instead.
                    <button
                        type="button"
                        className="tap-target text-tap cursor-pointer rounded border-none bg-accent font-semibold text-white hover:bg-accent-hover"
                        onClick={onClickDone}
                    >
                        {t("done")}
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
            <header
                className="flex flex-col gap-1"
                data-tour-anchor="setup-wizard-header"
            >
                <h2 className="m-0 text-[1.5rem] uppercase tracking-[0.05em] text-accent">
                    {t("heading")}
                </h2>
                <p className="m-0 text-[1rem] text-muted">
                    {t("subheading")}
                </p>
            </header>

            <div
                className="flex flex-col gap-3"
                data-tour-anchor="setup-wizard-shell"
            >
                {steps.map((id, idx) => {
                    const stepNumber = idx + 1;
                    const totalSteps = steps.length;
                    const panelState = stepStateFor(id);
                    if (id === "cardPack") {
                        return (
                            <SetupStepCardPack
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "players") {
                        return (
                            <SetupStepPlayers
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "identity") {
                        return (
                            <SetupStepIdentity
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerBeforeSkip={registerBeforeSkip}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "handSizes") {
                        return (
                            <SetupStepHandSizes
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerBeforeAdvance={
                                    registerBeforeAdvance
                                }
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "myCards") {
                        // visibleSteps already gates this on
                        // selfPlayerId !== null, but TypeScript needs
                        // the runtime guard to narrow the prop.
                        if (state.selfPlayerId === null) return null;
                        return (
                            <SetupStepMyCards
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                selfPlayerId={state.selfPlayerId}
                                onClickToEdit={() => reEnter(id)}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "knownCards") {
                        return (
                            <SetupStepKnownCards
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    if (id === "inviteOtherPlayers") {
                        return (
                            <SetupStepInviteOtherPlayers
                                key={id}
                                state={panelState}
                                wizardMode={wizardMode}
                                stepNumber={stepNumber}
                                totalSteps={totalSteps}
                                onClickToEdit={() => reEnter(id)}
                                registerPanelEl={registerPanelEl}
                                footer={stickyFooter}
                            />
                        );
                    }
                    return null;
                })}
            </div>

        </div>
    );
}
