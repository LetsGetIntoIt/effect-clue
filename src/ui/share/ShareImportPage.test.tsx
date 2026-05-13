/**
 * Tests for the M22 receive-page redesign + the post-M22 share-receive
 * polish (sign-in gate, "Use it now?" prompt for pack-only saves,
 * pack pill activation after invite/transfer). The page renders a
 * sender + bullet-list summary, requires sign-in to import, hydrates
 * on Import, and surfaces a confirm dialog for the pack-save branch.
 *
 * Coverage:
 *   - Sender line — present for non-anonymous senders, absent for
 *     anonymous senders (server-side `ownerName === null`).
 *   - Bullet list reflects exactly which slices the snapshot carries.
 *   - Empty-share defensive branch shows the empty-state copy and
 *     disables the Import CTA.
 *   - Import click behaviour — branches by receive flow (pack-only
 *     → save + confirm; invite/transfer → confirm-then-hydrate when
 *     the receiver has a game in progress).
 *   - Sign-in gate — anonymous users see "Sign in to import" and the
 *     CTA kicks off social sign-in; auto-import only fires when a
 *     matching sessionStorage intent is present (malicious-URL
 *     defence).
 */
import { Schema } from "effect";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-intl", () => {
    const t = (key: string, values?: Record<string, unknown>): string =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    (t as unknown as { rich: unknown }).rich = (key: string): string => key;
    return {
        useTranslations: () => t,
        useLocale: () => "en",
    };
});

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: routerPushMock }),
}));

const applyMock = vi.fn();
const saveCardPackFromSnapshotMock = vi.fn();
let mockHasPersistedGameData = false;
vi.mock("./useApplyShareSnapshot", () => ({
    useApplyShareSnapshot: () => applyMock,
    hasPersistedGameData: () => mockHasPersistedGameData,
    saveCardPackFromSnapshot: (snapshot: unknown) =>
        saveCardPackFromSnapshotMock(snapshot),
}));

const consumePendingImportIntentMock = vi.fn();
const savePendingImportIntentMock = vi.fn();
vi.mock("./pendingImport", () => ({
    consumePendingImportIntent: (id: string) =>
        consumePendingImportIntentMock(id),
    savePendingImportIntent: (intent: unknown) =>
        savePendingImportIntentMock(intent),
}));

const signInSocialMock = vi.fn();
vi.mock("../account/authClient", () => ({
    authClient: {
        signIn: { social: (args: unknown) => signInSocialMock(args) },
    },
}));

let mockSessionUser: {
    id: string;
    isAnonymous: boolean;
} | null = { id: "test-user", isAnonymous: false };
vi.mock("../hooks/useSession", () => ({
    useSession: () => ({ data: { user: mockSessionUser } }),
}));

const invalidateQueriesMock = vi.fn();
vi.mock("@tanstack/react-query", async () => {
    const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
        "@tanstack/react-query",
    );
    return {
        ...actual,
        useQueryClient: () => ({
            invalidateQueries: invalidateQueriesMock,
        }),
    };
});

const sharedAnalytics = {
    shareImportStarted: vi.fn(),
    shareImported: vi.fn(),
    shareImportDismissed: vi.fn(),
    shareOpened: vi.fn(),
    signInStarted: vi.fn(),
    signInFailed: vi.fn(),
};
vi.mock("../../analytics/events", () => ({
    shareImportStarted: (...args: unknown[]) =>
        sharedAnalytics.shareImportStarted(...args),
    shareImported: (...args: unknown[]) =>
        sharedAnalytics.shareImported(...args),
    shareImportDismissed: (...args: unknown[]) =>
        sharedAnalytics.shareImportDismissed(...args),
    shareOpened: (...args: unknown[]) =>
        sharedAnalytics.shareOpened(...args),
    signInStarted: (...args: unknown[]) =>
        sharedAnalytics.signInStarted(...args),
    signInFailed: (...args: unknown[]) =>
        sharedAnalytics.signInFailed(...args),
}));

