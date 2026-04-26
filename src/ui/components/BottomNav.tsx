"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { aboutLinkClicked } from "../../analytics/events";
import { describeAction } from "../../logic/describeAction";
import { routes } from "../../routes";
import { useLongPress } from "../hooks/useLongPress";
import { useClue } from "../state";
import { label } from "../keyMap";
import { T_SPRING_SOFT, T_STANDARD, useReducedTransition } from "../motion";
import { ExternalLinkIcon } from "./Icons";
import { OverflowMenu } from "./OverflowMenu";
import { useToolbarActions } from "./Toolbar";

/**
 * Mobile-only fixed-bottom navigation. Shown only under 800px — the
 * desktop header `Toolbar` covers the same affordances above that
 * breakpoint. Five slots, left to right:
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
                <LayoutGroup id="bottomnav-underline">
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
                </LayoutGroup>
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
                <BottomOverflowMenu
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
    const underlineTransition = useReducedTransition(T_SPRING_SOFT);
    const colorTransition = useReducedTransition(T_STANDARD);
    return (
        <li className="flex-1">
            <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={onClick}
                className={
                    "relative flex h-12 w-full cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-transparent px-2 text-[13px] font-semibold"
                }
            >
                <motion.span
                    animate={{
                        color: active
                            ? "var(--color-accent)"
                            : "var(--color-muted)",
                    }}
                    transition={colorTransition}
                >
                    {label}
                </motion.span>
                {active && (
                    <motion.span
                        layoutId="bottomnav-active-underline"
                        className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent"
                        transition={underlineTransition}
                    />
                )}
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
 * Trailing overflow slot — thin wrapper around the shared `OverflowMenu`
 * with mobile-specific trigger styling (icon slot, ~12 tall/wide) and
 * `side="top"` so the popover opens upward above the fixed nav. The
 * menu items mirror the desktop Toolbar: Game setup (switches to Setup
 * mode), Share link, and New game. Share + New game reuse
 * `useToolbarActions` so the mobile flow is identical to the desktop.
 */
function BottomOverflowMenu({
    setupActive,
    onSetup,
}: {
    readonly setupActive: boolean;
    readonly onSetup: () => void;
}) {
    const t = useTranslations("bottomNav");
    const tToolbar = useTranslations("toolbar");
    const { onShare, onNewGame, copied } = useToolbarActions();
    return (
        <li>
            <OverflowMenu
                triggerClassName="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[var(--radius)] border-none bg-transparent text-[20px] text-muted hover:text-accent"
                triggerLabel={t("more")}
                side="top"
                align="end"
                items={[
                    {
                        label: t("gameSetup", {
                            shortcut: label("global.gotoSetup"),
                        }),
                        active: setupActive,
                        onClick: onSetup,
                    },
                    {
                        label: copied
                            ? tToolbar("shareCopied")
                            : tToolbar("share"),
                        onClick: onShare,
                    },
                    {
                        label: tToolbar("newGame", {
                            shortcut: label("global.newGame"),
                        }),
                        onClick: onNewGame,
                    },
                    {
                        label: t("about"),
                        trailingIcon: <ExternalLinkIcon size={14} />,
                        onClick: () => {
                            aboutLinkClicked({ source: "overflow_menu" });
                            window.open(routes.about, "about-page", "noopener");
                        },
                    },
                ]}
            />
        </li>
    );
}
