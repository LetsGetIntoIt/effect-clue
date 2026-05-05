/**
 * Typed event emitters for PostHog.
 *
 * One named function per event so we never typo a string at a call
 * site and so renaming an event is a TypeScript-checked change. The
 * payload type for each event is defined inline next to the emitter.
 *
 * Event taxonomy (kept in sync with the production-deployment plan):
 *
 *   Lifecycle           : appLoaded
 *   Game-setup funnel   : gameSetupStarted, playerAdded, playerRemoved,
 *                         cardsDealt, gameStarted
 *   Gameplay            : suggestionMade, suggestionDisproven,
 *                         suggestionPassed, cardMarked, deductionRevealed,
 *                         priorSuggestionEdited
 *   Solve outcome       : caseFileSolved (deducer narrowed every category
 *                         to exactly one candidate), gameAbandoned
 *   Feature usage       : whyTooltipOpened, checklistRowClicked,
 *                         undoUsed, redoUsed, settingsOpened,
 *                         languageChanged, localstorageCleared
 *   Onboarding / splash : splashScreenViewed, splashScreenDismissed,
 *                         youtubeEmbedPlayed, aboutLinkClicked
 *   Onboarding tour     : tourStarted, tourStepAdvanced, tourStepViewed,
 *                         tourCompleted, tourDismissed, tourAbandoned,
 *                         tourRestarted
 *   PWA install         : installPrompted, installAccepted,
 *                         installDismissed, installCompleted,
 *                         appLaunchedStandalone
 *   Sharing              : shareCreateStarted, shareCreated,
 *                         shareLinkCopied, shareOpened,
 *                         shareOpenFailed, shareImportStarted,
 *                         shareImported, shareImportDismissed
 *   Performance signals : webVital, deducerRun
 *
 * Several of the splash / install / tour emitters layer PostHog
 * person-property updates (`$set` / `$set_once`) onto the event
 * payload via `withPersonProperties()` — this powers cross-funnel
 * cohort filtering ("did dismissing splash affect setup completion?")
 * without separate identify calls. See `personProperties.ts`.
 *
 * Note: this app is a Clue *solver*, not a Clue *game* — the user records
 * what other players suggested in their physical game, and the deducer
 * tells them what's true. There is no real-life "I make my accusation"
 * moment in the app, and "game finished" only meaningfully happens once
 * the deducer narrows the case file to a single suspect / weapon / room.
 * Both signals collapse into `caseFileSolved`.
 *
 * `$pageview` is auto-emitted by PostHog (capture_pageview: true) so it
 * has no helper here.
 */
"use client";

import { DateTime } from "effect";
import { posthog } from "./posthog";
import {
    personIso,
    withPersonProperties,
    type InstallStatus,
    type SplashStatus,
    type TourStatus,
} from "./personProperties";

const capture = (event: string, props?: Record<string, unknown>): void => {
    if (typeof window === "undefined") return;
    if (!posthog.__loaded) return;
    posthog.capture(event, props);
};

/** Capture-time clock for the `last_*_at` person properties. The
 *  emitter owns its own timestamp — it's strictly an analytics signal,
 *  not a domain timestamp, so we don't take it as a parameter. */
const nowIso = (): string => personIso(DateTime.nowUnsafe());

// ── Lifecycle ─────────────────────────────────────────────────────────────

export const appLoaded = (props: {
    coldStart: boolean;
    language: string;
    appVersion: string;
}): void => capture("app_loaded", props);

// ── Game-setup funnel ─────────────────────────────────────────────────────

export const gameSetupStarted = (): void => capture("game_setup_started");

export const playerAdded = (props: {
    playerCount: number;
    position: number;
}): void => capture("player_added", props);

export const playerRemoved = (props: { playerCount: number }): void =>
    capture("player_removed", props);

export const cardsDealt = (props: {
    playerCount: number;
    totalCards: number;
}): void => capture("cards_dealt", props);

