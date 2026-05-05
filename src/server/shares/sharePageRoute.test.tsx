import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ERR_SHARE_NOT_FOUND } from "./errors";

const mocks = vi.hoisted(() => ({
    getShare: vi.fn(),
}));

vi.mock("../../../src/server/actions/shares", () => ({
    getShare: mocks.getShare,
}));

vi.mock("../../../src/ui/hooks/useConfirm", () => ({
    ConfirmProvider: ({ children }: { readonly children: React.ReactNode }) => (
        <>{children}</>
    ),
}));

vi.mock("../../../src/ui/share/ShareImportPage", () => ({
    ShareImportPage: () => <div data-testid="share-import-page" />,
}));

vi.mock("../../../src/ui/share/ShareMissingPage", () => ({
    ShareMissingPage: ({ shareId }: { readonly shareId: string }) => (
        <div data-share-id={shareId} data-testid="share-missing-page" />
    ),
}));

import SharePageRoute from "../../../app/share/[id]/page";

const routeParams = (id: string): Parameters<typeof SharePageRoute>[0] => ({
    params: Promise.resolve({ id }),
});

describe("SharePageRoute", () => {
    test("renders the missing-share page for a missing or expired share", async () => {
        mocks.getShare.mockRejectedValueOnce(new Error(ERR_SHARE_NOT_FOUND));

        render(await SharePageRoute(routeParams("missing-share-id")));

        expect(mocks.getShare).toHaveBeenCalledWith({
            id: "missing-share-id",
        });
        expect(screen.getByTestId("share-missing-page")).toHaveAttribute(
            "data-share-id",
            "missing-share-id",
        );
    });

    test("surfaces Postgres connection failures instead of hiding them as missing shares", async () => {
        mocks.getShare.mockRejectedValueOnce(
            Object.assign(new Error("PgClient: Failed to connect"), {
                name: "effect/sql/SqlError",
            }),
        );

        await expect(
            SharePageRoute(routeParams("made-up-preview-id")),
        ).rejects.toThrow("PgClient: Failed to connect");
    });

    test("still rethrows unrelated share lookup errors", async () => {
        mocks.getShare.mockRejectedValueOnce(new Error("malformed share"));

        await expect(
            SharePageRoute(routeParams("broken-share-id")),
        ).rejects.toThrow("malformed share");
    });
});
