import { describe, expect, test, beforeEach, vi } from "vitest";

// next-intl mock — i18n keys come back as the key itself, plus
// interpolated values when present. Tests assert against the key
// strings, not the human copy.
vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return { useTranslations: () => t };
});

import * as React from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { CardEntry, CardSet, Category } from "../../logic/CardSet";
import { Card, CardCategory } from "../../logic/GameObjects";
import { TestQueryClientProvider } from "../../test-utils/queryClient";
import {
    ModalStackProvider,
    ModalStackShell,
} from "../components/ModalStack";
import { ConfirmProvider } from "../hooks/useConfirm";
import { PromptProvider } from "../hooks/usePrompt";
import { ClueProvider } from "../state";
import { useOpenCardPackEditor } from "./CardPackEditorModal";
import {
    loadNewCardPackDraft,
    NEW_CARD_PACK_DRAFT_KEY,
    saveNewCardPackDraft,
} from "../../data/newCardPackDraft";

const Wrappers = ({ children }: { readonly children: React.ReactNode }) => (
    <TestQueryClientProvider>
        <ClueProvider>
            <ModalStackProvider>
                <ConfirmProvider>
                    <PromptProvider>
                        {children}
                        <ModalStackShell />
                    </PromptProvider>
                </ConfirmProvider>
            </ModalStackProvider>
        </ClueProvider>
    </TestQueryClientProvider>
);

const samplePackCardSet = (): CardSet =>
    CardSet({
        categories: [
            Category({
                id: CardCategory("category-suspect"),
                name: "Suspect",
                cards: [
                    CardEntry({
                        id: Card("card-scarlet"),
                        name: "Miss Scarlet",
                    }),
                ],
            }),
        ],
    });

// Tiny opener harness: render a button that opens the editor with the
// given args on click. Tests fire the click and then inspect the
// pushed modal.
const Opener = ({
    args,
}: {
    readonly args: Parameters<ReturnType<typeof useOpenCardPackEditor>>[0];
}) => {
    const open = useOpenCardPackEditor();
    return (
        <button type="button" data-testid="opener" onClick={() => open(args)}>
            open
        </button>
    );
};

const openEditor = (
    args: Parameters<ReturnType<typeof useOpenCardPackEditor>>[0],
): void => {
    render(<Opener args={args} />, { wrapper: Wrappers });
    fireEvent.click(screen.getByTestId("opener"));
};

beforeEach(() => {
    window.localStorage.clear();
});