/**
 * Fired when the user opens the "All card packs" typeahead dropdown.
 * Pairs with `cardPackSelected({ source: "search" })` to gauge how
 * often users reach for the dropdown vs. the surface pills — informs
 * whether the pinned-recents limit (currently 3) is right.
 */
export const cardPackPickerOpened = (): void =>
    capture("card_pack_picker_opened");

/**
 * Fired alongside `cardsDealt` whenever a pack is loaded. Distinguishes
 * built-in packs (Classic, Master Detective) from user-saved custom
 * packs, and records which surface the click came from. The canonical
 * funnel step stays `cardsDealt`; this is an additive feature-usage
 * signal.
 */
export const cardPackSelected = (props: {
    packType: "built-in" | "custom";
    source: "pinned" | "recent" | "search";
}): void => capture("card_pack_selected", props);

export const gameStarted = (props: {
    playerCount: number;
    setupDurationMs: number;
}): void => capture("game_started", props);

// ── Gameplay ──────────────────────────────────────────────────────────────

export const suggestionMade = (props: {
    turnNumber: number;
    suspect: string;
    weapon: string;
    room: string;
    suggestingPlayer: string;
}): void => capture("suggestion_made", props);

export const suggestionDisproven = (props: {
    turnNumber: number;
    disprovingPlayer: string;
    cardRevealedToUser: boolean;
}): void => capture("suggestion_disproven", props);

export const suggestionPassed = (props: {
    turnNumber: number;
    passingPlayersCount: number;
}): void => capture("suggestion_passed", props);

export const cardMarked = (props: {
    cardType: "suspect" | "weapon" | "room";
    markType: "has" | "doesnt-have" | "unknown";
    manual: boolean;
}): void => capture("card_marked", props);

export const deductionRevealed = (props: {
    /**
     * The display name of the category the newly-derived cell belongs
     * to. Categories are user-configurable in this app — for a stock
     * Clue game this will be "Suspect", "Weapon", or "Room", but
     * custom decks can be anything. Funnel queries should treat this
     * as a free-form string, not an enum.
     */
    categoryName: string;
    deductionChainLength: number;
}): void => capture("deduction_revealed", props);

export const priorSuggestionEdited = (props: { turnNumber: number }): void =>
    capture("prior_suggestion_edited", props);

// ── Accusation flow ──────────────────────────────────────────────────────
//
// The user logs failed accusations as a separate kind of game event
// (parallel to suggestions). Each event matches a user-visible
// transition in the SuggestionLogPanel: opening the form, submitting,
// editing a prior accusation, or removing one.

export const accusationFormOpened = (props: {
    /**
     * How the user reached the accusation form:
     * - `"toggle_link"`: clicked the inline "log failed accusation
     *   instead" link in the Add-a-suggestion header.
     * - `"accuse_now_banner"`: clicked the "Log this accusation"
     *   button inside the recommender's accuse-now banner (the
     *   case-file is fully pinned).
     */
    source: "toggle_link" | "accuse_now_banner";
}): void => capture("accusation_form_opened", props);

export const accusationLogged = (props: {
    accusationCount: number;
    accuser: string;
    /**
     * `"manual"`: the user filled the form themselves (toggle link).
     * `"deduced_triple"`: the form was prefilled from the recommender's
     * accuse-now banner. Distinguishes intentional follow-ups on a
     * solved case file from regular failed-accusation logging.
     */
    source: "manual" | "deduced_triple";
}): void => capture("accusation_logged", props);

export const priorAccusationEdited = (props: {
    accusationNumber: number;
}): void => capture("prior_accusation_edited", props);

export const accusationRemoved = (props: {
    accusationCount: number;
}): void => capture("accusation_removed", props);

// ── Solve outcome ─────────────────────────────────────────────────────────

export const caseFileSolved = (props: {
    durationMs: number;
    suggestionsCount: number;
}): void => capture("case_file_solved", props);

