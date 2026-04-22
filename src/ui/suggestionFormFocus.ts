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
let pending: { clear: boolean; expiresAt: number } | null = null;

const PENDING_WINDOW_MS = 500;

export function registerSuggestionFormFocusHandler(h: Handler): () => void {
    current = h;
    if (pending && Date.now() < pending.expiresAt) {
        const { clear } = pending;
        pending = null;
        queueMicrotask(() => h({ clear }));
    } else {
        pending = null;
    }
    return () => {
        if (current === h) current = null;
    };
}

export function requestFocusSuggestionForm(options: { clear: boolean }): void {
    if (current) {
        current(options);
    } else {
        pending = {
            clear: options.clear,
            expiresAt: Date.now() + PENDING_WINDOW_MS,
        };
    }
}
