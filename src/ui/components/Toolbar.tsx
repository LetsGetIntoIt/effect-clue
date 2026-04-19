"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useClue } from "../state";

const buttonClass =
    "rounded-[var(--radius)] border border-border bg-white px-3.5 py-1.5 " +
    "text-[13px] cursor-pointer hover:bg-hover " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

/**
 * Top-of-page controls: undo/redo, start a fresh game, and copy a
 * shareable URL encoding the current state.
 */
export function Toolbar() {
    const t = useTranslations("toolbar");
    const { dispatch, currentShareUrl, canUndo, canRedo, undo, redo } =
        useClue();
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

    const onNewGame = () => {
        if (window.confirm(t("newGameConfirm"))) {
            dispatch({ type: "newGame" });
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3">
            <button
                type="button"
                className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={undo}
                disabled={!canUndo}
                title={t("undoTitle")}
                aria-label={t("undoAria")}
            >
                {t("undo")}
            </button>
            <button
                type="button"
                className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={redo}
                disabled={!canRedo}
                title={t("redoTitle")}
                aria-label={t("redoAria")}
            >
                {t("redo")}
            </button>
            <button type="button" className={buttonClass} onClick={onShare}>
                {copied ? t("shareCopied") : t("share")}
            </button>
            <button type="button" className={buttonClass} onClick={onNewGame}>
                {t("newGame")}
            </button>
        </div>
    );
}
