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
 * Sliding focus ring overlay. Listens at the document level for
 * keyboard focus changes; paints a single `<motion.span>` fixed to
 * the viewport, sized and positioned over whichever focusable
 * element currently has keyboard `:focus-visible` AND opts in via
 * `data-animated-focus`.
 *
 * Mounted once near the app root. Focus targets annotate themselves
 * with `data-animated-focus`; the global `*:focus-visible` outline
 * is suppressed on those via a scoped selector in globals.css. The
 * result: a single ring that slides across the entire app as focus
 * moves between cells, pills, and list items — fading in on first
 * keyboard focus, out when focus leaves animated-focus targets.
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
    const transition = useReducedTransition(T_SPRING_SOFT);

    useLayoutEffect(() => {
        if (!target) {
            setRect(null);
            return;
        }
        const measure = () => {
            const r = target.getBoundingClientRect();
            setRect({
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
            });
        };
        measure();

        window.addEventListener("scroll", measure, true);
        window.addEventListener("resize", measure);
        const ro = new ResizeObserver(measure);
        ro.observe(target);
        return () => {
            window.removeEventListener("scroll", measure, true);
            window.removeEventListener("resize", measure);
            ro.disconnect();
        };
    }, [target]);

    return (
        <AnimatePresence>
            {rect !== null ? (
                <motion.span
                    key="animated-focus-ring"
                    className="pointer-events-none fixed z-30 rounded-[4px]"
                    style={{
                        boxShadow:
                            "0 0 0 2px var(--color-accent), 0 0 0 4px var(--color-panel)",
                    }}
                    initial={{
                        opacity: 0,
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                    }}
                    animate={{
                        opacity: 1,
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                    }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    aria-hidden
                />
            ) : null}
        </AnimatePresence>
    );
}
