"use client";

import { Result } from "effect";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { T_STANDARD, useReducedTransition } from "../motion";
import { useClue } from "../state";
import {
    ContradictionBanner,
    JointHypothesisContradictionBanner,
} from "./ContradictionBanner";

// AnimatePresence keys hoisted to module scope so `no-literal-string`
// reads them as code, not UI text.
const KEY_REAL = "real" as const;
const KEY_JOINT = "joint" as const;

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
 *
 * Two failure modes share this chrome:
 *   1. Real-deduction failure (the canonical fact set is inconsistent)
 *      — wins precedence. Once real is broken there's no point reasoning
 *      about hypotheses on top of it.
 *   2. Hypothesis conflict (real is fine, but at least one hypothesis
 *      is rejected). The body distinguishes "conflicts with a known
 *      fact" from "can't all be true together" via the
 *      `hypothesisConflict.kind` discriminator and offers per-row
 *      "Turn off" CTAs.
 */
export function GlobalContradictionBanner() {
    const { derived } = useClue();
    const result = derived.deductionResult;
    const realTrace = Result.isFailure(result) ? result.failure : undefined;
    const conflict = derived.hypothesisConflict;
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    const bodyKey = realTrace ? KEY_REAL : conflict ? KEY_JOINT : undefined;

    return (
        <AnimatePresence
            onExitComplete={() => {
                document.documentElement.style.setProperty(
                    "--contradiction-banner-offset",
                    "0px",
                );
            }}
        >
            {bodyKey === KEY_REAL && realTrace ? (
                <BannerShell key={KEY_REAL} transition={transition}>
                    <ContradictionBanner trace={realTrace} />
                </BannerShell>
            ) : bodyKey === KEY_JOINT && conflict ? (
                <BannerShell key={KEY_JOINT} transition={transition}>
                    <JointHypothesisContradictionBanner conflict={conflict} />
                </BannerShell>
            ) : null}
        </AnimatePresence>
    );
}

function BannerShell({
    children,
    transition,
}: {
    readonly children: ReactNode;
    readonly transition: ReturnType<typeof useReducedTransition>;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useBannerOffset(ref);

    return (
        <motion.div
            ref={ref}
            role="alert"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={transition}
            className="fixed inset-x-0 top-0 z-[var(--z-contradiction-banner)] border-b border-danger-border bg-panel/95 shadow-lg backdrop-blur-sm"
        >
            <div className="mx-auto max-w-[1400px] px-5 pt-3">{children}</div>
        </motion.div>
    );
}

function useBannerOffset(ref: RefObject<HTMLDivElement | null>) {
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
    }, [ref]);
}
