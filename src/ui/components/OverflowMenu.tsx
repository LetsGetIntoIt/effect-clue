"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useState } from "react";

interface OverflowMenuItem {
    readonly label: string;
    readonly active?: boolean;
    readonly onClick: () => void | Promise<void>;
}

/**
 * Shared `⋯` overflow menu. Used by the desktop header Toolbar and the
 * mobile BottomNav. Internally a Radix Popover — each menu item closes
 * the popover before firing its handler so confirms/dialogs don't fight
 * with the open menu.
 */
export function OverflowMenu({
    triggerClassName,
    triggerLabel,
    side,
    align,
    items,
}: {
    readonly triggerClassName: string;
    readonly triggerLabel: string;
    readonly side: "top" | "bottom";
    readonly align: "start" | "end";
    readonly items: ReadonlyArray<OverflowMenuItem>;
}) {
    const [open, setOpen] = useState(false);
    const closeThen = (fn: () => void | Promise<void>) => () => {
        setOpen(false);
        void fn();
    };
    return (
        <RadixPopover.Root open={open} onOpenChange={setOpen}>
            <RadixPopover.Trigger
                aria-label={triggerLabel}
                title={triggerLabel}
                className={triggerClassName}
            >
                ⋯
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side={side}
                    align={align}
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[13px] shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                >
                    {items.map((item, i) => {
                        const handleClick = closeThen(item.onClick);
                        return item.active === undefined ? (
                            <MenuItem
                                key={i}
                                label={item.label}
                                onClick={handleClick}
                            />
                        ) : (
                            <MenuItem
                                key={i}
                                label={item.label}
                                active={item.active}
                                onClick={handleClick}
                            />
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
    onClick,
}: {
    readonly label: string;
    readonly active?: boolean;
    readonly onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                "block w-full cursor-pointer rounded-[var(--radius)] border-none bg-transparent px-3 py-2 text-left text-[13px] hover:bg-hover " +
                (active ? "text-accent font-semibold" : "text-inherit")
            }
        >
            {label}
        </button>
    );
}
