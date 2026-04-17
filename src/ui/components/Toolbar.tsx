import { useState } from "preact/hooks";
import {
    currentShareUrl,
    explanationsEnabledSignal,
    resetAll,
} from "../state";

/**
 * Top-of-page controls: toggle inference explanations, reset the game,
 * and copy a shareable URL encoding the current state.
 */
export function Toolbar() {
    const [copied, setCopied] = useState(false);

    const onShare = async () => {
        const url = currentShareUrl();
        if (!url) return;
        try {
            if (navigator && navigator.clipboard) {
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
        if (window.confirm("Clear all known cards, hand sizes, and suggestions?")) {
            resetAll();
        }
    };

    return (
        <div class="toolbar">
            <label>
                <input
                    type="checkbox"
                    checked={explanationsEnabledSignal.value}
                    onChange={e => {
                        explanationsEnabledSignal.value =
                            (e.target as HTMLInputElement).checked;
                    }}
                />
                &nbsp;Show "why?" explanations
            </label>
            <button type="button" onClick={onShare}>
                {copied ? "Copied!" : "Share link"}
            </button>
            <button type="button" onClick={onReset}>Reset</button>
        </div>
    );
}
