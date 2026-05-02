/**
 * Tests for the M22 receive-page redesign. The previous version only
 * had analytics-fire smoke checks (the actual import was a TODO).
 * Now the page renders a sender + bullet-list summary and actually
 * hydrates on Import, so the test covers:
 *
 *   - Sender line — present for non-anonymous senders, absent for
 *     anonymous senders (server-side `ownerName === null`).
 *   - Bullet list reflects exactly which slices the snapshot carries:
 *     pack name + custom flag, players + count, hand sizes, known
 *     cards / suggestions / accusations counts.
 *   - Empty-share defensive branch shows the empty-state copy and
 *     disables the Import CTA.
 *   - Import click invokes the hydration hook with the snapshot and
 *     routes to /play.
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
vi.mock("./useApplyShareSnapshot", () => ({
    useApplyShareSnapshot: () => applyMock,
}));

const sharedAnalytics = {
    shareImportStarted: vi.fn(),
    shareImported: vi.fn(),
    shareImportDismissed: vi.fn(),
    shareOpened: vi.fn(),
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
}));

import { fireEvent, render, screen } from "@testing-library/react";
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
    ownerName: null,
    ownerIsAnonymous: null,
    ...overrides,
});

beforeEach(() => {
    routerPushMock.mockReset();
    applyMock.mockReset();
    sharedAnalytics.shareImportStarted.mockReset();
    sharedAnalytics.shareImported.mockReset();
    sharedAnalytics.shareImportDismissed.mockReset();
    sharedAnalytics.shareOpened.mockReset();
});

describe("ShareImportPage — sender display", () => {
    test("non-anonymous sender → renders 'Shared by {name}' line", () => {
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                    ownerName: "Alice",
                    ownerIsAnonymous: false,
                })}
            />,
        );
        const senderLine = document.querySelector(
            "[data-share-import-sender]",
        );
        expect(senderLine).not.toBeNull();
        expect(senderLine?.textContent).toContain("importSharedBy");
        expect(senderLine?.textContent).toContain("Alice");
    });

    test("anonymous sender (ownerName: null) → no sender line", () => {
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                    ownerName: null,
                })}
            />,
        );
        expect(
            document.querySelector("[data-share-import-sender]"),
        ).toBeNull();
    });
});

describe("ShareImportPage — bullet list", () => {
    test("Classic built-in pack → renders 'Card pack: Classic' (no '(custom)')", () => {
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CLASSIC_PACK_PAYLOAD,
                })}
            />,
        );
        const packBullet = document.querySelector(
            "[data-share-import-bullet='pack']",
        );
        expect(packBullet?.textContent).toContain("importIncludesPackBuiltIn");
        expect(packBullet?.textContent).toContain("Classic");
        expect(packBullet?.textContent).not.toContain("PackCustom");
    });

    test("named custom pack → renders 'Card pack: My Office (custom)'", () => {
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                })}
            />,
        );
        const packBullet = document.querySelector(
            "[data-share-import-bullet='pack']",
        );
        expect(packBullet?.textContent).toContain("importIncludesPackCustom");
        expect(packBullet?.textContent).toContain("My Office");
    });

    test("invite share with players + handSizes → 4 bullets, no known/sugg/accu", () => {
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
                    handSizesData: HAND_SIZES_PAYLOAD,
                })}
            />,
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
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_TWO,
                    handSizesData: HAND_SIZES_PAYLOAD,
                    knownCardsData: KNOWN_CARDS_PAYLOAD,
                    suggestionsData: SUGGESTIONS_PAYLOAD,
                    accusationsData: ACCUSATIONS_PAYLOAD,
                })}
            />,
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
        render(
            <ShareImportPage
                snapshot={buildSnapshot({
                    cardPackData: CUSTOM_PACK_PAYLOAD,
                    playersData: PLAYERS_PAYLOAD_FIVE,
                })}
            />,
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
        render(
            <ShareImportPage snapshot={buildSnapshot({})} />,
        );
        expect(screen.getByText("importEmpty")).toBeTruthy();
        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement | null;
        expect(cta).not.toBeNull();
        expect(cta!.disabled).toBe(true);
    });
});

describe("ShareImportPage — import action", () => {
    test("clicking Import calls the hydration hook with the snapshot, then routes to /play", () => {
        const snapshot = buildSnapshot({
            cardPackData: CLASSIC_PACK_PAYLOAD,
            playersData: PLAYERS_PAYLOAD_TWO,
            handSizesData: HAND_SIZES_PAYLOAD,
            ownerName: "Alice",
            ownerIsAnonymous: false,
        });
        render(<ShareImportPage snapshot={snapshot} />);
        const cta = document.querySelector(
            "[data-share-import-cta]",
        ) as HTMLButtonElement;
        fireEvent.click(cta);
        expect(applyMock).toHaveBeenCalledWith(snapshot);
        expect(routerPushMock).toHaveBeenCalledWith("/play");
        expect(sharedAnalytics.shareImported).toHaveBeenCalledWith(
            expect.objectContaining({
                hadPack: true,
                hadPlayers: true,
                hadKnownCards: false,
                hadSuggestions: false,
            }),
        );
    });
});
