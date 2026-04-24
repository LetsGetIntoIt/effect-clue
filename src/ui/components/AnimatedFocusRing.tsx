"use client";

import { AnimatePresence, motion } from "motion/react";
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { T_SPRING_SOFT, useReducedTransition } from "../motion";

/**
 * Single focus-ring overlay glued to whichever focusable element
 * currently has keyboard `:focus-visible` AND opts in via
 * `data-animated-focus`. Listens at the document level for focus
 * changes and paints a `<motion.span>` fixed to the viewport, sized
 * and positioned on top of that element via `style` so it tracks the
 * element 1:1 each frame (no spring lag during view-switch slides
 * or layout animations of the focused element itself).
 *
 * Mounted once near the app root. Focus targets annotate themselves
 * with `data-animated-focus`; the global `*:focus-visible` outline
 * is suppressed on those via a scoped selector in globals.css. The
 * ring fades in on first keyboard focus and out when focus leaves
 * an animated-focus target; movement between targets is a snap
 * (position is CSS-bound, not motion-animated).
 *
 * This component renders no layout-affecting DOM — just an
 * `AnimatePresence` that portals the ring via fixed positioning.
 */
interface Rect {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
}

export function AnimatedFocusRing({
    children,
}: {
    readonly groupId?: string;
    readonly children?: ReactNode;
}) {
    const [target, setTarget] = useState<HTMLElement | null>(null);
    const lastActivityWasKeyboard = useRef(false);

    useEffect(() => {
        const evaluate = () => {
            const active = document.activeElement;
            if (
                !(active instanceof HTMLElement) ||
                active.dataset["animatedFocus"] === undefined
            ) {
                setTarget(null);
                return;
            }
            let visible = false;
            try {
                visible = active.matches(":focus-visible");
            } catch {
                visible = lastActivityWasKeyboard.current;
            }
            setTarget(visible ? active : null);
        };

        const onFocusIn = () => evaluate();
        const onFocusOut = () => queueMicrotask(evaluate);
        const onKeyDown = (e: KeyboardEvent) => {
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

        document.addEventListener("focusin", onFocusIn);
        document.addEventListener("focusout", onFocusOut);
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("pointerdown", onPointerDown, true);

        evaluate();

        return () => {
            document.removeEventListener("focusin", onFocusIn);
            document.removeEventListener("focusout", onFocusOut);
            document.removeEventListener("keydown", onKeyDown, true);
            document.removeEventListener("pointerdown", onPointerDown, true);
        };
    }, []);

    return (
        <>
            {children}
            <FocusRingOverlay target={target} />
        </>
    );
}

function FocusRingOverlay({ target }: { readonly target: HTMLElement | null }) {
    const [rect, setRect] = useState<Rect | null>(null);
    const opacityTransition = useReducedTransition(T_SPRING_SOFT);

    useLayoutEffect(() => {
        if (!target) {
            setRect(null);
            return;
        }
        // `getBoundingClientRect` reflects CSS transforms — motion's
        // `layout` prop animates size via transforms, and
        // ResizeObserver only fires when the underlying DOM box size
        // changes, not on transform. So when a focused row expands
        // (e.g. prior suggestion entering edit mode), ResizeObserver
        // would fire once at frame 0 with an inverse-transformed
        // rect, then never again — leaving the ring stuck at the
        // old size. A per-frame rAF loop keeps the ring locked to
        // the current visual rect through layout animations, scroll,
        // and any other transform/size changes. setRect short-
        // circuits when values are unchanged, so steady-state does
        // not trigger renders.
        let rafId = 0;
        const tick = () => {
            const r = target.getBoundingClientRect();
            setRect(prev => {
                if (
                    prev !== null &&
                    prev.top === r.top &&
                    prev.left === r.left &&
                    prev.width === r.width &&
                    prev.height === r.height
                ) {
                    return prev;
                }
                return {
                    top: r.top,
                    left: r.left,
                    width: r.width,
                    height: r.height,
                };
            });
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [target]);

    // Position is CSS-bound — each rAF tick re-renders with the
    // target's current rect in `style`, so the ring tracks the focused
    // element 1:1 with no motion-driven interpolation. Routing
    // top/left/width/height through `animate` instead would let
    // motion's spring chase the previous target's mid-transform rect
    // during a view-switch slide and land offset. Only opacity is
    // motion-animated, for the fade-in/out around focus enter/leave.
    return (
        <AnimatePresence>
            {rect !== null ? (
                <motion.span
                    key="animated-focus-ring"
                    className="pointer-events-none fixed z-30 rounded-[4px]"
                    style={{
                        boxShadow:
                            "0 0 0 2px var(--color-accent), 0 0 0 4px var(--color-panel)",
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={opacityTransition}
                    aria-hidden
                />
            ) : null}
        </AnimatePresence>
    );
}
