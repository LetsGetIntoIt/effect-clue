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
 *                         suggestionPassed, accusationMade, cardMarked,
 *                         deductionRevealed, priorSuggestionEdited
 *   Game close-out      : gameFinished, gameAbandoned
 *   Feature usage       : whyTooltipOpened, checklistRowClicked,
 *                         undoUsed, redoUsed, settingsOpened,
 *                         languageChanged, localstorageCleared
 *   Performance signals : webVital, deducerRun
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
    dealMethod: "auto" | "manual";
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

export const accusationMade = (props: {
    turnNumber: number;
    correct: boolean;
    suspect: string;
    weapon: string;
    room: string;
}): void => capture("accusation_made", props);

export const cardMarked = (props: {
    cardType: "suspect" | "weapon" | "room";
    markType: "has" | "doesnt-have" | "unknown";
    manual: boolean;
}): void => capture("card_marked", props);

export const deductionRevealed = (props: {
    cardType: "suspect" | "weapon" | "room";
    deductionChainLength: number;
}): void => capture("deduction_revealed", props);

export const priorSuggestionEdited = (props: { turnNumber: number }): void =>
    capture("prior_suggestion_edited", props);

// ── Game close-out ────────────────────────────────────────────────────────

export const gameFinished = (props: {
    outcome: "solved" | "wrong-accusation" | "abandoned";
    durationMs: number;
    turnCount: number;
    accusationAttempts: number;
}): void => capture("game_finished", props);

export const gameAbandoned = (props: {
    durationMs: number;
    turnCount: number;
}): void => capture("game_abandoned", props);

// ── Feature usage ─────────────────────────────────────────────────────────

export const whyTooltipOpened = (props: {
    deductionId: string;
    cardType: "suspect" | "weapon" | "room";
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
