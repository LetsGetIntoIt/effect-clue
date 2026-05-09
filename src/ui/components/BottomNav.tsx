"use client";

import { LayoutGroup, motion } from "motion/react";
import { useTranslations } from "next-intl";
import {
    aboutLinkClicked,
} from "../../analytics/events";
import { routes } from "../../routes";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useClue } from "../state";
import { shortcutSuffix } from "../keyMap";
import { T_SPRING_SOFT, T_STANDARD, useReducedTransition } from "../motion";
import { useTour } from "../tour/TourProvider";
import { screenKeyForUiMode } from "../tour/screenKey";
import { AccountAvatar } from "../account/AccountAvatar";
import { useAccountContext } from "../account/AccountProvider";
import { useShareContext } from "../share/ShareProvider";
import { useSession } from "../hooks/useSession";
import { ExternalLinkIcon } from "./Icons";
import { useInstallPromptContext } from "./InstallPromptProvider";
import type { InstallPromptTrigger } from "../../analytics/events";
import { OverflowMenu } from "./OverflowMenu";
import { useToolbarActions } from "./Toolbar";

const TRIGGER_MENU: InstallPromptTrigger = "menu";

/**
 * Mobile-only fixed-bottom navigation. Shown only under 800px — the
 * desktop header `Toolbar` covers the same affordances above that
 * breakpoint. Three slots, left to right:
 *
 *   [Checklist] [Suggest] [⋯]
 *
 * The first two mirror the desktop Play grid split: on mobile the
 * grid collapses to a single visible pane, chosen by `uiMode`. The
 * overflow menu exposes everything else — Undo / Redo (which on
 * desktop stay top-level in the header Toolbar; the smaller mobile
 * footprint pushes them into the menu instead), Game setup (the
 * Setup tab), and the rest of the desktop Toolbar's items.
 */