export const gameAbandoned = (props: {
    durationMs: number;
    turnCount: number;
}): void => capture("game_abandoned", props);

// ── Feature usage ─────────────────────────────────────────────────────────

/**
 * Status of the cell at popover-open time. Mirrors `HypothesisStatus`
 * in `src/logic/Hypothesis.ts` but flattened to a string so the
 * PostHog funnel can group by it without joining anything else.
 *
 *   - `off`           : no hypothesis on this cell, no derivation.
 *   - `active`        : direct hypothesis, joint deduction succeeds.
 *   - `derived`       : value follows from another active hypothesis.
 *   - `confirmed`     : real facts independently prove the hypothesis right.
 *   - `directlyContradicted` : real facts prove the hypothesis wrong.
 *   - `jointlyConflicts`     : solo-OK hypothesis that's part of a conflicting set.
 */
export type CellHypothesisStatus =
    | "off"
    | "active"
    | "derived"
    | "confirmed"
    | "directlyContradicted"
    | "jointlyConflicts";

export const whyTooltipOpened = (props: {
    /** See `deductionRevealed.categoryName` — same free-form rationale. */
    categoryName: string;
    /**
     * `true` when the cell has a real-fact deduction at popover-open
     * time. Now that the popover opens on every play-mode cell (not
     * just deducible ones), this lets the funnel separate "user
     * inspecting a known cell" from "user opening the popover to
     * pin a hypothesis on a blank".
     */
    hasDeduction: boolean;
    /**
     * `true` when the user has already pinned a hypothesis on this
     * exact cell. Lets the funnel measure follow-up engagement —
     * are users re-opening hypothesis cells to revisit them, or
     * setting and forgetting?
     */
    hasHypothesis: boolean;
    status: CellHypothesisStatus;
}): void => capture("why_tooltip_opened", props);

/**
 * Fires every time the user pins or changes a hypothesis (Y / N)
 * via the segmented control or a Y/N keyboard shortcut.
 *
 *   - `value`         : the new value (Y | N).
 *   - `previousValue` : "off" for a fresh pin, "Y" / "N" for a flip.
 *   - `cellStatus`    : the cell's {@link CellHypothesisStatus} *before*
 *                       the action — answers "what was the user looking
 *                       at when they decided to pin?". To recover the
 *                       post-action status, join in PostHog with the
 *                       next `why_tooltip_opened` on the same cell,
 *                       which fires when the user re-inspects it.
 *   - `source`        : "click" (segmented control) | "keyboard"
 *                       (Y / N bare-key shortcuts).
 */
export const hypothesisSet = (props: {
    value: "Y" | "N";
    previousValue: "off" | "Y" | "N";
    cellStatus: CellHypothesisStatus;
    source: "click" | "keyboard";
}): void => capture("hypothesis_set", props);

/**
 * Fires when the user clears a hypothesis (Off via segmented control
 * or the `O` keyboard shortcut). `cellStatus` is the status the cell
 * had immediately before the clear — useful for read-rate dashboards
 * ("are users clearing confirmed hypotheses to tidy up, or clearing
 * contradicted ones to revise?").
 */
export const hypothesisCleared = (props: {
    previousValue: "Y" | "N";
    cellStatus: CellHypothesisStatus;
    source: "click" | "keyboard";
}): void => capture("hypothesis_cleared", props);

export const checklistRowClicked = (props: {
    cardType: "suspect" | "weapon" | "room";
}): void => capture("checklist_row_clicked", props);

export const undoUsed = (props: { turnNumber: number }): void =>
    capture("undo_used", props);

export const redoUsed = (props: { turnNumber: number }): void =>
    capture("redo_used", props);

export const settingsOpened = (): void => capture("settings_opened");

export const languageChanged = (props: { from: string; to: string }): void =>
    capture("language_changed", props);

export const localstorageCleared = (props: { hadActiveGame: boolean }): void =>
    capture("localstorage_cleared", props);

