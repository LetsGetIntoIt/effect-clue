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
}

/**
 * Section divider between groups of menu items. Renders as a
 * 1px hairline; carries no interaction. Pass between two
 * `OverflowMenuButton`s in the `items` array.
 */
interface OverflowMenuDivider {
    readonly type: "divider";
}

type OverflowMenuItem = OverflowMenuButton | OverflowMenuDivider;

const isDivider = (item: OverflowMenuItem): item is OverflowMenuDivider =>
    "type" in item && item.type === "divider";

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
                        "z-[var(--z-popover)] min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[13px] shadow-[0_6px_16px_rgba(0,0,0,0.18)]" +
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
                        const handleClick = closeThen(item.onClick);
                        const content = (
                            <MenuItem
                                label={item.label}
                                {...(item.active !== undefined
                                    ? { active: item.active }
                                    : {})}
                                {...(item.leadingIcon !== undefined
                                    ? { leadingIcon: item.leadingIcon }
                                    : {})}
                                {...(item.trailingIcon !== undefined
                                    ? { trailingIcon: item.trailingIcon }
                                    : {})}
                                onClick={handleClick}
                            />
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
    onClick,
}: {
    readonly label: string;
    readonly active?: boolean;
    readonly leadingIcon?: ReactNode;
    readonly trailingIcon?: ReactNode;
    readonly onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                "flex w-full items-center justify-between gap-2 cursor-pointer rounded-[var(--radius)] border-none bg-transparent px-3 py-2 text-left text-[13px] hover:bg-hover " +
                (active ? "text-accent font-semibold" : "text-inherit")
            }
        >
            <span className="flex min-w-0 items-center gap-2">
                {leadingIcon !== undefined ? (
                    <span className="flex shrink-0 items-center">
                        {leadingIcon}
                    </span>
                ) : null}
                <span className="truncate">{label}</span>
            </span>
            {trailingIcon !== undefined ? (
                <span className="flex shrink-0 items-center text-muted">
                    {trailingIcon}
                </span>
            ) : null}
        </button>
    );
}
