/**
 * Helper for component tests that mount <Clue/>.
 *
 * The startup coordinator auto-fires the splash modal, the onboarding
 * tour, and the PWA install prompt based on state in localStorage.
 * In tests, "fresh" localStorage looks like a first-time visitor, so
 * the splash modal opens and blocks click events on every test that
 * forgot to dismiss it. This helper seeds the dismiss-once-and-stay-
 * dismissed state so component tests can focus on the underlying UI.
 *
 * Call after `window.localStorage.clear()` in `beforeEach`. Tests
 * that DO want to exercise the splash / tour / install paths skip
 * this helper and seed their own state.
 */

export const seedOnboardingDismissed = (): void => {
    if (typeof window === "undefined") return;
    // `recent` ensures the dormancy check doesn't re-engage the
    // splash. Both timestamps must be recent (≤ 4 weeks) AND
    // `lastDismissedAt` must be set, otherwise the gate fires.
    const recent = new Date().toISOString();
    window.localStorage.setItem(
        "effect-clue.splash.v1",
        JSON.stringify({
            version: 1,
            lastVisitedAt: recent,
            lastDismissedAt: recent,
        }),
    );
    // `visits: 0` makes the install gate fail even after the
    // per-mount bump (gate requires ≥ 2).
    window.localStorage.setItem(
        "effect-clue.install-prompt.v1",
        JSON.stringify({ version: 1, visits: 0 }),
    );
    // Per-screen tour gates. The combined `checklistSuggest` tour
    // covers both panes; `setup` is the third screen with content.
    // Account / shareImport tours have no content yet so they don't
    // auto-fire regardless of seed.
    const tourSeed = JSON.stringify({
        version: 1,
        lastVisitedAt: recent,
        lastDismissedAt: recent,
    });
    window.localStorage.setItem("effect-clue.tour.setup.v1", tourSeed);
    window.localStorage.setItem(
        "effect-clue.tour.checklistSuggest.v1",
        tourSeed,
    );
    // Sharing tour is a follow-up that fires once both setup +
    // checklistSuggest have been dismissed (which they are, above).
    // Seed its dismissal so component tests don't see it auto-fire on
    // the setup screen.
    window.localStorage.setItem("effect-clue.tour.sharing.v1", tourSeed);
};