import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { Card, CardCategory, Player } from "../../logic/GameObjects";
import { CARD_SETS } from "../../logic/GameSetup";
import {
    cardPackCodec,
    handSizesCodec,
    knownCardsCodec,
    playersCodec,
    suggestionsCodec,
    accusationsCodec,
} from "../../logic/ShareCodec";
import { newSuggestionId } from "../../logic/Suggestion";
import { newAccusationId } from "../../logic/Accusation";
import { ShareImportPage } from "./ShareImportPage";
import { ModalStackProvider, ModalStackShell } from "../components/ModalStack";
import { ConfirmProvider } from "../hooks/useConfirm";

const CUSTOM_PACK_PAYLOAD = Schema.encodeSync(cardPackCodec)({
    name: "My Office",
    categories: [
        {
            id: CardCategory("category-suspect"),
            name: "Suspect",
            cards: [
                { id: Card("card-pam"), name: "Pam Beesly" },
                { id: Card("card-jim"), name: "Jim Halpert" },
            ],
        },
    ],
});

const CLASSIC_PACK_PAYLOAD = Schema.encodeSync(cardPackCodec)({
    name: "Classic",
    // Same shape as the actual Classic registry entry — see
    // src/logic/GameSetup.ts CARD_SETS — the receive page matches by
    // structural equality, not by name alone.
    categories: getClassicCategoriesShape(),
});

function getClassicCategoriesShape() {
    // Lift the Classic registry's categories into the wire shape.
    // Asserts the receive page detects the built-in match by
    // structural equality — sidesteps the per-test fixture by
    // borrowing the real registry. If the registry's structure
    // ever changes, this falls over by design.
    return CARD_SETS[0]!.cardSet.categories.map((c) => ({
        id: c.id,
        name: c.name,
        cards: c.cards.map((card) => ({ id: card.id, name: card.name })),
    }));
}

const PLAYERS_PAYLOAD_TWO = Schema.encodeSync(playersCodec)([
    Player("Alice"),
    Player("Bob"),
]);
const PLAYERS_PAYLOAD_FIVE = Schema.encodeSync(playersCodec)([
    Player("Alice"),
    Player("Bob"),
    Player("Cho"),
    Player("Dana"),
    Player("Eve"),
    Player("Frank"),
]);
const HAND_SIZES_PAYLOAD = Schema.encodeSync(handSizesCodec)([
    { player: Player("Alice"), size: 4 },
    { player: Player("Bob"), size: 4 },
]);
const KNOWN_CARDS_PAYLOAD = Schema.encodeSync(knownCardsCodec)([
    { player: Player("Alice"), cards: [Card("card-pam"), Card("card-jim")] },
]);
const SUGGESTIONS_PAYLOAD = Schema.encodeSync(suggestionsCodec)([
    {
        id: newSuggestionId(),
        suggester: Player("Alice"),
        cards: [Card("card-pam")],
        nonRefuters: [],
        refuter: null,
        seenCard: null,
        loggedAt: 1,
    },
    {
        id: newSuggestionId(),
        suggester: Player("Bob"),
        cards: [Card("card-jim")],
        nonRefuters: [],
        refuter: null,
        seenCard: null,
        loggedAt: 2,
    },
]);
const ACCUSATIONS_PAYLOAD = Schema.encodeSync(accusationsCodec)([
    {
        id: newAccusationId(),
        accuser: Player("Alice"),
        cards: [Card("card-pam")],
        loggedAt: 3,
    },
]);

interface SnapshotOverrides {
    cardPackData?: string | null;
    playersData?: string | null;
    handSizesData?: string | null;
    knownCardsData?: string | null;
    suggestionsData?: string | null;
    accusationsData?: string | null;
    ownerName?: string | null;
    ownerIsAnonymous?: boolean | null;
}

const buildSnapshot = (overrides: SnapshotOverrides) => ({
    id: "share_test_id",
    cardPackData: null,
    playersData: null,
    handSizesData: null,
    knownCardsData: null,
    suggestionsData: null,
    accusationsData: null,
    hypothesesData: null,
    ownerName: null,
    ownerIsAnonymous: null,
    ...overrides,
});

