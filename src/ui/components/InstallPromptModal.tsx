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
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import {
    installAccepted,
    installDismissed,
    installPrompted,
    type InstallDismissVia,
    type InstallPromptTrigger,
} from "../../analytics/events";
import { ArrowRightIcon, XIcon } from "./Icons";

// Module-scope discriminator constants for the analytics payload —
// exempt from the i18next/no-literal-string rule. Keep them aligned
// with `InstallDismissVia` in events.ts.
const VIA_NATIVE_DECLINE = "native_decline" satisfies InstallDismissVia;
const VIA_SNOOZE = "snooze" satisfies InstallDismissVia;
const VIA_X_BUTTON = "x_button" satisfies InstallDismissVia;

export function InstallPromptModal({
    open,
    trigger,
    onInstall,
    onSnooze,
    onClose,
}: {
    readonly open: boolean;
    /** What surfaced this modal: auto-gate, menu click, or tour step. */
    readonly trigger: InstallPromptTrigger;
    /** Resolves to true when the user accepted, false otherwise. */
    readonly onInstall: () => Promise<boolean>;
    /** Persist a snooze timestamp; called by the "Not now" path. */
    readonly onSnooze: () => void;
    /** Hide the modal without snoozing. Called from the X close. */
    readonly onClose: () => void;
}) {
    const t = useTranslations("installPrompt");
    const tCommon = useTranslations("common");

    const handleInstall = async (): Promise<void> => {
        installPrompted({ trigger });
        const accepted = await onInstall();
        if (accepted) {
            installAccepted({ trigger });
        } else {
            // The user declined the OS-native dialog. Don't snooze
            // — they may install via the menu later. The modal closes
            // either way because the deferred prompt is one-shot.
            installDismissed({ trigger, via: VIA_NATIVE_DECLINE });
        }
        onClose();
    };

    const handleSnooze = (): void => {
        installDismissed({ trigger, via: VIA_SNOOZE });
        onSnooze();
        onClose();
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    installDismissed({ trigger, via: VIA_X_BUTTON });
                    onClose();
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,480px)] flex-col " +
                        "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                        <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                            {t("title")}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={tCommon("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                        {t("description")}
                    </Dialog.Description>
                    <ul className="m-0 list-disc px-5 pl-9 pt-3 text-[14px] leading-relaxed">
                        <li>{t("benefitOffline")}</li>
                        <li>{t("benefitHomeScreen")}</li>
                        <li>{t("benefitFastLaunch")}</li>
                    </ul>
                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border bg-panel px-5 pt-4 pb-5">
                        <button
                            type="button"
                            onClick={handleSnooze}
                            className="cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[14px] hover:bg-hover"
                        >
                            {t("notNow")}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleInstall()}
                            className={
                                "inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius)] border-2 border-accent bg-accent " +
                                "px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                            }
                        >
                            <span>{t("install")}</span>
                            <ArrowRightIcon size={16} />
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
