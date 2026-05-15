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
import { resetScrollMemory } from "../scrollMemory";
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
import { PlayCTAButton } from "./PlayCTAButton";
import { teachModeCheckUsed } from "../../analytics/events";
import { tallyVerdicts } from "../../logic/TeachMode";
import { useTeachModeCheck } from "./TeachModeCheckContext";
import { useTeachModeToggle } from "./useTeachModeToggle";
import { Tooltip } from "./Tooltip";

// Module-scope discriminator values, exempt from the i18next literal
// lint rule.
const TRIGGER_MENU: InstallPromptTrigger = "menu";

// Source token passed to `requestTeachMode` from the overflow menu.
// Hoisted so the lint rule reads it as a code identifier.
const TEACH_SOURCE_OVERFLOW_MENU = "overflowMenu" as const;

const buttonClass =
    "tap-target-compact text-tap-compact rounded-[var(--radius)] border border-border bg-white " +
    "cursor-pointer hover:bg-hover " +
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
            resetScrollMemory();
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
    const tTeach = useTranslations("teachMode");
    const hasKeyboard = useHasKeyboard();
    const {
        state,
        dispatch,
        derived,
        canUndo,
        canRedo,
        undo,
        redo,
        nextUndo,
        nextRedo,
    } = useClue();
    const { onNewGame } = useToolbarActions();
    const { openBanner } = useTeachModeCheck();
    const requestTeachMode = useTeachModeToggle();
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
            {state.teachMode && state.uiMode !== "setup" && (
                <button
                    type="button"
                    onClick={onCheckClick}
                    className={`${buttonClass} inline-flex items-center gap-1.5`}
                    aria-label={tTeach("toolbarCheckAria")}
                    data-tour-anchor="teach-mode-check"
                >
                    {tTeach("toolbarCheckLabel")}
                </button>
            )}
            <PlayCTAButton variant="toolbar" />
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
                        tourAnchor: "menu-item-invite-player",
                    },
                    {
                        label: tShare("menuItemTransferDevice"),
                        onClick: () => openContinueOnAnotherDevice(),
                        tourAnchor: "menu-item-transfer-device",
                    },
                    { type: "divider" },
                    // Group 2: Account
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
                    { type: "divider" },
                    // Group 3: Teach-me mode + Check my work — own
                    // section so the toggle's "(on)" indicator and the
                    // Check shortcut sit together, distinct from the
                    // surrounding chrome.
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
                    // Check my work — hidden when not in teach-mode
                    // or while still in setup. The Toolbar top-level
                    // button covers desktop; this menu item is the
                    // primary entry point on mobile (Toolbar isn't
                    // rendered below 800px) and a secondary path on
                    // desktop.
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
                    // Group 4: Content + onboarding
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
