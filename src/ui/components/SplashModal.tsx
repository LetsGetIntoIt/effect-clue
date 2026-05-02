/**
 * About-app splash modal shown on `/play` for first-time and dormant
 * users. Wraps `<AboutContent />` in a Radix `Dialog` with:
 *
 *   - X close in the top-right
 *   - "Start playing" primary button at the bottom
 *   - "Don't show this again" checkbox above the button
 *
 * Both close paths funnel through the same dismiss handler so we
 * always emit `splash_screen_dismissed` with `method` ("x_button" |
 * "start_playing") and `dontShowAgainChecked`. ESC and overlay click
 * are treated as the X close (`onOpenChange(false)`).
 *
 * The "show / don't show" decision lives in `useSplashGate` — this
 * component is only the chrome.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { splashScreenDismissed } from "../../analytics/events";
import { AboutContent } from "./AboutContent";
import { ArrowRightIcon, XIcon } from "./Icons";

export function SplashModal({
    open,
    onDismiss,
}: {
    readonly open: boolean;
    /** Fires when the user closes the modal by any path. */
    readonly onDismiss: (dontShowAgain: boolean) => void;
}) {
    const t = useTranslations("splash");
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const ctaRef = useRef<HTMLButtonElement | null>(null);

    const handleDismiss = (method: "start_playing" | "x_button") => {
        splashScreenDismissed({
            method,
            dontShowAgainChecked: dontShowAgain,
        });
        onDismiss(dontShowAgain);
    };

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => {
                // eslint-disable-next-line i18next/no-literal-string
                if (!next) handleDismiss("x_button");
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,640px)] max-h-[90vh] flex-col " +
                        "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                    onOpenAutoFocus={(e) => {
                        // Radix's default focuses the first focusable
                        // descendant — that's the X. Bias instead toward
                        // the CTA so a user who hits Enter on muscle
                        // memory accepts rather than dismisses. The
                        // setTimeout (vs rAF) lets Radix's FocusScope
                        // settle before we override — rAF can lose the
                        // race when the modal opens during a busy
                        // render path (e.g. coming out of the startup
                        // coordinator).
                        e.preventDefault();
                        window.setTimeout(() => {
                            ctaRef.current?.focus();
                        }, 50);
                    }}
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                        <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                            {t("title")}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={t("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="sr-only">
                        {t("description")}
                    </Dialog.Description>
                    <div className="flex-1 overflow-y-auto px-5 pt-3 pb-5">
                        <AboutContent context="modal" />
                    </div>
                    <div className="shrink-0 border-t border-border bg-panel px-5 pt-4 pb-5">
                        <button
                            ref={ctaRef}
                            type="button"
                            onClick={() => handleDismiss("start_playing")}
                            className={
                                "flex w-full cursor-pointer items-center justify-center gap-2 " +
                                "rounded-[var(--radius)] border-2 border-accent bg-accent " +
                                "px-6 py-3.5 text-[18px] font-bold text-white " +
                                "shadow-[0_4px_14px_rgba(122,28,28,0.35)] " +
                                "hover:bg-accent-hover hover:shadow-[0_6px_18px_rgba(122,28,28,0.45)] " +
                                "active:translate-y-[1px] active:shadow-[0_2px_8px_rgba(122,28,28,0.35)] " +
                                "transition-all"
                            }
                        >
                            <span>{t("startPlaying")}</span>
                            <ArrowRightIcon size={20} />
                        </button>
                        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 text-[13px] text-muted">
                            <input
                                type="checkbox"
                                checked={dontShowAgain}
                                onChange={(e) =>
                                    setDontShowAgain(e.target.checked)
                                }
                                className="h-4 w-4 cursor-pointer accent-accent"
                            />
                            <span>{t("dontShowAgain")}</span>
                        </label>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
