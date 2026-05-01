/**
 * Static tour content registry.
 *
 * Each per-screen tour is a list of `TourStep`s the user walks
 * through with Next / Back / Skip. Anchors are CSS-attribute
 * selectors so any component can mark itself as a target with
 * `data-tour-anchor="..."` without threading refs through props.
 *
 * Tour copy lives in `messages/en.json` under the `onboarding`
 * namespace — `<i18n key>` entries here are looked up by the
 * `TourPopover` at render time. Author the copy and add new steps
 * here; the wiring picks up new steps for free.
 */
import type { UiMode } from "../../logic/ClueState";
import type { ScreenKey } from "./TourState";

/**
 * A single step in a tour. The `anchor` resolves to
 * `document.querySelector(`[data-tour-anchor~="${anchor}"]`)` at the
 * moment the step becomes active. Missing anchors auto-skip — the
 * tour advances to the next step or dismisses if there's no next.
 *
 * Both `titleKey` and `bodyKey` are next-intl keys under the
 * `onboarding` namespace. They're allowed to be missing in
 * messages — that surfaces a hard error in i18n:check, which is the
 * right discipline.
 *
 * `requiredUiMode` is consulted by the tour driver before rendering
 * a step: on mobile, `checklist` and `suggest` modes route to
 * different panes, so a step targeting the prior-log needs the
 * `suggest` pane mounted. Desktop renders both panes simultaneously
 * so the dispatch is a no-op.
 */
export interface TourStep {
    /**
     * Identifier matching a `data-tour-anchor="..."` attribute on the
     * target element. Module-internal — choose a stable name and use
     * the same string everywhere.
     */
    readonly anchor: string;
    /** next-intl key under `onboarding.<screenKey>`. */
    readonly titleKey: string;
    /**
     * Optional next-intl key under `onboarding.<screenKey>`. When
     * omitted, the popover renders just the title — useful for
     * short call-to-action steps where no extra body copy is needed.
     */
    readonly bodyKey?: string;
    /**
     * Preferred side relative to the anchor. Radix may flip this if
     * there's not enough room. Defaults to `"bottom"`.
     */
    readonly side?: "top" | "right" | "bottom" | "left";
    /** Defaults to `"center"`. */
    readonly align?: "start" | "center" | "end";
    /**
     * If set, the driver dispatches `setUiMode` to this mode before
     * the step renders so the anchor is mounted in the visible pane.
     */
    readonly requiredUiMode?: UiMode;
    /**
     * Optional next-intl key (under the `onboarding` namespace) used
     * for the "next" button on the LAST step. Defaults to
     * `onboarding.finish` ("Finish"). Use this on a closing step to
     * customize the call-to-action — e.g. "Start playing" for the
     * Checklist & Suggest tour's wrap-up step.
     */
    readonly finishLabelKey?: string;
}

/**
 * Tour registry. Four screens — `setup`, `checklistSuggest`, and
 * placeholder entries `account` / `shareImport` reserved for M7 / M9.
 *
 * The combined `checklistSuggest` tour walks first across the
 * checklist (2 steps) then across the suggest pane (2 steps).
 * `requiredUiMode` flags the suggest-pane steps so the mobile
 * driver flips to the right pane before each.
 */
export const TOURS: Record<ScreenKey, ReadonlyArray<TourStep>> = {
    setup: [
        {
            anchor: "setup-card-pack",
            titleKey: "setup.cardPack.title",
            bodyKey: "setup.cardPack.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "setup-player-column",
            titleKey: "setup.players.title",
            bodyKey: "setup.players.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "setup-hand-size",
            titleKey: "setup.handSize.title",
            bodyKey: "setup.handSize.body",
            side: "bottom",
            align: "center",
        },
        {
            anchor: "setup-known-cell",
            titleKey: "setup.knownCard.title",
            bodyKey: "setup.knownCard.body",
            // The first-player column extends from the top to the
            // bottom of the table. Putting the popover to the right
            // keeps the column itself unobscured so the user can
            // see the cells they're being introduced to.
            side: "right",
            align: "start",
        },
        {
            anchor: "overflow-menu",
            titleKey: "setup.overflow.title",
            bodyKey: "setup.overflow.body",
            // The overflow menu opens vertically from the trigger
            // (downward on desktop, upward on mobile). Anchoring the
            // popover to the LEFT of the trigger keeps the menu
            // contents visible — Radix's collision detection will
            // flip to bottom/top if the left edge runs out of room
            // on a small viewport.
            side: "left",
            align: "start",
        },
        {
            anchor: "setup-start-playing",
            titleKey: "setup.start.title",
            bodyKey: "setup.start.body",
            side: "top",
            align: "end",
        },
    ],
    checklistSuggest: [
        {
            anchor: "checklist-cell",
            titleKey: "checklist.cell.title",
            bodyKey: "checklist.cell.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "checklist",
        },
        {
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
            requiredUiMode: "checklist",
        },
        {
            anchor: "suggest-add-form",
            titleKey: "suggest.addForm.title",
            bodyKey: "suggest.addForm.body",
            side: "bottom",
            align: "start",
            requiredUiMode: "suggest",
        },
        {
            anchor: "suggest-prior-log",
            titleKey: "suggest.priorLog.title",
            bodyKey: "suggest.priorLog.body",
            side: "top",
            align: "start",
            requiredUiMode: "suggest",
        },
        {
            // Wrap-up step. Anchors to the same add-form so the
            // user lands on the input box; the step's CTA renames
            // the "Finish" button to "Start playing" so the close
            // action reads as a continuation, not a chore.
            anchor: "suggest-add-form",
            titleKey: "suggest.ready.title",
            side: "bottom",
            align: "start",
            requiredUiMode: "suggest",
            finishLabelKey: "startPlaying",
        },
    ],
    // Reserved for M7 / M9 — no content yet.
    account: [],
    shareImport: [],
};
