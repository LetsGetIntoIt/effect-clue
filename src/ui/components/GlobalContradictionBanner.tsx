"use client";

import { Result } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { T_STANDARD, useReducedTransition } from "../motion";
import { useClue } from "../state";
import { ContradictionBanner } from "./ContradictionBanner";

/**
 * Global contradiction banner pinned to the top of the viewport whenever
 * the deducer detects an inconsistency. `position: fixed` keeps the
 * banner visible regardless of scroll position, and a ResizeObserver
 * writes its current height to `--contradiction-banner-offset` so the
 * surrounding `<main>` can reserve matching top padding (set in
 * `Clue.tsx`). Without the offset the banner would occlude the header.
 *
 * `AnimatePresence` drives slide-down enter + slide-up exit; the
 * offset variable is cleared on exit *complete* so `<main>`'s top
 * padding doesn't collapse while the banner is still on-screen.
 */
export function GlobalContradictionBanner() {
    const { derived } = useClue();
    const result = derived.deductionResult;
    const trace = Result.isFailure(result) ? result.failure : undefined;
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    return (
        <AnimatePresence
            onExitComplete={() => {
                document.documentElement.style.setProperty(
                    "--contradiction-banner-offset",
                    "0px",
                );
            }}
        >
            {trace ? (
                <ContradictionBody key="banner" trace={trace} transition={transition} />
            ) : null}
        </AnimatePresence>
    );
}

function ContradictionBody({
    trace,
    transition,
}: {
    readonly trace: Parameters<typeof ContradictionBanner>[0]["trace"];
    readonly transition: ReturnType<typeof useReducedTransition>;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const root = document.documentElement;
        const write = () =>
            root.style.setProperty(
                "--contradiction-banner-offset",
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <motion.div
            ref={ref}
            role="alert"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={transition}
            className="fixed inset-x-0 top-0 z-50 border-b border-danger-border bg-panel/95 shadow-lg backdrop-blur-sm"
        >
            <div className="mx-auto max-w-[1400px] px-5 pt-3">
                <ContradictionBanner trace={trace} />
            </div>
        </motion.div>
    );
}
