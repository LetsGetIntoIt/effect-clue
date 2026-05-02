import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return {
        useTranslations: () => t,
    };
});

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

import { ClueProvider, useClue } from "../state";
import { ConfirmProvider } from "../hooks/useConfirm";
import { CardPackRow } from "./CardPackRow";
import {
    saveCustomCardSet,
    type CustomCardSet,
} from "../../logic/CustomCardSets";
import { CardSet, CardEntry, Category } from "../../logic/CardSet";
import { KnownCard } from "../../logic/InitialKnowledge";
import { Card, CardCategory } from "../../logic/GameObjects";
import { TestQueryClientProvider } from "../../test-utils/queryClient";

const makeCardSet = (id: string) =>
    CardSet({
        categories: [
            Category({
                id: CardCategory(`cat-${id}`),
                name: "Things",
                cards: [
                    CardEntry({ id: Card(`card-${id}-1`), name: "One" }),
                    CardEntry({ id: Card(`card-${id}-2`), name: "Two" }),
                ],
            }),
        ],
    });

const seedCustomPacks = (labels: ReadonlyArray<string>): ReadonlyArray<CustomCardSet> =>
    labels.map(label => saveCustomCardSet(label, makeCardSet(label)));

const renderRow = () =>
    render(
        <ConfirmProvider>
            <ClueProvider>
                <CardPackRow />
            </ClueProvider>
        </ConfirmProvider>,
        { wrapper: TestQueryClientProvider },
    );

/** Test harness — exposes a "Mutate" button that renames the first
 * card in the active deck. Used to verify the active-match drops
 * (and Save becomes active) when the table diverges from any saved
 * pack. */
function MutateButton() {
    const { state, dispatch } = useClue();
    const cat = state.setup.cardSet.categories[0];
    const card = cat?.cards[0];
    return (
        <button
            type="button"
            data-testid="mutate"
            onClick={() => {
                if (!cat || !card) return;
                dispatch({
                    type: "renameCard",
                    cardId: card.id,
                    name: `${card.name}-RENAMED`,
                });
            }}
        >
            mutate
        </button>
    );
}

const renderRowWithMutate = () =>
    render(
        <ConfirmProvider>
            <ClueProvider>
                <CardPackRow />
                <MutateButton />
            </ClueProvider>
        </ConfirmProvider>,
        { wrapper: TestQueryClientProvider },
    );

beforeEach(() => {
    window.localStorage.clear();
    captureCalls.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

const surfaceLabels = (): ReadonlyArray<string> => {
    // The surface row is the first .flex.flex-wrap container in the row.
    const container = document.querySelector(
        ".flex.flex-wrap",
    ) as HTMLElement | null;
    if (!container) return [];
    // Walk every descendant button (motion adds wrapping spans for layout
    // animations and AnimatePresence), then drop:
    //   - the Save pill ("saveAsCardPack")
    //   - the magnifying-glass pill ("allCardPacksPill")
    //   - any per-pack delete buttons ("deleteCustomCardSetAria…")
    const pills: string[] = [];
    const seen = new Set<string>();
    for (const btn of Array.from(container.querySelectorAll("button"))) {
        const text = btn.textContent?.trim() ?? "";
        if (!text) continue;
        if (text.startsWith("saveAsCardPack")) continue;
        if (text.startsWith("saveAsNewCardPack")) continue;
        if (text.startsWith("updateCardPack")) continue;
        if (text.startsWith("allCardPacksPill")) continue;
        if (btn.getAttribute("aria-label")?.startsWith("deleteCustomCardSetAria"))
            continue;
        if (seen.has(text)) continue;
        seen.add(text);
        pills.push(text);
    }
    return pills;
};

describe("CardPackRow surface row composition", () => {
    test("with only built-ins (2 packs total): no magnifying-glass pill, both built-ins shown", () => {
        renderRow();
        expect(surfaceLabels()).toEqual(["Classic", "Master Detective"]);
        expect(screen.queryByText("allCardPacksPill")).toBeNull();
    });

    test("with 4 total packs: still no magnifying-glass pill", () => {
        seedCustomPacks(["Alpha", "Beta"]); // + Classic + Master = 4
        renderRow();
        // Order: Classic pinned, then non-Classic in topRecentPacks order
        // (alphabetical fallback because nothing has been used yet).
        const labels = surfaceLabels();
        expect(labels[0]).toBe("Classic");
        expect(new Set(labels.slice(1))).toEqual(
            new Set(["Master Detective", "Alpha", "Beta"]),
        );
        expect(labels).toHaveLength(4);
        expect(screen.queryByText("allCardPacksPill")).toBeNull();
    });

    test("with 5 total packs: shows the magnifying-glass pill and exactly Classic + 3 recents on surface", () => {
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // + Classic + Master = 5
        renderRow();
        const labels = surfaceLabels();
        expect(labels).toHaveLength(4);
        expect(labels[0]).toBe("Classic");
        expect(screen.getByText("allCardPacksPill")).toBeInTheDocument();
    });

    test("recency: loading a pack moves it to the front of the recents", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // + Classic + Master = 5
        renderRow();
        // Without any usage history, alphabetical ordering puts Alpha,
        // Beta, Gamma on the surface (Master Detective falls behind
        // alphabetically — "Alpha" < "Beta" < "Gamma" < "Master").
        // Now load Master via the dropdown — recency should bring it
        // forward.
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        await user.click(within(list).getByRole("button", { name: "Master Detective" }));
        // After the click the dropdown closes and Master is now the
        // most-recent non-Classic pack, so the surface should include
        // it.
        const labels = surfaceLabels();
        expect(labels[0]).toBe("Classic");
        expect(labels.slice(1)).toContain("Master Detective");
    });

    test("deleting a custom pack removes it from the row and from usage", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha"]); // total = 3 (Classic + Master + Alpha)
        renderRow();
        // Custom pack rendered with a delete × button on the surface.
        const deleteBtn = screen.getByRole("button", {
            name: /deleteCustomCardSetAria.*Alpha/,
        });
        await user.click(deleteBtn);
        // Confirm dialog.
        const confirmBtn = await screen.findByRole("button", {
            name: "confirm",
        });
        await user.click(confirmBtn);
        const labels = surfaceLabels();
        expect(labels).not.toContain("Alpha");
    });
});

