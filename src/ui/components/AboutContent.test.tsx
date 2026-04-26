import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock("react-youtube", () => ({
    default: () => <div data-testid="yt-mock">video</div>,
}));

afterEach(() => {
    captureCalls.length = 0;
});

const importContent = async () => {
    const mod = await import("./AboutContent");
    return mod.AboutContent;
};

describe("AboutContent", () => {
    test("renders the video, title, and copy", async () => {
        const AboutContent = await importContent();
        render(<AboutContent context="page" />);
        expect(screen.getByTestId("yt-mock")).toBeInTheDocument();
        expect(screen.getByText("title")).toBeInTheDocument();
        expect(screen.getByText("motivation")).toBeInTheDocument();
        expect(screen.getByText("videoCallout")).toBeInTheDocument();
    });

    test("does not fire any analytics events on plain render", async () => {
        const AboutContent = await importContent();
        render(<AboutContent context="modal" />);
        expect(captureCalls).toEqual([]);
    });
});
