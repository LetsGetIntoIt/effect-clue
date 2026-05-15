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
import { PlayCTAButton } from "./PlayCTAButton";
import { useToolbarActions } from "./Toolbar";
import { useTeachModeToggle } from "./useTeachModeToggle";
import { useTeachModeCheck } from "./TeachModeCheckContext";
import { tallyVerdicts } from "../../logic/TeachMode";
import { teachModeCheckUsed } from "../../analytics/events";

const TRIGGER_MENU: InstallPromptTrigger = "menu";

// Source token for the teach-mode toggle dispatched from the overflow
// menu. Hoisted to module scope so the `i18next/no-literal-string`
// lint rule reads it as a code identifier.
const TEACH_SOURCE_OVERFLOW_MENU = "overflowMenu" as const;

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

    // In setup mode the wizard owns the page-bottom area with its own
    // sticky CTA bar, so we hide the Checklist / Suggest tabs (they'd
    // compete with the wizard's primary nav and Game setup is already
    // the active screen). But we still surface the overflow menu (⋯)
    // on the right side — without it, mobile setup users have no way
    // to reach Undo / Redo / Install / Account / Restart tour, all of
    // which live in the overflow menu. The wizard's sticky footer and
    // this bar can co-exist: the page's `pb-24` clears the BottomNav,
    // and the wizard footer sticks at the viewport bottom which sits
    // visually above the BottomNav (z-order: BottomNav uses
    // `--z-app-chrome` which is below the popovers but above page
    // content, while the wizard footer is in-flow so it stacks under
    // the BottomNav's fixed positioning).
    const setupMode = mode === "setup";

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
                {!setupMode && (
                    <LayoutGroup id="bottomnav-underline">
                        <NavTabItem
                            label={t("checklist", {
                                shortcut: shortcutSuffix(
                                    "global.gotoChecklist",
                                    hasKeyboard,
                                ),
                            })}
                            active={mode === "checklist"}
                            tourAnchor="bottom-nav-checklist bottom-nav-two-halves"
                            onClick={() =>
                                dispatch({ type: "setUiMode", mode: "checklist" })
                            }
                        />
                        {/* 1×1 sentinel sitting between the two tabs.
                            Mirror of `two-halves-divider` in
                            DesktopPlayLayout — the mobile "Two
                            halves" tour step anchors its popover here
                            so it centers above the visual border
                            between the Checklist and Suggest tabs.
                            `h-px w-px` is just enough area to clear
                            `pickPopoverRect`'s zero-area filter; the
                            ~5px it adds between the two tabs
                            (`gap-1 + 1px + gap-1`) is negligible.
                            `aria-hidden` + `pointer-events-none`
                            keeps it out of a11y and click paths. */}
                        <li
                            aria-hidden
                            data-tour-anchor="bottom-nav-two-halves-divider"
                            className="pointer-events-none h-px w-px self-center"
                        />
                        <NavTabItem
                            label={t("suggest", {
                                shortcut: shortcutSuffix(
                                    "global.gotoPlay",
                                    hasKeyboard,
                                ),
                            })}
                            active={mode === "suggest"}
                            tourAnchor="bottom-nav-suggest bottom-nav-two-halves"
                            onClick={() =>
                                dispatch({ type: "setUiMode", mode: "suggest" })
                            }
                        />
                    </LayoutGroup>
                )}
                {setupMode && (
                    // Setup-mode chrome: when phase ≥ setupCompleted
                    // the PlayCTAButton renders a centered "Start /
                    // Continue playing" primary CTA in the row to
                    // the left of the overflow menu. When phase
                    // < setupCompleted the button renders an empty
                    // <li flex-1> spacer instead so the overflow
                    // stays right-aligned and the row keeps its
                    // ~56px height (the wizard's sticky-footer
                    // offset depends on that).
                    <PlayCTAButton variant="bottomNav" />
                )}
                <BottomOverflowMenu
                    setupActive={setupMode}
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
                    "relative flex h-12 w-full cursor-pointer items-center justify-center rounded-[var(--radius)] border-0 bg-transparent px-2 text-[1rem] font-semibold"
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
    const tTeach = useTranslations("teachMode");
    const hasKeyboard = useHasKeyboard();
    const { state, derived, canUndo, canRedo, undo, redo } = useClue();
    const { onNewGame } = useToolbarActions();
    const requestTeachMode = useTeachModeToggle();
    const { openBanner } = useTeachModeCheck();
    const onCheckClick = () => {
        const tally = tallyVerdicts(
            state.setup,
            state.userDeductions,
            derived.deductionResult,
            derived.intrinsicContradictions,
        );
        teachModeCheckUsed({
            revealLevel: "vague",
            verifiable: tally.verifiable,
            falsifiable: tally.falsifiable,
            plausible: tally.plausible,
            missed: tally.missed,
            inconsistent: tally.inconsistent,
            evidenceContradiction: tally.evidenceContradiction,
        });
        openBanner();
    };
    const { restartTourForScreen, currentStep } = useTour();
    // Force this menu open while the "Everything else lives here" tour
    // step is active so the user can see the items without clicking ⋯.
    // The "Everything else lives here" tour step (and any step that
    // spotlights a SPECIFIC menu item, like the sharing tour's three
    // share-affordance callouts) needs the menu open. The legacy
    // pattern observed `anchor === "overflow-menu"`, which only
    // worked when the step's spotlight was the menu itself. The
    // explicit `forceOpenOverflowMenu` flag generalizes that to any
    // step that wants the menu open regardless of its spotlight.
    const tourForcesMenuOpen =
        currentStep?.anchor === "overflow-menu"
        || currentStep?.forceOpenOverflowMenu === true;
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
                triggerClassName="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[var(--radius)] border-none bg-transparent text-[1.25rem] text-muted hover:text-accent"
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
                        label: tToolbar("newGame", {
                            shortcut: shortcutSuffix("global.newGame", hasKeyboard),
                        }),
                        onClick: onNewGame,
                    },
                    {
                        label: t("gameSetup", {
                            shortcut: shortcutSuffix("global.gotoSetup", hasKeyboard),
                        }),
                        active: setupActive,
                        onClick: onSetup,
                    },
                    {
                        label: tShare("menuItemInvitePlayer"),
                        onClick: () => openInvitePlayer(),
                        tourAnchor: "menu-item-invite-player",
                    },
                    {
                        label: tShare("menuItemTransferDevice"),
                        onClick: () => openContinueOnAnotherDevice(),
                        tourAnchor: "menu-item-transfer-device",
                    },
                    { type: "divider" },
                    // Group 2: Teach-me mode + Check my work — own
                    // section so the toggle's "(on)" indicator and the
                    // Check shortcut sit together, distinct from the
                    // surrounding chrome. Mobile-primary surface for
                    // Check (the Toolbar's top-level button is
                    // desktop-only).
                    {
                        label: state.teachMode
                            ? tTeach("menuLabelActive")
                            : tTeach("menuLabel"),
                        active: state.teachMode,
                        onClick: () =>
                            requestTeachMode(
                                !state.teachMode,
                                TEACH_SOURCE_OVERFLOW_MENU,
                            ),
                        tourAnchor: "menu-item-teach-mode",
                    },
                    ...(state.teachMode && state.uiMode !== "setup"
                        ? [
                              {
                                  label: tTeach("toolbarCheckLabel"),
                                  onClick: onCheckClick,
                                  tourAnchor: "menu-item-teach-mode-check",
                              } as const,
                          ]
                        : []),
                    { type: "divider" },
                    // Group 3: Account + content. Sign in / out sits
                    // alongside My card packs since both flows are
                    // account-driven.
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
                        tourAnchor: "menu-item-my-card-packs",
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
