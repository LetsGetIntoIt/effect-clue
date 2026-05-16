/**
 * About-app splash modal shown on `/play` for first-time and dormant
 * users. Pushes onto the shared `ModalStack` with three pinned bands:
 *
 *   - `header`: title + X close
 *   - `content`: scrollable `AboutContent`
 *   - `footer`: "Start playing" primary CTA + "Don't show again" checkbox
 *
 * Both close paths funnel through the same dismiss handler so we
 * always emit `splash_screen_dismissed` with `method` ("x_button" |
 * "start_playing") and `dontShowAgainChecked`. Outside-click and
 * Escape (handled by the modal stack shell) are treated as the X
 * close path.
 *
 * The "show / don't show" decision lives in `useSplashGate` — this
 * file is only the chrome.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { splashScreenDismissed } from "../../analytics/events";
import { AboutContent } from "./AboutContent";
import { ArrowRightIcon, XIcon } from "./Icons";
import { useModalStack } from "./ModalStack";

const SPLASH_MODAL_ID = "splash" as const;
const SPLASH_MODAL_MAX_WIDTH = "min(92vw,640px)" as const;
// Wire-format discriminators for `splashScreenDismissed`'s `method`.
// Pulled to module scope so the i18next/no-literal-string lint rule
// reads them as identifiers rather than user copy.
const DISMISS_METHOD_X = "x_button" as const;
const DISMISS_METHOD_CTA = "start_playing" as const;

function SplashFooter({
    ctaRef,
    dontShowAgainRef,
    onStartPlaying,
    ctaLabel,
    dontShowAgainLabel,
}: {
    readonly ctaRef: React.RefObject<HTMLButtonElement | null>;
    readonly dontShowAgainRef: React.RefObject<boolean>;
    readonly onStartPlaying: () => void;
    readonly ctaLabel: string;
    readonly dontShowAgainLabel: string;
}) {
    // Footer owns the checkbox state and mirrors the latest value into
    // the shared ref so the X-close handler in the header (which lives
    // outside this subtree) can read the user's choice without a
    // cross-slot React context.
    const [dontShowAgain, setDontShowAgain] = useState(false);
    useEffect(() => {
        dontShowAgainRef.current = dontShowAgain;
    }, [dontShowAgain, dontShowAgainRef]);

    return (
        <div className="bg-panel px-5 pt-4 pb-5">
            <button
                ref={ctaRef}
                type="button"
                onClick={onStartPlaying}
                className={
                    "flex w-full cursor-pointer items-center justify-center gap-2 " +
                    "rounded-[var(--radius)] border-2 border-accent bg-accent " +
                    "px-6 py-3.5 text-[1.125rem] font-bold text-white " +
                    "shadow-[0_4px_14px_rgba(122,28,28,0.35)] " +
                    "hover:bg-accent-hover hover:shadow-[0_6px_18px_rgba(122,28,28,0.45)] " +
                    "active:translate-y-[1px] active:shadow-[0_2px_8px_rgba(122,28,28,0.35)] " +
                    "transition-all"
                }
            >
                <span>{ctaLabel}</span>
                <ArrowRightIcon size={20} />
            </button>
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 text-[1rem] text-muted">
                <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(e) => setDontShowAgain(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-accent"
                />
                <span>{dontShowAgainLabel}</span>
            </label>
        </div>
    );
}

interface SplashModalGateProps {
    readonly open: boolean;
    readonly onDismiss: (dontShowAgain: boolean) => void;
}

/**
 * Imperative gate hook. Watches `open` and pushes / pops the splash
 * onto the modal stack. `onDismiss` is held in a ref so a parent
 * re-render that recreates the callback doesn't churn the effect
 * (which would unmount-remount the splash mid-display).
 */
export function useSplashModalGate({
    open,
    onDismiss,
}: SplashModalGateProps): void {
    const t = useTranslations("splash");
    const tCommon = useTranslations("common");
    const { push, popTo } = useModalStack();
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;
    // next-intl's `useTranslations` returns a new function reference
    // each call in some test mocks, so capturing in a ref keeps the
    // effect deps stable.
    const tRef = useRef(t);
    tRef.current = t;
    const tCommonRef = useRef(tCommon);
    tCommonRef.current = tCommon;

    const ctaRef = useRef<HTMLButtonElement | null>(null);
    const dontShowAgainRef = useRef(false);

    const dismiss = useCallback(
        (method: typeof DISMISS_METHOD_X | typeof DISMISS_METHOD_CTA) => {
            const dontShowAgain = dontShowAgainRef.current;
            splashScreenDismissed({
                method,
                dontShowAgainChecked: dontShowAgain,
            });
            popTo(SPLASH_MODAL_ID);
            onDismissRef.current(dontShowAgain);
        },
        [popTo],
    );

    useEffect(() => {
        if (!open) return;
        const t = tRef.current;
        const tCommon = tCommonRef.current;
        const title = t("title");
        push({
            id: SPLASH_MODAL_ID,
            title,
            maxWidth: SPLASH_MODAL_MAX_WIDTH,
            header: (
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                    <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                        {title}
                    </Dialog.Title>
                    <button
                        type="button"
                        aria-label={tCommon("close")}
                        onClick={() => dismiss(DISMISS_METHOD_X)}
                        className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                    >
                        <XIcon size={18} />
                    </button>
                </div>
            ),
            content: (
                <>
                    <p className="sr-only">{t("description")}</p>
                    <div className="px-5 pt-3 pb-5">
                        <AboutContent context="modal" />
                    </div>
                </>
            ),
            footer: (
                <SplashFooter
                    ctaRef={ctaRef}
                    dontShowAgainRef={dontShowAgainRef}
                    onStartPlaying={() => dismiss(DISMISS_METHOD_CTA)}
                    ctaLabel={t("startPlaying")}
                    dontShowAgainLabel={t("dontShowAgain")}
                />
            ),
        });
        return () => {
            popTo(SPLASH_MODAL_ID);
        };
    }, [open, push, popTo, dismiss]);

    // Bias focus toward the CTA on mount so a user who hits Enter on
    // muscle memory accepts rather than dismisses. Single rAF lets the
    // shell's slide animation begin before we steal focus.
    useEffect(() => {
        if (!open) return;
        const id = window.requestAnimationFrame(() => {
            ctaRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(id);
    }, [open]);
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
