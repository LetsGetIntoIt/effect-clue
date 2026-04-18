"use client";

import { useState } from "react";
import { useClue } from "../state";

const buttonClass =
    "rounded-[var(--radius)] border border-border bg-white px-3.5 py-1.5 " +
    "text-[13px] cursor-pointer hover:bg-[#f0f0f5]";

/**
 * Top-of-page controls: reset the game and copy a shareable URL
 * encoding the current state.
 */
export function Toolbar() {
    const { dispatch, currentShareUrl } = useClue();
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

    const onReset = () => {
        if (
            window.confirm(
                "Clear all known cards, hand sizes, and suggestions?",
            )
        ) {
            dispatch({ type: "resetAll" });
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonClass} onClick={onShare}>
                {copied ? "Copied!" : "Share link"}
            </button>
            <button type="button" className={buttonClass} onClick={onReset}>
                Reset
            </button>
        </div>
    );
}
