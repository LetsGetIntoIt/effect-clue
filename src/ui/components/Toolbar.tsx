"use client";

import { useState } from "react";
import { useClue } from "../state";

const buttonClass =
    "rounded-[var(--radius)] border border-border bg-white px-3.5 py-1.5 " +
    "text-[13px] cursor-pointer hover:bg-hover";

/**
 * Top-of-page controls: undo/redo, start a fresh game, and copy a
 * shareable URL encoding the current state.
 */
export function Toolbar() {
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
                window.prompt("Copy this URL:", url);
            }
        } catch {
            window.prompt("Copy this URL:", url);
        }
    };

    const onNewGame = () => {
        if (
            window.confirm(
                "Start a new game? This will clear all players, cards, " +
                "known hands, and suggestions.",
            )
        ) {
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
                title="Undo (⌘Z / Ctrl+Z)"
                aria-label="Undo"
            >
                ↶ Undo
            </button>
            <button
                type="button"
                className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⌘⇧Z / Ctrl+Shift+Z)"
                aria-label="Redo"
            >
                ↷ Redo
            </button>
            <button type="button" className={buttonClass} onClick={onShare}>
                {copied ? "Copied!" : "Share link"}
            </button>
            <button type="button" className={buttonClass} onClick={onNewGame}>
                New game
            </button>
        </div>
    );
}