export function BottomNav() {
    const { state, dispatch } = useClue();
    const t = useTranslations("bottomNav");
    const hasKeyboard = useHasKeyboard();
    const mode = state.uiMode;

    // In setup mode, the wizard owns the page-bottom area with its
    // own sticky CTA bar (Start over / Skip / Next / Start playing).
    // BottomNav's tabs aren't useful there — Game-setup's already
    // active, and the Checklist / Suggest tabs would compete with
    // the wizard's primary navigation. Hide entirely.
    if (mode === "setup") return null;

    return (
        <nav
            aria-label={t("ariaLabel")}
            className={
                "fixed inset-x-0 bottom-0 z-[var(--z-app-chrome)] border-t border-border bg-panel " +
                "[padding-bottom:env(safe-area-inset-bottom,0px)] " +
                "[@media(min-width:800px)]:hidden"
            }
        >
            <ul className="m-0 flex list-none items-stretch justify-between gap-1 p-1">
                <LayoutGroup id="bottomnav-underline">
                <NavTabItem
                    label={t("checklist", {
                        shortcut: shortcutSuffix("global.gotoChecklist", hasKeyboard),
                    })}
                    active={mode === "checklist"}
                    tourAnchor="bottom-nav-checklist"
                    onClick={() =>
                        dispatch({ type: "setUiMode", mode: "checklist" })
                    }
                />
                <NavTabItem
                    label={t("suggest", {
                        shortcut: shortcutSuffix("global.gotoPlay", hasKeyboard),
                    })}
                    active={mode === "suggest"}
                    tourAnchor="bottom-nav-suggest"
                    onClick={() =>
                        dispatch({ type: "setUiMode", mode: "suggest" })
                    }
                />
                </LayoutGroup>
                <BottomOverflowMenu
                    // In setup mode this whole nav is unmounted, so
                    // `setupActive` is always false from here.
                    setupActive={false}
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
    tourAnchor,
}: {
    readonly label: string;
    readonly active: boolean;
    readonly onClick: () => void;
    /** Optional `data-tour-anchor` attached to the underlying button.
     * Used by the M22 firstSuggestion tour to point at the Checklist
     * tab on mobile. */
    readonly tourAnchor?: string;
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
                {...(tourAnchor !== undefined
                    ? { "data-tour-anchor": tourAnchor }
                    : {})}
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
 * Trailing overflow slot — thin wrapper around the shared `OverflowMenu`
 * with mobile-specific trigger styling (icon slot, ~12 tall/wide) and
 * `side="top"` so the popover opens upward above the fixed nav. The
 * menu items mirror the desktop Toolbar — Undo / Redo first (greyed
 * when there's no history), then Game setup, New game, etc. Undo /
 * Redo live top-level on desktop's header Toolbar but the mobile
 * footprint pushes them into the menu so the bottom row stays clean.
 * New game reuses `useToolbarActions` so the mobile flow is identical
 * to the desktop. The Share item was dropped in M3 and M9 will
 * reintroduce it.
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
    const tOnboarding = useTranslations("onboarding");
    const tInstall = useTranslations("installPrompt");
    const tAccount = useTranslations("account");
    const tShare = useTranslations("share");
    const hasKeyboard = useHasKeyboard();
    const { state, canUndo, canRedo, undo, redo } = useClue();
    const { onNewGame } = useToolbarActions();
    const { restartTourForScreen, currentStep } = useTour();
    // Force this menu open while the "Everything else lives here" tour
    // step is active so the user can see the items without clicking ⋯.
    const tourForcesMenuOpen = currentStep?.anchor === "overflow-menu";
    const { installable, openModal: openInstallModal } =
        useInstallPromptContext();
    const { openModal: openAccountModal, requestSignOut } = useAccountContext();
    const { openInvitePlayer, openContinueOnAnotherDevice } =
        useShareContext();
    const session = useSession();
    const user = session.data?.user;
    const signedIn = user !== undefined && !user.isAnonymous;
    const accountLabel = signedIn
        ? tAccount("signOut")
        : tAccount("menuItemSignedOut");
    const onAccountClick = async () => {
        if (!signedIn) {
            openAccountModal();
            return;
        }
        // Provider owns the flush-then-warn-then-commit dance, the
        // `sign_out` event emission, and the session refetch.
        await requestSignOut();
    };
    return (
        <li>
            <OverflowMenu
                triggerClassName="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[var(--radius)] border-none bg-transparent text-[20px] text-muted hover:text-accent"
                triggerLabel={t("more")}
                side="top"
                align="end"
                forceOpen={tourForcesMenuOpen}
                // BottomNav itself is hidden on desktop via CSS, but
                // the portaled menu content lives on body and would
                // otherwise ghost on desktop when forceOpen flips it
                // on for the tour. Hide above the 800px breakpoint.
                contentClassName="[@media(min-width:800px)]:hidden"
                items={[
                    // Group 0: History. One row split 50/50 so the
                    // pair reads as two halves of the same affordance
                    // instead of two unrelated rows. Greyed out when
                    // there's nothing to act on. Desktop's Toolbar
                    // keeps these top-level; on mobile the screen
                    // real estate pushes them into the menu instead.
                    {
                        type: "split",
                        left: {
                            label: tToolbar("undo", {
                                shortcut: shortcutSuffix("global.undo", hasKeyboard),
                            }),
                            onClick: undo,
                            disabled: !canUndo,
                        },
                        right: {
                            label: tToolbar("redo", {
                                shortcut: shortcutSuffix("global.redo", hasKeyboard),
                            }),
                            onClick: redo,
                            disabled: !canRedo,
                        },
                    },
                    { type: "divider" },
                    // Group 1: Game
                    {
                        label: t("gameSetup", {
                            shortcut: shortcutSuffix("global.gotoSetup", hasKeyboard),
                        }),
                        active: setupActive,
                        onClick: onSetup,
                    },
                    {
                        label: tToolbar("newGame", {
                            shortcut: shortcutSuffix("global.newGame", hasKeyboard),
                        }),
                        onClick: onNewGame,
                    },
                    {
                        label: tShare("menuItemInvitePlayer"),
                        onClick: () => openInvitePlayer(),
                    },
                    {
                        label: tShare("menuItemTransferDevice"),
                        onClick: () => openContinueOnAnotherDevice(),
                    },
                    { type: "divider" },
                    // Group 2: Account & content
                    {
                        label: accountLabel,
                        leadingIcon: (
                            <AccountAvatar
                                user={signedIn ? user : null}
                                sizeClassName="h-6 w-6"
                            />
                        ),
                        onClick: onAccountClick,
                    },
                    {
                        label: tAccount("menuItemMyCardPacks"),
                        onClick: () => openAccountModal(),
                    },
                    {
                        label: tOnboarding("takeTour"),
                        onClick: () =>
                            restartTourForScreen(
                                screenKeyForUiMode(state.uiMode),
                            ),
                    },
                    { type: "divider" },
                    // Group 3: Help / system
                    ...(installable
                        ? [
                              {
                                  label: tInstall("menuItem"),
                                  onClick: () =>
                                      openInstallModal(TRIGGER_MENU),
                              } as const,
                          ]
                        : []),
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
