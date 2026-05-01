/**
 * Coordinates the three things that can auto-fire on /play mount:
 *
 *   1. About-app splash (`<SplashModal />`)
 *   2. Onboarding tour (`<TourScreenGate />` + `<TourPopover />`)
 *   3. PWA install prompt (`<InstallPromptModal />`)
 *
 * Without coordination these three races stack on top of each other:
 * the splash, the tour, and the install prompt can all dispatch
 * simultaneously on the first page load, leaving the user with three
 * overlapping dialogs. The order they happen to win the race is also
 * arbitrary — splash might come second, tour might come third, etc.
 *
 * This coordinator owns a single phase machine that walks the queue
 * in a hardcoded priority order with explicit suppression rules:
 *
 *     boot → splash? → tour? → install? → done
 *
 * - **Splash always goes first** when eligible. Tour and install wait.
 * - **Tour comes after splash closes**, only if its per-screen gate
 *   says it should fire on the screen the user landed on.
 * - **Install comes after splash closes**, only if (a) the visit-count
 *   gate is met, AND (b) the tour did NOT auto-fire this session.
 *   Showing the install prompt right after a tour is overwhelming;
 *   the user can still install manually from the ⋯ → Install app menu.
 *
 * Eligibility for splash + tour + install (counter only) is computed
 * synchronously from localStorage at boot — these gates don't depend
 * on async signals. The install prompt has one async piece (the
 * browser firing `beforeinstallprompt`); when phase advances to
 * `install`, the install gate waits up to a short window for the
 * deferred prompt event before either opening the modal or advancing
 * to `done`.
 *
 * Manual triggers (the ⋯ → "Install app" menu, the ⋯ → "Take tour"
 * menu, etc.) bypass this coordinator entirely. The coordinator only
 * gates AUTO-fires that happen on page load.
 */
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { DateTime, Duration } from "effect";
import { loadInstallPromptState } from "../../logic/InstallPromptState";
import { loadSplashState } from "../../logic/SplashState";
import { ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION } from "../hooks/useSplashGate";
import { TOUR_RE_ENGAGE_DURATION } from "../tour/useTourGate";
import { loadTourState, type ScreenKey } from "../tour/TourState";

/**
 * The slots the coordinator manages. Each maps to one auto-firable
 * surface on /play.
 */
type StartupSlot = "splash" | "tour" | "install";

// Module-scoped phase/slot constants. Pulled out so the
// `i18next/no-literal-string` lint rule treats them as wire-format
// discriminators rather than user-facing copy.
const PHASE_BOOT = "boot" as const;
const PHASE_DONE = "done" as const;
const SLOT_SPLASH: StartupSlot = "splash";
const SLOT_TOUR: StartupSlot = "tour";
const SLOT_INSTALL: StartupSlot = "install";

/**
 * Phases the coordinator walks through. `boot` is the initial state
 * before hydration completes; `done` is the terminal state where
 * nothing else auto-fires.
 *
 * Slot phases (`splash`, `tour`, `install`) match the slot names so
 * each gate can simply compare `phase === <its slot>` to decide
 * whether to auto-fire.
 */
type StartupPhase = "boot" | StartupSlot | "done";

interface CoordinatorValue {
    /** Current phase. Each gate compares against its slot name. */
    readonly phase: StartupPhase;
    /**
     * Each gate calls this when its modal closes (any reason — X,
     * dismiss, complete, install, snooze) so the coordinator can
     * advance to the next phase. Calling for the wrong slot is a
     * no-op.
     */
    readonly reportClosed: (slot: StartupSlot) => void;
}

const StartupCoordinatorContext = createContext<CoordinatorValue | null>(null);

export const useStartupCoordinator = (): CoordinatorValue => {
    const ctx = useContext(StartupCoordinatorContext);
    if (!ctx) {
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        throw new Error("useStartupCoordinator must be inside <StartupCoordinatorProvider>");
    }
    return ctx;
};

const VISITS_BEFORE_INSTALL_PROMPT = 2;
const INSTALL_PROMPT_SNOOZE = Duration.weeks(4);

const isSplashEligible = (now: DateTime.Utc): boolean => {
    const state = loadSplashState();
    if (state.lastDismissedAt === undefined) return true;
    if (state.lastVisitedAt === undefined) return true;
    return Duration.isGreaterThan(
        DateTime.distance(state.lastVisitedAt, now),
        ABOUT_APP_SPLASH_SCREEN_DISMISSAL_DURATION,
    );
};

