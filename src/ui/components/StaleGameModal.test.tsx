import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateTime } from "effect";

vi.mock("next-intl", () => ({
    useTranslations: (ns?: string) => (
        key: string,
        values?: Record<string, string | number>,
    ) => {
        if (values === undefined) return ns ? `${ns}.${key}` : key;
        const args = Object.entries(values)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",");
        return `${ns ?? ""}.${key}(${args})`;
    },
}));

const importModal = async () => {
    const mod = await import("./StaleGameModal");
    return mod.StaleGameModal;
};

const baseProps = {
    referenceTimestamp: DateTime.makeUnsafe("2026-04-22T12:00:00Z"),
    now: DateTime.makeUnsafe("2026-04-25T12:00:00Z"),
};

describe("StaleGameModal", () => {
    test("renders title, description (started variant), and both buttons", async () => {
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="started"
                onSetupNewGame={() => {}}
                onKeepWorking={() => {}}
            />,
        );
        expect(screen.getByText("staleGame.title")).toBeInTheDocument();
        expect(
            screen.getByText(/staleGame\.descriptionStarted/),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "staleGame.keepWorking" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /staleGame\.setupNew/ }),
        ).toBeInTheDocument();
    });

    test("renders the unstarted-variant description", async () => {
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="unstarted"
                onSetupNewGame={() => {}}
                onKeepWorking={() => {}}
            />,
        );
        expect(
            screen.getByText(/staleGame\.descriptionUnstarted/),
        ).toBeInTheDocument();
    });

    test("renders nothing when closed", async () => {
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open={false}
                variant="started"
                onSetupNewGame={() => {}}
                onKeepWorking={() => {}}
            />,
        );
        expect(
            screen.queryByText("staleGame.title"),
        ).not.toBeInTheDocument();
    });

    test("auto-focuses 'Keep working', not 'Set up new game' or X", async () => {
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="started"
                onSetupNewGame={() => {}}
                onKeepWorking={() => {}}
            />,
        );
        const keepWorking = screen.getByRole("button", {
            name: "staleGame.keepWorking",
        });
        await waitFor(() => {
            expect(keepWorking).toHaveFocus();
        });
    });

    test("'Set up new game' fires onSetupNewGame", async () => {
        const onSetupNewGame = vi.fn();
        const onKeepWorking = vi.fn();
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="started"
                onSetupNewGame={onSetupNewGame}
                onKeepWorking={onKeepWorking}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: /staleGame\.setupNew/ }),
        );
        expect(onSetupNewGame).toHaveBeenCalledTimes(1);
        expect(onKeepWorking).not.toHaveBeenCalled();
    });

    test("'Keep working' fires onKeepWorking", async () => {
        const onSetupNewGame = vi.fn();
        const onKeepWorking = vi.fn();
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="started"
                onSetupNewGame={onSetupNewGame}
                onKeepWorking={onKeepWorking}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "staleGame.keepWorking" }),
        );
        expect(onKeepWorking).toHaveBeenCalledTimes(1);
        expect(onSetupNewGame).not.toHaveBeenCalled();
    });

    test("X close fires onKeepWorking (snooze, not wipe)", async () => {
        const onSetupNewGame = vi.fn();
        const onKeepWorking = vi.fn();
        const StaleGameModal = await importModal();
        render(
            <StaleGameModal
                {...baseProps}
                open
                variant="started"
                onSetupNewGame={onSetupNewGame}
                onKeepWorking={onKeepWorking}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "common.close" }));
        expect(onKeepWorking).toHaveBeenCalledTimes(1);
        expect(onSetupNewGame).not.toHaveBeenCalled();
    });
});
