import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, createElement, useState } from "react";
import type { ReactNode } from "react";

// -----------------------------------------------------------------------
// ESM mocks. Vitest hoists `vi.mock` calls to the top of the file, so
// regular top-level imports below see the mocked modules — no deferred-
// import dance required.
// -----------------------------------------------------------------------

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (
        key: string,
        _values?: Record<string, unknown>,
    ): string => key;
    return { useTranslations: () => t };
});

vi.mock("motion/react", () => {
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) =>
                forwardRef(
                    (
                        props: Record<string, unknown>,
                        ref: React.Ref<HTMLElement>,
                    ) => {
                        const {
                            layout: _layout,
                            initial: _initial,
                            animate: _animate,
                            exit: _exit,
                            transition: _transition,
                            whileHover: _whileHover,
                            whileTap: _whileTap,
                            ...rest
                        } = props;
                        return createElement(tag, { ...rest, ref });
                    },
                ),
        },
    );
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
        LayoutGroup: ({ children }: { children: ReactNode }) => children,
    };
});

import { SuggestionForm, type FormState } from "./SuggestionForm";
import { TooltipProvider } from "./Tooltip";
import { CLASSIC_SETUP_3P as setup } from "../../logic/GameSetup";
import { SuggestionId } from "../../logic/Suggestion";
import type { PendingSuggestionDraft } from "../../logic/ClueState";
import { Player } from "../../logic/GameObjects";
import { cardByName } from "../../logic/test-utils/CardByName";

const renderForm = (ui: React.ReactElement) =>
    render(<TooltipProvider>{ui}</TooltipProvider>);

const SUSPECT = cardByName(setup, "Col. Mustard");
const KNIFE = cardByName(setup, "Knife");
const KITCHEN = cardByName(setup, "Kitchen");
const ANISHA = Player("Anisha");

// -----------------------------------------------------------------------
// pendingDraft seeding (M2)
//
// New-suggestion flow: when the parent supplies a `pendingDraft`, the
// form renders pre-filled with those values. The edit-existing flow
// (suggestion prop present) ignores the draft entirely — it has its own
// saved source-of-truth.
// -----------------------------------------------------------------------
describe("SuggestionForm — pendingDraft seeding", () => {
    test("seeds form values from a non-null pendingDraft on mount", () => {
        const draft: PendingSuggestionDraft = {
            id: "draft-1",
            suggester: ANISHA,
            cards: [SUSPECT, KNIFE, KITCHEN],
            nonRefuters: null,
            refuter: null,
            seenCard: null,
        };
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                pendingDraft={draft}
                onPendingDraftChange={vi.fn()}
            />,
        );
        // The suggester pill renders the player's name when filled,
        // and the card pills render their card names.
        expect(screen.getByRole("button", { name: /Anisha/ })).toBeDefined();
        expect(screen.getByRole("button", { name: /Mustard/ })).toBeDefined();
        expect(screen.getByRole("button", { name: /Knife/ })).toBeDefined();
        expect(screen.getByRole("button", { name: /Kitchen/ })).toBeDefined();
    });

    test("falls back to an empty form when pendingDraft is null", () => {
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                pendingDraft={null}
                onPendingDraftChange={vi.fn()}
            />,
        );
        // Empty suggester pill renders the placeholder label.
        expect(
            screen.getByRole("button", { name: /pillSuggester/ }),
        ).toBeDefined();
    });

    test("falls back to an empty form when pendingDraft.cards length doesn't match the setup (stale draft)", () => {
        // 5-card draft against a 3-category setup — the reducer drops
        // these on setup change but the form is also defensive.
        const stale: PendingSuggestionDraft = {
            id: "draft-stale",
            suggester: ANISHA,
            cards: [SUSPECT, KNIFE, KITCHEN, SUSPECT, KNIFE],
            nonRefuters: null,
            refuter: null,
            seenCard: null,
        };
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                pendingDraft={stale}
                onPendingDraftChange={vi.fn()}
            />,
        );
        // No populated pills — the suggester slot fell back to empty.
        expect(
            screen.queryByRole("button", { name: /Anisha/ }),
        ).toBeNull();
    });

    test("edit flow ignores pendingDraft entirely and uses the suggestion prop", () => {
        const SECOND_SUSPECT = cardByName(setup, "Mrs. White");
        // Draft says one suspect; suggestion prop says another. Form
        // must render the suggestion's value.
        const draft: PendingSuggestionDraft = {
            id: "draft-ignored",
            suggester: ANISHA,
            cards: [SUSPECT, KNIFE, KITCHEN],
            nonRefuters: null,
            refuter: null,
            seenCard: null,
        };
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                suggestion={{
                    id: SuggestionId("test-existing"),
                    suggester: Player("Bob"),
                    cards: [SECOND_SUSPECT, KNIFE, KITCHEN],
                    nonRefuters: [],
                }}
                pendingDraft={draft}
                onPendingDraftChange={vi.fn()}
            />,
        );
        expect(screen.getByRole("button", { name: /Bob/ })).toBeDefined();
        expect(
            screen.queryByRole("button", { name: /Mustard/ }),
        ).toBeNull();
        expect(
            screen.queryByRole("button", { name: /Anisha/ }),
        ).toBeNull();
        expect(screen.getByRole("button", { name: /White/ })).toBeDefined();
    });
});

