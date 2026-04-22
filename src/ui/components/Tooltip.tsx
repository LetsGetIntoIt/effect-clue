"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { ReactNode } from "react";

/**
 * Project-wide tooltip primitive. Wraps Radix `Tooltip.Root` + `Trigger`
 * + `Content` so components don't have to repeat the boilerplate.
 *
 * Unlike the browser's native `title=` attribute:
 *  - Delay is configurable (default 150ms, short enough to feel
 *    responsive on cell-heavy grids).
 *  - Content can be multi-line / styled / contain whitespace, matching
 *    the parchment-and-ink aesthetic of the rest of the app.
 *  - Clicks-through-to-the-trigger still work (we don't wrap in a
 *    button).
 *  - Accessible: Radix handles role="tooltip" + aria-describedby.
 *
 * If `content` is undefined, the Tooltip renders children unchanged —
 * useful for conditionally-populated tooltips (e.g. the checklist
 * grid's "why this value" chain that's empty for blank cells).
 */
export function Tooltip({
    content,
    children,
    side = "top",
    delayMs = 150,
    variant = "default",
}: {
    content: ReactNode;
    children: ReactNode;
    side?: "top" | "right" | "bottom" | "left";
    delayMs?: number;
    variant?: "default" | "accent";
}) {
    if (content === undefined || content === null || content === "") {
        return <>{children}</>;
    }
    const toneClasses =
        variant === "accent"
            ? "border-accent bg-accent text-white"
            : "border-border bg-panel text-[#2a1f12]";
    const arrowClasses =
        variant === "accent"
            ? "fill-accent stroke-accent"
            : "fill-panel stroke-border";
    return (
        <RadixTooltip.Root delayDuration={delayMs}>
            <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    side={side}
                    sideOffset={6}
                    collisionPadding={8}
                    className={
                        "z-50 max-w-[320px] rounded-[var(--radius)] border px-3 py-2 text-[12px] leading-snug shadow-[0_6px_16px_rgba(0,0,0,0.18)] " +
                        toneClasses
                    }
                >
                    {content}
                    <RadixTooltip.Arrow
                        className={arrowClasses}
                        strokeWidth={0.5}
                    />
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );
}

/**
 * Root-level Radix provider. Installed once at `<ClueProvider>` (actually
 * at the page level, since Radix wants this above anything that uses
 * `<Tooltip>`). Sharing a single provider keeps delay / skipDelay state
 * consistent across tooltips.
 */
export const TooltipProvider = RadixTooltip.Provider;
