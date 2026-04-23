"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { describeAction } from "../../logic/describeAction";
import { useLongPress } from "../hooks/useLongPress";
import { useClue } from "../state";
import { label } from "../keyMap";
import { useToolbarActions } from "./Toolbar";

/**
 * Mobile-only fixed-bottom navigation. Shown only under 800px — the
 * desktop header's `Toolbar` + `TabBar` cover the same affordances
 * above that breakpoint. Five slots, left to right:
 *
 *   [Checklist] [Suggest] [Undo] [Redo] [⋯]
 *
 * The first two mirror the desktop Play grid split: on mobile the
 * grid collapses to a single visible pane, chosen by `uiMode`. The
 * overflow menu exposes everything else from the desktop Toolbar —
 * Game setup (the Setup tab), Share link, and New game.
 */
export function BottomNav() {
    const { state, dispatch, canUndo, canRedo, undo, redo, nextUndo, nextRedo } =
        useClue();
    const t = useTranslations("bottomNav");
    const tToolbar = useTranslations("toolbar");
    const tHistory = useTranslations("history");
    const mode = state.uiMode;

    const undoPreview = nextUndo
        ? tHistory("undoTooltip", {
              description: describeAction(
                  nextUndo.action,
                  nextUndo.previousState,
                  tHistory,
              ),
          })
        : undefined;
    const redoPreview = nextRedo
        ? tHistory("redoTooltip", {
              description: describeAction(
                  nextRedo.action,
                  nextRedo.previousState,
                  tHistory,
              ),
          })
        : undefined;

    return (
        <nav
            aria-label={t("ariaLabel")}
            className={
                "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-panel " +
                "[padding-bottom:env(safe-area-inset-bottom,0px)] " +
                "[@media(min-width:800px)]:hidden"
            }
        >
            <ul className="m-0 flex list-none items-stretch justify-between gap-1 p-1">
                <NavTabItem
                    label={t("checklist", {
                        shortcut: label("global.gotoChecklist"),
                    })}
                    active={mode === "checklist"}
                    onClick={() =>
                        dispatch({ type: "setUiMode", mode: "checklist" })
                    }
                />
                <NavTabItem
                    label={t("suggest", {
                        shortcut: label("global.gotoPlay"),
                    })}
                    active={mode === "suggest"}
                    onClick={() =>
                        dispatch({ type: "setUiMode", mode: "suggest" })
                    }
                />
                <NavIconItem
                    label={tToolbar("undoAria")}
                    glyph="↶"
                    onClick={undo}
                    disabled={!canUndo}
                    preview={undoPreview}
                />
                <NavIconItem
                    label={tToolbar("redoAria")}
                    glyph="↷"
                    onClick={redo}
                    disabled={!canRedo}
                    preview={redoPreview}
                />
                <OverflowMenu
                    setupActive={mode === "setup"}
                    onSetup={() =>
                        dispatch({ type: "setUiMode", mode: "setup" })
                    }
                />
            </ul>
        </nav>
    );
}

/**
 * Text-labelled tab slot (Checklist / Suggest). Active styling matches
 * the desktop TabBar's accent underline — the bottom border lights up
 * in red so the active tab reads at a glance against the panel
 * background.
 */
function NavTabItem({
    label,
    active,
    onClick,
}: {
    readonly label: string;
    readonly active: boolean;
    readonly onClick: () => void;
}) {
    return (
        <li className="flex-1">
            <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={onClick}
                className={
                    "flex h-12 w-full cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 border-b-2 bg-transparent px-2 text-[13px] font-semibold " +
                    (active
                        ? "border-accent text-accent"
                        : "border-transparent text-muted hover:text-accent")
                }
            >
                {label}
            </button>
        </li>
    );
}

/**
 * Icon-only slot (Undo / Redo). Glyph matches the toolbar strings
 * (↶ / ↷); `aria-label` carries the real name for screen readers.
 * On touch devices a long-press (~500 ms) reveals `preview` in a
 * popover without firing the primary `onClick` — users can see what
 * they're about to reverse before committing.
 */
function NavIconItem({
    label,
    glyph,
    onClick,
    disabled,
    preview,
}: {
    readonly label: string;
    readonly glyph: string;
    readonly onClick: () => void;
    readonly disabled: boolean;
    readonly preview?: string | undefined;
}) {
    const [previewOpen, setPreviewOpen] = useState(false);
    const longPress = useLongPress(() => {
        if (disabled || !preview) return;
        setPreviewOpen(true);
    });

    return (
        <li>
            <RadixPopover.Root open={previewOpen} onOpenChange={setPreviewOpen}>
                <RadixPopover.Trigger
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    disabled={disabled}
                    className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[var(--radius)] border-none bg-transparent text-[20px] text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
                    style={{ WebkitTouchCallout: "none" }}
                    {...longPress}
                >
                    {glyph}
                </RadixPopover.Trigger>
                <RadixPopover.Portal>
                    <RadixPopover.Content
                        side="top"
                        sideOffset={6}
                        collisionPadding={8}
                        onOpenAutoFocus={e => e.preventDefault()}
                        className="z-50 max-w-[280px] rounded-[var(--radius)] border border-border bg-panel px-3 py-2 text-[12px] leading-snug shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                    >
                        {preview ?? label}
                        <RadixPopover.Arrow
                            className="fill-panel stroke-border"
                            strokeWidth={0.5}
                        />
                    </RadixPopover.Content>
                </RadixPopover.Portal>
            </RadixPopover.Root>
        </li>
    );
}

/**
 * Trailing overflow slot. A small Radix popover that opens *upward*
 * (`side="top"`) above the fixed nav and hosts the three less-common
 * actions: Game setup (switches to the Setup tab), Share link, and
 * New game. Share + New game reuse `useToolbarActions` so the mobile
 * flow is identical to the desktop Toolbar.
 */
function OverflowMenu({
    setupActive,
    onSetup,
}: {
    readonly setupActive: boolean;
    readonly onSetup: () => void;
}) {
    const t = useTranslations("bottomNav");
    const tToolbar = useTranslations("toolbar");
    const [open, setOpen] = useState(false);
    const { onShare, onNewGame, copied } = useToolbarActions();

    const closeThen = (fn: () => void | Promise<void>) => () => {
        setOpen(false);
        void fn();
    };

    return (
        <li>
            <RadixPopover.Root open={open} onOpenChange={setOpen}>
                <RadixPopover.Trigger
                    aria-label={t("more")}
                    title={t("more")}
                    className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[var(--radius)] border-none bg-transparent text-[20px] text-muted hover:text-accent"
                >
                    ⋯
                </RadixPopover.Trigger>
                <RadixPopover.Portal>
                    <RadixPopover.Content
                        side="top"
                        align="end"
                        sideOffset={6}
                        collisionPadding={8}
                        className="z-50 min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[13px] shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                    >
                        <MenuItem
                            label={t("gameSetup", {
                                shortcut: label("global.gotoSetup"),
                            })}
                            active={setupActive}
                            onClick={closeThen(onSetup)}
                        />
                        <MenuItem
                            label={copied ? tToolbar("shareCopied") : tToolbar("share")}
                            onClick={closeThen(onShare)}
                        />
                        <MenuItem
                            label={tToolbar("newGame", {
                                shortcut: label("global.newGame"),
                            })}
                            onClick={closeThen(onNewGame)}
                        />
                    </RadixPopover.Content>
                </RadixPopover.Portal>
            </RadixPopover.Root>
        </li>
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