describe("CardPackEditorModal — new-with-name-input mode", () => {
    test("opens empty with autofocused name input and disabled save", async () => {
        openEditor({
            initialCardSet: CardSet({ categories: [] }),
            applyToActiveGame: false,
            mode: "new-with-name-input",
        });

        // Title from the new-mode key.
        await waitFor(() => {
            expect(screen.getByText("titleNew")).toBeInTheDocument();
        });
        // Name input is present and focused.
        const nameInput = screen.getByLabelText("newPackNameAria");
        expect(nameInput).toBeInTheDocument();
        expect(document.activeElement).toBe(nameInput);
        // No categories rendered.
        expect(document.querySelectorAll("li").length).toBe(0);
        // Save-as-new button exists but is disabled.
        const saveBtn = screen.getByText("saveAsNewPack");
        expect(saveBtn).toBeDisabled();
        // Start Over present but disabled at empty start.
        const startOver = screen.getByText("startOver");
        expect(startOver.closest("button")).toBeDisabled();
        // No "Update loaded pack" button (no initialPackId).
        expect(
            screen.queryByText(/^updatePack/),
        ).not.toBeInTheDocument();
    });

    test("typing in name input persists the draft to localStorage", async () => {
        openEditor({
            initialCardSet: CardSet({ categories: [] }),
            applyToActiveGame: false,
            mode: "new-with-name-input",
        });
        const nameInput = (await screen.findByLabelText(
            "newPackNameAria",
        )) as HTMLInputElement;
        await act(async () => {
            fireEvent.change(nameInput, { target: { value: "Office pack" } });
        });
        const stored = window.localStorage.getItem(NEW_CARD_PACK_DRAFT_KEY);
        expect(stored).not.toBeNull();
        const loaded = loadNewCardPackDraft();
        expect(loaded?.label).toBe("Office pack");
    });

    test("opens prefilled when a saved draft exists in localStorage", async () => {
        // Seed a draft, then open. The editor should read it.
        saveNewCardPackDraft({
            label: "Resumed pack",
            cardSet: samplePackCardSet(),
        });
        openEditor({
            initialCardSet: CardSet({ categories: [] }),
            applyToActiveGame: false,
            mode: "new-with-name-input",
        });
        await waitFor(() => {
            const input = screen.getByLabelText(
                "newPackNameAria",
            ) as HTMLInputElement;
            expect(input.value).toBe("Resumed pack");
        });
        // Sample category rendered too.
        expect(screen.getByDisplayValue("Suspect")).toBeInTheDocument();
    });

    test("Cancel preserves the draft (sticky semantics)", async () => {
        saveNewCardPackDraft({
            label: "Sticky",
            cardSet: samplePackCardSet(),
        });
        openEditor({
            initialCardSet: CardSet({ categories: [] }),
            applyToActiveGame: false,
            mode: "new-with-name-input",
        });
        // Cancel — the editor closes but the draft slot survives.
        const cancel = await screen.findByText("cancel");
        await act(async () => {
            fireEvent.click(cancel);
        });
        // Draft still present.
        expect(loadNewCardPackDraft()?.label).toBe("Sticky");
    });

    test("Start Over confirms then wipes the draft and resets the editor", async () => {
        saveNewCardPackDraft({
            label: "About to discard",
            cardSet: samplePackCardSet(),
        });
        openEditor({
            initialCardSet: CardSet({ categories: [] }),
            applyToActiveGame: false,
            mode: "new-with-name-input",
        });
        await waitFor(() => {
            expect(
                (screen.getByLabelText(
                    "newPackNameAria",
                ) as HTMLInputElement).value,
            ).toBe("About to discard");
        });
        // Click Start Over → confirm dialog appears.
        const startOver = (await screen.findByText("startOver")).closest(
            "button",
        )!;
        await act(async () => {
            fireEvent.click(startOver);
        });
        // The confirm dialog renders the message and a confirm button
        // with the discard label.
        await screen.findByText("startOverConfirmMessage");
        const discard = screen.getByText("startOverConfirm");
        await act(async () => {
            fireEvent.click(discard);
        });
        // Draft is wiped.
        expect(loadNewCardPackDraft()).toBeUndefined();
        // Editor reset to blank.
        await waitFor(() => {
            const input = screen.getByLabelText(
                "newPackNameAria",
            ) as HTMLInputElement;
            expect(input.value).toBe("");
        });
    });
});

describe("CardPackEditorModal — edit mode dirty-check on Cancel", () => {
    test("Cancel with no changes closes silently (no confirm)", async () => {
        const initial = samplePackCardSet();
        openEditor({
            initialCardSet: initial,
            initialPackId: "pack-1",
            initialPackLabel: "Sample",
            applyToActiveGame: false,
        });
        await screen.findByText(/titleEdit/);
        const cancel = screen.getByText("cancel");
        await act(async () => {
            fireEvent.click(cancel);
        });
        // No discard-confirm prompt should appear; editor unmounts.
        expect(
            screen.queryByText("discardChangesConfirmMessage"),
        ).not.toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByText(/titleEdit/)).not.toBeInTheDocument();
        });
    });

    test("does NOT render Start Over button in edit mode", async () => {
        openEditor({
            initialCardSet: samplePackCardSet(),
            initialPackId: "pack-1",
            initialPackLabel: "Sample",
            applyToActiveGame: false,
        });
        await screen.findByText(/titleEdit/);
        expect(screen.queryByText("startOver")).not.toBeInTheDocument();
    });
});