beforeEach(() => {
    // Clear tour state between tests — the invite/transfer flow writes
    // `effect-clue.tour.setup.v1` to mark the setup tour dismissed,
    // and we want each test to start from a clean slate.
    window.localStorage.clear();
    mockHasPersistedGameData = false;
    mockSessionUser = { id: "test-user", isAnonymous: false };
    routerPushMock.mockReset();
    applyMock.mockReset();
    saveCardPackFromSnapshotMock.mockReset();
    saveCardPackFromSnapshotMock.mockReturnValue({
        kind: "saved",
        pack: { id: "pack-1", label: "My Office", cardSet: { categories: [] } },
    });
    invalidateQueriesMock.mockReset();
    invalidateQueriesMock.mockResolvedValue(undefined);
    consumePendingImportIntentMock.mockReset();
    consumePendingImportIntentMock.mockReturnValue(false);
    savePendingImportIntentMock.mockReset();
    signInSocialMock.mockReset();
    signInSocialMock.mockResolvedValue({ error: null });
    sharedAnalytics.shareImportStarted.mockReset();
    sharedAnalytics.shareImported.mockReset();
    sharedAnalytics.shareImportDismissed.mockReset();
    sharedAnalytics.shareOpened.mockReset();
    sharedAnalytics.signInStarted.mockReset();
    sharedAnalytics.signInFailed.mockReset();
});

const renderImportPage = (snapshot: ReturnType<typeof buildSnapshot>) =>
    render(
        <ModalStackProvider>
            <ConfirmProvider>
                <ShareImportPage snapshot={snapshot} />
                <ModalStackShell />
            </ConfirmProvider>
        </ModalStackProvider>,
    );

describe("ShareImportPage — sender display", () => {
    test("non-anonymous sender → renders 'Shared by {name}' line", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                    ownerName: "Alice",
                    ownerIsAnonymous: false,
            }),
        );
        const senderLine = document.querySelector(
            "[data-share-import-sender]",
        );
        expect(senderLine).not.toBeNull();
        expect(senderLine?.textContent).toContain("importSharedBy");
        expect(senderLine?.textContent).toContain("Alice");
    });

    test("anonymous sender (ownerName: null) → no sender line", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                    ownerName: null,
            }),
        );
        expect(
            document.querySelector("[data-share-import-sender]"),
        ).toBeNull();
    });
});