// ── Onboarding / splash ───────────────────────────────────────────────────

/**
 * Fires the moment the splash modal becomes visible. Carries enough
 * context that PostHog dashboards can answer view-rate, reengagement,
 * and "did the user opt out earlier?" questions without joining
 * across separate events.
 *
 * `reengaged` flips true when the user is seeing the splash again
 * after a previous dismissal *and* their `lastVisitedAt` was older
 * than the gate's re-engagement window — i.e. the splash re-fired on
 * its own after the snooze expired. Lets a Trends insight read
 * reengagement view-rate by filtering `reengaged: true`.
 */
export const splashScreenViewed = (props: {
    dismissedBefore: boolean;
    daysSinceLastVisit: number | null;
    reengaged: boolean;
    daysSinceLastDismissal: number | null;
}): void => {
    const at = nowIso();
    const status: SplashStatus = "viewed";
    capture("splash_screen_viewed", {
        ...props,
        ...withPersonProperties(
            {
                splash_status: status,
                last_splash_viewed_at: at,
            },
            { first_splash_viewed_at: at },
        ),
    });
};

export const splashScreenDismissed = (props: {
    method: "start_playing" | "x_button";
    dontShowAgainChecked: boolean;
}): void => {
    const status: SplashStatus = props.dontShowAgainChecked
        ? "dismissed_with_dontshow"
        : "dismissed_no_dontshow";
    capture("splash_screen_dismissed", {
        ...props,
        ...withPersonProperties({
            splash_status: status,
            splash_dont_show_again: props.dontShowAgainChecked,
            last_splash_dismiss_method: props.method,
            last_splash_dismissed_at: nowIso(),
        }),
    });
};

export const youtubeEmbedPlayed = (props: {
    context: "page" | "modal";
}): void => capture("youtube_embed_played", props);

export const aboutLinkClicked = (props: {
    source: "overflow_menu";
}): void => capture("about_link_clicked", props);

// ── Onboarding tour ───────────────────────────────────────────────────────
//
// Per-screen walkthrough (M4). Each event carries `screenKey` so a
// PostHog funnel can break the data out one tour at a time. The
// existing onboarding funnel (game_setup_started → cards_dealt →
// game_started) is wrapped by the setup tour — verify in PostHog that
// completion rate doesn't regress when the tour goes live.

export type TourScreenKey =
    | "setup"
    | "checklistSuggest"
    | "sharing"
    | "firstSuggestion"
    | "account"
    | "shareImport";

/** All the ways a tour can be dismissed before completion.
 * `"backdrop"` was removed in M20 — clicking outside the popover no
 * longer dismisses; users have to explicitly click X / Skip tour /
 * press Esc to bail. */
export type TourDismissVia =
    | "skip"
    | "esc"
    | "close"
    | "anchor_missing";

/** Build the `tour_<screenKey>_status` person-property key for a
 *  given screen. Centralized here so the wire-format string is built
 *  the same way at every emission site. */
const tourStatusKey = (screenKey: TourScreenKey): string =>
    `tour_${screenKey}_status`;

const lastTourStartedAtKey = (screenKey: TourScreenKey): string =>
    `last_tour_${screenKey}_started_at`;

const firstTourStartedAtKey = (screenKey: TourScreenKey): string =>
    `first_tour_${screenKey}_started_at`;

const lastTourCompletedAtKey = (screenKey: TourScreenKey): string =>
    `last_tour_${screenKey}_completed_at`;

const lastTourDismissedAtKey = (screenKey: TourScreenKey): string =>
    `last_tour_${screenKey}_dismissed_at`;

const lastTourStepIndexKey = (screenKey: TourScreenKey): string =>
    `last_tour_${screenKey}_step_index`;

const lastTourAbandonedAtKey = (screenKey: TourScreenKey): string =>
    `last_tour_${screenKey}_abandoned_at`;

