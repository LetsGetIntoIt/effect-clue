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
