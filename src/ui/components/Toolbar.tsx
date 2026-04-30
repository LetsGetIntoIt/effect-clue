"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { aboutLinkClicked, gameSetupStarted } from "../../analytics/events";
import { startSetup } from "../../analytics/gameSession";
import { describeAction } from "../../logic/describeAction";
import { routes } from "../../routes";
import { useConfirm } from "../hooks/useConfirm";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useClue } from "../state";
import { shortcutSuffix } from "../keyMap";
import { ExternalLinkIcon, RedoIcon, UndoIcon } from "./Icons";
import { OverflowMenu } from "./OverflowMenu";
import { Tooltip } from "./Tooltip";

const buttonClass =
    "rounded-[var(--radius)] border border-border bg-white px-3.5 py-1.5 " +
    "text-[13px] cursor-pointer hover:bg-hover " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

/**
 * Shared handlers for the Share-link and New-game actions. Keeps the
 * clipboard fallback + transient "Copied!" state + confirm-and-dispatch
 * flow in one place so both the desktop Toolbar and the mobile
 * BottomNav overflow menu behave identically.
 */
export function useToolbarActions() {
    const t = useTranslations("toolbar");
    const { dispatch, currentShareUrl } = useClue();
    const confirm = useConfirm();
    const [copied, setCopied] = useState(false);

    const onShare = async () => {
        const url = currentShareUrl();
        if (!url) return;
        try {
            if (navigator?.clipboard) {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } else {
                window.prompt(t("copyFallback"), url);
            }
        } catch {
            window.prompt(t("copyFallback"), url);
        }
    };

    const onNewGame = async () => {
        if (await confirm({ message: t("newGameConfirm") })) {
            startSetup();
            dispatch({ type: "newGame" });
            gameSetupStarted();
        }
    };

    return { onShare, onNewGame, copied };
}

/**
 * Top-of-page controls (desktop only): undo/redo as top-level buttons,
 * plus a ⋯ overflow menu that hosts Game setup, Share link, and New
 * game. Mirrors the mobile `BottomNav` overflow so both breakpoints
 * share the same menu structure.
 */
export function Toolbar() {
    const t = useTranslations("toolbar");
    const tNav = useTranslations("bottomNav");
    const tHistory = useTranslations("history");
    const hasKeyboard = useHasKeyboard();
    const {
        state,
        dispatch,
        canUndo,
        canRedo,
        undo,
        redo,
        nextUndo,
        nextRedo,
    } = useClue();
    const { onShare, onNewGame, copied } = useToolbarActions();

    const undoTooltip = nextUndo
        ? tHistory("undoTooltip", {
              description: describeAction(
                  nextUndo.action,
                  nextUndo.previousState,
                  tHistory,
              ),
          })
        : undefined;
    const redoTooltip = nextRedo
        ? tHistory("redoTooltip", {
              description: describeAction(
                  nextRedo.action,
                  nextRedo.previousState,
                  tHistory,
              ),
          })
        : undefined;

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={undoTooltip}>
                <button
                    type="button"
                    className={`${buttonClass} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={undo}
                    disabled={!canUndo}
                    title={t("undoTitle")}
                    aria-label={t("undoAria")}
                >
                    <UndoIcon size={15} className="shrink-0" />
                    {t("undo", { shortcut: shortcutSuffix("global.undo", hasKeyboard) })}
                </button>
            </Tooltip>
            <Tooltip content={redoTooltip}>
                <button
                    type="button"
                    className={`${buttonClass} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={redo}
                    disabled={!canRedo}
                    title={t("redoTitle")}
                    aria-label={t("redoAria")}
                >
                    <RedoIcon size={15} className="shrink-0" />
                    {t("redo", { shortcut: shortcutSuffix("global.redo", hasKeyboard) })}
                </button>
            </Tooltip>
            <OverflowMenu
                triggerClassName={buttonClass}
                triggerLabel={tNav("more")}
                side="bottom"
                align="end"
                items={[
                    {
                        label: tNav("gameSetup", {
                            shortcut: shortcutSuffix("global.gotoSetup", hasKeyboard),
                        }),
                        active: state.uiMode === "setup",
                        onClick: () =>
                            dispatch({ type: "setUiMode", mode: "setup" }),
                    },
                    {
                        label: copied ? t("shareCopied") : t("share"),
                        onClick: onShare,
                    },
                    {
                        label: t("newGame", {
                            shortcut: shortcutSuffix("global.newGame", hasKeyboard),
                        }),
                        onClick: onNewGame,
                    },
                    {
                        label: tNav("about"),
                        trailingIcon: <ExternalLinkIcon size={14} />,
                        onClick: () => {
                            aboutLinkClicked({ source: "overflow_menu" });
                            window.open(routes.about, "about-page", "noopener");
                        },
                    },
                ]}
            />
        </div>
    );
}