describe("CardPackRow active-match styling", () => {
    test("on initial mount Classic is active and Save is not", () => {
        renderRow();
        const classicBtn = screen.getByRole("button", { name: "Classic" });
        expect(classicBtn).toHaveAttribute("aria-pressed", "true");
        const saveBtn = screen.getByRole("button", { name: "saveAsCardPack" });
        expect(saveBtn).not.toHaveAttribute("data-card-pack-save-active");
    });

    test("loading a non-Classic pack moves active styling and Save stays inactive", async () => {
        const user = userEvent.setup();
        renderRow();
        const masterBtn = screen.getByRole("button", { name: "Master Detective" });
        await user.click(masterBtn);
        // After dispatch, the row re-renders. Master Detective should now
        // be aria-pressed; Classic should not.
        expect(
            screen.getByRole("button", { name: "Master Detective" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Classic" })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        expect(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        ).not.toHaveAttribute("data-card-pack-save-active");
    });

    test("mutating the active deck drops the match and lights up Save", async () => {
        const user = userEvent.setup();
        renderRowWithMutate();
        // Classic is the default → Classic is active. Mutate the first
        // card name; the deck no longer matches Classic byte-for-byte.
        await user.click(screen.getByTestId("mutate"));
        expect(screen.getByRole("button", { name: "Classic" })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        expect(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        ).toHaveAttribute("data-card-pack-save-active", "true");
    });

    test("an active custom pack is promoted to the second pill (right after Classic)", async () => {
        const user = userEvent.setup();
        // Seed a custom pack; click it via the dropdown (forces it to
        // become active). It should land in the second surface slot.
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs total
        renderRow();
        // Click Alpha from the dropdown.
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        await user.click(within(list).getByRole("button", { name: "Alpha" }));
        // After load, Alpha is active and pinned to the second slot.
        const surface = surfaceLabels();
        expect(surface[0]).toBe("Classic");
        expect(surface[1]).toBe("Alpha");
        // The Alpha pill is aria-pressed via the inner load button.
        const alphaBtns = screen.getAllByRole("button", { name: "Alpha" });
        expect(alphaBtns.some(b => b.getAttribute("aria-pressed") === "true")).toBe(
            true,
        );
    });
});

describe("CardPackRow analytics", () => {
    test("emits cards_dealt + card_pack_selected on a pinned-pill click", async () => {
        const user = userEvent.setup();
        renderRow();
        const classicBtn = screen.getByRole("button", { name: "Classic" });
        await user.click(classicBtn);
        const events = captureCalls.map(c => c.event);
        expect(events).toContain("cards_dealt");
        expect(events).toContain("card_pack_selected");
        const packSelected = captureCalls.find(
            c => c.event === "card_pack_selected",
        );
        expect(packSelected?.props).toMatchObject({
            packType: "built-in",
            source: "pinned",
        });
    });

    test("emits card_pack_picker_opened when the dropdown opens", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs
        renderRow();
        await user.click(screen.getByText("allCardPacksPill"));
        await screen.findByRole("listbox");
        const opens = captureCalls.filter(
            c => c.event === "card_pack_picker_opened",
        );
        expect(opens).toHaveLength(1);
    });

    test("dropdown selection is tagged with source: search", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs
        renderRow();
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        await user.click(
            within(list).getByRole("button", { name: "Master Detective" }),
        );
        const selected = captureCalls.find(
            c => c.event === "card_pack_selected",
        );
        expect(selected?.props).toMatchObject({
            packType: "built-in",
            source: "search",
        });
    });

    test("non-Classic surface-pill click is tagged with source: recent and packType: custom", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha"]); // total = 3 (Classic + Master + Alpha)
        renderRow();
        // Alpha is on the surface row (≤4 packs, no dropdown). Click it.
        const alphaBtns = screen.getAllByRole("button", { name: "Alpha" });
        // The first match is the surface pill's load button (it's the only Alpha
        // on screen with the dropdown closed).
        await user.click(alphaBtns[0]!);
        const selected = captureCalls.find(
            c => c.event === "card_pack_selected",
        );
        expect(selected?.props).toMatchObject({
            packType: "custom",
            source: "recent",
        });
    });

    test("clicking a built-in non-Classic pill emits source: recent + packType: built-in", async () => {
        const user = userEvent.setup();
        renderRow(); // total = 2: Classic + Master Detective
        await user.click(
            screen.getByRole("button", { name: "Master Detective" }),
        );
        const selected = captureCalls.find(
            c => c.event === "card_pack_selected",
        );
        expect(selected?.props).toMatchObject({
            packType: "built-in",
            source: "recent",
        });
    });
});

describe("CardPackRow dropdown reflects active pack", () => {
    test("the active pack is marked inside the dropdown", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs total
        renderRow();
        // Click Alpha on the surface (becomes active).
        const alphaSurface = screen.getAllByRole("button", { name: "Alpha" });
        await user.click(alphaSurface[0]!);
        // Open the dropdown — the Alpha row should carry the active marker.
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        const items = within(list).getAllByRole("option");
        const activeRow = items.find(
            li => li.getAttribute("data-card-pack-active") === "true",
        );
        expect(activeRow).toBeDefined();
        expect(activeRow?.textContent).toContain("Alpha");
    });

    test("after a deck mutation no row is marked active in the dropdown", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs total
        render(
            <ConfirmProvider>
                <ClueProvider>
                    <CardPackRow />
                    <MutateButton />
                </ClueProvider>
            </ConfirmProvider>,
            { wrapper: TestQueryClientProvider },
        );
        // Mutate the active deck (currently Classic on first mount).
        await user.click(screen.getByTestId("mutate"));
        // Open the dropdown.
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        const activeRows = within(list)
            .getAllByRole("option")
            .filter(
                li => li.getAttribute("data-card-pack-active") === "true",
            );
        expect(activeRows).toHaveLength(0);
    });
});

