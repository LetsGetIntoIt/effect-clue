/**
 * Captures the browser's `beforeinstallprompt` event, exposes the
 * deferred prompt() call, and gates whether to surface the in-app
 * `<InstallPromptModal />` automatically.
 *
 * Browser support: `beforeinstallprompt` only fires on Chromium
 * (Chrome, Edge, Android Chrome) when:
 *   - The page is served over HTTPS (or `localhost`).
 *   - A valid manifest is reachable at `/manifest.webmanifest`.
 *   - A service worker is registered and controls the page.
 *   - At least one icon ≥192px is in the manifest.
 *
 * Safari (desktop + iOS), Firefox, and other engines do NOT fire
 * this event — installation goes through the share-sheet "Add to
 * Home Screen" path. Our gate exposes `installable: false` on
 * those engines so the in-app prompt + the "Install app" overflow
 * menu item don't show.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { DateTime } from "effect";
import {
    computeShouldShowInstallPrompt,
    INSTALL_PROMPT_MIN_VISITS,
    INSTALL_PROMPT_SNOOZE_DURATION,
    loadInstallPromptState,
    recordInstallPromptDismissed,
    recordInstallPromptShown,
    recordInstallPromptVisit,
} from "../../logic/InstallPromptState";

/**
 * Shape of the `beforeinstallprompt` event. The browser type
 * libraries omit it because it's only on Chromium; we declare the
 * subset we actually use.
 */
interface BeforeInstallPromptEvent extends Event {
    readonly prompt: () => Promise<void>;
    readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface UseInstallPromptResult {
    /** True when the browser fired `beforeinstallprompt` and the user hasn't installed yet. */
    readonly installable: boolean;
    /** Decided once on mount: should the gate auto-fire the modal? */
    readonly shouldAutoShow: boolean;
    /** True after the browser fires `appinstalled`. */
    readonly installed: boolean;
    /**
     * Replay the deferred prompt — opens the OS-native install dialog.
     * Resolves to `true` when the user accepts, `false` otherwise.
     * No-ops (returns false) when there's no deferred prompt.
     */
    readonly install: () => Promise<boolean>;
    /** Persist a "user said no" timestamp so the gate snoozes. */
    readonly snooze: () => void;
    /** Persist a "we showed the modal" timestamp. */
    readonly markShown: () => void;
}

export function useInstallPrompt(): UseInstallPromptResult {
    const [deferred, setDeferred] =
        useState<BeforeInstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(false);
    const [shouldAutoShow, setShouldAutoShow] = useState(false);

    // Capture the deferred event on mount and decide whether to auto-fire.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const onBeforeInstallPrompt = (event: Event): void => {
            event.preventDefault();
            setDeferred(event as BeforeInstallPromptEvent);
        };
        const onAppInstalled = (): void => {
            setInstalled(true);
            setDeferred(null);
        };

        window.addEventListener(
            "beforeinstallprompt",
            onBeforeInstallPrompt as EventListener,
        );
        window.addEventListener("appinstalled", onAppInstalled);

        // Bump visit counter and decide the gate.
        const stateBefore = loadInstallPromptState();
        recordInstallPromptVisit();
        const stateAfter = {
            ...stateBefore,
            visits: stateBefore.visits + 1,
        };
        const should = computeShouldShowInstallPrompt(
            stateAfter,
            DateTime.nowUnsafe(),
            INSTALL_PROMPT_SNOOZE_DURATION,
            INSTALL_PROMPT_MIN_VISITS,
        );
        setShouldAutoShow(should);

        // Detect already-installed (standalone display mode).
        if (
            window.matchMedia("(display-mode: standalone)").matches ||
            // Safari iOS-specific.
            (window.navigator as unknown as { standalone?: boolean })
                .standalone === true
        ) {
            setInstalled(true);
        }

        return () => {
            window.removeEventListener(
                "beforeinstallprompt",
                onBeforeInstallPrompt as EventListener,
            );
            window.removeEventListener("appinstalled", onAppInstalled);
        };
    }, []);

    const install = useCallback(async (): Promise<boolean> => {
        if (!deferred) return false;
        try {
            await deferred.prompt();
            const choice = await deferred.userChoice;
            setDeferred(null);
            return choice.outcome === "accepted";
        } catch {
            return false;
        }
    }, [deferred]);

    const snooze = useCallback((): void => {
        recordInstallPromptDismissed(DateTime.nowUnsafe());
        setShouldAutoShow(false);
    }, []);

    const markShown = useCallback((): void => {
        recordInstallPromptShown(DateTime.nowUnsafe());
    }, []);

    return {
        installable: deferred !== null && !installed,
        shouldAutoShow: shouldAutoShow && deferred !== null && !installed,
        installed,
        install,
        snooze,
        markShown,
    };
}
