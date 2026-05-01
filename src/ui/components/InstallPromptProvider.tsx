/**
 * Top-level provider for the PWA install flow.
 *
 * The browser fires `beforeinstallprompt` exactly once per page
 * load; whoever calls `prompt()` first owns the deferred prompt
 * forever. So we capture it ONCE here, share it via context, and
 * have any UI surface (the auto-gate, the "Install app" overflow
 * menu item, the setup tour's install step) replay it through
 * `openModal(trigger)`.
 *
 * Auto-gate is delegated to `<StartupCoordinatorProvider>`. This
 * provider only auto-opens the modal when the coordinator's phase is
 * `"install"` AND the browser has fired `beforeinstallprompt`. If
 * the deferred event hasn't fired by the time the coordinator
 * advances to install, we wait a short window (3s) for it before
 * giving up — the user can still install manually from the ⋯ menu.
 */
"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Duration } from "effect";
import {
    appLaunchedStandalone,
    installCompleted,
    type InstallPromptTrigger,
} from "../../analytics/events";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { useStartupCoordinator } from "../onboarding/StartupCoordinator";
import { InstallPromptModal } from "./InstallPromptModal";

// Discriminator values for the analytics `trigger` payload — kept at
// module scope so the i18next/no-literal-string lint rule treats them
// as wire-format strings rather than user copy.
const TRIGGER_AUTO = "auto" satisfies InstallPromptTrigger;
// Coordinator slot discriminator. Same name as `StartupSlot` but
// extracted as a constant so the lint rule treats it as a wire-format
// identifier rather than user copy.
const SLOT_INSTALL = "install" as const;

/**
 * How long to wait for `beforeinstallprompt` to fire after the
 * coordinator advances to the install phase. If the browser hasn't
 * fired it within this window, we advance to "done" — the visit
 * gate said the user is eligible, but the OS isn't offering install
 * right now (already installed, unsupported browser, criteria not
 * met). The user can still trigger install from the ⋯ menu later.
 */
const INSTALL_WAIT_FOR_DEFERRED_PROMPT = Duration.seconds(3);

interface InstallPromptContextValue {
    /**
     * True when the browser fired `beforeinstallprompt` and the user
     * hasn't installed yet. Drives whether the "Install app" menu
     * item is even rendered — it shouldn't show on Safari / iOS
     * where the prompt path lives in the share sheet.
     */
    readonly installable: boolean;
    /** Open the modal manually (e.g. from the overflow menu). */
    readonly openModal: (trigger: InstallPromptTrigger) => void;
}

const InstallPromptContext = createContext<
    InstallPromptContextValue | undefined
>(undefined);

export const useInstallPromptContext = (): InstallPromptContextValue => {
    const ctx = useContext(InstallPromptContext);
    if (!ctx) {
        // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion.
        throw new Error("useInstallPromptContext must be inside <InstallPromptProvider>");
    }
    return ctx;
};

export function InstallPromptProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const { phase, reportClosed } = useStartupCoordinator();
    const {
        installable,
        installed,
        install,
        snooze,
        markShown,
    } = useInstallPrompt();
    const [openTrigger, setOpenTrigger] =
        useState<InstallPromptTrigger | undefined>(undefined);

    // Fire `app_launched_standalone` once on mount when running as
    // a PWA — useful for understanding which fraction of sessions
    // are launched from the home screen vs. browser tab.
    const launchedRef = useRef(false);
    useEffect(() => {
        if (launchedRef.current) return;
        if (typeof window === "undefined") return;
        if (
            window.matchMedia("(display-mode: standalone)").matches ||
            (window.navigator as unknown as { standalone?: boolean })
                .standalone === true
        ) {
            launchedRef.current = true;
            appLaunchedStandalone();
        }
    }, []);

    // Bridge `appinstalled` to `install_completed`.
    const completedRef = useRef(false);
    useEffect(() => {
        if (installed && !completedRef.current) {
            completedRef.current = true;
            installCompleted();
        }
    }, [installed]);

    // Auto-fire when the coordinator says it's our turn AND the
    // deferred prompt is available. If the prompt hasn't fired by the
    // time the phase advances, wait a short window before giving up
    // — `beforeinstallprompt` typically fires within a few hundred
    // ms after the page becomes interactive.
    const autoFiredRef = useRef(false);
    useEffect(() => {
        if (phase !== "install") return;
        if (autoFiredRef.current) return;

        if (installable) {
            autoFiredRef.current = true;
            setOpenTrigger(TRIGGER_AUTO);
            markShown();
            return;
        }

        // No deferred prompt yet. Wait, then either fire or advance.
        const timer = window.setTimeout(() => {
            if (autoFiredRef.current) return;
            autoFiredRef.current = true;
            // Browser never offered install — nothing to show. Advance
            // the coordinator so the page-load sequence settles.
            reportClosed(SLOT_INSTALL);
        }, Duration.toMillis(INSTALL_WAIT_FOR_DEFERRED_PROMPT));
        return () => {
            window.clearTimeout(timer);
        };
    }, [phase, installable, markShown, reportClosed]);

    const handleAutoClose = useCallback(() => {
        setOpenTrigger(undefined);
        // Auto-fired modal closing → coordinator advances. Manual
        // opens from the menu come through openModal() with a non-
        // auto trigger and don't touch the coordinator.
        if (openTrigger === TRIGGER_AUTO) {
            reportClosed(SLOT_INSTALL);
        }
    }, [openTrigger, reportClosed]);

    const openModal = useCallback(
        (trigger: InstallPromptTrigger) => {
            setOpenTrigger(trigger);
            markShown();
        },
        [markShown],
    );

    const value = useMemo<InstallPromptContextValue>(
        () => ({ installable, openModal }),
        [installable, openModal],
    );

    return (
        <InstallPromptContext.Provider value={value}>
            {children}
            <InstallPromptModal
                open={openTrigger !== undefined}
                trigger={openTrigger ?? TRIGGER_AUTO}
                onInstall={install}
                onSnooze={snooze}
                onClose={handleAutoClose}
            />
        </InstallPromptContext.Provider>
    );
}
