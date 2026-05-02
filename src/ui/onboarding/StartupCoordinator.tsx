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
 * Priority order for auto-firing tours at boot. The coordinator
 * picks the highest-priority eligible tour. If that tour belongs to
 * a screen the user is NOT currently on, it MAY ask the parent to
 * redirect (via `onRedirectToScreen`) — but only for the setup tour.
 * See `shouldRedirectForTour` below.
 *
 * Screens omitted from this list are NOT auto-fired by precedence:
 *   - `firstSuggestion` is event-triggered (after the user logs
 *     their first suggestion in any session), not screen-mounted.
 *   - `account` and `shareImport` are reserved for M7 / M9 — they
 *     overlay any uiMode rather than redirect.
 */
const TOUR_PRECEDENCE: ReadonlyArray<ScreenKey> = [
    "setup",
    "checklistSuggest",
] as const;

const SCREEN_SETUP: ScreenKey = "setup";

/**
 * Should the coordinator pull the user off their current screen to
 * fire the highest-priority eligible tour? Only the setup tour gets
 * the redirect treatment — for everything else, we defer to the
 * per-screen `TourScreenGate` to fire the tour the next time the
 * user navigates to its screen themselves.
 *
 * Why setup-only: setup is the prerequisite for everything else in
 * the app (you can't meaningfully use the checklist or suggest panes
 * without a configured game). A brand-new user who landed deep-linked
 * on `/play?view=checklist` genuinely needs to be moved back to setup
 * first. For all other tours, silently bouncing the user off the
 * screen they intentionally landed on is more disorienting than
 * waiting for them to navigate there themselves.
 */
const shouldRedirectForTour = (
    target: ScreenKey,
    activeScreen: ScreenKey,
): boolean => target === SCREEN_SETUP && activeScreen !== SCREEN_SETUP;

/**
 * Decide what the coordinator should do with the highest-priority
 * eligible tour, given the screen the user landed on and whether a
 * redirect callback is available.
 *
 *   - `"fire"` — phase advances to `tour`; the matching tour fires
 *     in place. Either the target matches the active screen, OR the
 *     coordinator wanted to redirect but had no callback (test path).
 *   - `"redirect-then-fire"` — call `onRedirectToScreen(target)`;
 *     the active-screen prop will update on the parent's next render
 *     and the matching tour fires after.
 *   - `"skip"` — no tour auto-fires this boot. Either nothing is
 *     eligible, or the eligible tour is for a screen the user isn't
 *     on AND we don't redirect for it. The per-screen
 *     `TourScreenGate` will fire it the next time the user navigates
 *     there themselves.
 */
const TOUR_DECISION_FIRE = "fire" as const;
const TOUR_DECISION_REDIRECT_THEN_FIRE = "redirect-then-fire" as const;
const TOUR_DECISION_SKIP = "skip" as const;
type TourDecision =
    | typeof TOUR_DECISION_FIRE
    | typeof TOUR_DECISION_REDIRECT_THEN_FIRE
    | typeof TOUR_DECISION_SKIP;

const decideTourDispatch = (
    target: ScreenKey | undefined,
    activeScreen: ScreenKey,
    canRedirect: boolean,
): TourDecision => {
    if (target === undefined) return TOUR_DECISION_SKIP;
    if (target === activeScreen) return TOUR_DECISION_FIRE;
    if (shouldRedirectForTour(target, activeScreen)) {
        return canRedirect ? TOUR_DECISION_REDIRECT_THEN_FIRE : TOUR_DECISION_FIRE;
    }
    return TOUR_DECISION_SKIP;
};

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

/**
 * Walk `TOUR_PRECEDENCE` in order, return the FIRST eligible screen
 * (or `undefined` when no tour wants to fire). Pure read of
 * localStorage via `loadTourState` — same reads that
 * `isTourEligible` does, just done across the priority list.
 */
