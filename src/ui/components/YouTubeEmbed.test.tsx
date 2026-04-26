import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

vi.mock("react-youtube", () => ({
    default: ({
        onPlay,
        title,
    }: {
        onPlay?: () => void;
        title?: string;
    }) => (
        <button
            type="button"
            data-testid="yt-mock-play"
            aria-label={title ?? "play"}
            onClick={() => onPlay?.()}
        >
            play
        </button>
    ),
}));

afterEach(() => {
    captureCalls.length = 0;
});

const importEmbed = async () => {
    const mod = await import("./YouTubeEmbed");
    return mod.YouTubeEmbed;
};

describe("YouTubeEmbed", () => {
    test("fires youtubeEmbedPlayed once on first play", async () => {
        const YouTubeEmbed = await importEmbed();
        render(<YouTubeEmbed videoId="abc" context="modal" />);
        const play = screen.getByTestId("yt-mock-play");

        fireEvent.click(play);
        fireEvent.click(play);
        fireEvent.click(play);

        expect(captureCalls).toEqual([
            { event: "youtube_embed_played", props: { context: "modal" } },
        ]);
    });

    test("passes context=page through to the event", async () => {
        const YouTubeEmbed = await importEmbed();
        render(<YouTubeEmbed videoId="abc" context="page" />);
        fireEvent.click(screen.getByTestId("yt-mock-play"));
        expect(captureCalls).toEqual([
            { event: "youtube_embed_played", props: { context: "page" } },
        ]);
    });

    test("does not fire on mount alone", async () => {
        const YouTubeEmbed = await importEmbed();
        render(<YouTubeEmbed videoId="abc" context="modal" />);
        expect(captureCalls).toEqual([]);
    });
});
