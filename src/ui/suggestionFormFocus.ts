/**
 * Cross-component signal for the Cmd/Ctrl+K shortcut. The global
 * keyboard listener lives in `ClueProvider`, but the focus/clear
 * action has to land on `SuggestionForm` — which isn't mounted when
 * the user is on the Setup tab. A module-scoped bus with a small
 * pending queue bridges the gap: requests made before the form
 * registers are held briefly, then flushed when it mounts.
 */

type Handler = (options: { clear: boolean }) => void;

let current: Handler | null = null;
let pending: {
    clear: boolean;
    settleMs: number;
    expiresAt: number;
} | null = null;

const PENDING_WINDOW_MS = 500;

/**
 * Invoke the handler now or after `settleMs` milliseconds. Callers use
 * the delayed path when a view/pane transition is about to run, so the
 * popover anchored to the Suggester pill opens against the pill's final
 * position rather than a mid-slide measurement.
 */
function invokeHandler(h: Handler, clear: boolean, settleMs: number): void {
    if (settleMs > 0) {
        setTimeout(() => h({ clear }), settleMs);
    } else {
        h({ clear });
    }
}

export function registerSuggestionFormFocusHandler(h: Handler): () => void {
    current = h;
    if (pending && Date.now() < pending.expiresAt) {
        const { clear, settleMs } = pending;
        pending = null;
        queueMicrotask(() => invokeHandler(h, clear, settleMs));
    } else {
        pending = null;
    }
    return () => {
        if (current === h) current = null;
    };
}

export function requestFocusSuggestionForm(options: {
    clear: boolean;
    settleMs?: number;
}): void {
    const settleMs = options.settleMs ?? 0;
    if (current) {
        invokeHandler(current, options.clear, settleMs);
    } else {
        pending = {
            clear: options.clear,
            settleMs,
            expiresAt: Date.now() + PENDING_WINDOW_MS,
        };
    }
}
