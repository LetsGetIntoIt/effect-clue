/**
 * Press-delay hook for `Reorder.Item` drags. Pairs with Framer
 * Motion's `useDragControls` (`dragListener={false}` +
 * `dragControls={controls}` on the item) to gate drag activation
 * behind a short hold.
 *
 * Why: `Reorder.Item`'s default auto-listener grabs every pointer-
 * down on the item, so a casual swipe inside a modal body whose row
 * IS the drag target can never scroll the body — the row eats the
 * touch immediately. With this hook, the touch sits idle for
 * `REORDER_PRESS_DELAY` milliseconds before drag activates. Casual
 * swipes (which move more than `REORDER_PRESS_TOLERANCE_PX` before
 * the timer fires) cancel the pending drag and pass through to the
 * browser's natural scroll. Same model as dnd-kit's `PointerSensor`
 * `activationConstraint`.
 *
 * Usage:
 *   const controls = useDragControls();
 *   const press = useReorderPressDelay(controls);
 *   return (
 *     <Reorder.Item
 *       dragListener={false}
 *       dragControls={controls}
 *       style={{ touchAction: "pan-y" }}
 *       {...press}
 *     >...</Reorder.Item>
 *   );
 *
 * The accompanying CSS rule `touch-action: pan-y` is load-bearing:
 * it tells the browser "vertical scroll is mine until JS tells you
 * otherwise." Once `controls.start(event)` fires, Framer's drag
 * system takes over and the row tracks the pointer. Without
 * `pan-y`, the browser still won't scroll on touchmove inside the
 * row even before the timer fires (the previous bug).
 */
import { Duration } from "effect";
import { Reorder, useDragControls, type DragControls } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

// 250ms is the iOS-native drag-press delay; long enough that a flick
// swipe-scroll never accidentally arms a drag, short enough that a
// deliberate press-and-hold feels responsive. Matches dnd-kit's
// default `PointerSensor` delay.
const REORDER_PRESS_DELAY = Duration.millis(250);

// Pixels of pointer movement (Euclidean distance from press origin)
// that cancels the pending drag-start. A finger naturally jitters
// 1-3 px on touchdown; a deliberate swipe usually clears 8 px within
// the first frame. The Checklist's long-press uses 10 px, but
// reorder benefits from a tighter window because the user's
// "scroll" intent is the dominant case.
const REORDER_PRESS_TOLERANCE_PX = 8;

// CSS selector for interactive children that should never arm the
// press timer. Pressing a trash / arrow button, or focusing an
// input, must not stage a drag.
const INTERACTIVE_SELECTOR =
    "button, input, textarea, select, a, [contenteditable]";

interface PressHandlers {
    readonly onPointerDown: (e: React.PointerEvent) => void;
    readonly onPointerMove: (e: React.PointerEvent) => void;
    readonly onPointerUp: () => void;
    readonly onPointerCancel: () => void;
}

export function useReorderPressDelay(
    controls: DragControls,
): PressHandlers {
    const timerRef = useRef<number | null>(null);
    const originRef = useRef<{ x: number; y: number } | null>(null);

    const cancel = (): void => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        originRef.current = null;
    };

    useEffect(() => () => cancel(), []);

    return {
        onPointerDown: (event) => {
            // Skip interactive children — let the button / input handle
            // the press itself. Without this, long-holding a trash
            // button would arm the timer and slide into a drag mid-
            // press.
            const target = event.target as Element | null;
            if (target?.closest(INTERACTIVE_SELECTOR)) return;
            originRef.current = { x: event.clientX, y: event.clientY };
            // Capture the event so the timer callback can replay it
            // into `controls.start` — Framer needs a real pointer
            // event to seed the drag.
            const capturedEvent = event;
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                controls.start(capturedEvent);
            }, Duration.toMillis(REORDER_PRESS_DELAY));
        },
        onPointerMove: (event) => {
            if (timerRef.current === null) return;
            const origin = originRef.current;
            if (origin === null) return;
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if (Math.hypot(dx, dy) > REORDER_PRESS_TOLERANCE_PX) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
    };
}

/**
 * `Reorder.Item` wrapper that gates drag activation behind the
 * press-delay above. Drop-in replacement: pass `value`, `onDragEnd`,
 * `className`, and children — internally calls `useDragControls` and
 * wires the manual `dragListener={false}` + `dragControls` + press
 * handlers. `touch-action: pan-y` is set inline so the browser owns
 * vertical scroll until the timer fires.
 *
 * Note that this component is generic over the reorder value type;
 * Framer's `Reorder.Item` exposes the same generic via its `value`
 * prop, so consumers get the full TypeScript inference.
 */
export function DelayedReorderItem<T>({
    value,
    onDragEnd,
    className,
    children,
}: {
    readonly value: T;
    readonly onDragEnd?: () => void;
    readonly className?: string;
    readonly children: ReactNode;
}) {
    const controls = useDragControls();
    const press = useReorderPressDelay(controls);
    return (
        <Reorder.Item
            value={value}
            dragListener={false}
            dragControls={controls}
            {...(onDragEnd !== undefined ? { onDragEnd } : {})}
            {...(className !== undefined ? { className } : {})}
            style={{ touchAction: "pan-y" }}
            {...press}
        >
            {children}
        </Reorder.Item>
    );
}
