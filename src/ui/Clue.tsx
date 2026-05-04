"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { gameSetupStarted } from "../analytics/events";
import { startSetup } from "../analytics/gameSession";
import { AccountProvider } from "./account/AccountProvider";
import { ShareProvider } from "./share/ShareProvider";
import { BottomNav } from "./components/BottomNav";
import { Checklist } from "./components/Checklist";
import { GlobalContradictionBanner } from "./components/GlobalContradictionBanner";
import { InstallPromptProvider } from "./components/InstallPromptProvider";
import { PlayLayout } from "./components/PlayLayout";
import { Toolbar } from "./components/Toolbar";
import { TooltipProvider } from "./components/Tooltip";
import { ConfirmProvider, useConfirm } from "./hooks/useConfirm";
import { useSplashGate } from "./hooks/useSplashGate";
import { SelectionProvider } from "./SelectionContext";
import { useGlobalShortcut } from "./keyMap";
import { T_STANDARD, useReducedTransition } from "./motion";
import type { UiMode } from "../logic/ClueState";
import { StartupCoordinatorProvider, useStartupCoordinator } from "./onboarding/StartupCoordinator";
import { SplashModal } from "./components/SplashModal";
import { StaleGameModal } from "./components/StaleGameModal";
import { useStaleGameGate } from "./hooks/useStaleGameGate";
import { ClueProvider, useClue } from "./state";
import { TourProvider, useTour } from "./tour/TourProvider";
import { TourPopover } from "./tour/TourPopover";
import {
    computeShouldShowTour,
    TOUR_RE_ENGAGE_DURATION,
    useTourGate,
} from "./tour/useTourGate";
import {
    loadTourState,
    saveTourDismissed,
    saveTourVisited,
} from "./tour/TourState";
import { TelemetryRuntime } from "../observability/runtime";
import { DateTime } from "effect";
import {
    pickFirstEligibleScreenKey,
    screenKeyForUiMode,
    screensForUiMode,
    uiModeForScreenKey,
} from "./tour/screenKey";

// Non user-facing literals.
const VARIANT_INITIAL = "initial";
const VARIANT_ANIMATE = "animate";
const VARIANT_EXIT = "exit";
const UI_SETUP: "setup" = "setup";
const UI_CHECKLIST: "checklist" = "checklist";
const UI_SUGGEST: "suggest" = "suggest";
const TOP_LEVEL_PLAY = "play";
// Coordinator slot discriminators — same shape as `StartupSlot` but
// pulled out as constants so the i18next/no-literal-string lint rule
// treats them as wire-format identifiers, not user copy.
const COORDINATOR_PHASE_TOUR = "tour" as const;
// ScreenKey discriminator for the M22 first-suggestion tour. Pulled
// to module scope for the same i18next-lint reason.
const FIRST_SUGGESTION_SCREEN_KEY = "firstSuggestion" as const;

/**
 * Horizontal mental-model of the three views. Setup sits to the
 * left of the play grid; within the play grid on mobile, the
 * checklist sits to the left of the suggest log. On desktop the
 * play grid collapses into one view (both panes visible), so the
 * top-level AnimatePresence treats "checklist" and "suggest" as a
 * single "play" key — switching between them doesn't animate.
 */
const POSITIONS: Record<UiMode, number> = {
    setup: 0,
    checklist: 1,
    suggest: 2,
};

type Direction = 1 | -1;

function getDirection(prev: UiMode, next: UiMode): Direction {
    return POSITIONS[next] >= POSITIONS[prev] ? 1 : -1;
}

const slideVariants: Variants = {
    initial: (dir: Direction) => ({ x: dir === 1 ? "100%" : "-100%", opacity: 0 }),
    animate: { x: 0, opacity: 1 },
    exit: (dir: Direction) => ({ x: dir === 1 ? "-100%" : "100%", opacity: 0 }),
};

