"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { T_FAST, useReducedTransition } from "../motion";
import { MenuIcon } from "./MenuIcon";

interface OverflowMenuButton {
    readonly label: string;
    readonly active?: boolean;
    readonly leadingIcon?: ReactNode;
    readonly trailingIcon?: ReactNode;
    readonly onClick: () => void | Promise<void>;
    /**
     * When `true`, the item renders greyed out and ignores clicks. The
     * popover does NOT auto-close on a disabled click — that would
     * feel like a successful tap on a non-functional control. Used
     * for Undo/Redo when there's no history to act on.
     */
    readonly disabled?: boolean;
    /**
     * Optional `data-tour-anchor` attached to the item's button.
     * The sharing tour uses this to spotlight specific menu items
     * (Invite a player, Continue on another device, My card packs)
     * while the surrounding menu stays open.
     */
    readonly tourAnchor?: string;
}

/**
 * Section divider between groups of menu items. Renders as a
 * 1px hairline; carries no interaction. Pass between two
 * `OverflowMenuButton`s in the `items` array.
 */
interface OverflowMenuDivider {
    readonly type: "divider";
}

/**
 * Two buttons rendered side-by-side at 50/50 width inside one menu
 * row. Each half behaves like a regular menu item (close-on-click,
 * disabled support). Labels render as `whitespace-nowrap overflow-
 * hidden` with no ellipsis — if the label + shortcut don't fit in
 * half the menu width, the trailing characters are simply clipped.
 * Used for paired actions like Undo / Redo where forming a single
 * row reads as "two halves of the same affordance" instead of two
 * unrelated rows.
 */
interface OverflowMenuSplitRow {
    readonly type: "split";
    readonly left: OverflowMenuButton;
    readonly right: OverflowMenuButton;
}

type OverflowMenuItem =
    | OverflowMenuButton
    | OverflowMenuDivider
    | OverflowMenuSplitRow;

const isDivider = (item: OverflowMenuItem): item is OverflowMenuDivider =>
    "type" in item && item.type === "divider";

const isSplit = (item: OverflowMenuItem): item is OverflowMenuSplitRow =>
    "type" in item && item.type === "split";

/**
 * Shared `⋯` overflow menu. Used by the desktop header Toolbar and the
 * mobile BottomNav. Internally a Radix Popover — each menu item closes
 * the popover before firing its handler so confirms/dialogs don't fight
 * with the open menu.
 *
 * Items can be either buttons or `{ type: "divider" }` sentinels for
 * separating logical groups (e.g. Game / Account & content / Help).
 *
 * The optional `forceOpen` prop lets the onboarding tour pin the menu
 * open while it's pointing the user at "everything else lives here".
 * When `forceOpen === true`, the menu is open regardless of internal
 * click / hover state. Internal close attempts (Esc, outside click)
 * still update the internal state, but the visible open state stays
 * `true` until `forceOpen` flips back to `false` (i.e. the tour
 * advances past that step).
 */
