"use client";

import { useReducedMotion, type Transition } from "motion/react";

/**
 * Shared motion presets. Every animation in the app routes through one
 * of these so reduced-motion is a single audit point.
 *
 * Aesthetic register: the dossier/parchment theme calls for refined
 * and snappy over bouncy. Default is tween easeOut 160–240ms; spring
 * is reserved for layout morphs (tab underline, pill width, focus
 * ring) where physical settling reads right; a bouncier spring is
 * reserved for celebrations.
 */

export const T_FAST: Transition = {
    duration: 0.12,
    ease: "easeOut",
};

export const T_STANDARD: Transition = {
    duration: 0.2,
    ease: [0.22, 1, 0.36, 1],
};

/**
 * How long to wait after starting a view/pane transition before
 * running post-transition side effects (opening a popover anchored to
 * a newly-visible pill, scrolling to a freshly-revealed row, focusing
 * a cell that was in an `inert` subtree a moment ago). Matches
 * `T_STANDARD.duration` plus a one-frame buffer so the target element
 * has settled into its final position before we measure or focus it.
 */
export const PANE_SETTLE_MS = 210;

export const T_SPRING_SOFT: Transition = {
    type: "spring",
    stiffness: 320,
    damping: 34,
    mass: 0.7,
};

export const T_CELEBRATE: Transition = {
    type: "spring",
    stiffness: 260,
    damping: 14,
};

/**
 * Celebration keyframe sequence (wiggle / pulse). Spring can't
 * handle >2 keyframes, so the per-category wiggle, envelope wiggle,
 * and accuse-ready pulse all use a short tween-based playthrough.
 */
export const T_WIGGLE: Transition = {
    duration: 0.6,
    ease: [0.22, 1, 0.36, 1],
};

/**
 * Wrap any transition so it respects `prefers-reduced-motion`. When
 * reduced motion is on, spring/ease timing is collapsed to an instant
 * state swap. For elements where instant-swap reads as broken (e.g.
 * the contradiction banner), pass `{ fadeMs }` to keep a short linear
 * fade.
 */
export function useReducedTransition(
    t: Transition,
    { fadeMs }: { readonly fadeMs?: number } = {},
): Transition {
    const reduced = useReducedMotion();
    if (!reduced) return t;
    // eslint-disable-next-line i18next/no-literal-string -- motion easing keyword
    if (fadeMs !== undefined) return { duration: fadeMs / 1000, ease: "linear" };
    return { duration: 0 };
}
