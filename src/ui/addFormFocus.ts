/**
 * Cross-component signal for the global keyboard shortcuts that jump
 * focus to one of the Add-form variants. The keyboard listener lives
 * in `ClueProvider`, but the focus / clear / mode-switch action has
 * to land on the Add-form host inside `SuggestionLogPanel` — which
 * isn't mounted when the user is on the Setup tab. A module-scoped
 * bus with a small pending queue bridges the gap: requests made
 * before the host registers are held briefly, then flushed when it
 * mounts.
 *
 * Two targets are supported:
 *   - `"suggestion"` — focus the suggestion form. Wired to ⌘K.
 *   - `"accusation"` — switch to accusation mode + focus the
 *     accusation form. Wired to ⌘I (in a follow-up commit).
 *
 * The host is responsible for the mode flip (the host owns the tab
 * UI and the AnimatePresence-driven form swap); this bus only
 * delivers the *intent* and a `clear` flag.
 */

import { DateTime, Duration } from "effect";

type Target = "suggestion" | "accusation";

type Handler = (target: Target, options: { readonly clear: boolean }) => void;

let current: Handler | null = null;
let pending: {
    readonly target: Target;
    readonly clear: boolean;
    readonly settle: Duration.Duration;
    readonly requestedAt: DateTime.Utc;
} | null = null;

/**
 * Window of time after a focus request during which the bus will
 * remember and replay the request to a late-arriving handler. Tuned
 * for the worst case of a Setup → Play tab transition that mounts
 * `SuggestionLogPanel` on the next animation frame.
 */
const PENDING_WINDOW: Duration.Duration = Duration.millis(500);

/**
 * Invoke the handler now or after `settle` has elapsed. Callers use
 * the delayed path when a view/pane transition is about to run, so
 * the popover anchored to a pill opens against the pill's final
 * position rather than a mid-slide measurement.
 */
function invokeHandler(
    h: Handler,
    target: Target,
    clear: boolean,
    settle: Duration.Duration,
): void {
    const settleMs = Duration.toMillis(settle);
    if (settleMs > 0) {
        setTimeout(() => h(target, { clear }), settleMs);
    } else {
        h(target, { clear });
    }
}

export function registerAddFormFocusHandler(h: Handler): () => void {
    current = h;
    if (pending !== null) {
        const elapsed = DateTime.distance(pending.requestedAt, DateTime.nowUnsafe());
        if (Duration.isLessThanOrEqualTo(elapsed, PENDING_WINDOW)) {
            const { target, clear, settle } = pending;
            pending = null;
            queueMicrotask(() => invokeHandler(h, target, clear, settle));
        } else {
            pending = null;
        }
    }
    return () => {
        if (current === h) current = null;
    };
}

export function requestFocusAddForm(
    target: Target,
    options: {
        readonly clear: boolean;
        readonly settle?: Duration.Duration;
    },
): void {
    const settle = options.settle ?? Duration.zero;
    if (current !== null) {
        invokeHandler(current, target, options.clear, settle);
    } else {
        pending = {
            target,
            clear: options.clear,
            settle,
            requestedAt: DateTime.nowUnsafe(),
        };
    }
}