describe("CardPackRow destructive-data confirmation", () => {
    /**
     * Test harness that lets a test seed a known card so the destructive
     * branch (`hasDestructiveData = true`) is exercised on the next
     * pack-load click.
     */
    function SeedKnownCardButton() {
        const { state, dispatch } = useClue();
        return (
            <button
                type="button"
                data-testid="seed-known"
                onClick={() => {
                    const cat = state.setup.cardSet.categories[0];
                    const card = cat?.cards[0];
                    const player = state.setup.players[0];
                    if (!cat || !card || !player) return;
                    dispatch({
                        type: "addKnownCard",
                        card: KnownCard({
                            player,
                            card: card.id,
                        }),
                    });
                }}
            >
                seed
            </button>
        );
    }

    test("asks for confirmation before swapping the deck when known cards exist", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha"]); // 3 packs total: Classic + Master + Alpha
        render(
            <ConfirmProvider>
                <ClueProvider>
                    <CardPackRow />
                    <SeedKnownCardButton />
                </ClueProvider>
            </ConfirmProvider>,
            { wrapper: TestQueryClientProvider },
        );
        // Seed a known card to flip hasDestructiveData on.
        await user.click(screen.getByTestId("seed-known"));
        // Now click Master Detective — confirm dialog should appear.
        await user.click(
            screen.getByRole("button", { name: "Master Detective" }),
        );
        // The confirm dialog renders confirm/cancel buttons.
        expect(
            await screen.findByRole("button", { name: "confirm" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "cancel" }),
        ).toBeInTheDocument();
        // The deck shouldn't have swapped yet — Classic is still active.
        // (No card_pack_selected event for Master should have fired.)
        expect(
            captureCalls.filter(c => c.event === "card_pack_selected"),
        ).toHaveLength(0);
    });

    test("cancelling the confirm leaves the deck unchanged and emits no analytics", async () => {
        const user = userEvent.setup();
        render(
            <ConfirmProvider>
                <ClueProvider>
                    <CardPackRow />
                    <SeedKnownCardButton />
                </ClueProvider>
            </ConfirmProvider>,
            { wrapper: TestQueryClientProvider },
        );
        await user.click(screen.getByTestId("seed-known"));
        await user.click(
            screen.getByRole("button", { name: "Master Detective" }),
        );
        const cancelBtn = await screen.findByRole("button", { name: "cancel" });
        await user.click(cancelBtn);
        // Classic still active; no card_pack_selected fired.
        expect(
            screen.getByRole("button", { name: "Classic" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(
            captureCalls.filter(c => c.event === "card_pack_selected"),
        ).toHaveLength(0);
    });

    test("confirming swaps the deck and emits the analytics", async () => {
        const user = userEvent.setup();
        render(
            <ConfirmProvider>
                <ClueProvider>
                    <CardPackRow />
                    <SeedKnownCardButton />
                </ClueProvider>
            </ConfirmProvider>,
            { wrapper: TestQueryClientProvider },
        );
        await user.click(screen.getByTestId("seed-known"));
        await user.click(
            screen.getByRole("button", { name: "Master Detective" }),
        );
        const confirmBtn = await screen.findByRole("button", {
            name: "confirm",
        });
        await user.click(confirmBtn);
        // Master Detective should now be active.
        expect(
            screen.getByRole("button", { name: "Master Detective" }),
        ).toHaveAttribute("aria-pressed", "true");
        const selected = captureCalls.find(
            c => c.event === "card_pack_selected",
        );
        expect(selected?.props).toMatchObject({
            packType: "built-in",
            source: "recent",
        });
    });
});

describe("CardPackRow custom-pack delete also forgets usage", () => {
    test("deleting a custom pack removes both the pack and its usage entry", async () => {
        const user = userEvent.setup();
        const [alpha] = seedCustomPacks(["Alpha"]); // 3 packs total
        renderRow();
        // Click Alpha first so a usage entry is recorded.
        const alphaBtns = screen.getAllByRole("button", { name: "Alpha" });
        await user.click(alphaBtns[0]!);
        // Confirm the usage was recorded.
        const usageBefore = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.card-pack-usage.v1",
            ) ?? "null",
        );
        expect(
            usageBefore?.entries?.some(
                (e: { id: string }) => e.id === alpha!.id,
            ),
        ).toBe(true);
        // Now delete it via the surface pill's × button.
        const deleteBtn = screen.getByRole("button", {
            name: /deleteCustomCardSetAria.*Alpha/,
        });
        await user.click(deleteBtn);
        const confirmBtn = await screen.findByRole("button", {
            name: "confirm",
        });
        await user.click(confirmBtn);
        // Usage entry should be gone too.
        const usageAfter = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.card-pack-usage.v1",
            ) ?? "null",
        );
        expect(
            (usageAfter?.entries ?? []).some(
                (e: { id: string }) => e.id === alpha!.id,
            ),
        ).toBe(false);
        // And the custom-presets blob should no longer reference Alpha.
        const presets = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.custom-presets.v1",
            ) ?? "null",
        );
        expect(
            (presets?.presets ?? []).some(
                (p: { id: string }) => p.id === alpha!.id,
            ),
        ).toBe(false);
    });

    test("cancelling the delete confirm keeps both the pack and its usage entry", async () => {
        const user = userEvent.setup();
        const [alpha] = seedCustomPacks(["Alpha"]);
        renderRow();
        const alphaBtns = screen.getAllByRole("button", { name: "Alpha" });
        await user.click(alphaBtns[0]!);
        const deleteBtn = screen.getByRole("button", {
            name: /deleteCustomCardSetAria.*Alpha/,
        });
        await user.click(deleteBtn);
        const cancelBtn = await screen.findByRole("button", { name: "cancel" });
        await user.click(cancelBtn);
        const usage = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.card-pack-usage.v1",
            ) ?? "null",
        );
        expect(
            (usage?.entries ?? []).some(
                (e: { id: string }) => e.id === alpha!.id,
            ),
        ).toBe(true);
    });
});