// -----------------------------------------------------------------------
// onPendingDraftChange mirroring (M2)
//
// Every form-state change in the new-suggestion flow fires the callback,
// so the parent can persist into ClueState. Edit flow doesn't fire it.
// "Empty form" mirrors as `null` so a fresh form re-mount doesn't pick
// up a stale empty draft.
// -----------------------------------------------------------------------
describe("SuggestionForm — onPendingDraftChange mirroring", () => {
    test("does not fire on initial mount", () => {
        const onPendingDraftChange = vi.fn();
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                pendingDraft={null}
                onPendingDraftChange={onPendingDraftChange}
            />,
        );
        expect(onPendingDraftChange).not.toHaveBeenCalled();
    });

    test("fires on user-driven form change", async () => {
        const user = userEvent.setup();
        const onPendingDraftChange = vi.fn();
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                pendingDraft={null}
                onPendingDraftChange={onPendingDraftChange}
            />,
        );
        // Open suggester pill, pick Anisha.
        await user.click(screen.getByRole("button", { name: /pillSuggester/ }));
        await user.click(screen.getByRole("option", { name: /Anisha/ }));
        // The callback fired with a draft whose suggester is Anisha.
        expect(onPendingDraftChange).toHaveBeenCalled();
        const lastCall =
            onPendingDraftChange.mock.calls[
                onPendingDraftChange.mock.calls.length - 1
            ];
        const draft = lastCall?.[0] as PendingSuggestionDraft | null;
        expect(draft).not.toBeNull();
        expect(draft?.suggester).toBe(ANISHA);
    });

    test("does not fire in edit flow", async () => {
        const user = userEvent.setup();
        const onPendingDraftChange = vi.fn();
        renderForm(
            <SuggestionForm
                setup={setup}
                onSubmit={vi.fn()}
                suggestion={{
                    id: SuggestionId("test-edit"),
                    suggester: Player("Bob"),
                    cards: [SUSPECT, KNIFE, KITCHEN],
                    nonRefuters: [],
                }}
                pendingDraft={null}
                onPendingDraftChange={onPendingDraftChange}
            />,
        );
        // Change the suggester to trigger setForm.
        await user.click(screen.getByRole("button", { name: /Bob/ }));
        await user.click(screen.getByRole("option", { name: /Anisha/ }));
        expect(onPendingDraftChange).not.toHaveBeenCalled();
    });
});

// -----------------------------------------------------------------------
// Cross-mount survival (M2)
//
// The bug we fix: the mobile `MobilePlayLayout` unmounts
// `SuggestionLogPanel` (and the form inside) when the user swaps to the
// Checklist pane. With the form's local state owning the draft, a swap
// dropped everything. The fix lifts the draft into the parent — so a
// mount/unmount cycle with the parent passing the persisted draft back
// in re-seeds the form to the same values.
// -----------------------------------------------------------------------
describe("SuggestionForm — cross-mount survival via parent-owned draft", () => {
    test("draft survives unmount/remount when the parent persists it", async () => {
        const user = userEvent.setup();

        function Harness() {
            const [draft, setDraft] = useState<FormState | null>(null);
            const [mounted, setMounted] = useState(true);
            return (
                <div>
                    <button
                        type="button"
                        data-testid="toggle"
                        onClick={() => setMounted(m => !m)}
                    >
                        toggle
                    </button>
                    {mounted ? (
                        <SuggestionForm
                            setup={setup}
                            onSubmit={vi.fn()}
                            pendingDraft={draft}
                            onPendingDraftChange={setDraft}
                        />
                    ) : null}
                </div>
            );
        }

        renderForm(<Harness />);

        // Pre-state: form is mounted, no values.
        expect(
            screen.queryByRole("button", { name: /Anisha/ }),
        ).toBeNull();

        // Fill the suggester pill.
        await user.click(screen.getByRole("button", { name: /pillSuggester/ }));
        await user.click(screen.getByRole("option", { name: /Anisha/ }));

        // The form now shows Anisha.
        expect(screen.getByRole("button", { name: /Anisha/ })).toBeDefined();

        // Unmount the form (simulates mobile tab swap).
        await user.click(screen.getByTestId("toggle"));
        expect(
            screen.queryByRole("button", { name: /pillSuggester/ }),
        ).toBeNull();

        // Re-mount.
        await user.click(screen.getByTestId("toggle"));

        // The form re-mounts seeded from the parent's draft — Anisha
        // is back without re-typing.
        expect(screen.getByRole("button", { name: /Anisha/ })).toBeDefined();
    });
});
