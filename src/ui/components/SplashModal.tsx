/**
 * About-app splash modal shown on `/play` for first-time and dormant
 * users. Wraps `<AboutContent />` with the splash chrome:
 *
 *   - X close in the top-right
 *   - "Start playing" primary button at the bottom
 *   - "Don't show this again" checkbox above the button
 *
 * Both close paths funnel through the same dismiss handler so we
 * always emit `splash_screen_dismissed` with `method` ("x_button" |
 * "start_playing") and `dontShowAgainChecked`. Outside-click and
 * Escape (handled by the modal stack shell) are treated as the X
 * close path.
 *
 * Rendered via the global modal stack (`SPLASH_MODAL_ID`). The
 * content component itself owns no `Dialog.Root` — the shell wraps
 * it. Mounting code (`useSplashGate`'s consumer) pushes this entry
 * when the splash gate flips true.
 *
 * The "show / don't show" decision lives in `useSplashGate` — this
 * component is only the chrome.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { splashScreenDismissed } from "../../analytics/events";
import { AboutContent } from "./AboutContent";
import { ArrowRightIcon, XIcon } from "./Icons";
import { useModalStack } from "./ModalStack";

const SPLASH_MODAL_ID = "splash" as const;
const SPLASH_MODAL_MAX_WIDTH = "min(92vw,640px)" as const;

function SplashModalContent({
    onDismiss,
}: {
    /** Fires when the user closes the modal by any path. The caller
     *  is responsible for pop()'ing the modal off the stack. */
    readonly onDismiss: (dontShowAgain: boolean) => void;
}) {
    const t = useTranslations("splash");
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const ctaRef = useRef<HTMLButtonElement | null>(null);

    // Bias focus toward the CTA on mount so a user who hits Enter on
    // muscle memory accepts rather than dismisses. Single rAF lets the
    // shell's slide animation begin before we steal focus.
    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            ctaRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(id);
    }, []);

    const handleDismiss = (method: "start_playing" | "x_button") => {
        splashScreenDismissed({
            method,
            dontShowAgainChecked: dontShowAgain,
        });
        onDismiss(dontShowAgain);
    };

    return (
        <div className="flex max-h-[90vh] flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                    {t("title")}
                </Dialog.Title>
                <button
                    type="button"
                    aria-label={t("close")}
                    onClick={() => handleDismiss("x_button")}
                    className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                >
                    <XIcon size={18} />
                </button>
            </div>
            <p className="sr-only">{t("description")}</p>
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
        </div>
    );
}

interface SplashModalGateProps {
    readonly open: boolean;
    readonly onDismiss: (dontShowAgain: boolean) => void;
}

/**
 * Imperative gate hook. Watches `open` and pushes / pops the splash
 * content onto the modal stack accordingly. `onDismiss` is held in a
 * ref so a parent re-render that recreates the callback doesn't churn
 * the effect (which would unmount-remount the splash mid-display).
 */
export function useSplashModalGate({
    open,
    onDismiss,
}: SplashModalGateProps): void {
    const t = useTranslations("splash");
    const { push, popTo } = useModalStack();
    // Capture handler + translated title in refs so the effect doesn't
    // re-fire when the parent re-renders (which would re-push the
    // entry every render — infinite mount loop). next-intl's
    // `useTranslations` returns a new function reference each call in
    // some test mocks, so we can't put `t` in the effect deps either.
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;
    const titleRef = useRef("");
    titleRef.current = t("title");
    useEffect(() => {
        if (!open) return;
        push({
            id: SPLASH_MODAL_ID,
            title: titleRef.current,
            maxWidth: SPLASH_MODAL_MAX_WIDTH,
            content: (
                <SplashModalContent
                    onDismiss={(dontShowAgain) => {
                        popTo(SPLASH_MODAL_ID);
                        onDismissRef.current(dontShowAgain);
                    }}
                />
            ),
        });
        return () => {
            popTo(SPLASH_MODAL_ID);
        };
    }, [open, push, popTo]);
}

/**
 * Backwards-compatible component wrapper around `useSplashModalGate`.
 * Tests that mount `<SplashModal open onDismiss={...} />` directly
 * keep working without hand-pushing onto the stack.
 */
export function SplashModal(props: SplashModalGateProps) {
    useSplashModalGate(props);
    return null;
}
