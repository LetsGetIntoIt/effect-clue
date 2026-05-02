import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

afterEach(() => {
    captureCalls.length = 0;
});

const importModal = async () => {
    const mod = await import("./InstallPromptModal");
    return mod.InstallPromptModal;
};

describe("InstallPromptModal", () => {
    test("renders title, value-prop bullets, and both buttons when open", async () => {
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={async () => true}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        expect(
            screen.getByText("installPrompt.title"),
        ).toBeInTheDocument();
        expect(
            screen.getByText("installPrompt.benefitOffline"),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "installPrompt.notNow" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "installPrompt.install" }),
        ).toBeInTheDocument();
    });

    test("renders nothing when closed", async () => {
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open={false}
                trigger="auto"
                onInstall={async () => true}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        expect(
            screen.queryByText("installPrompt.title"),
        ).not.toBeInTheDocument();
    });

    test("auto-focuses Not now, not the X or Install", async () => {
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={async () => true}
                onSnooze={() => {}}
                onClose={() => {}}
            />,
        );
        const notNow = screen.getByRole("button", {
            name: "installPrompt.notNow",
        });
        await waitFor(() => {
            expect(notNow).toHaveFocus();
        });
    });

    test("'Not now' fires snooze + close + dismiss analytics", async () => {
        const onSnooze = vi.fn();
        const onClose = vi.fn();
        const InstallPromptModal = await importModal();
        render(
            <InstallPromptModal
                open
                trigger="auto"
                onInstall={async () => true}
                onSnooze={onSnooze}
                onClose={onClose}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "installPrompt.notNow" }),
        );
        expect(onSnooze).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(captureCalls).toEqual([
            {
                event: "install_dismissed",
                props: { trigger: "auto", via: "snooze" },
            },
        ]);
    });
});
