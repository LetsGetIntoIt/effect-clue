"use client";

import { useCallback } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Accuse-ready celebration. Fires an oxblood-tinted confetti burst
 * from the given origin element. `canvas-confetti` is lazy-imported
 * so the ~10KB library is only downloaded when the user is close to
 * solving the case — not on every app load.
 *
 * No-ops under `prefers-reduced-motion`.
 */
export function useConfetti(): (origin: HTMLElement | null) => void {
    const reduced = useReducedMotion();
    return useCallback(
        (origin: HTMLElement | null) => {
            if (reduced) return;
            const target = origin ?? document.body;
            const rect = target.getBoundingClientRect();
            const x = (rect.left + rect.width / 2) / window.innerWidth;
            const y = (rect.top + rect.height / 2) / window.innerHeight;
            void import("canvas-confetti").then(mod => {
                const confetti = mod.default;
                const shared = {
                    origin: { x, y },
                    colors: ["#7a1c1c", "#5e1414", "#ead9b0", "#cbb68c"],
                    scalar: 0.9,
                };
                confetti({ ...shared, particleCount: 60, spread: 55, startVelocity: 35 });
                confetti({ ...shared, particleCount: 40, spread: 80, startVelocity: 25, ticks: 150 });
            });
        },
        [reduced],
    );
}