/**
 * Top-level Clue solver app.
 *
 * **Desktop (≥ 800px)** shows the `Checklist` and `SuggestionLogPanel`
 * side-by-side in a 2-column grid. A top-right `Toolbar` holds Undo
 * and Redo as top-level buttons plus a `⋯` overflow menu for Game
 * setup and New game. Setup mode (entered via ⌘H or the overflow
 * menu) swaps the grid for a full-width Checklist that unlocks
 * inline-edit affordances.
 *
 * **Mobile (< 800px)** hides the desktop Toolbar entirely. A fixed
 * `BottomNav` takes its place, with Checklist / Suggest tabs that
 * split what desktop packs into a single Play grid, plus inline
 * Undo/Redo and a `⋯` overflow menu that mirrors the desktop one.
 * `<main>`'s bottom padding is bumped up to keep page content clear
 * of the fixed nav.
 *
 * A single global contradiction banner is pinned to the top of the
 * viewport (`position: fixed` inside `GlobalContradictionBanner`)
 * whenever the deducer is stuck; it measures its own height and
 * publishes `--contradiction-banner-offset`, which `<main>` adds to
 * its top padding so the header isn't hidden underneath.
 *
 * The unified Checklist is the single surface for both Setup and
 * Play modes — the overflow menu's Game setup item drives the
 * `uiMode` slice and the component gates its Setup-mode affordances
 * (inline renames, add/remove, hand-size row, "+ add card" / "+ add
 * category") on that flag. `uiMode` has three values: `setup`,
 * `checklist`, `suggest`. On desktop `checklist` and `suggest` both
 * render the Play grid; on mobile each routes to its own pane. This
 * means resizing across the breakpoint never jumps tabs — the URL
 * (`?view=…`) stays coherent on both sides.
 */
export function Clue() {
    const headerRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const el = headerRef.current;
        if (!el) return;
        const root = document.documentElement;
        // Header is vertically sticky at every breakpoint, so the
        // sticky thead in the Checklist always needs to know how
        // tall it is to anchor `top: calc(...)` below it.
        const write = () =>
            root.style.setProperty(
                "--header-offset",
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => {
            ro.disconnect();
        };
    }, []);
    return (
        <TooltipProvider delayDuration={150} skipDelayDuration={50}>
          <ClueProvider>
           <ConfirmProvider>
           <SelectionProvider>
            <CoordinatedShell headerRef={headerRef} />
           </SelectionProvider>
           </ConfirmProvider>
          </ClueProvider>
        </TooltipProvider>
    );
}

/**
 * Mounts the startup coordinator + tour provider with values pulled
 * from `useClue()`. The coordinator needs `hydrated` (so it doesn't
 * decide based on default state) and the active screen key (so per-
 * screen tour eligibility is computed against the screen the user
 * actually landed on).
 */
function CoordinatedShell({
    headerRef,
}: {
    readonly headerRef: React.RefObject<HTMLElement | null>;
}) {
    const { hydrated, state, dispatch } = useClue();
    const activeScreen = screenKeyForUiMode(state.uiMode);
    // Whether the hydrated game has any progress. Drives the
    // staleGame slot's threshold choice in the coordinator.
    const gameStarted =
        state.knownCards.length > 0
        || state.suggestions.length > 0
        || state.accusations.length > 0;
    // Translate the coordinator's precedence-redirect request back
    // into a `setUiMode` dispatch. The coordinator only fires this
    // when the highest-priority eligible tour belongs to a screen
    // the user is NOT on (e.g. brand-new user who landed on
    // `/play?view=checklist` gets sent to `setup`).
    const handleRedirectToScreen = useCallback(
        (screen: ReturnType<typeof screenKeyForUiMode>) => {
            const targetMode = uiModeForScreenKey(screen);
            if (targetMode === undefined) return;
            if (targetMode === state.uiMode) return;
            dispatch({ type: "setUiMode", mode: targetMode });
        },
        [dispatch, state.uiMode],
    );
    return (
        <StartupCoordinatorProvider
            hydrated={hydrated}
            activeScreen={activeScreen}
            gameStarted={gameStarted}
            onRedirectToScreen={handleRedirectToScreen}
        >
            <TourProvider>
                <ClueShell headerRef={headerRef} />
            </TourProvider>
        </StartupCoordinatorProvider>
    );
}

/**
 * Inner shell that reads `useClue().hydrated` so we can pass it to
 * the install-prompt provider. Splitting this out keeps `Clue`
 * itself out of `useClue`, which would crash if we ever rendered
 * the shell before `<ClueProvider>` mounted.
 */
