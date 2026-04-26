/**
 * Shared "about" content for the splash modal on `/play` and the
 * standalone `/about` page. The video at the top is the kickoff
 * explainer; the copy below pitches what the solver does for you and
 * sends you to the video for the strategy lesson.
 *
 * `context` is forwarded to every analytics event the user can fire
 * from this surface so PostHog can split engagement by where they
 * saw it (modal vs. page).
 */
"use client";

import { useTranslations } from "next-intl";
import { YouTubeEmbed } from "./YouTubeEmbed";

const VIDEO_ID = "ijkDbdlpY6c";

export function AboutContent({
    context,
}: {
    readonly context: "page" | "modal";
}) {
    const t = useTranslations("about");
    return (
        <div className="flex flex-col gap-4">
            <YouTubeEmbed
                videoId={VIDEO_ID}
                context={context}
                title={t("videoTitle")}
            />
            <h2 className="m-0 font-display text-[22px] leading-tight">
                {t("title")}
            </h2>
            <p className="m-0 text-[15px] leading-relaxed">
                {t("motivation")}
            </p>
            <p className="m-0 text-[15px] leading-relaxed">
                {t("videoCallout")}
            </p>
        </div>
    );
}
