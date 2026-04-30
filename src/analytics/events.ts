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
 *   Performance signals : webVital, deducerRun
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

import { posthog } from "./posthog";

const capture = (event: string, props?: Record<string, unknown>): void => {
    if (typeof window === "undefined") return;
    if (!posthog.__loaded) return;
    posthog.capture(event, props);
};

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

export const whyTooltipOpened = (props: {
    /** See `deductionRevealed.categoryName` — same free-form rationale. */
    categoryName: string;
}): void => capture("why_tooltip_opened", props);

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

export const splashScreenViewed = (props: {
    dismissedBefore: boolean;
    daysSinceLastVisit: number | null;
}): void => capture("splash_screen_viewed", props);

export const splashScreenDismissed = (props: {
    method: "start_playing" | "x_button";
    dontShowAgainChecked: boolean;
}): void => capture("splash_screen_dismissed", props);

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
    | "checklist"
    | "suggest"
    | "account"
    | "shareImport";

/** All the ways a tour can be dismissed before completion. */
export type TourDismissVia =
    | "skip"
    | "esc"
    | "backdrop"
    | "close"
    | "anchor_missing";

export const tourStarted = (props: {
    screenKey: TourScreenKey;
    stepCount: number;
}): void => capture("tour_started", props);

export const tourStepAdvanced = (props: {
    screenKey: TourScreenKey;
    fromStep: number;
    toStep: number;
    totalSteps: number;
    direction: "forward" | "back";
}): void => capture("tour_step_advanced", props);

export const tourCompleted = (props: {
    screenKey: TourScreenKey;
    totalSteps: number;
}): void => capture("tour_completed", props);

export const tourDismissed = (props: {
    screenKey: TourScreenKey;
    stepIndex: number;
    totalSteps: number;
    via: TourDismissVia;
}): void => capture("tour_dismissed", props);

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

export const installPrompted = (props: {
    trigger: InstallPromptTrigger;
}): void => capture("install_prompted", props);

export const installAccepted = (props: {
    trigger: InstallPromptTrigger;
}): void => capture("install_accepted", props);

export const installDismissed = (props: {
    trigger: InstallPromptTrigger;
    via: InstallDismissVia;
}): void => capture("install_dismissed", props);

/** Fires when the browser confirms a successful install (`appinstalled` event). */
export const installCompleted = (): void =>
    capture("install_completed");

/** Fires on every load when `display-mode: standalone` matches — the user
 *  has installed and is launching from the home screen / dock. */
export const appLaunchedStandalone = (): void =>
    capture("app_launched_standalone");

// ── Auth (M7) ─────────────────────────────────────────────────────────────
//
// better-auth + Google OAuth + anonymous plugin. The dev-only
// email/password sign-in does NOT emit any of these events (it's a
// local-only convenience and would skew funnels).

export type AccountModalSource = "menu" | "tour" | "share_import";
export type AuthProvider = "google";
export type SignInFromContext = "menu" | "share_import" | "save_pack";

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

export const shareCreated = (props: {
    includedPack: boolean;
    includedPlayers: boolean;
    includedKnownCards: boolean;
    includedSuggestions: boolean;
    packIsCustom: boolean;
    requiresAuth: boolean;
}): void => capture("share_created", props);

export const shareLinkCopied = (): void => capture("share_link_copied");

export const shareOpened = (props: {
    shareIdHash: string;
}): void => capture("share_opened", props);

export const shareImportStarted = (props: {
    shareIdHash: string;
}): void => capture("share_import_started", props);

export const shareImported = (props: {
    shareIdHash: string;
    includedPack: boolean;
    includedPlayers: boolean;
    includedKnownCards: boolean;
    includedSuggestions: boolean;
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