describe("CardPackRow save-as-pack activates the new pack", () => {
    test("after saving, the new pack becomes the active pill and Save un-activates", async () => {
        const user = userEvent.setup();
        // Force a deck mutation first so Save is the active pill before save.
        renderRowWithMutate();
        await user.click(screen.getByTestId("mutate"));
        // Pre-condition: Save pill is active, no pack pill is active.
        expect(
            document.querySelector("[data-card-pack-save-active='true']"),
        ).not.toBeNull();
        expect(
            document.querySelectorAll("[data-card-pack-active='true']"),
        ).toHaveLength(0);
        // Save the current configuration.
        const promptSpy = vi
            .spyOn(window, "prompt")
            .mockReturnValue("My New Pack");
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        // Save should no longer be active.
        expect(
            document.querySelector("[data-card-pack-save-active='true']"),
        ).toBeNull();
        // Exactly one pack pill is now marked active.
        const actives = document.querySelectorAll(
            "[data-card-pack-active='true']",
        );
        expect(actives).toHaveLength(1);
        expect(actives[0]?.textContent).toContain("My New Pack");
    });

    test("the saved pack appears on the surface row immediately", async () => {
        const user = userEvent.setup();
        renderRow(); // 2 packs to start (Classic + Master)
        const promptSpy = vi
            .spyOn(window, "prompt")
            .mockReturnValue("Brand New");
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        const labels = surfaceLabels();
        expect(labels).toContain("Brand New");
    });

    test("saving records a usage entry for the new pack", async () => {
        const user = userEvent.setup();
        renderRow();
        const promptSpy = vi
            .spyOn(window, "prompt")
            .mockReturnValue("Recorded");
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        const usage = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.card-pack-usage.v1",
            ) ?? "null",
        );
        // Find the saved pack's id in the presets blob.
        const presets = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.custom-presets.v1",
            ) ?? "null",
        );
        const saved = (presets?.presets ?? []).find(
            (p: { label: string }) => p.label === "Recorded",
        );
        expect(saved).toBeDefined();
        const recorded = (usage?.entries ?? []).some(
            (e: { id: string }) => e.id === saved.id,
        );
        expect(recorded).toBe(true);
    });

    test("saving does not fire cards_dealt or card_pack_selected", async () => {
        // Saving doesn't change the active deck (it only snapshots it),
        // so it shouldn't pollute the deck-swap analytics funnel.
        const user = userEvent.setup();
        renderRow();
        const promptSpy = vi
            .spyOn(window, "prompt")
            .mockReturnValue("No Analytics");
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        const events = captureCalls.map(c => c.event);
        expect(events).not.toContain("cards_dealt");
        expect(events).not.toContain("card_pack_selected");
    });

    test("cancelling the save prompt leaves activation untouched", async () => {
        const user = userEvent.setup();
        renderRowWithMutate();
        await user.click(screen.getByTestId("mutate")); // Save now active
        const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        // Save still active; no pack-pill activation.
        expect(
            document.querySelector("[data-card-pack-save-active='true']"),
        ).not.toBeNull();
        expect(
            document.querySelectorAll("[data-card-pack-active='true']"),
        ).toHaveLength(0);
    });

    test("an empty / whitespace-only label is treated as cancel", async () => {
        const user = userEvent.setup();
        renderRowWithMutate();
        await user.click(screen.getByTestId("mutate"));
        const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("   ");
        await user.click(
            screen.getByRole("button", { name: "saveAsCardPack" }),
        );
        promptSpy.mockRestore();
        // Nothing was saved; Save pill stays active.
        const presets = JSON.parse(
            window.localStorage.getItem(
                "effect-clue.custom-presets.v1",
            ) ?? "null",
        );
        expect(presets).toBeNull();
        expect(
            document.querySelector("[data-card-pack-save-active='true']"),
        ).not.toBeNull();
    });
});

describe("CardPackRow surface-pill ordering edge cases", () => {
    test("with 5 packs and recent usage, the most-recent non-Classic packs occupy the recent slots", async () => {
        const user = userEvent.setup();
        seedCustomPacks(["Alpha", "Beta", "Gamma"]); // 5 packs total
        renderRow();
        // Load Master Detective (no other clicks). Master becomes the
        // most-recent non-Classic pack and should land in slot 1.
        await user.click(screen.getByText("allCardPacksPill"));
        const list = await screen.findByRole("listbox");
        await user.click(
            within(list).getByRole("button", { name: "Master Detective" }),
        );
        const labels = surfaceLabels();
        expect(labels[0]).toBe("Classic");
        expect(labels[1]).toBe("Master Detective");
    });
});
