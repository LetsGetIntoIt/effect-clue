import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

vi.mock("react-youtube", () => ({
    default: () => <div data-testid="yt-mock" />,
}));

afterEach(() => {
    captureCalls.length = 0;
});

const importModal = async () => {
    const mod = await import("./SplashModal");
    return mod.SplashModal;
};

describe("SplashModal", () => {
    test("renders title, content, and primary button when open", async () => {
        const SplashModal = await importModal();
        render(<SplashModal open onDismiss={() => {}} />);
        expect(screen.getByText("splash.title")).toBeInTheDocument();
        expect(screen.getByTestId("yt-mock")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "splash.startPlaying" }),
        ).toBeInTheDocument();
    });

    test("renders nothing when closed", async () => {
        const SplashModal = await importModal();
        render(<SplashModal open={false} onDismiss={() => {}} />);
        expect(screen.queryByText("splash.title")).not.toBeInTheDocument();
    });

    test("auto-focuses the CTA, not the X", async () => {
        const SplashModal = await importModal();
        render(<SplashModal open onDismiss={() => {}} />);
        const cta = screen.getByRole("button", {
            name: "splash.startPlaying",
        });
        await waitFor(() => {
            expect(cta).toHaveFocus();
        });
    });

    test("'Start playing' fires dismiss with method=start_playing and the checkbox state", async () => {
        const onDismiss = vi.fn();
        const SplashModal = await importModal();
        render(<SplashModal open onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole("button", { name: "splash.startPlaying" }));
        expect(onDismiss).toHaveBeenCalledWith(false);
        expect(captureCalls).toEqual([
            {
                event: "splash_screen_dismissed",
                props: {
                    method: "start_playing",
                    dontShowAgainChecked: false,
                },
            },
        ]);
    });

    test("X close fires dismiss with method=x_button", async () => {
        const onDismiss = vi.fn();
        const SplashModal = await importModal();
        render(<SplashModal open onDismiss={onDismiss} />);
        fireEvent.click(screen.getByRole("button", { name: "splash.close" }));
        expect(onDismiss).toHaveBeenCalledWith(false);
        expect(captureCalls).toEqual([
            {
                event: "splash_screen_dismissed",
                props: {
                    method: "x_button",
                    dontShowAgainChecked: false,
                },
            },
        ]);
    });

    test("checkbox toggle propagates into the dismiss event and onDismiss arg", async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        const SplashModal = await importModal();
        render(<SplashModal open onDismiss={onDismiss} />);
        await user.click(screen.getByRole("checkbox"));
        await user.click(screen.getByRole("button", { name: "splash.startPlaying" }));
        expect(onDismiss).toHaveBeenCalledWith(true);
        expect(captureCalls).toEqual([
            {
                event: "splash_screen_dismissed",
                props: {
                    method: "start_playing",
                    dontShowAgainChecked: true,
                },
            },
        ]);
    });
});