function ClueShell({
    headerRef,
}: {
    readonly headerRef: React.RefObject<HTMLElement | null>;
}) {
    const t = useTranslations("app");
    const { showSplash, dismiss: dismissSplash } = useSplashGate();
    const staleGame = useStaleGameGate();
    return (
        <InstallPromptProvider>
        <AccountProvider>
        <ShareProvider>
            <main className="mx-auto flex min-w-max max-w-[1400px] flex-col gap-5 px-5 pb-24 [@media(min-width:800px)]:pb-5 [padding-top:calc(var(--contradiction-banner-offset,0px)+1.5rem)]">
                <header
                    ref={headerRef}
                    className="sticky top-[var(--contradiction-banner-offset,0px)] z-[var(--z-app-chrome)] flex flex-wrap items-center justify-between gap-4 bg-bg py-2 [@media(min-width:800px)]:left-5 [@media(min-width:800px)]:max-w-[calc(100vw-2.5rem)]"
                >
                    <h1 className="m-0 text-[36px] uppercase tracking-[0.08em] text-accent drop-shadow-sm">
                        {t("title")}
                    </h1>
                    <div className="hidden [@media(min-width:800px)]:block">
                        <Toolbar />
                    </div>
                </header>

                <GlobalContradictionBanner />

                <div className="flex flex-col">
                    <TabContent />
                </div>
                <NewGameShortcut />
                <TourScreenGate />
                <FirstSuggestionTourGate />
                <TourPopover />
            </main>
            <BottomNav />
            <SplashModal open={showSplash} onDismiss={dismissSplash} />
            <StaleGameModal
                open={staleGame.open}
                variant={staleGame.variant}
                referenceTimestamp={staleGame.referenceTimestamp}
                now={staleGame.now}
                onSetupNewGame={staleGame.setupNewGame}
                onKeepWorking={staleGame.keepWorking}
            />
        </ShareProvider>
        </AccountProvider>
        </InstallPromptProvider>
    );
}

/**
 * Reads `state.uiMode` and the per-screen tour gate to fire whichever
 * screen-specific tour applies. Mounts once inside the provider stack
 * so `useTourGate` (per-screen storage) and `useTour` (start tour)
 * are both available.
 *
 * The gate only checks first-visit + 4-week dormancy — it does NOT
 * fire mid-game when the user toggles between Setup / Checklist /
 * Suggest. We track the screen-key the gate fired against; once a
 * tour fires for that key, the same key won't re-fire in the same
 * mount even if the user revisits it.
 */

function TourScreenGate() {
    const { state, hydrated } = useClue();
    const { startTour, activeScreen } = useTour();
    const { phase, reportClosed } = useStartupCoordinator();
    // Resolve which tour key to gate against. Most uiModes have one
    // candidate; the setup uiMode has both `setup` (foundational)
    // and `sharing` (follow-up after both setup + checklistSuggest
    // have been dismissed). `pickFirstEligibleScreenKey` walks the
    // candidates and picks the first whose prerequisites + own
    // re-engage gate are satisfied. Always returns SOME key so the
    // useTourGate signature stays stable.
    const screenKey = useMemo(() => {
        if (!hydrated) return screenKeyForUiMode(state.uiMode);
        return pickFirstEligibleScreenKey(
            screensForUiMode(state.uiMode),
            DateTime.nowUnsafe(),
        );
    }, [hydrated, state.uiMode]);
    const { shouldShow, dismiss } = useTourGate(screenKey, {
        enabled: hydrated,
    });

    // Track which screen key we've already fired in this mount so we
    // don't re-fire a tour the user already saw mid-session (the gate
    // localStorage write happens AFTER the read; without this guard a
    // splash flash + uiMode flip during hydration could stack two
    // start calls).
    const firedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!hydrated) return;
        if (!shouldShow) return;
        if (activeScreen) return; // a tour is already running.
        if (firedRef.current.has(screenKey)) return;
        // The coordinator's phase blocks tour firing while
        // `splash`, `install`, or `boot` own the slot — they're the
        // states where firing would stack modals on top of each
        // other. Phase `tour` is the explicit go-ahead from the
        // coordinator at boot. Phase `done` covers post-boot
        // client-side navigation: by the time the user clicks
        // "Start playing" (setup → checklistSuggest), splash and
        // install have already had their chance, so a fresh per-
        // screen tour can fire without coordinator intervention.
        if (phase === "boot" || phase === "splash" || phase === "install") {
            return;
        }
        firedRef.current.add(screenKey);
        startTour(screenKey);
        // The gate's `dismiss` flips its own internal state and persists
        // `lastDismissedAt`. We pair tour completion / dismiss with
        // gate dismiss so subsequent visits respect the 4-week cadence.
        // The actual flag is set in the per-tour finish path; for now
        // just mark "we showed the tour" so a refresh in this session
        // won't re-fire.
        dismiss();
    }, [hydrated, shouldShow, phase, screenKey, activeScreen, startTour, dismiss]);

    // Whenever the tour transitions from active → not active AND we
    // were in the coordinator's "tour" phase, advance the coordinator.
    // This catches every dismiss path (skip / esc / backdrop / X /
    // complete) without each path having to remember.
    const wasActiveRef = useRef(false);
    useEffect(() => {
        const isActive = activeScreen !== undefined;
        if (wasActiveRef.current && !isActive && phase === COORDINATOR_PHASE_TOUR) {
            reportClosed(COORDINATOR_PHASE_TOUR);
        }
        wasActiveRef.current = isActive;
    }, [activeScreen, phase, reportClosed]);

    return null;
}

