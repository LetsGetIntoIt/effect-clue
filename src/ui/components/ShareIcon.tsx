"use client";

import { usePlatformIsApple } from "../hooks/usePlatformIsApple";

/**
 * Share icon. Renders the iOS / macOS share-sheet icon (square with
 * up-arrow) on Apple platforms and the Material three-node graph on
 * everything else.
 *
 * Callers don't need to know about the platform split — they ask for
 * "the share icon" and we render whichever shape the user's device
 * recognises. Each ecosystem has a strongly-recognised system share
 * symbol; showing the wrong one looks unfamiliar and makes the
 * affordance harder to spot.
 *
 * SSR snapshot: defaults to non-Apple to avoid a desktop user
 * briefly seeing the Apple icon flash on hydration when their UA
 * doesn't match.
 */
export function ShareIcon({
    className,
    size = 14,
}: {
    readonly className?: string;
    readonly size?: number;
}) {
    const isApple = usePlatformIsApple();
    const Svg = isApple ? AppleShareSvg : MaterialShareSvg;
    return (
        <Svg
            size={size}
            {...(className !== undefined ? { className } : {})}
        />
    );
}

/**
 * Three-node graph — the system share affordance on Material /
 * Android / Windows. Internal to this module; callers should use the
 * exported `ShareIcon` so the right SVG ships per platform.
 */
function MaterialShareSvg({
    className,
    size,
}: {
    readonly className?: string;
    readonly size: number;
}) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            {...(className !== undefined ? { className } : {})}
        >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
    );
}

/**
 * Square with up-arrow — the iOS / macOS system share-sheet icon.
 * Internal to this module.
 */
function AppleShareSvg({
    className,
    size,
}: {
    readonly className?: string;
    readonly size: number;
}) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            {...(className !== undefined ? { className } : {})}
        >
            {/* Box: the share-sheet's "outbound" container, open at
                the top so the arrow visually rises out of it. */}
            <path d="M8 12 V19 a2 2 0 0 0 2 2 h4 a2 2 0 0 0 2 -2 V12" />
            {/* Up arrow with stem from y=3 to y=14 and a chevron head. */}
            <line x1="12" y1="3" x2="12" y2="14" />
            <polyline points="8 7 12 3 16 7" />
        </svg>
    );
}
