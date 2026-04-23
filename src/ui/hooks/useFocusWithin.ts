"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Track which descendant of a scope currently holds `:focus-visible`
 * keyboard focus. Returns the focused element (or null if focus is
 * elsewhere).
 *
 * Used by `AnimatedFocusRing` to decide which child in a scope
 * paints the sliding ring. Mouse clicks focus elements but do NOT
 * trigger `:focus-visible`; only keyboard navigation does. That
 * matches the native browser focus-ring behavior.
 *
 * Implementation notes:
 *   - We listen to `focusin` / `focusout` on the scope container, then
 *     check `document.activeElement.matches(':focus-visible')` to filter
 *     out mouse-driven focus.
 *   - We also re-evaluate on `keydown` within the scope — arrow-key
 *     navigation that programmatically calls `el.focus()` should
 *     reveal the ring even if the original focus was mouse-driven.
 */
export function useFocusWithin(
    scopeRef: React.RefObject<HTMLElement | null>,
): Element | null {
    const [focused, setFocused] = useState<Element | null>(null);
    const lastActivityWasKeyboard = useRef(false);

    useEffect(() => {
        const scope = scopeRef.current;
        if (!scope) return;

        const evaluate = () => {
            const active = document.activeElement;
            if (!active || !scope.contains(active)) {
                setFocused(null);
                return;
            }
            // `:focus-visible` is the canonical signal. Fall back to
            // lastActivityWasKeyboard for browsers that don't support
            // it natively (all modern browsers do, but the fallback is
            // cheap).
            let visible = false;
            try {
                visible = active.matches(":focus-visible");
            } catch {
                visible = lastActivityWasKeyboard.current;
            }
            setFocused(visible ? active : null);
        };

        const onFocusIn = () => evaluate();
        const onFocusOut = () => {
            // focusout fires before the new element is focused, so defer.
            queueMicrotask(evaluate);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            // Tab, arrow keys, enter, space — any of these indicate
            // keyboard activity. Re-evaluate so a programmatic focus
            // move (e.g. arrow-key grid nav) shows the ring.
            if (
                e.key === "Tab" ||
                e.key.startsWith("Arrow") ||
                e.key === "Enter" ||
                e.key === " "
            ) {
                lastActivityWasKeyboard.current = true;
                queueMicrotask(evaluate);
            }
        };
        const onPointerDown = () => {
            lastActivityWasKeyboard.current = false;
            queueMicrotask(evaluate);
        };

        scope.addEventListener("focusin", onFocusIn);
        scope.addEventListener("focusout", onFocusOut);
        scope.addEventListener("keydown", onKeyDown);
        scope.addEventListener("pointerdown", onPointerDown);

        evaluate();

        return () => {
            scope.removeEventListener("focusin", onFocusIn);
            scope.removeEventListener("focusout", onFocusOut);
            scope.removeEventListener("keydown", onKeyDown);
            scope.removeEventListener("pointerdown", onPointerDown);
        };
    }, [scopeRef]);

    return focused;
}
