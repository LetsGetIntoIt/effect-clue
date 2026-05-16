"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Result } from "effect";
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
import { useConfirm } from "../hooks/useConfirm";
import { useClue } from "../state";
import { useModalStack } from "./ModalStack";

const PROMPT_ID_PREFIX = "teach-mode-prompt" as const;

type MidGameChoice = "keep-explicit" | "adopt-deductions" | "cancel";

/**
 * Imperatively-invoked teach-mode toggle. The overflow menu items
 * (desktop Toolbar + mobile BottomNav) and the setup wizard step call
 * `requestSetTeachMode` — the hook handles confirmation and seeding:
 *
 * - Turning OFF: prompts the user to confirm (exiting teach-mode
 *   reveals all the deductions the solver knows, which can take the
 *   thinking out of the rest of the game). Wizard source skips the
 *   confirm — unchecking the setup-time toggle is low-stakes.
 * - Turning ON from the wizard: skip the prompt, auto-seed the
 *   "free" facts derived from the user's own hand.
 * - Turning ON mid-game: opens a 3-option modal letting the user
 *   pick between keeping their explicit marks (or starting blank
 *   if they have none) and adopting the Clue Solver's current
 *   deductions wholesale.
 */
export function useTeachModeToggle(): (
    enabled: boolean,
    source: "wizard" | "overflowMenu" | "shareImport",
) => void {
    const t = useTranslations("teachMode");
    const tCommon = useTranslations("common");
    const { state, derived, dispatch } = useClue();
    const { push, pop } = useModalStack();
    const confirm = useConfirm();
    const nextIdRef = useRef(0);

    return useCallback(
        (enabled: boolean, source: "wizard" | "overflowMenu" | "shareImport") => {
            if (!enabled) {
                const finishOff = () => {
                    dispatch({ type: "setTeachMode", enabled: false });
                    if (source !== "wizard") {
                        teachModeDisabled({
                            source:
                                source === "shareImport"
                                    ? "shareImport"
                                    : "overflowMenu",
                        });
                    }
                };
                // Wizard source: low-stakes setup-time toggle, no
                // confirm. Other sources: warn the user that exiting
                // teach-mode reveals the solver's deductions and
                // can take the thinking and fun out of the rest of
                // the game.
                if (source === "wizard") {
                    finishOff();
                    return;
                }
                void (async () => {
                    const ok = await confirm({
                        title: t("exitPromptTitle"),
                        message: t("exitPromptBody"),
                        confirmLabel: t("exitPromptConfirm"),
                        cancelLabel: tCommon("cancel"),
                        destructive: true,
                    });
                    if (ok) finishOff();
                })();
                return;
            }

            // Setup wizard: skip the prompt — auto-seed the "free"
            // facts derived from the user's own hand (Y on their
            // column for each card they hold, N on every other
            // player + the case file for the same cards). The user
            // gets these for free without manual marking; they
            // physically have the cards in their hand at the table.
            if (source === "wizard") {
                const seed = seedFromOwnHand(
                    state.knownCards,
                    state.selfPlayerId,
                    state.setup.players,
                    state.handSizes,
                    state.setup.cardSet,
                );
                dispatch({
                    type: "replaceUserDeductions",
                    userDeductions: seed,
                });
                dispatch({ type: "setTeachMode", enabled: true });
                teachModeEnabled({ source });
                return;
            }

            // Mid-game (overflowMenu / shareImport) — open the
            // 3-option prompt. Both choices flip teach-mode on; they
            // differ in what `userDeductions` look like afterwards.
            nextIdRef.current += 1;
            const id = `${PROMPT_ID_PREFIX}-${nextIdRef.current}`;
            const knowledge = Result.isSuccess(derived.deductionResult)
                ? derived.deductionResult.success
                : undefined;

            const resolveChoice = (choice: MidGameChoice) => {
                pop();
                if (choice === "cancel") return;
                dispatch({ type: "setTeachMode", enabled: true });
                if (choice === "adopt-deductions") {
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
                    // "keep-explicit" — user's existing marks stay as
                    // they are (empty if none, prior teach-mode marks
                    // if the user toggled off then on again).
                    teachModeEnabled({
                        source,
                        midGameAction: "previousMarks",
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
                header: (
                    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                        <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                            {t("midGamePromptTitle")}
                        </Dialog.Title>
                    </div>
                ),
                content: (
                    <Dialog.Description className="m-0 px-5 pt-3 pb-3 text-[1rem] leading-normal text-[#2a1f12]">
                        {t("midGamePromptBody")}
                    </Dialog.Description>
                ),
                footer: (
                    <MidGamePromptFooter
                        onResolve={resolveChoice}
                        optionKeepExplicit={t("midGameOptionKeepExplicit")}
                        optionAdoptDeductions={t(
                            "midGameOptionAdoptDeductions",
                        )}
                        optionCancel={tCommon("cancel")}
                    />
                ),
            });
        },
        [
            dispatch,
            derived.deductionResult,
            push,
            pop,
            confirm,
            state.knownCards,
            state.selfPlayerId,
            state.setup.players,
            state.setup.cardSet,
            state.handSizes,
            t,
            tCommon,
        ],
    );
}

function MidGamePromptFooter({
    onResolve,
    optionKeepExplicit,
    optionAdoptDeductions,
    optionCancel,
}: {
    readonly onResolve: (choice: MidGameChoice) => void;
    readonly optionKeepExplicit: string;
    readonly optionAdoptDeductions: string;
    readonly optionCancel: string;
}) {
    const primaryClass =
        "tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 font-semibold border-accent bg-accent text-white hover:bg-accent-hover";
    const cancelClass =
        "tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover";
    return (
        <div className="flex flex-wrap items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
            <button
                type="button"
                onClick={() => onResolve("cancel")}
                className={cancelClass}
            >
                {optionCancel}
            </button>
            <button
                type="button"
                onClick={() => onResolve("keep-explicit")}
                className={primaryClass}
            >
                {optionKeepExplicit}
            </button>
            <button
                type="button"
                onClick={() => onResolve("adopt-deductions")}
                className={primaryClass}
            >
                {optionAdoptDeductions}
            </button>
        </div>
    );
}