const findHighestPriorityEligibleTour = (
    now: DateTime.Utc,
): ScreenKey | undefined => {
    for (const screen of TOUR_PRECEDENCE) {
        if (isTourEligible(screen, now)) return screen;
    }
    return undefined;
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
    onRedirectToScreen,
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
    /**
     * Optional precedence-redirect callback. When the highest-priority
     * eligible tour (per `TOUR_PRECEDENCE`) does NOT match
     * `activeScreen`, the coordinator invokes this with the target
     * screen. The parent should map the screen back to a `uiMode` and
     * dispatch `setUiMode` so the user lands on the right pane before
     * the tour fires.
     *
     * When omitted, the precedence redirect is disabled and the
     * coordinator falls back to single-screen tour eligibility. Useful
     * for tests and for any caller that doesn't want the redirect
     * behavior.
     */
    readonly onRedirectToScreen?: (screen: ScreenKey) => void;
}) {
    const [phase, setPhase] = useState<StartupPhase>(PHASE_BOOT);

    // Eligibility snapshot taken once at boot. Held in a ref so that
    // post-splash transitions can re-consult the snapshot without
    // re-reading localStorage (which would have been mutated by the
    // splash/tour/install gates' own writes during their open path).
    const eligibilityRef = useRef<Eligibility | null>(null);

    // Latest redirect callback in a ref so the boot effect doesn't
    // need to depend on its identity (the parent often passes an
    // inline arrow). The redirect only fires inside the effect after
    // an eligibility decision, which is gated by `eligibilityRef`,
    // so closure-staleness across renders isn't a concern.
    const redirectRef = useRef(onRedirectToScreen);
    redirectRef.current = onRedirectToScreen;

    // Compute eligibility once on hydration and decide the first
    // phase. The pure decision lives in `pickNextPhase`.
    //
    // Precedence: if a higher-priority tour (per `TOUR_PRECEDENCE`)
    // is eligible on a screen the user is NOT on, ask the parent to
    // redirect. The effect short-circuits (returns without writing
    // the snapshot) so when `activeScreen` updates from the parent's
    // dispatch, we re-run and fall through to the snapshot branch.
    //
    // Splash-first wins regardless of precedence — the precedence
    // decision is deferred to `reportClosed("splash")`. This avoids
    // dispatching `setUiMode` while the splash modal is on screen
    // (which would cause a layout shift behind it).
    useEffect(() => {
        if (!hydrated) return;
        if (phase !== PHASE_BOOT) return;
        if (eligibilityRef.current !== null) return;
        const now = DateTime.nowUnsafe();

        if (isSplashEligible(now)) {
            const eligibility: Eligibility = {
                splash: true,
                // Tour eligibility is recomputed when splash closes;
                // hold it as `false` here so a stale snapshot can't
                // accidentally fire the tour for the wrong screen.
                tour: false,
                install: isInstallEligibleByCounter(now),
            };
            eligibilityRef.current = eligibility;
            setPhase(SLOT_SPLASH);
            return;
        }

        const target = findHighestPriorityEligibleTour(now);
        const decision = decideTourDispatch(
            target,
            activeScreen,
            redirectRef.current !== undefined,
        );

        if (decision === TOUR_DECISION_REDIRECT_THEN_FIRE) {
            // Don't snapshot yet — wait for the parent to dispatch the
            // redirect, which will update `activeScreen` and re-run
            // this effect (which will then take the "fire" branch).
            redirectRef.current?.(target as ScreenKey);
            return;
        }

        const eligibility: Eligibility = {
            splash: false,
            tour: decision === TOUR_DECISION_FIRE,
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
        if (slot === SLOT_SPLASH) {
            // Re-run the precedence decision now that splash is gone.
            // Same `decideTourDispatch` rule as boot — we only redirect
            // off the user's current screen for the setup tour; other
            // tours fire in place or wait for next navigation.
            const now = DateTime.nowUnsafe();
            const target = findHighestPriorityEligibleTour(now);
            const decision = decideTourDispatch(
                target,
                activeScreen,
                redirectRef.current !== undefined,
            );
            setPhase(prev => {
                if (prev !== SLOT_SPLASH) return prev;
                if (decision === TOUR_DECISION_REDIRECT_THEN_FIRE) {
                    // Mirror the snapshot to reflect that a tour will
                    // fire (so the next `reportClosed("tour")` reads
                    // a consistent snapshot), then redirect. The
                    // coordinator advances to `tour` immediately —
                    // when the redirect lands, the right tour will
                    // fire on the new screen.
                    eligibilityRef.current = {
                        splash: false,
                        tour: true,
                        install: snapshot.install,
                    };
                    redirectRef.current?.(target as ScreenKey);
                    return SLOT_TOUR;
                }
                const willFireTour = decision === TOUR_DECISION_FIRE;
                eligibilityRef.current = {
                    splash: false,
                    tour: willFireTour,
                    install: snapshot.install,
                };
                return pickNextPhase({
                    splash: false,
                    tour: willFireTour,
                    install: snapshot.install,
                });
            });
            return;
        }
        setPhase(prev => {
            if (prev !== slot) return prev;
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
    }, [activeScreen]);

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
