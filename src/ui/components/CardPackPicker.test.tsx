import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return {
        useTranslations: () => t,
    };
});

import { CardPackPicker, type PickerPack } from "./CardPackPicker";

const samplePacks: ReadonlyArray<PickerPack> = [
    { id: "classic", label: "Classic", isCustom: false },
    { id: "master", label: "Master Detective", isCustom: false },
    { id: "custom-a", label: "Alpha", isCustom: true },
    { id: "custom-b", label: "Beta Pack", isCustom: true },
    { id: "custom-c", label: "Gamma", isCustom: true },
];

interface HarnessProps {
    readonly packs?: ReadonlyArray<PickerPack>;
    readonly onSelect?: (pack: PickerPack) => void;
    readonly onDeleteCustomPack?: (pack: PickerPack) => void;
}

function Harness({
    packs = samplePacks,
    onSelect = () => {},
    onDeleteCustomPack = () => {},
}: HarnessProps) {
    const [open, setOpen] = useState(false);
    return (
        <CardPackPicker
            open={open}
            onOpenChange={setOpen}
            packs={packs}
            onSelect={onSelect}
            onDeleteCustomPack={onDeleteCustomPack}
        >
            <button type="button">Open</button>
        </CardPackPicker>
    );
}

describe("CardPackPicker", () => {
    test("does not render the listbox when closed", () => {
        render(<Harness />);
        expect(screen.queryByRole("listbox")).toBeNull();
    });

    test("opens on trigger click and focuses the search input", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        expect(input).toHaveFocus();
        const list = screen.getByRole("listbox");
        const items = within(list).getAllByRole("option");
        expect(items.map(li => li.textContent?.replace(/×.*/g, "").trim())).toEqual([
            "Classic",
            "Master Detective",
            "Alpha",
            "Beta Pack",
            "Gamma",
        ]);
    });

    test("filters case-insensitively as the user types", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        await user.type(input, "BeT");
        const items = within(screen.getByRole("listbox")).getAllByRole("option");
        expect(items).toHaveLength(1);
        expect(items[0]?.textContent).toContain("Beta Pack");
    });

    test("shows the empty state when nothing matches", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        await user.type(input, "zzzNoMatch");
        // The empty-state copy comes from the i18n mock as a JSON-tagged
        // key, so assert by role + key prefix rather than exact text.
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(screen.getByRole("status").textContent).toContain(
            "cardPackSearchEmpty",
        );
    });

    test("ArrowDown moves the highlight and wraps", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        const initialItems = within(screen.getByRole("listbox")).getAllByRole(
            "option",
        );
        expect(initialItems[0]).toHaveAttribute("aria-selected", "true");
        await user.keyboard("{ArrowDown}");
        const after1 = within(screen.getByRole("listbox")).getAllByRole(
            "option",
        );
        expect(after1[1]).toHaveAttribute("aria-selected", "true");
        // Wrap to end then back to start.
        for (let i = 0; i < initialItems.length - 1; i += 1) {
            await user.keyboard("{ArrowDown}");
        }
        const wrapped = within(screen.getByRole("listbox")).getAllByRole(
            "option",
        );
        expect(wrapped[0]).toHaveAttribute("aria-selected", "true");
        // Quiet the unused `input` lint warning — the keyboard events
        // target it implicitly because it has focus.
        expect(input).toHaveFocus();
    });

    test("ArrowUp wraps to the last option from the first", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        await user.keyboard("{ArrowUp}");
        const items = within(screen.getByRole("listbox")).getAllByRole(
            "option",
        );
        expect(items[items.length - 1]).toHaveAttribute(
            "aria-selected",
            "true",
        );
    });

    test("Enter selects the highlighted row", async () => {
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSelect={onSelect} />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        await user.keyboard("{ArrowDown}{Enter}");
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]?.[0]?.id).toBe("master");
    });

    test("Escape closes the dropdown without selecting", async () => {
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSelect={onSelect} />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("listbox")).toBeNull();
        expect(onSelect).not.toHaveBeenCalled();
    });

    test("clicking an option selects it", async () => {
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSelect={onSelect} />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        await user.click(
            within(screen.getByRole("listbox")).getByRole("button", {
                name: "Alpha",
            }),
        );
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0]?.[0]?.id).toBe("custom-a");
    });

    test("delete × calls onDeleteCustomPack only for custom packs", async () => {
        const onDelete = vi.fn();
        const user = userEvent.setup();
        render(<Harness onDeleteCustomPack={onDelete} />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        const list = screen.getByRole("listbox");
        // Three custom packs in the sample, so three delete buttons.
        const deletes = within(list).getAllByRole("button", {
            name: /deleteCustomCardSetAria/,
        });
        expect(deletes).toHaveLength(3);
        await user.click(deletes[0]!);
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete.mock.calls[0]?.[0]?.id).toBe("custom-a");
    });

    test("does not render delete buttons for built-in packs", async () => {
        const user = userEvent.setup();
        render(
            <Harness
                packs={[
                    { id: "classic", label: "Classic", isCustom: false },
                    { id: "master", label: "Master", isCustom: false },
                ]}
            />,
        );
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        const list = screen.getByRole("listbox");
        expect(
            within(list).queryAllByRole("button", {
                name: /deleteCustomCardSetAria/,
            }),
        ).toHaveLength(0);
    });

    test("typing resets the highlight to the first match", async () => {
        const onSelect = vi.fn();
        const user = userEvent.setup();
        render(<Harness onSelect={onSelect} />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        await user.keyboard("{ArrowDown}{ArrowDown}");
        await user.type(input, "alp");
        await user.keyboard("{Enter}");
        expect(onSelect.mock.calls[0]?.[0]?.id).toBe("custom-a");
    });

    test("Home and End jump to first and last visible matches", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        await user.keyboard("{End}");
        const list = screen.getByRole("listbox");
        const items = within(list).getAllByRole("option");
        expect(items[items.length - 1]).toHaveAttribute(
            "aria-selected",
            "true",
        );
        await user.keyboard("{Home}");
        const after = within(screen.getByRole("listbox")).getAllByRole(
            "option",
        );
        expect(after[0]).toHaveAttribute("aria-selected", "true");
    });

    test("activeMatchId marks the matching row with data-card-pack-active", async () => {
        function HarnessActive() {
            const [open, setOpen] = useState(false);
            return (
                <CardPackPicker
                    open={open}
                    onOpenChange={setOpen}
                    packs={samplePacks}
                    onSelect={() => {}}
                    onDeleteCustomPack={() => {}}
                    activeMatchId="custom-b"
                >
                    <button type="button">Open</button>
                </CardPackPicker>
            );
        }
        const user = userEvent.setup();
        render(<HarnessActive />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        const list = screen.getByRole("listbox");
        const items = within(list).getAllByRole("option");
        // Exactly one row should be marked active.
        const activeRows = items.filter(
            li => li.getAttribute("data-card-pack-active") === "true",
        );
        expect(activeRows).toHaveLength(1);
        expect(activeRows[0]?.textContent).toContain("Beta Pack");
        // The load button on the active row should also be aria-pressed.
        const activeBtn = activeRows[0]!.querySelector(
            'button[aria-pressed="true"]',
        );
        expect(activeBtn).not.toBeNull();
    });

    test("without activeMatchId no row carries the active marker", async () => {
        const user = userEvent.setup();
        render(<Harness />); // no activeMatchId passed
        await user.click(screen.getByRole("button", { name: "Open" }));
        await screen.findByRole("combobox");
        const list = screen.getByRole("listbox");
        const activeRows = within(list)
            .getAllByRole("option")
            .filter(
                li => li.getAttribute("data-card-pack-active") === "true",
            );
        expect(activeRows).toHaveLength(0);
    });

    test("active row's marker survives filtering when it stays in the result set", async () => {
        function HarnessActive() {
            const [open, setOpen] = useState(false);
            return (
                <CardPackPicker
                    open={open}
                    onOpenChange={setOpen}
                    packs={samplePacks}
                    onSelect={() => {}}
                    onDeleteCustomPack={() => {}}
                    activeMatchId="custom-b"
                >
                    <button type="button">Open</button>
                </CardPackPicker>
            );
        }
        const user = userEvent.setup();
        render(<HarnessActive />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        await user.type(input, "Bet");
        const list = screen.getByRole("listbox");
        const items = within(list).getAllByRole("option");
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveAttribute("data-card-pack-active", "true");
    });

    test("filtering past the active row drops the marker from the visible list", async () => {
        function HarnessActive() {
            const [open, setOpen] = useState(false);
            return (
                <CardPackPicker
                    open={open}
                    onOpenChange={setOpen}
                    packs={samplePacks}
                    onSelect={() => {}}
                    onDeleteCustomPack={() => {}}
                    activeMatchId="custom-b"
                >
                    <button type="button">Open</button>
                </CardPackPicker>
            );
        }
        const user = userEvent.setup();
        render(<HarnessActive />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        const input = await screen.findByRole("combobox");
        // "alp" matches Alpha only, not Beta Pack.
        await user.type(input, "alp");
        const list = screen.getByRole("listbox");
        const visible = within(list)
            .getAllByRole("option")
            .filter(
                li => li.getAttribute("data-card-pack-active") === "true",
            );
        expect(visible).toHaveLength(0);
    });
});