describe("ShareImportPage — bullet list", () => {
    test("pack-only share uses card-pack title, content heading, and CTA", () => {
        renderImportPage(
            buildSnapshot({
                cardPackData: CUSTOM_PACK_PAYLOAD,
            }),
        );

        expect(screen.getByText("importModalTitlePack")).toBeInTheDocument();
        expect(
            screen.getByText(
                'importIncludesHeaderPackNamed:{"label":"My Office"}',
            ),
        ).toBeInTheDocument();
        expect(screen.getByText("importActionPack")).toBeInTheDocument();
        expect(
            document.querySelector("[data-share-import-bullet='pack']"),
        ).toBeNull();
        expect(
            document.querySelectorAll(
                "[data-share-import-bullet='pack-category']",
            ).length,
        ).toBe(1);
        expect(document.body.textContent).toContain("Suspect");
        expect(document.body.textContent).toContain("\"count\":2");
    });

    test("invite-style share uses game-setup title, content heading, and CTA", () => {
        renderImportPage(
            buildSnapshot({
                cardPackData: CUSTOM_PACK_PAYLOAD,
                playersData: PLAYERS_PAYLOAD_TWO,
                handSizesData: HAND_SIZES_PAYLOAD,
            }),
        );

        expect(screen.getByText("importModalTitleInvite")).toBeInTheDocument();
        expect(screen.getByText("importIncludesHeaderInvite")).toBeInTheDocument();
        expect(screen.getByText("importActionInvite")).toBeInTheDocument();
    });

    test("transfer/progress share uses continue-game title, content heading, and CTA", () => {
        renderImportPage(
            buildSnapshot({
                cardPackData: CUSTOM_PACK_PAYLOAD,
                playersData: PLAYERS_PAYLOAD_TWO,
                handSizesData: HAND_SIZES_PAYLOAD,
                knownCardsData: KNOWN_CARDS_PAYLOAD,
            }),
        );

        expect(screen.getByText("importModalTitleTransfer")).toBeInTheDocument();
        expect(screen.getByText("importIncludesHeaderTransfer")).toBeInTheDocument();
        expect(screen.getByText("importActionTransfer")).toBeInTheDocument();
    });

    test("game share with Classic built-in pack → renders 'Card pack: Classic' (no '(custom)')", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
            }),
        );
        const packBullet = document.querySelector(
            "[data-share-import-bullet='pack']",
        );
        expect(packBullet?.textContent).toContain("importIncludesPackBuiltIn");
        expect(packBullet?.textContent).toContain("Classic");
        expect(packBullet?.textContent).not.toContain("PackCustom");
    });

    test("game share with named custom pack → renders 'Card pack: My Office (custom)'", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
            }),
        );
        const packBullet = document.querySelector(
            "[data-share-import-bullet='pack']",
        );
        expect(packBullet?.textContent).toContain("importIncludesPackCustom");
        expect(packBullet?.textContent).toContain("My Office");
    });

    test("invite share with players + handSizes → 4 bullets, no known/sugg/accu", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
                    handSizesData: HAND_SIZES_PAYLOAD,
            }),
        );
        expect(
            document.querySelector("[data-share-import-bullet='pack']"),
        ).not.toBeNull();
        expect(
            document.querySelector("[data-share-import-bullet='players']"),
        ).not.toBeNull();
        expect(
            document.querySelector("[data-share-import-bullet='hand-sizes']"),
        ).not.toBeNull();
        expect(
            document.querySelector("[data-share-import-bullet='known-cards']"),
        ).toBeNull();
        expect(
            document.querySelector("[data-share-import-bullet='suggestions']"),
        ).toBeNull();
        expect(
            document.querySelector("[data-share-import-bullet='accusations']"),
        ).toBeNull();
    });

    test("transfer share → all 6 bullets present with counts", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
                    handSizesData: HAND_SIZES_PAYLOAD,
                    knownCardsData: KNOWN_CARDS_PAYLOAD,
                    suggestionsData: SUGGESTIONS_PAYLOAD,
                    accusationsData: ACCUSATIONS_PAYLOAD,
            }),
        );
        const knownBullet = document.querySelector(
            "[data-share-import-bullet='known-cards']",
        );
        // Two cards in the fixture's single hand → count: 2
        expect(knownBullet?.textContent).toContain("\"count\":2");
        const suggBullet = document.querySelector(
            "[data-share-import-bullet='suggestions']",
        );
        expect(suggBullet?.textContent).toContain("\"count\":2");
        const accuBullet = document.querySelector(
            "[data-share-import-bullet='accusations']",
        );
        expect(accuBullet?.textContent).toContain("\"count\":1");
    });

    test("more than 4 player names → uses overflow copy with '+N more'", () => {
        renderImportPage(
            buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_FIVE,
            }),
        );
        const playersBullet = document.querySelector(
            "[data-share-import-bullet='players']",
        );
        expect(playersBullet?.textContent).toContain(
            "importIncludesPlayersOverflow",
        );
        expect(playersBullet?.textContent).toContain("\"extra\":2");
    });
});

describe("ShareImportPage — empty share guard", () => {
    test("no card pack → empty-state copy, Import disabled", () => {
        renderImportPage(buildSnapshot({}));
        expect(screen.getByText("importEmpty")).toBeTruthy();
        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement | null;
        expect(cta).not.toBeNull();
        expect(cta!.disabled).toBe(true);
    });
});