/**
 * Mid-game tour: when the user adds a suggestion while the
 * `firstSuggestion` gate is fresh, point at the deduction grid
 * (desktop) or the Checklist BottomNav tab (mobile) and explain
 * that the solver re-runs with each addition. Fires at most once
 * per user per 4-week window — explicitly NOT once-per-game; if
 * the user solves a case, starts a new one, and logs a suggestion,
 * the previously-saved dismissal suppresses a re-fire.
 *
 * Trigger: ANY suggestion-count increase since this mount, gated
 * by a fresh read of `tour.firstSuggestion` localStorage at the
 * moment of the addition. "Fresh read" matters: when the user
 * clicks ⋯ → "Take tour" mid-game, `restartTourForScreen` wipes
 * EVERY tour key (including `firstSuggestion`). Reading the gate
 * at trigger time picks up that wipe — the next suggestion they
 * log re-fires the tour. A mount-time gate snapshot wouldn't, and
 * the user would have to refresh the page to see it again.
 *
 * Tracks the last seen length in a ref so we only fire on a real
 * "user added something this session" transition, not on every
 * mount of a hydrated session that already has suggestions. The
 * `firedRef` guard keeps it to one fire per mount even if the user
 * adds several suggestions in a row.
 */
function FirstSuggestionTourGate() {
    const { state, hydrated } = useClue();
    const { startTour, activeScreen } = useTour();
    const { phase } = useStartupCoordinator();
    const lastSeenLengthRef = useRef<number | null>(null);
    const firedRef = useRef(false);

    useEffect(() => {
        const currentLength = state.suggestions.length;
        // First mount: just snapshot, don't fire.
        if (lastSeenLengthRef.current === null) {
            lastSeenLengthRef.current = currentLength;
            return;
        }
        // Fire on ANY increase (going up by one or more) — not just
        // the 0 → 1+ transition, because the user may already have
        // suggestions logged when the gate becomes eligible (e.g.
        // they cleared it via "Take tour" mid-game).
        const justAdded = currentLength > lastSeenLengthRef.current;
        lastSeenLengthRef.current = currentLength;
        if (!justAdded) return;
        if (!hydrated) return;
        if (activeScreen) return;
        if (firedRef.current) return;
        if (phase === "boot" || phase === "splash" || phase === "install") {
            return;
        }
        // Gate evaluated FRESH at trigger time, not at mount time.
        // This is what makes "Take tour"'s mid-session wipe of
        // `tour.firstSuggestion.v1` take effect on the next add —
        // a snapshot from useTourGate at mount would miss the wipe.
        const now = DateTime.nowUnsafe();
        const shouldShow = TelemetryRuntime.runSync(
            computeShouldShowTour(
                loadTourState(FIRST_SUGGESTION_SCREEN_KEY),
                now,
                TOUR_RE_ENGAGE_DURATION,
            ),
        );
        if (!shouldShow) return;
        firedRef.current = true;
        startTour(FIRST_SUGGESTION_SCREEN_KEY);
        // Persist BOTH timestamps so the gate returns false until
        // the next 4-week re-engage window opens. Saving only
        // `lastDismissedAt` would keep the gate eligible because
        // the gate's "dismissed but never visited" branch returns
        // true (a defensive "if state is incoherent, show again").
        saveTourVisited(FIRST_SUGGESTION_SCREEN_KEY, now);
        saveTourDismissed(FIRST_SUGGESTION_SCREEN_KEY, now);
    }, [state.suggestions.length, hydrated, activeScreen, phase, startTour]);

    return null;
}

/**
 * Cmd/Ctrl+Shift+Backspace handler for starting a new game. Mounts
 * once inside `ClueProvider` so `useClue` + i18n are available.
 */
function NewGameShortcut() {
    const t = useTranslations("toolbar");
    const { dispatch } = useClue();
    const confirm = useConfirm();
    useGlobalShortcut(
        "global.newGame",
        useCallback(() => {
            void confirm({ message: t("newGameConfirm") }).then(ok => {
                if (ok) {
                    startSetup();
                    dispatch({ type: "newGame" });
                    gameSetupStarted();
                }
            });
        }, [confirm, dispatch, t]),
    );
    return null;
}

