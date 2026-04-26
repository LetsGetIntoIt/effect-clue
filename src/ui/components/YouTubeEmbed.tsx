/**
 * Thin wrapper around `react-youtube` that fires a typed PostHog
 * `youtube_embed_played` event the first time the user starts the
 * video. We guard with a ref so that pause/seek/replay don't re-fire
 * the event — one play per mount is what matters for the funnel.
 *
 * `context` distinguishes the splash modal from the standalone About
 * page so we can split engagement by surface in PostHog.
 */
"use client";

import { useRef } from "react";
import YouTube from "react-youtube";
import { youtubeEmbedPlayed } from "../../analytics/events";

export function YouTubeEmbed({
    videoId,
    context,
    title,
}: {
    readonly videoId: string;
    readonly context: "page" | "modal";
    readonly title?: string;
}) {
    const playedOnce = useRef(false);
    // Size derives from context: the modal lives on a tight,
    // height-constrained surface where the primary CTA must stay
    // visible, so the embed is capped narrow. The standalone /about
    // page has no such pressure — let it fill the page column.
    const widthCap = context === "modal" ? "max-w-sm" : "max-w-2xl";
    return (
        <div
            className={`mx-auto aspect-video w-full ${widthCap} overflow-hidden rounded-[var(--radius)] bg-black`}
        >
            <YouTube
                videoId={videoId}
                title={title ?? videoId}
                className="h-full w-full"
                iframeClassName="h-full w-full"
                opts={{
                    width: "100%",
                    height: "100%",
                    playerVars: { rel: 0, modestbranding: 1 },
                }}
                onPlay={() => {
                    if (playedOnce.current) return;
                    playedOnce.current = true;
                    youtubeEmbedPlayed({ context });
                }}
            />
        </div>
    );
}