describe("ShareImportPage — import action", () => {
    test("pack-only import saves pack, then asks 'Use it now?' (no game in progress)", async () => {
        mockHasPersistedGameData = false;
        const snapshot = buildSnapshot({
            cardPackData: CUSTOM_PACK_PAYLOAD,
        });
        renderImportPage(snapshot);

        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        fireEvent.click(cta);

        await waitFor(() => {
            expect(saveCardPackFromSnapshotMock).toHaveBeenCalledWith(snapshot);
        });
        // Use-it-now confirm fires; "newGameConfirm" is NOT appended
        // because there's no game in progress.
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog.textContent).toContain("packSavedPrompt");
        expect(dialog.textContent).not.toContain("newGameConfirm");
        // "Not now" cancels the prompt; pack stays saved but live
        // setup isn't touched.
        fireEvent.click(within(dialog).getByText("notNow"));

        await waitFor(() => {
            expect(routerPushMock).toHaveBeenCalledWith("/play");
        });
        expect(applyMock).not.toHaveBeenCalled();
        expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);
    });

    test("pack-only with game in progress → 'Use it now?' message includes overwrite warning", async () => {
        mockHasPersistedGameData = true;
        const snapshot = buildSnapshot({
            cardPackData: CUSTOM_PACK_PAYLOAD,
        });
        renderImportPage(snapshot);

        fireEvent.click(
            document.querySelector("[data-share-import-cta]")!,
        );

        const dialog = await screen.findByRole("alertdialog");
        expect(dialog.textContent).toContain("packSavedPrompt");
        expect(dialog.textContent).toContain("newGameConfirm");
    });

    test("pack-only 'Start new game' → applies snapshot and routes to /play", async () => {
        mockHasPersistedGameData = false;
        const snapshot = buildSnapshot({
            cardPackData: CUSTOM_PACK_PAYLOAD,
        });
        renderImportPage(snapshot);

        fireEvent.click(
            document.querySelector("[data-share-import-cta]")!,
        );
        const dialog = await screen.findByRole("alertdialog");
        fireEvent.click(within(dialog).getByText("startNewGameWithPack"));

        await waitFor(() => {
            expect(applyMock).toHaveBeenCalledWith(snapshot);
            expect(routerPushMock).toHaveBeenCalledWith("/play");
        });
    });

    test("invite-style import calls applySnapshot, dismisses the setup tour, and routes to /play?view=checklist", async () => {
        // The share is a complete game — the receiver doesn't need
        // the setup wizard, so we land them on the checklist directly
        // and mark the setup tour as dismissed so the StartupCoordinator
        // doesn't redirect them back.
        const snapshot = buildSnapshot({
            cardPackData: CLASSIC_PACK_PAYLOAD,
            playersData: PLAYERS_PAYLOAD_TWO,
            handSizesData: HAND_SIZES_PAYLOAD,
            ownerName: "Alice",
            ownerIsAnonymous: false,
        });
        renderImportPage(snapshot);
        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        expect(cta.textContent).toBe("importActionInvite");
        fireEvent.click(cta);
        await waitFor(() => {
            expect(applyMock).toHaveBeenCalledWith(snapshot);
            expect(routerPushMock).toHaveBeenCalledWith(
                "/play?view=checklist",
            );
        });
        // Setup tour is now marked dismissed in localStorage so the
        // coordinator's precedence redirect doesn't pull the user back.
        const setupTourState = window.localStorage.getItem(
            "effect-clue.tour.setup.v1",
        );
        expect(setupTourState).not.toBeNull();
        expect(setupTourState).toContain("lastDismissedAt");
        expect(sharedAnalytics.shareImported).toHaveBeenCalledWith(
            expect.objectContaining({
                hadPack: true,
                hadPlayers: true,
                hadKnownCards: false,
                hadSuggestions: false,
            }),
        );
    });

    test("dirty receiver game shows the existing New Game warning before importing", async () => {
        mockHasPersistedGameData = true;
        const snapshot = buildSnapshot({
            cardPackData: CLASSIC_PACK_PAYLOAD,
            playersData: PLAYERS_PAYLOAD_TWO,
        });
        renderImportPage(snapshot);

        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        fireEvent.click(cta);

        expect(screen.getByText("newGameConfirm")).toBeInTheDocument();
        expect(applyMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText("confirm"));

        await waitFor(() => {
            expect(applyMock).toHaveBeenCalledWith(snapshot);
            // Invite/transfer flow → checklist view, not bare /play.
            expect(routerPushMock).toHaveBeenCalledWith(
                "/play?view=checklist",
            );
        });
    });

    test("canceling the dirty-game warning leaves the current game untouched", () => {
        mockHasPersistedGameData = true;
        const snapshot = buildSnapshot({
            cardPackData: CLASSIC_PACK_PAYLOAD,
            playersData: PLAYERS_PAYLOAD_TWO,
        });
        renderImportPage(snapshot);

        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        fireEvent.click(cta);
        const dialog = screen.getByRole("alertdialog");
        fireEvent.click(within(dialog).getByText("cancel"));

        expect(applyMock).not.toHaveBeenCalled();
        expect(routerPushMock).not.toHaveBeenCalled();
    });
});