export const tourStarted = (props: {
    screenKey: TourScreenKey;
    stepCount: number;
    /** `true` when the user has previously dismissed this tour and
     *  is now seeing it again after the re-engage window. */
    reengaged: boolean;
    /** Days since the previous dismissal, or `null` if the user has
     *  never dismissed this tour before. */
    daysSinceLastDismissal: number | null;
}): void => {
    const at = nowIso();
    const status: TourStatus = "started";
    capture("tour_started", {
        ...props,
        ...withPersonProperties(
            {
                [tourStatusKey(props.screenKey)]: status,
                [lastTourStartedAtKey(props.screenKey)]: at,
            },
            { [firstTourStartedAtKey(props.screenKey)]: at },
        ),
    });
};

export const tourStepAdvanced = (props: {
    screenKey: TourScreenKey;
    fromStep: number;
    toStep: number;
    totalSteps: number;
    direction: "forward" | "back";
}): void => capture("tour_step_advanced", props);

/**
 * Fires once per step the user actually sees, in addition to
 * `tour_step_advanced` which fires on the navigation moment. The
 * step-viewed event is what powers the histogram funnel: a Trends
 * insight grouped by `stepIndex` (and filterable by `screenKey`)
 * auto-discovers new steps as tours change in code, with no
 * dashboard re-config needed.
 */
export const tourStepViewed = (props: {
    screenKey: TourScreenKey;
    stepIndex: number;
    /** The step's `data-tour-anchor` token. Free-form; the histogram
     *  insight slices by `stepIndex`, but `stepId` is what makes
     *  individual rows readable in the PostHog UI. */
    stepId: string;
    totalSteps: number;
    isFirstStep: boolean;
    isLastStep: boolean;
}): void => {
    capture("tour_step_viewed", {
        ...props,
        ...withPersonProperties({
            [lastTourStepIndexKey(props.screenKey)]: props.stepIndex,
        }),
    });
};

export const tourCompleted = (props: {
    screenKey: TourScreenKey;
    totalSteps: number;
}): void => {
    const status: TourStatus = "completed";
    capture("tour_completed", {
        ...props,
        ...withPersonProperties({
            [tourStatusKey(props.screenKey)]: status,
            [lastTourCompletedAtKey(props.screenKey)]: nowIso(),
        }),
    });
};

export const tourDismissed = (props: {
    screenKey: TourScreenKey;
    stepIndex: number;
    totalSteps: number;
    via: TourDismissVia;
}): void => {
    const status: TourStatus =
        props.via === "skip"
            ? "dismissed_skip"
            : props.via === "close"
              ? "dismissed_close"
              : props.via === "esc"
                ? "dismissed_esc"
                : "dismissed_anchor_missing";
    capture("tour_dismissed", {
        ...props,
        ...withPersonProperties({
            [tourStatusKey(props.screenKey)]: status,
            [lastTourDismissedAtKey(props.screenKey)]: nowIso(),
            [lastTourStepIndexKey(props.screenKey)]: props.stepIndex,
        }),
    });
};

/** Fires when a tour is active and the page is unloaded (tab close,
 *  browser back) without the user reaching `tour_completed` /
 *  `tour_dismissed`. Lets the dropoff dashboard cleanly bucket "left
 *  the site" as a third class alongside Skip / Close / Esc. */
export const tourAbandoned = (props: {
    screenKey: TourScreenKey;
    lastStepIndex: number;
    lastStepId: string;
    totalSteps: number;
}): void => {
    const status: TourStatus = "abandoned";
    capture("tour_abandoned", {
        ...props,
        ...withPersonProperties({
            [tourStatusKey(props.screenKey)]: status,
            [lastTourAbandonedAtKey(props.screenKey)]: nowIso(),
            [lastTourStepIndexKey(props.screenKey)]: props.lastStepIndex,
        }),
    });
};

/** Fires on "Restart tour" overflow-menu click before `tourStarted`. */
export const tourRestarted = (props: {
    screenKey: TourScreenKey;
}): void => capture("tour_restarted", props);

