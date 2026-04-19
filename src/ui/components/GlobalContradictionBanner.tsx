"use client";

import { Result } from "effect";
import { useLayoutEffect, useRef } from "react";
import { useClue } from "../state";
import { ContradictionBanner } from "./ContradictionBanner";

/**
 * Global contradiction banner pinned to the top of the viewport whenever
 * the deducer detects an inconsistency. `position: fixed` keeps the
 * banner visible regardless of scroll position, and a ResizeObserver
 * writes its current height to `--contradiction-banner-offset` so the
 * surrounding `<main>` can reserve matching top padding (set in
 * `Clue.tsx`). Without the offset the banner would occlude the header.
 */
export function GlobalContradictionBanner() {
    const { derived } = useClue();
    const result = derived.deductionResult;
    const trace = Result.isFailure(result) ? result.failure : undefined;
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const root = document.documentElement;
        if (!trace) {
            root.style.setProperty("--contradiction-banner-offset", "0px");
            return;
        }
        const el = ref.current;
        if (!el) return;
        const write = () =>
            root.style.setProperty(
                "--contradiction-banner-offset",
                `${el.offsetHeight}px`,
            );
        write();
        const ro = new ResizeObserver(write);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.setProperty("--contradiction-banner-offset", "0px");
        };
    }, [trace]);

    if (!trace) return null;
    return (
        <div
            ref={ref}
            role="alert"
            className="fixed inset-x-0 top-0 z-50 border-b border-danger-border bg-panel/95 shadow-lg backdrop-blur-sm"
        >
            <div className="mx-auto max-w-[1400px] px-5 pt-3">
                <ContradictionBanner trace={trace} />
            </div>
        </div>
    );
}
