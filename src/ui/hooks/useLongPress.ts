"use client";

import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface LongPressHandlers {
    readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
    readonly onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Fires `onLongPress` after `delayMs` of pointerdown that hasn't moved more
 * than `moveThresholdPx`. Swallows the synthetic click that would otherwise
 * follow the long-press release so that the button's own onClick handler
 * doesn't also fire.
 *
 * Touch-only by default: if you want mice to also trigger long-press, pass
 * `includeMouse`. Normally mice have their own hover affordance (tooltip)
 * and don't need long-press.
 *
 * `onLongPress` is called with the triggering pointerType so callers can
 * tailor the popover position (bottom sheet for touch, anchored popover
 * for mouse).
 */
export function useLongPress(
    onLongPress: (pointerType: string) => void,
    opts: {
        readonly delayMs?: number;
        readonly moveThresholdPx?: number;
        readonly includeMouse?: boolean;
    } = {},
): LongPressHandlers {
    const delayMs = opts.delayMs ?? 500;
    const moveThreshold = opts.moveThresholdPx ?? 8;
    const includeMouse = opts.includeMouse ?? false;

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startRef = useRef<{ x: number; y: number; pointerType: string } | null>(null);
    const firedRef = useRef(false);

    const clearTimer = () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const onPointerDown = useCallback(
        (e: ReactPointerEvent<HTMLElement>) => {
            if (e.pointerType === "mouse" && !includeMouse) return;
            firedRef.current = false;
            startRef.current = {
                x: e.clientX,
                y: e.clientY,
                pointerType: e.pointerType,
            };
            clearTimer();
            timerRef.current = setTimeout(() => {
                firedRef.current = true;
                onLongPress(
                    // eslint-disable-next-line i18next/no-literal-string
                    startRef.current?.pointerType ?? "touch",
                );
            }, delayMs);
        },
        [delayMs, includeMouse, onLongPress],
    );

    const onPointerMove = useCallback(
        (e: ReactPointerEvent<HTMLElement>) => {
            if (!startRef.current) return;
            const dx = e.clientX - startRef.current.x;
            const dy = e.clientY - startRef.current.y;
            if (Math.hypot(dx, dy) > moveThreshold) {
                clearTimer();
                startRef.current = null;
            }
        },
        [moveThreshold],
    );

    const onPointerUp = useCallback(() => {
        clearTimer();
        startRef.current = null;
    }, []);

    const onPointerCancel = useCallback(() => {
        clearTimer();
        startRef.current = null;
        firedRef.current = false;
    }, []);

    const onPointerLeave = useCallback(() => {
        clearTimer();
        startRef.current = null;
    }, []);

    // iOS Safari emits a long-press-triggered contextmenu on some elements.
    // Swallow it so the native "copy/share" callout doesn't appear on our
    // long-press target.
    const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (firedRef.current) e.preventDefault();
    }, []);

    // Eat the synthetic click that follows a fired long-press so the
    // button's primary action doesn't run.
    const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (firedRef.current) {
            e.preventDefault();
            e.stopPropagation();
            firedRef.current = false;
        }
    }, []);

    return {
        onPointerDown,
        onPointerUp,
        onPointerMove,
        onPointerCancel,
        onPointerLeave,
        onContextMenu,
        onClickCapture,
    };
}