// ── PWA install prompt (M5) ───────────────────────────────────────────────
//
// Browser-driven flow. `installPrompted` fires when our in-app modal
// is shown to the user (auto-gate, menu click, or tour). The OS-native
// "Install / Cancel" dialog that comes after is mediated by the browser
// — we don't see its outcome until it resolves; `installAccepted` /
// `installDismissed` cover both branches.

export type InstallPromptTrigger = "auto" | "menu" | "tour";

/** Reasons the user closed the install modal without installing. */
export type InstallDismissVia =
    | "x_button"
    | "snooze"
    | "native_decline";

/**
 * Fires when our in-app install modal opens. `reengaged` flips true
 * when the modal is re-firing after a previous dismissal whose snooze
 * has now elapsed — the same definition the splash uses, so the two
 * dashboards read symmetrically.
 *
 * `visitCount` mirrors the localStorage `visits` counter at the time
 * the modal opens, so the team can read "what fraction of users on
 * their N-th visit see the prompt?" without joining events.
 */
export const installPrompted = (props: {
    trigger: InstallPromptTrigger;
    reengaged: boolean;
    daysSinceLastDismissal: number | null;
    visitCount: number;
}): void => {
    const at = nowIso();
    const status: InstallStatus = "prompted";
    capture("install_prompted", {
        ...props,
        ...withPersonProperties(
            {
                install_status: status,
                last_install_prompted_at: at,
            },
            { first_install_prompted_at: at },
        ),
    });
};

export const installAccepted = (props: {
    trigger: InstallPromptTrigger;
}): void => {
    const status: InstallStatus = "accepted";
    capture("install_accepted", {
        ...props,
        ...withPersonProperties({
            install_status: status,
            last_install_accepted_at: nowIso(),
        }),
    });
};

export const installDismissed = (props: {
    trigger: InstallPromptTrigger;
    via: InstallDismissVia;
}): void => {
    const status: InstallStatus =
        props.via === "native_decline"
            ? "dismissed_native_decline"
            : "dismissed_snoozed";
    capture("install_dismissed", {
        ...props,
        ...withPersonProperties({
            install_status: status,
            last_install_dismiss_via: props.via,
            last_install_dismissed_at: nowIso(),
        }),
    });
};

/** Fires when the browser confirms a successful install (`appinstalled` event). */
export const installCompleted = (): void => {
    const status: InstallStatus = "completed";
    capture("install_completed", {
        ...withPersonProperties({
            install_status: status,
            app_installed: true,
            last_install_completed_at: nowIso(),
        }),
    });
};

/** Fires on every load when `display-mode: standalone` matches — the user
 *  has installed and is launching from the home screen / dock. */
export const appLaunchedStandalone = (): void => {
    capture("app_launched_standalone", {
        ...withPersonProperties({ app_installed: true }),
    });
};

// ── Auth (M7) ─────────────────────────────────────────────────────────────
//
// better-auth + Google OAuth + anonymous plugin. The dev-only
// email/password sign-in does NOT emit any of these events (it's a
// local-only convenience and would skew funnels).

export type AccountModalSource = "menu" | "tour" | "share_import";
export type AuthProvider = "google";
export type SignInFromContext =
    | "menu"
    | "share_import"
    | "save_pack"
    | "sharing";

export const accountModalOpened = (props: {
    state: "anon" | "signedIn";
    via: AccountModalSource;
}): void => capture("account_modal_opened", props);

export const signInStarted = (props: {
    provider: AuthProvider;
    from: SignInFromContext;
}): void => capture("sign_in_started", props);

export const signInCompleted = (props: {
    provider: AuthProvider;
    isFirstTime: boolean;
    wasAnonymous: boolean;
}): void => capture("sign_in_completed", props);

export const signInFailed = (props: {
    provider: AuthProvider;
    reason: string;
}): void => capture("sign_in_failed", props);