describe("ShareImportPage — sign-in gate", () => {
    test("anonymous user → CTA reads 'Sign in to import' and click stamps intent + kicks off OAuth", async () => {
        mockSessionUser = { id: "anon", isAnonymous: true };
        const snapshot = buildSnapshot({ cardPackData: CUSTOM_PACK_PAYLOAD });
        renderImportPage(snapshot);

        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        expect(cta.textContent).toBe("signInToImport");

        fireEvent.click(cta);

        await waitFor(() => {
            expect(savePendingImportIntentMock).toHaveBeenCalledWith(
                expect.objectContaining({ shareId: snapshot.id }),
            );
            expect(signInSocialMock).toHaveBeenCalledWith(
                expect.objectContaining({ provider: "google" }),
            );
        });
        // No actual import happened — that fires after OAuth lands the
        // user back here with a real session.
        expect(saveCardPackFromSnapshotMock).not.toHaveBeenCalled();
        expect(applyMock).not.toHaveBeenCalled();
    });

    test("anonymous → no logged-out user can be tricked into auto-import (no sessionStorage intent)", () => {
        mockSessionUser = { id: "anon", isAnonymous: true };
        consumePendingImportIntentMock.mockReturnValue(false);
        const snapshot = buildSnapshot({ cardPackData: CUSTOM_PACK_PAYLOAD });
        renderImportPage(snapshot);
        // Render alone must not auto-fire any imports.
        expect(saveCardPackFromSnapshotMock).not.toHaveBeenCalled();
        expect(applyMock).not.toHaveBeenCalled();
    });

    test("signed-in user with matching pendingImport intent → auto-imports on mount", async () => {
        mockSessionUser = { id: "test-user", isAnonymous: false };
        consumePendingImportIntentMock.mockReturnValue(true);
        const snapshot = buildSnapshot({ cardPackData: CUSTOM_PACK_PAYLOAD });
        renderImportPage(snapshot);

        await waitFor(() => {
            expect(consumePendingImportIntentMock).toHaveBeenCalledWith(
                snapshot.id,
            );
            expect(saveCardPackFromSnapshotMock).toHaveBeenCalled();
        });
    });

    test("signed-in user without pendingImport intent → renders modal idle (malicious-URL safe)", () => {
        mockSessionUser = { id: "test-user", isAnonymous: false };
        consumePendingImportIntentMock.mockReturnValue(false);
        const snapshot = buildSnapshot({ cardPackData: CUSTOM_PACK_PAYLOAD });
        renderImportPage(snapshot);
        // No auto-import without an explicit intent — the user (or a
        // malicious sender) sending the URL alone can't kick off import.
        expect(saveCardPackFromSnapshotMock).not.toHaveBeenCalled();
        expect(applyMock).not.toHaveBeenCalled();
    });
});
