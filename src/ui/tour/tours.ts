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
import type { ScreenKey } from "./TourState";

/**
 * A single step in a tour. The `anchor` resolves to
 * `document.querySelector(`[data-tour-anchor="${anchor}"]`)` at the
 * moment the step becomes active. Missing anchors auto-skip — the
 * tour advances to the next step or dismisses if there's no next.
 *
 * Both `titleKey` and `bodyKey` are next-intl keys under the
 * `onboarding` namespace. They're allowed to be missing in
 * messages — that surfaces a hard error in i18n:check, which is the
 * right discipline.
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
    /** next-intl key under `onboarding.<screenKey>`. */
    readonly bodyKey: string;
    /**
     * Preferred side relative to the anchor. Radix may flip this if
     * there's not enough room. Defaults to `"bottom"`.
     */
    readonly side?: "top" | "right" | "bottom" | "left";
    /** Defaults to `"center"`. */
    readonly align?: "start" | "center" | "end";
}

/**
 * Tour registry. Five screens defined; the `account` and
 * `shareImport` arrays are placeholder entries reserved for M7 / M9.
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
            side: "bottom",
            align: "center",
        },
        {
            anchor: "overflow-menu",
            titleKey: "setup.overflow.title",
            bodyKey: "setup.overflow.body",
            side: "bottom",
            align: "end",
        },
        {
            anchor: "setup-start-playing",
            titleKey: "setup.start.title",
            bodyKey: "setup.start.body",
            side: "top",
            align: "end",
        },
    ],
    checklist: [
        {
            anchor: "checklist-cell",
            titleKey: "checklist.cell.title",
            bodyKey: "checklist.cell.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "checklist-case-file",
            titleKey: "checklist.caseFile.title",
            bodyKey: "checklist.caseFile.body",
            side: "bottom",
            align: "end",
        },
    ],
    suggest: [
        {
            anchor: "suggest-add-form",
            titleKey: "suggest.addForm.title",
            bodyKey: "suggest.addForm.body",
            side: "bottom",
            align: "start",
        },
        {
            anchor: "suggest-prior-log",
            titleKey: "suggest.priorLog.title",
            bodyKey: "suggest.priorLog.body",
            side: "top",
            align: "start",
        },
    ],
    // Reserved for M7 / M9 — no content yet.
    account: [],
    shareImport: [],
};
