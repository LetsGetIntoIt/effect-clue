/**
 * Pins the install-prompt modal's analytics emission, including the
 * reengagement context (`reengaged`, `daysSinceLastDismissal`,
 * `visitCount`) read from `InstallPromptState` localStorage at the
 * moment the user clicks Install / Snooze / X.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateTime } from "effect";

const captureCalls: Array<{
    event: string;
    props: Record<string, unknown> | undefined;
}> = [];

vi.mock("../../analytics/posthog", () => ({
    posthog: {
        __loaded: true,
        capture: (event: string, props?: Record<string, unknown>) => {
            captureCalls.push({ event, props });
        },
    },
}));

vi.mock("next-intl", () => ({
    useTranslations: (ns?: string) => (key: string) =>
        ns ? `${ns}.${key}` : key,
}));

beforeEach(() => {
    window.localStorage.clear();
    captureCalls.length = 0;
});

afterEach(() => {
    window.localStorage.clear();
});

const importModal = async () => {
    const mod = await import("./InstallPromptModal");
    return mod.InstallPromptModal;
};

const seedState = (state: {
    visits: number;
    lastDismissedAt?: DateTime.Utc;
}): void => {
    const payload: {
        version: 1;
        visits: number;
        lastDismissedAt?: string;
    } = { version: 1, visits: state.visits };
    if (state.lastDismissedAt) {
        payload.lastDismissedAt = new Date(
            DateTime.toEpochMillis(state.lastDismissedAt),
        ).toISOString();
    }
    window.localStorage.setItem(
        "effect-clue.install-prompt.v1",
        JSON.stringify(payload),
    );
};

describe("InstallPromptModal — analytics", () => {
    test("Install with no prior dismissal sends reengaged: false, visitCount from state", async () => {
        seedState({ visits: 3 });
        const InstallPromptModal = await importModal();
        const onInstall = vi.fn().mockResolvedValue(true);
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={onInstall}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.install" }),
        );
        // Wait the microtask for the awaited onInstall.
        await Promise.resolve();
        await Promise.resolve();
        const prompted = captureCalls.find(c => c.event === "install_prompted");
        expect(prompted).toMatchObject({
            event: "install_prompted",
            props: {
                trigger: "auto",
                reengaged: false,
                daysSinceLastDismissal: null,
                visitCount: 3,
                $set: { install_status: "prompted" },
            },
        });
    });

    test("Install with stale dismissal reports reengaged: true and the day count", async () => {
        const dismissedAt = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
        seedState({ visits: 5, lastDismissedAt: dismissedAt });
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="menu"
                onInstall={vi.fn().mockResolvedValue(false)}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.install" }),
        );
        await Promise.resolve();
        await Promise.resolve();
        const prompted = captureCalls.find(c => c.event === "install_prompted");
        expect(prompted).toMatchObject({
            event: "install_prompted",
            props: {
                trigger: "menu",
                reengaged: true,
                visitCount: 5,
            },
        });
        // Day count is "today minus dismissedAt" — depends on `Date.now()`,
        // so we just assert it's a non-negative number.
        const days = (prompted!.props as { daysSinceLastDismissal: number })
            .daysSinceLastDismissal;
        expect(typeof days).toBe("number");
        expect(days).toBeGreaterThanOrEqual(0);
    });

    test("Snooze fires install_dismissed with via=snooze and the dismiss-snoozed status", async () => {
        seedState({ visits: 2 });
        const InstallPromptModal = await importModal();
        const onSnooze = vi.fn();
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={vi.fn().mockResolvedValue(false)}
                onSnooze={onSnooze}
                onClose={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.notNow" }),
        );
        expect(onSnooze).toHaveBeenCalled();
        expect(captureCalls).toHaveLength(1);
        expect(captureCalls[0]).toMatchObject({
            event: "install_dismissed",
            props: {
                trigger: "auto",
                via: "snooze",
                $set: {
                    install_status: "dismissed_snoozed",
                    last_install_dismiss_via: "snooze",
                },
            },
        });
    });

    test("Native decline (user accepts our modal but declines OS dialog) reports dismissed_native_decline", async () => {
        seedState({ visits: 2 });
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={vi.fn().mockResolvedValue(false)}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.install" }),
        );
        await Promise.resolve();
        await Promise.resolve();
        const dismissed = captureCalls.find(c => c.event === "install_dismissed");
        expect(dismissed).toMatchObject({
            event: "install_dismissed",
            props: {
                trigger: "auto",
                via: "native_decline",
                $set: {
                    install_status: "dismissed_native_decline",
                    last_install_dismiss_via: "native_decline",
                },
            },
        });
    });

    test("Successful install fires install_accepted with the accepted status", async () => {
        seedState({ visits: 2 });
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="menu"
                onInstall={vi.fn().mockResolvedValue(true)}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.install" }),
        );
        await Promise.resolve();
        await Promise.resolve();
        const accepted = captureCalls.find(c => c.event === "install_accepted");
        expect(accepted).toMatchObject({
            event: "install_accepted",
            props: {
                trigger: "menu",
                $set: { install_status: "accepted" },
            },
        });
    });
});
