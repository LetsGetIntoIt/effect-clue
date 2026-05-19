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
    useTranslations: (namespace?: string) => {
        const prefix = namespace !== undefined ? `${namespace}.` : "";
        const t = (key: string) => `${prefix}${key}`;
        t.rich = (key: string) => `${prefix}${key}`;
        return t;
    },
}));

vi.mock("react-youtube", () => ({
    default: () => <div data-testid="yt-mock">video</div>,
}));

vi.mock("next/image", () => ({
    default: ({ alt }: { alt: string }) => (
        <div data-testid="next-image" data-alt={alt} />
    ),
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
        expect(screen.getByText("about.title")).toBeInTheDocument();
        expect(screen.getByText("about.motivation")).toBeInTheDocument();
        expect(screen.getByText("about.videoCallout")).toBeInTheDocument();
    });

    test("renders the walkthrough with every major section", async () => {
        const AboutContent = await importContent();
        render(<AboutContent context="page" />);
        // Walkthrough container heading
        expect(
            screen.getByText("about.walkthrough.heading"),
        ).toBeInTheDocument();
        // One assertion per major section heading is enough to prove the
        // walkthrough mounted end-to-end without enumerating all 12 sub-sections.
        for (const heading of [
            "about.walkthrough.smartDeductions.heading",
            "about.walkthrough.hypotheses.heading",
            "about.walkthrough.invite.heading",
            "about.walkthrough.cardPacks.heading",
            "about.walkthrough.platforms.heading",
            "about.walkthrough.teachMe.heading",
        ]) {
            expect(screen.getByText(heading)).toBeInTheDocument();
        }
        // 13 walkthrough images render (one per sub-section).
        expect(screen.getAllByTestId("next-image")).toHaveLength(13);
    });

    test("does not fire any analytics events on plain render", async () => {
        const AboutContent = await importContent();
        render(<AboutContent context="modal" />);
        expect(captureCalls).toEqual([]);
    });
});