/**
 * Tab-body router driven by `uiMode`. Three logical views live in
 * a horizontal row: setup (pos 0), checklist (pos 1), suggest (pos
 * 2). Transitions slide whole pages in/out from the direction that
 * matches that position, so a move from setup to suggest slides the
 * new page in from the RIGHT (positions increasing), and the reverse
 * slides it in from the LEFT.
 *
 * `topLevelKey` is `"setup" | "play"` — checklist and suggest both
 * map to `"play"` so switching between them at this layer does NOT
 * trigger a slide. The Play view's internal layout (single active
 * pane on mobile vs side-by-side on desktop, plus the Checklist ↔
 * Suggest sub-tab transition) is `PlayLayout`'s job.
 */
function TabContent() {
    const { state, hydrated } = useClue();
    const mode = state.uiMode;
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    // Track the previous mode to compute slide direction. Updates
    // via useEffect so render sees the PREVIOUS value alongside the
    // new mode — exactly what's needed to choose enter/exit sides.
    const prevModeRef = useRef<UiMode>(mode);
    const direction = getDirection(prevModeRef.current, mode);
    useEffect(() => {
        prevModeRef.current = mode;
    }, [mode]);

    const topLevelKey: "setup" | "play" =
        mode === UI_SETUP ? UI_SETUP : TOP_LEVEL_PLAY;

    // With document-level scroll, the page doesn't reset when the
    // top-level view changes — a deep scroll into the Checklist
    // would otherwise leave the user mid-page after switching to
    // Setup. Reset to the top on top-level toggles, skipping the
    // initial mount so we don't override hydration's restored view.
    const prevTopLevelKey = useRef(topLevelKey);
    useEffect(() => {
        if (prevTopLevelKey.current === topLevelKey) return;
        prevTopLevelKey.current = topLevelKey;
        const reduced =
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // eslint-disable-next-line i18next/no-literal-string -- ScrollBehavior enum
        window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }, [topLevelKey]);

    // Until URL/localStorage hydration resolves the real view, render
    // a view-agnostic skeleton so the default `"setup"` pane doesn't
    // flash between initial mount and the hydrated dispatch. Gating
    // the AnimatePresence (not an early return) keeps hook order
    // stable across the transition. AnimatePresence only mounts once
    // `hydrated` is true, so `initial={false}` correctly skips the
    // entry animation on whichever hydrated view wins.
    return (
        <div className="relative grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'stack'] contain-paint">
            {!hydrated ? (
                <ViewSkeleton />
            ) : (
            <AnimatePresence custom={direction} initial={false}>
                {topLevelKey === UI_SETUP ? (
                    <motion.div
                        key={UI_SETUP}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="[grid-area:stack] min-w-0"
                    >
                        <Checklist />
                    </motion.div>
                ) : (
                    <motion.div
                        key={TOP_LEVEL_PLAY}
                        custom={direction}
                        variants={slideVariants}
                        initial={VARIANT_INITIAL}
                        animate={VARIANT_ANIMATE}
                        exit={VARIANT_EXIT}
                        transition={transition}
                        className="[grid-area:stack] min-w-0"
                    >
                        <PlayLayout
                            mode={mode === UI_SUGGEST ? UI_SUGGEST : UI_CHECKLIST}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            )}
        </div>
    );
}

/**
 * View-agnostic loading skeleton. On mobile it renders a single pane
 * (matching the one visible pane in Setup, Checklist, and Suggest
 * modes). On desktop (≥800px) it mirrors the Play grid's two-column
 * layout so the skeleton shape is close to whichever view lands —
 * the left column wins for Setup (where the right panel disappears
 * in one frame), and both columns match the Play grid. Rectangles
 * stand in for a heading bar, a subtitle / progress row, and the
 * main content area. `motion-safe:animate-pulse` lets reduced-motion
 * users see a static skeleton.
 */
function ViewSkeleton() {
    const pane = (
        <div className="flex min-h-[60vh] flex-col gap-3 rounded-[var(--radius)] border border-border/40 bg-panel/40 p-4">
            <div className="h-5 w-1/3 rounded bg-border/40" />
            <div className="h-3 w-2/3 rounded bg-border/30" />
            <div className="mt-1 min-h-20 flex-1 rounded bg-border/20" />
        </div>
    );
    return (
        <div
            aria-hidden
            className="relative min-h-[60vh] motion-safe:animate-pulse [@media(min-width:800px)]:grid [@media(min-width:800px)]:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] [@media(min-width:800px)]:gap-5"
        >
            {pane}
            <div className="hidden [@media(min-width:800px)]:block">
                {pane}
            </div>
        </div>
    );
}
