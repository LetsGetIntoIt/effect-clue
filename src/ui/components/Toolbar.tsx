"use client";

import { useTranslations } from "next-intl";
import {
    aboutLinkClicked,
    gameSetupStarted,
} from "../../analytics/events";
import { startSetup } from "../../analytics/gameSession";
import { describeAction } from "../../logic/describeAction";
import { routes } from "../../routes";
import { useConfirm } from "../hooks/useConfirm";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useClue } from "../state";
import { shortcutSuffix } from "../keyMap";
import { useTour } from "../tour/TourProvider";
import { screenKeyForUiMode } from "../tour/screenKey";
import { AccountAvatar } from "../account/AccountAvatar";
import { useAccountContext } from "../account/AccountProvider";
import { useShareContext } from "../share/ShareProvider";
import { useSession } from "../hooks/useSession";
import { ExternalLinkIcon, RedoIcon, UndoIcon } from "./Icons";
import { useInstallPromptContext } from "./InstallPromptProvider";
import type { InstallPromptTrigger } from "../../analytics/events";
import { OverflowMenu } from "./OverflowMenu";
import { Tooltip } from "./Tooltip";

// Module-scope discriminator values, exempt from the i18next literal
// lint rule.
const TRIGGER_MENU: InstallPromptTrigger = "menu";

const buttonClass =
    "rounded-[var(--radius)] border border-border bg-white px-3.5 py-1.5 " +
    "text-[13px] cursor-pointer hover:bg-hover " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
    "focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

/**
 * Shared handlers for the New-game action used by both the desktop
 * Toolbar overflow menu and the mobile BottomNav overflow menu.
 *
 * The Share-link action that used to live here was dropped during M3
 * — the base64 `?state=...` URL flow was removed entirely, and the
 * server-stored `/share/[id]` flow that replaces it lands in M9 with
 * its own creation modal. There is no Share menu item between M3 and
 * M9.
 */
export function useToolbarActions() {
    const t = useTranslations("toolbar");
    const { dispatch } = useClue();
    const confirm = useConfirm();

    const onNewGame = async () => {
        if (await confirm({ message: t("newGameConfirm") })) {
            startSetup();
            dispatch({ type: "newGame" });
            gameSetupStarted();
        }
    };

    return { onNewGame };
}

/**
 * Top-of-page controls (desktop only): undo/redo as top-level buttons,
 * plus a ⋯ overflow menu that hosts Game setup and New game. Mirrors
 * the mobile `BottomNav` overflow so both breakpoints share the same
 * menu structure. The Share item that used to live here was dropped
 * in M3; M9 reintroduces it pointing at the server-stored share flow.
 */
export function Toolbar() {
    const t = useTranslations("toolbar");
    const tNav = useTranslations("bottomNav");
    const tHistory = useTranslations("history");
    const tOnboarding = useTranslations("onboarding");
    const tInstall = useTranslations("installPrompt");
    const tAccount = useTranslations("account");
    const tShare = useTranslations("share");
    const hasKeyboard = useHasKeyboard();
    const {
        state,
        dispatch,
        canUndo,
        canRedo,
        undo,
        redo,
        nextUndo,
        nextRedo,
    } = useClue();
    const { onNewGame } = useToolbarActions();
    const { restartTourForScreen, currentStep } = useTour();
    // The "Everything else lives here" tour step points at this menu.
    // Force it open while that step is active so the user can see
    // what's inside without having to click ⋯ themselves.
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

    const undoTooltip = nextUndo
        ? tHistory("undoTooltip", {
              description: describeAction(
                  nextUndo.action,
                  nextUndo.previousState,
                  tHistory,
              ),
          })
        : undefined;
    const redoTooltip = nextRedo
        ? tHistory("redoTooltip", {
              description: describeAction(
                  nextRedo.action,
                  nextRedo.previousState,
                  tHistory,
              ),
          })
        : undefined;

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Tooltip content={undoTooltip}>
                <button
                    type="button"
                    className={`${buttonClass} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={undo}
                    disabled={!canUndo}
                    title={t("undoTitle")}
                    aria-label={t("undoAria")}
                >
                    <UndoIcon size={15} className="shrink-0" />
                    {t("undo", { shortcut: shortcutSuffix("global.undo", hasKeyboard) })}
                </button>
            </Tooltip>
            <Tooltip content={redoTooltip}>
                <button
                    type="button"
                    className={`${buttonClass} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={redo}
                    disabled={!canRedo}
                    title={t("redoTitle")}
                    aria-label={t("redoAria")}
                >
                    <RedoIcon size={15} className="shrink-0" />
                    {t("redo", { shortcut: shortcutSuffix("global.redo", hasKeyboard) })}
                </button>
            </Tooltip>
            <OverflowMenu
                triggerClassName={`${buttonClass} inline-flex items-center justify-center`}
                triggerLabel={tNav("more")}
                side="bottom"
                align="end"
                forceOpen={tourForcesMenuOpen}
                // The Toolbar is hidden via CSS on mobile, but the
                // portaled menu content is rendered to body and
                // wouldn't inherit that. Hide it here when below the
                // 800px breakpoint so the desktop menu doesn't ghost
                // on mobile when forceOpen flips it on for the tour.
                contentClassName="[@media(max-width:799px)]:hidden"
                items={[
                    // Group 1: Game
                    {
                        label: tNav("gameSetup", {
                            shortcut: shortcutSuffix("global.gotoSetup", hasKeyboard),
                        }),
                        active: state.uiMode === "setup",
                        onClick: () =>
                            dispatch({ type: "setUiMode", mode: "setup" }),
                    },
                    {
                        label: t("newGame", {
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
                    // Group 3: Help / system. "Install app" only
                    // appears when the browser confirmed
                    // installability via `beforeinstallprompt`.
                    // On Safari / iOS the event never fires, so the
                    // item never renders — those users install via
                    // the share sheet.
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
                        label: tNav("about"),
                        trailingIcon: <ExternalLinkIcon size={14} />,
                        onClick: () => {
                            aboutLinkClicked({ source: "overflow_menu" });
                            window.open(routes.about, "about-page", "noopener");
                        },
                    },
                ]}
            />
        </div>
    );
}