export function OverflowMenu({
    triggerClassName,
    triggerLabel,
    side,
    align,
    items,
    forceOpen,
    contentClassName,
}: {
    readonly triggerClassName: string;
    readonly triggerLabel: string;
    readonly side: "top" | "bottom";
    readonly align: "start" | "end";
    readonly items: ReadonlyArray<OverflowMenuItem>;
    readonly forceOpen?: boolean;
    /**
     * Extra className applied to the portaled `RadixPopover.Content`.
     * Used by callers in mobile-only or desktop-only contexts to add
     * a viewport-gated `hidden` class so the portaled menu mirrors
     * the parent's CSS visibility — the menu is portaled outside its
     * parent, so a `display: none` on the parent doesn't reach it.
     */
    readonly contentClassName?: string;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = forceOpen === true ? true : internalOpen;
    const itemTransition = useReducedTransition(T_FAST);
    const closeThen = (fn: () => void | Promise<void>) => () => {
        setInternalOpen(false);
        void fn();
    };
    return (
        <RadixPopover.Root open={open} onOpenChange={setInternalOpen}>
            <RadixPopover.Trigger
                aria-label={triggerLabel}
                title={triggerLabel}
                className={triggerClassName}
                data-tour-anchor="overflow-menu"
            >
                <MenuIcon size={18} />
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side={side}
                    align={align}
                    sideOffset={6}
                    collisionPadding={8}
                    // The menu's content carries the same anchor as
                    // the trigger so the onboarding tour's spotlight
                    // expands to cover the opened menu (not just the
                    // ⋯ button). The TourPopover's `findAnchorElements`
                    // unions every match.
                    data-tour-anchor="overflow-menu"
                    className={
                        "z-[var(--z-popover)] min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[1rem] shadow-[0_6px_16px_rgba(0,0,0,0.18)]" +
                        (contentClassName ? ` ${contentClassName}` : "")
                    }
                >
                    {items.map((item, i) => {
                        if (isDivider(item)) {
                            return (
                                <div
                                    key={i}
                                    role="separator"
                                    aria-orientation="horizontal"
                                    className="my-1 h-px bg-border"
                                />
                            );
                        }
                        // Disabled items don't run their onClick and
                        // don't auto-close the popover — leaving the
                        // menu open keeps the disabled state visible
                        // so the user understands why nothing happened.
                        const renderItem = (b: OverflowMenuButton) => {
                            const handleClick =
                                b.disabled === true
                                    ? () => {}
                                    : closeThen(b.onClick);
                            return (
                                <MenuItem
                                    label={b.label}
                                    {...(b.active !== undefined
                                        ? { active: b.active }
                                        : {})}
                                    {...(b.leadingIcon !== undefined
                                        ? { leadingIcon: b.leadingIcon }
                                        : {})}
                                    {...(b.trailingIcon !== undefined
                                        ? { trailingIcon: b.trailingIcon }
                                        : {})}
                                    {...(b.tourAnchor !== undefined
                                        ? { tourAnchor: b.tourAnchor }
                                        : {})}
                                    disabled={b.disabled === true}
                                    onClick={handleClick}
                                />
                            );
                        };
                        const content = isSplit(item) ? (
                            <div className="flex w-full items-stretch gap-1">
                                <div className="min-w-0 flex-1 basis-0">
                                    {renderItem(item.left)}
                                </div>
                                <div className="min-w-0 flex-1 basis-0">
                                    {renderItem(item.right)}
                                </div>
                            </div>
                        ) : (
                            renderItem(item)
                        );
                        return (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...itemTransition, delay: i * 0.03 }}
                            >
                                {content}
                            </motion.div>
                        );
                    })}
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}

function MenuItem({
    label,
    active,
    leadingIcon,
    trailingIcon,
    disabled,
    onClick,
    tourAnchor,
}: {
    readonly label: string;
    readonly active?: boolean;
    readonly leadingIcon?: ReactNode;
    readonly trailingIcon?: ReactNode;
    readonly disabled?: boolean;
    readonly onClick: () => void;
    readonly tourAnchor?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            {...(tourAnchor !== undefined
                ? { "data-tour-anchor": tourAnchor }
                : {})}
            className={
                "tap-target-compact text-tap-compact flex w-full items-center justify-between gap-2 rounded-[var(--radius)] border-none bg-transparent text-left " +
                (disabled
                    ? "cursor-not-allowed opacity-40 text-inherit"
                    : "cursor-pointer hover:bg-hover " +
                      (active ? "text-accent font-semibold" : "text-inherit"))
            }
        >
            <span className="flex min-w-0 items-center gap-2">
                {leadingIcon !== undefined ? (
                    <span className="flex shrink-0 items-center">
                        {leadingIcon}
                    </span>
                ) : null}
                <span className="overflow-hidden whitespace-nowrap">
                    {label}
                </span>
            </span>
            {trailingIcon !== undefined ? (
                <span className="flex shrink-0 items-center text-muted">
                    {trailingIcon}
                </span>
            ) : null}
        </button>
    );
}
