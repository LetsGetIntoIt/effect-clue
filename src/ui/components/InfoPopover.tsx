"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import {
    type ReactNode,
    useCallback,
    useState,
} from "react";

interface InfoPopoverProps {
    readonly content: ReactNode;
    readonly children: ReactNode;
    readonly side?: "top" | "right" | "bottom" | "left";
    readonly align?: "start" | "center" | "end";
    /** Tone — default neutral parchment; accent is for error/contradiction states. */
    readonly variant?: "default" | "accent";
    /**
     * When true, the trigger wrapper becomes a real `<button>` and receives
     * focus/aria-haspopup semantics. Use for bare ⓘ-icon triggers. When
     * false (default), children are rendered as-is via `asChild` so the
     * existing element (e.g. `<td>`) keeps its own semantics.
     */
    readonly asButton?: boolean;
    /** When provided, overrides the max-width of the content. */
    readonly maxWidthPx?: number;
    /**
     * Callback fired whenever the popover opens or closes. Useful for
     * syncing external state (e.g. pinning the corresponding cell's
     * selection).
     */
    readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Click/tap-to-reveal info popover. Unlike `Tooltip` (hover-only,
 * desktop-only), this works identically on desktop and touch: the only
 * way to open it is an explicit click, tap, or keyboard activation. We
 * deliberately do NOT open on hover — users on touch devices can't
 * hover, and having desktop behave differently from mobile leads to
 * "the Mac shows something the phone doesn't" bug reports.
 *
 * Built on Radix Popover (not Tooltip), so the content is a focusable
 * dialog that keyboard users can read and dismiss.
 */
export function InfoPopover({
    content,
    children,
    side = "top",
    align = "center",
    variant = "default",
    asButton = false,
    maxWidthPx = 320,
    onOpenChange,
}: InfoPopoverProps) {
    const tCommon = useTranslations("common");
    const [open, setOpenState] = useState(false);
    const setOpen = useCallback(
        (next: boolean) => {
            setOpenState(next);
            onOpenChange?.(next);
        },
        [onOpenChange],
    );

    const toneClasses =
        variant === "accent"
            ? "border-accent bg-accent text-white"
            : "border-border bg-panel text-[#2a1f12]";
    const arrowClasses =
        variant === "accent"
            ? "fill-accent stroke-accent"
            : "fill-panel stroke-border";

    return (
        <RadixPopover.Root open={open} onOpenChange={setOpen}>
            {asButton ? (
                <RadixPopover.Trigger
                    aria-label={tCommon("info")}
                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border bg-panel text-[12px] text-muted hover:text-accent"
                >
                    {children}
                </RadixPopover.Trigger>
            ) : (
                <RadixPopover.Trigger asChild>{children}</RadixPopover.Trigger>
            )}
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side={side}
                    align={align}
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => e.preventDefault()}
                    className={
                        "z-50 rounded-[var(--radius)] border px-3 py-2 text-[12px] leading-snug shadow-[0_6px_16px_rgba(0,0,0,0.18)] " +
                        "focus:outline-none " +
                        toneClasses
                    }
                    style={{ maxWidth: maxWidthPx }}
                >
                    <div className="whitespace-pre-line">{content}</div>
                    <RadixPopover.Arrow
                        className={arrowClasses}
                        strokeWidth={0.5}
                    />
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
