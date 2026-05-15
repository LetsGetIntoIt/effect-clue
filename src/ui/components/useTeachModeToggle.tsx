"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { HashMap, Result } from "effect";
import { useTranslations } from "next-intl";
import { useCallback, useRef } from "react";
import {
    seedFromKnowledge,
    seedFromOwnHand,
} from "../../logic/TeachMode";
import {
    teachModeDisabled,
    teachModeEnabled,
} from "../../analytics/events";
import { useClue } from "../state";
import { useModalStack } from "./ModalStack";

const PROMPT_ID_PREFIX = "teach-mode-prompt" as const;

type MidGameChoice = "blank-or-previous" | "keep-deduced" | "cancel";

/**
 * Imperatively-invoked teach-mode toggle. The overflow menu items
 * (desktop Toolbar + mobile BottomNav) call `requestSetTeachMode` —
 * the hook handles the mid-game prompt internally:
 *
 * - Turning OFF: dispatch immediately, no prompt. `userDeductions`
 *   persist so toggling back on restores the user's marks.
 * - Turning ON: always prompt with a 3-option modal:
 *   - "Start blank" / "Start with my previous marks" (label depends
 *     on whether `userDeductions` is currently empty) → preserve
 *     existing marks or leave empty.
 *   - "Keep what we've deduced" → snapshot the real-only deducer
 *     output into `userDeductions` (overwriting any existing marks
 *     when non-empty).
 *   - "Cancel" → abort, don't toggle.
 *
 * The prompt's body copy explains what teach-mode does on the first
 * activation, and explains the "replacing your marks" implication
 * when the user has previous marks.
 */
export function useTeachModeToggle(): (
    enabled: boolean,
    source: "wizard" | "overflowMenu" | "shareImport",
) => void {
    const t = useTranslations("teachMode");
    const { state, derived, dispatch } = useClue();
    const { push, pop } = useModalStack();
    const nextIdRef = useRef(0);

    return useCallback(
        (enabled: boolean, source: "wizard" | "overflowMenu" | "shareImport") => {
            if (!enabled) {
                dispatch({ type: "setTeachMode", enabled: false });
                if (source !== "wizard") {
                    teachModeDisabled({
                        source:
                            source === "shareImport"
                                ? "shareImport"
                                : "overflowMenu",
                    });
                }
                return;
            }

            // Setup wizard: skip the prompt — auto-seed the "free"
            // facts derived from the user's own hand (Y on their
            // column for each card they hold, N on every other
            // player + the case file for the same cards). The user
            // gets these for free without manual marking; they
            // physically have the cards in their hand at the
            // table. This matches user intuition during setup,
            // where there's no in-progress work to preserve and a
            // three-option prompt would be friction.
            if (source === "wizard") {
                const seed = seedFromOwnHand(
                    state.knownCards,
                    state.selfPlayerId,
                    state.setup.players,
                );
                dispatch({
                    type: "replaceUserDeductions",
                    userDeductions: seed,
                });
                dispatch({ type: "setTeachMode", enabled: true });
                teachModeEnabled({ source });
                return;
            }

            // Mid-game (overflowMenu / shareImport) — prompt the
            // user. Preserves any prior teach-mode marks the user
            // worked through before toggling off.
            nextIdRef.current += 1;
            const id = `${PROMPT_ID_PREFIX}-${nextIdRef.current}`;
            const hasMarks = HashMap.size(state.userDeductions) > 0;
            const knowledge = Result.isSuccess(derived.deductionResult)
                ? derived.deductionResult.success
                : undefined;

            const resolveChoice = (choice: MidGameChoice) => {
                pop();
                if (choice === "cancel") return;
                dispatch({ type: "setTeachMode", enabled: true });
                if (choice === "keep-deduced") {
                    if (knowledge !== undefined) {
                        dispatch({
                            type: "replaceUserDeductions",
                            userDeductions: seedFromKnowledge(knowledge),
                        });
                    }
                    teachModeEnabled({
                        source,
                        midGameAction: "keepDeduced",
                    });
                } else {
                    // "blank-or-previous" — when marks are empty, this
                    // means "start blank" (no-op on userDeductions).
                    // When marks are non-empty, this means "keep my
                    // previous marks" (no-op on userDeductions).
                    teachModeEnabled({
                        source,
                        midGameAction: hasMarks ? "previousMarks" : "blank",
                    });
                }
            };

            push({
                id,
                title: t("midGamePromptTitle"),
                dismissOnOutsideClick: false,
                dismissOnEscape: false,
                maxWidth: "min(90vw,460px)",
                onClose: () => {
                    // Defensive — clear without side effects if popTo
                    // closes us from outside.
                },
                content: (
                    <MidGamePromptContent
                        hasMarks={hasMarks}
                        onResolve={resolveChoice}
                        title={t("midGamePromptTitle")}
                        bodyEmpty={t("midGamePromptBodyEmpty")}
                        bodyHasMarks={t("midGamePromptBodyHasMarks")}
                        optionBlank={t("midGameOptionBlank")}
                        optionPreviousMarks={t("midGameOptionPreviousMarks")}
                        optionKeepDeduced={t("midGameOptionKeepDeduced")}
                        optionKeepDeducedOverwrite={t(
                            "midGameOptionKeepDeducedOverwrite",
                        )}
                        optionCancel={t("midGameOptionCancel")}
                    />
                ),
            });
        },
        [
            dispatch,
            derived.deductionResult,
            push,
            pop,
            state.userDeductions,
            state.knownCards,
            state.selfPlayerId,
            state.setup.players,
            t,
        ],
    );
}

function MidGamePromptContent({
    hasMarks,
    onResolve,
    title,
    bodyEmpty,
    bodyHasMarks,
    optionBlank,
    optionPreviousMarks,
    optionKeepDeduced,
    optionKeepDeducedOverwrite,
    optionCancel,
}: {
    readonly hasMarks: boolean;
    readonly onResolve: (choice: MidGameChoice) => void;
    readonly title: string;
    readonly bodyEmpty: string;
    readonly bodyHasMarks: string;
    readonly optionBlank: string;
    readonly optionPreviousMarks: string;
    readonly optionKeepDeduced: string;
    readonly optionKeepDeducedOverwrite: string;
    readonly optionCancel: string;
}) {
    return (
        <div className="flex flex-col gap-4">
            <Dialog.Title className="m-0 mb-1 font-display text-[1.125rem] text-accent">
                {title}
            </Dialog.Title>
            <Dialog.Description className="m-0 text-[1.125rem] leading-snug text-fg">
                {hasMarks ? bodyHasMarks : bodyEmpty}
            </Dialog.Description>
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={() => onResolve("blank-or-previous")}
                    className="cursor-pointer rounded border border-border bg-control px-3 py-2 text-left text-[1.125rem] font-semibold text-fg hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {hasMarks ? optionPreviousMarks : optionBlank}
                </button>
                <button
                    type="button"
                    onClick={() => onResolve("keep-deduced")}
                    className="cursor-pointer rounded border border-border bg-control px-3 py-2 text-left text-[1.125rem] font-semibold text-fg hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {hasMarks ? optionKeepDeducedOverwrite : optionKeepDeduced}
                </button>
                <button
                    type="button"
                    onClick={() => onResolve("cancel")}
                    className="mt-2 cursor-pointer rounded border border-transparent px-3 py-1.5 text-[1.125rem] text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {optionCancel}
                </button>
            </div>
        </div>
    );
}
