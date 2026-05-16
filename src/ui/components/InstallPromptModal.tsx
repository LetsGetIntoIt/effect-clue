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
 * Pushed onto the shared `ModalStack` with the standard three slots —
 * `header` (title + X), `content` (description + benefits), `footer`
 * (Not now / Install).
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { DateTime } from "effect";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
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
    const tCommon = useTranslations("common");
    const { push, popTo } = useModalStack();
    const handlersRef = useRef({ onInstall, onSnooze, onClose });
    handlersRef.current = { onInstall, onSnooze, onClose };
    const tRef = useRef(t);
    tRef.current = t;
    const tCommonRef = useRef(tCommon);
    tCommonRef.current = tCommon;
    const notNowRef = useRef<HTMLButtonElement | null>(null);

    const handleInstall = useCallback(async (): Promise<void> => {
        const ctx = computeInstallPromptAnalyticsContext(
            loadInstallPromptState(),
            DateTime.nowUnsafe(),
        );
        installPrompted({ trigger, ...ctx });
        const accepted = await handlersRef.current.onInstall();
        if (accepted) {
            installAccepted({ trigger });
        } else {
            installDismissed({ trigger, via: VIA_NATIVE_DECLINE });
        }
        popTo(INSTALL_PROMPT_MODAL_ID);
        handlersRef.current.onClose();
    }, [trigger, popTo]);

    const handleSnooze = useCallback((): void => {
        installDismissed({ trigger, via: VIA_SNOOZE });
        handlersRef.current.onSnooze();
        popTo(INSTALL_PROMPT_MODAL_ID);
        handlersRef.current.onClose();
    }, [trigger, popTo]);

    const handleXClose = useCallback((): void => {
        installDismissed({ trigger, via: VIA_X_BUTTON });
        handlersRef.current.onSnooze();
        popTo(INSTALL_PROMPT_MODAL_ID);
        handlersRef.current.onClose();
    }, [trigger, popTo]);

    useEffect(() => {
        if (!open) return;
        const t = tRef.current;
        const tCommon = tCommonRef.current;
        const title = t("title");
        push({
            id: INSTALL_PROMPT_MODAL_ID,
            title,
            maxWidth: INSTALL_PROMPT_MAX_WIDTH,
            header: (
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                    <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                        {title}
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
            ),
            content: (
                <div className="px-5 pb-3">
                    <p className="m-0 pt-3 text-[1rem] leading-normal">
                        {t("description")}
                    </p>
                    <ul className="m-0 list-disc pl-4 pt-3 text-[1rem] leading-normal">
                        <li>{t("benefitOffline")}</li>
                        <li>{t("benefitHomeScreen")}</li>
                        <li>{t("benefitFastLaunch")}</li>
                    </ul>
                </div>
            ),
            footer: (
                <div className="flex items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
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
            ),
        });
        return () => {
            popTo(INSTALL_PROMPT_MODAL_ID);
        };
    }, [open, push, popTo, handleInstall, handleSnooze, handleXClose]);

    // Bias focus toward "Not now" — the user wasn't seeking out an
    // install, so a stray Enter on Install would feel hostile.
    useEffect(() => {
        if (!open) return;
        const id = window.requestAnimationFrame(() => {
            notNowRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(id);
    }, [open]);
}

/**
 * Backwards-compatible component wrapper. Tests can keep mounting
 * `<InstallPromptModal open ... />` directly.
 */
export function InstallPromptModal(props: InstallPromptModalGateProps) {
    useInstallPromptModalGate(props);
    return null;
}
