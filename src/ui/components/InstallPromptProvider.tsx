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
 * The auto-gate lives inside this provider too: on hydrated mount,
 * if the visit-count + snooze gate clears AND the deferred prompt
 * exists, we open the modal with `trigger: TRIGGER_AUTO`.
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
import {
    appLaunchedStandalone,
    installCompleted,
    type InstallPromptTrigger,
} from "../../analytics/events";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { InstallPromptModal } from "./InstallPromptModal";

// Discriminator values for the analytics `trigger` payload — kept at
// module scope so the i18next/no-literal-string lint rule treats them
// as wire-format strings rather than user copy.
const TRIGGER_AUTO = "auto" satisfies InstallPromptTrigger;

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
    hydrated,
}: {
    readonly children: ReactNode;
    /** Gate effect waits for `<ClueProvider>` to finish hydrating. */
    readonly hydrated: boolean;
}) {
    const {
        installable,
        installed,
        shouldAutoShow,
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

    // Auto-fire the modal when the gate decided to and we're past
    // ClueProvider's localStorage hydration (otherwise we could race
    // with the splash modal).
    useEffect(() => {
        if (!hydrated) return;
        if (!shouldAutoShow) return;
        if (openTrigger !== undefined) return;
        setOpenTrigger(TRIGGER_AUTO);
        markShown();
    }, [hydrated, shouldAutoShow, openTrigger, markShown]);

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
                onClose={() => setOpenTrigger(undefined)}
            />
        </InstallPromptContext.Provider>
    );
}