const isTourEligible = (screen: ScreenKey, now: DateTime.Utc): boolean => {
    const state = loadTourState(screen);
    if (state.lastDismissedAt === undefined) return true;
    if (state.lastVisitedAt === undefined) return true;
    return Duration.isGreaterThan(
        DateTime.distance(state.lastVisitedAt, now),
        TOUR_RE_ENGAGE_DURATION,
    );
};

const isInstallEligibleByCounter = (now: DateTime.Utc): boolean => {
    const state = loadInstallPromptState();
    // Account for the visit-bump that happens on this mount. The
    // install hook bumps `visits` by 1 in its own effect; we mirror
    // that here so eligibility reflects the post-mount count.
    const bumpedVisits = state.visits + 1;
    if (bumpedVisits < VISITS_BEFORE_INSTALL_PROMPT) return false;
    if (state.lastDismissedAt === undefined) return true;
    return Duration.isGreaterThan(
        DateTime.distance(state.lastDismissedAt, now),
        INSTALL_PROMPT_SNOOZE,
    );
};

interface Eligibility {
    readonly splash: boolean;
    readonly tour: boolean;
    readonly install: boolean;
}

/**
 * Pure decision helper. Picks the first slot from the priority list
 * that the eligibility map flags as on, or "done" when nothing's
 * eligible. Tour suppresses install automatically because the
 * caller never passes `tour: true, install: true` to the post-tour
 * decision (the post-tour transition forces install eligibility to
 * false; see `reportClosed`).
 */
const pickNextPhase = (eligibility: Eligibility): StartupPhase => {
    if (eligibility.splash) return SLOT_SPLASH;
    if (eligibility.tour) return SLOT_TOUR;
    if (eligibility.install) return SLOT_INSTALL;
    return PHASE_DONE;
};

export function StartupCoordinatorProvider({
    children,
    hydrated,
    activeScreen,
}: {
    readonly children: ReactNode;
    /**
     * `true` once the upstream `<ClueProvider>` has finished its
     * localStorage hydration. We don't make any auto-fire decisions
     * before this flips so we don't race with the React-Query
     * persister rehydration (which can swap state in the same tick).
     */
    readonly hydrated: boolean;
    /**
     * The active screen key at boot. Used to compute tour eligibility
     * for the screen the user lands on. Per-screen tour gates are
     * checked at boot only — switching uiMode mid-session does not
     * re-fire a tour automatically (the user can use ⋯ → Take tour).
     */
    readonly activeScreen: ScreenKey;
}) {
    const [phase, setPhase] = useState<StartupPhase>(PHASE_BOOT);

    // Eligibility snapshot taken once at boot. Held in a ref so that
    // post-splash transitions can re-consult the snapshot without
    // re-reading localStorage (which would have been mutated by the
    // splash/tour/install gates' own writes during their open path).
    const eligibilityRef = useRef<Eligibility | null>(null);

    // Compute eligibility once on hydration and decide the first
    // phase. The pure decision lives in `pickNextPhase`.
    useEffect(() => {
        if (!hydrated) return;
        if (phase !== PHASE_BOOT) return;
        if (eligibilityRef.current !== null) return;
        const now = DateTime.nowUnsafe();
        const eligibility: Eligibility = {
            splash: isSplashEligible(now),
            tour: isTourEligible(activeScreen, now),
            install: isInstallEligibleByCounter(now),
        };
        eligibilityRef.current = eligibility;
        setPhase(pickNextPhase(eligibility));
    }, [hydrated, phase, activeScreen]);

    const reportClosed = useCallback((slot: StartupSlot) => {
        const snapshot = eligibilityRef.current;
        if (snapshot === null) return;
        // Only advance when the closing slot matches the active phase.
        // Defensive — guards against a stale onClose from a slot that
        // already advanced, e.g. install snooze + close fired twice.
        setPhase(prev => {
            if (prev !== slot) return prev;
            if (slot === SLOT_SPLASH) {
                return pickNextPhase({
                    splash: false,
                    tour: snapshot.tour,
                    install: snapshot.install,
                });
            }
            if (slot === SLOT_TOUR) {
                // Tour suppresses install per the spec. Even if the
                // install gate is otherwise eligible, we do NOT
                // auto-fire it after a tour — too much modal traffic
                // for one page load. Manual install via ⋯ menu still
                // works.
                return PHASE_DONE;
            }
            // install
            return PHASE_DONE;
        });
    }, []);

    const value = useMemo<CoordinatorValue>(
        () => ({ phase, reportClosed }),
        [phase, reportClosed],
    );

    return (
        <StartupCoordinatorContext.Provider value={value}>
            {children}
        </StartupCoordinatorContext.Provider>
    );
}