export const signOut = (): void => capture("sign_out");

// ── Server-side card packs (M8) ───────────────────────────────────────────

export const localPacksPushedOnSignIn = (props: {
    countPushed: number;
    countAlreadySynced: number;
    countRenamed: number;
    countDeduped: number;
    countPulled: number;
    countFailed: number;
}): void => capture("local_packs_pushed_on_sign_in", props);

export const cardPackSaved = (props: {
    isFirstTime: boolean;
    source: "local" | "share_import";
    syncedToServer: boolean;
}): void => capture("card_pack_saved", props);

export const cardPackDeleted = (props: {
    wasServerBacked: boolean;
}): void => capture("card_pack_deleted", props);

export const cardPackRenamed = (props: {
    wasServerBacked: boolean;
}): void => capture("card_pack_renamed", props);

// ── Sharing flow (M9) ─────────────────────────────────────────────────────
//
// Sender + receiver halves of the server-stored share flow. The
// raw share id (a cuid2) never goes to PostHog — every event
// includes a `shareIdHash` (FNV-1a 32-bit, hex-padded) so funnels
// can correlate a sender's `share_created` to a receiver's
// `share_opened` / `share_imported` without leaking the URL.

export type ShareDismissVia =
    | "x_button"
    | "backdrop"
    | "navigated_away";

export const shareCreateStarted = (): void =>
    capture("share_create_started");

/**
 * Sender created a share. M22: emitted with the new variant taxonomy
 * (`pack` / `invite` / `transfer`) plus a derived `includesProgress`
 * flag (true when the share carries suggestions+accusations — always
 * for `transfer`, optionally for `invite`). The legacy per-section
 * `included*` booleans were dropped — they're now derivable from
 * `kind` + `includesProgress` and recreating them four-way at the call
 * site is needless surface for the funnel queries to track.
 */
export const shareCreated = (props: {
    kind: "pack" | "invite" | "transfer";
    packIsCustom: boolean;
    includesProgress: boolean;
}): void => capture("share_created", props);

export const shareLinkCopied = (): void => capture("share_link_copied");

export const shareOpened = (props: {
    shareIdHash: string;
}): void => capture("share_opened", props);

export const shareOpenFailed = (props: {
    shareIdHash: string;
    reason: "not_found_or_expired";
}): void => capture("share_open_failed", props);

export const shareImportStarted = (props: {
    shareIdHash: string;
}): void => capture("share_import_started", props);

/**
 * Receiver imported a share. M22: receive modal switched from a
 * pick-what-to-import toggle UI to "import everything in the link",
 * so the per-section `included*` flags are gone. We still record
 * which slices the share *contained* (mirrors of the receive-modal
 * bullet list, derived from snapshot column nullability).
 */
export const shareImported = (props: {
    shareIdHash: string;
    hadPack: boolean;
    hadPlayers: boolean;
    hadKnownCards: boolean;
    hadSuggestions: boolean;
    triggeredNewGame: boolean;
    savedPackToAccount: boolean;
}): void => capture("share_imported", props);

export const shareImportDismissed = (props: {
    shareIdHash: string;
    via: ShareDismissVia;
}): void => capture("share_import_dismissed", props);

export const shareSignInRedirect = (props: {
    shareIdHash: string;
}): void => capture("share_sign_in_redirect", props);

export const shareSignInResumed = (props: {
    shareIdHash: string;
    restoredChoices: boolean;
}): void => capture("share_sign_in_resumed", props);

// ── Performance signals ───────────────────────────────────────────────────

export const webVital = (props: {
    name: "lcp" | "inp" | "cls" | "ttfb" | "fcp";
    value: number;
    rating: "good" | "needs-improvement" | "poor";
}): void => capture(`web_vital_${props.name}`, props);

export const deducerRun = (props: {
    durationMs: number;
    cardCount: number;
    result: "success" | "error";
}): void => capture("deducer_run", props);
