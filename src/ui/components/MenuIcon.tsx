"use client";

import { usePlatformIsApple } from "../hooks/usePlatformIsApple";

export function MenuIcon({
    className,
    size = 20,
}: {
    readonly className?: string;
    readonly size?: number;
}) {
    const isApple = usePlatformIsApple();
    const Svg = isApple ? AppleMenuSvg : MaterialMenuSvg;
    return (
        <Svg
            size={size}
            {...(className !== undefined ? { className } : {})}
        />
    );
}

function MaterialMenuSvg({
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
            aria-hidden="true"
            focusable="false"
            {...(className !== undefined ? { className } : {})}
        >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
    );
}

function AppleMenuSvg({
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
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
            {...(className !== undefined ? { className } : {})}
        >
            <line x1="5" y1="7" x2="19" y2="7" />
            <line x1="5" y1="12" x2="19" y2="12" />
            <line x1="5" y1="17" x2="19" y2="17" />
        </svg>
    );
}
