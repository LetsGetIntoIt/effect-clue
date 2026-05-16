import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

const routerPushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: routerPushMock }),
}));

let mockHasPersistedGameData = false;
vi.mock("./useApplyShareSnapshot", () => ({
    hasPersistedGameData: () => mockHasPersistedGameData,
}));

const shareOpenFailedMock = vi.fn();
vi.mock("../../analytics/events", () => ({
    shareOpenFailed: (input: unknown) => shareOpenFailedMock(input),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareMissingPage } from "./ShareMissingPage";
import {
    ModalStackProvider,
    ModalStackShell,
} from "../components/ModalStack";

beforeEach(() => {
    mockHasPersistedGameData = false;
    routerPushMock.mockReset();
    shareOpenFailedMock.mockReset();
});

// `ShareMissingPage` pushes its modal entry onto the global stack —
// wrap with the provider so the push has a target and the shell
// renders the content into the DOM.
const renderInStack = (ui: React.ReactElement) =>
    render(
        <ModalStackProvider>
            {ui}
            <ModalStackShell />
        </ModalStackProvider>,
    );

describe("ShareMissingPage", () => {
    test("empty local state offers to start a new game", async () => {
        renderInStack(<ShareMissingPage shareId="missing-share" />);

        await waitFor(() => {
            expect(screen.getByText("missingTitle")).toBeInTheDocument();
        });
        expect(screen.getByText("missingBody")).toBeInTheDocument();
        await waitFor(() => {
            expect(
                screen.getByText("missingActionStart"),
            ).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("missingActionStart"));

        expect(routerPushMock).toHaveBeenCalledWith("/play?view=setup");
        await waitFor(() => {
            expect(shareOpenFailedMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: "not_found_or_expired",
                }),
            );
        });
    });

    test("existing local progress offers to continue the current game", async () => {
        mockHasPersistedGameData = true;
        renderInStack(<ShareMissingPage shareId="missing-share" />);

        await waitFor(() => {
            expect(
                screen.getByText("missingActionContinue"),
            ).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText("missingActionContinue"));

        expect(routerPushMock).toHaveBeenCalledWith("/play");
    });
});
