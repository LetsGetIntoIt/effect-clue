import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => {
    const t = (key: string): string => key;
    return { useTranslations: () => t };
});

import { PromptProvider, usePrompt } from "./usePrompt";

function Trigger({
    captured,
}: {
    readonly captured: { current: string | null | "unset" };
}) {
    const prompt = usePrompt();
    return (
        <button
            type="button"
            data-testid="open"
            onClick={async () => {
                const result = await prompt({
                    title: "Rename pack",
                    label: "New name",
                    initialValue: "Old name",
                });
                captured.current = result;
            }}
        >
            open
        </button>
    );
}

const renderHarness = () => {
    const captured: { current: string | null | "unset" } = { current: "unset" };
    const utils = render(
        <PromptProvider>
            <Trigger captured={captured} />
        </PromptProvider>,
    );
    return { ...utils, captured };
};

describe("usePrompt", () => {
    test("opens the dialog with the title, label, and pre-populated input", async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByTestId("open"));
        expect(screen.getByText("Rename pack")).toBeInTheDocument();
        const input = screen.getByDisplayValue("Old name") as HTMLInputElement;
        expect(input).toHaveFocus();
        // Auto-select-all on open.
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe("Old name".length);
    });

    test("submitting (Enter / Save) resolves the trimmed value", async () => {
        const user = userEvent.setup();
        const { captured } = renderHarness();
        await user.click(screen.getByTestId("open"));
        const input = screen.getByDisplayValue("Old name");
        await user.clear(input);
        await user.type(input, "  New label  ");
        await user.click(screen.getByRole("button", { name: "save" }));
        expect(captured.current).toBe("New label");
    });

    test("cancel resolves null", async () => {
        const user = userEvent.setup();
        const { captured } = renderHarness();
        await user.click(screen.getByTestId("open"));
        await user.click(screen.getByRole("button", { name: "cancel" }));
        expect(captured.current).toBeNull();
    });

    test("Save is disabled when input is empty after trim", async () => {
        const user = userEvent.setup();
        renderHarness();
        await user.click(screen.getByTestId("open"));
        const input = screen.getByDisplayValue("Old name");
        await user.clear(input);
        const save = screen.getByRole("button", {
            name: "save",
        }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        // Whitespace stays disabled too.
        fireEvent.change(input, { target: { value: "   " } });
        expect(save.disabled).toBe(true);
    });
});
