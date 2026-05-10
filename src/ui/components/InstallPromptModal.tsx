/**
 * In-app modal that pitches PWA installation. Sits above the native
 * browser install banner and gives the user a clear value prop
 * ("offline access, home-screen icon, faster cold start") before
 * the native dialog appears.
 *
 * Two affordances:
 *   - "Install" — calls into the deferred `beforeinstallprompt`, which
 *     opens the OS-native dialog.
 *   - "Not now" — snoozes the gate for 4 weeks via `useInstallPrompt`'s
 *     `snooze()` callback.
 *
 * Visual identity matches the in-game palette (parchment + oxblood)
 * so it reads as "the app talking to you" rather than as meta UI
 * like the tour. The trigger comes from the gate or from the
 * "Install app" overflow menu item.
 *
 * Rendered via the global modal stack — the content has no
 * `Dialog.Root` of its own. `useInstallPromptModalGate` watches the
 * consumer gate and pushes / pops the entry.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { DateTime } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import {
    installAccepted,
    installDismissed,
    installPrompted,
    type InstallDismissVia,
    type InstallPromptTrigger,
} from "../../analytics/events";
import {
    computeInstallPromptAnalyticsContext,
    loadInstallPromptState,
} from "../../logic/InstallPromptState";
import { ArrowRightIcon, XIcon } from "./Icons";
import { useModalStack } from "./ModalStack";

const VIA_NATIVE_DECLINE = "native_decline" satisfies InstallDismissVia;
const VIA_SNOOZE = "snooze" satisfies InstallDismissVia;
const VIA_X_BUTTON = "x_button" satisfies InstallDismissVia;

const INSTALL_PROMPT_MODAL_ID = "install-prompt" as const;
const INSTALL_PROMPT_MAX_WIDTH = "min(92vw,480px)" as const;

interface InstallPromptModalContentProps {
    readonly trigger: InstallPromptTrigger;
    readonly onInstall: () => Promise<boolean>;
    readonly onSnooze: () => void;
    readonly onClose: () => void;
}

function InstallPromptModalContent({
    trigger,
    onInstall,
    onSnooze,
    onClose,
}: InstallPromptModalContentProps) {
    const t = useTranslations("installPrompt");
    const tCommon = useTranslations("common");
    const notNowRef = useRef<HTMLButtonElement | null>(null);

    // Bias focus toward "Not now" — the user wasn't seeking out an
    // install, so a stray Enter on Install would feel hostile.
    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            notNowRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(id);
    }, []);

    const handleInstall = async (): Promise<void> => {
        const ctx = computeInstallPromptAnalyticsContext(
            loadInstallPromptState(),
            DateTime.nowUnsafe(),
        );
        installPrompted({ trigger, ...ctx });
        const accepted = await onInstall();
        if (accepted) {
            installAccepted({ trigger });
        } else {
            installDismissed({ trigger, via: VIA_NATIVE_DECLINE });
        }
        onClose();
    };

    const handleSnooze = (): void => {
        installDismissed({ trigger, via: VIA_SNOOZE });
        onSnooze();
        onClose();
    };

    const handleXClose = (): void => {
        installDismissed({ trigger, via: VIA_X_BUTTON });
        onSnooze();
        onClose();
    };

    return (
        <div className="flex flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                    {t("title")}
                </Dialog.Title>
                <button
                    type="button"
                    aria-label={tCommon("close")}
                    onClick={handleXClose}
                    className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                >
                    <XIcon size={18} />
                </button>
            </div>
            <p className="px-5 pt-3 text-[14px] leading-relaxed">
                {t("description")}
            </p>
            <ul className="m-0 list-disc px-5 pl-9 pt-3 text-[14px] leading-relaxed">
                <li>{t("benefitOffline")}</li>
                <li>{t("benefitHomeScreen")}</li>
                <li>{t("benefitFastLaunch")}</li>
            </ul>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                <button
                    ref={notNowRef}
                    type="button"
                    onClick={handleSnooze}
                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-white hover:bg-hover"
                >
                    {t("notNow")}
                </button>
                <button
                    type="button"
                    onClick={() => void handleInstall()}
                    className={
                        "tap-target text-tap inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-accent bg-accent " +
                        "font-semibold text-white hover:bg-accent-hover"
                    }
                >
                    <span>{t("install")}</span>
                    <ArrowRightIcon size={16} />
                </button>
            </div>
        </div>
    );
}

interface InstallPromptModalGateProps {
    readonly open: boolean;
    readonly trigger: InstallPromptTrigger;
    readonly onInstall: () => Promise<boolean>;
    readonly onSnooze: () => void;
    readonly onClose: () => void;
}

/** Push / pop the install-prompt modal as the consumer's gate flips. */
function useInstallPromptModalGate({
    open,
    trigger,
    onInstall,
    onSnooze,
    onClose,
}: InstallPromptModalGateProps): void {
    const t = useTranslations("installPrompt");
    const { push, popTo } = useModalStack();
    const handlersRef = useRef({ onInstall, onSnooze, onClose });
    handlersRef.current = { onInstall, onSnooze, onClose };
    const titleRef = useRef("");
    titleRef.current = t("title");
    useEffect(() => {
        if (!open) return;
        push({
            id: INSTALL_PROMPT_MODAL_ID,
            title: titleRef.current,
            maxWidth: INSTALL_PROMPT_MAX_WIDTH,
            content: (
                <InstallPromptModalContent
                    trigger={trigger}
                    onInstall={() => handlersRef.current.onInstall()}
                    onSnooze={() => handlersRef.current.onSnooze()}
                    onClose={() => {
                        popTo(INSTALL_PROMPT_MODAL_ID);
                        handlersRef.current.onClose();
                    }}
                />
            ),
        });
        return () => {
            popTo(INSTALL_PROMPT_MODAL_ID);
        };
    }, [open, trigger, push, popTo]);
}

/**
 * Backwards-compatible component wrapper. Tests can keep mounting
 * `<InstallPromptModal open ... />` directly.
 */
export function InstallPromptModal(props: InstallPromptModalGateProps) {
    useInstallPromptModalGate(props);
    return null;
}
