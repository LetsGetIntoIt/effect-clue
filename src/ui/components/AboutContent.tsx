/**
 * Shared "about" content for the splash modal on `/play` and the
 * standalone `/about` page. The video at the top is the kickoff
 * strategy explainer; the copy below pitches what the solver does
 * for you; the walkthrough below that tours each feature with a
 * paired gif or screenshot.
 *
 * `context` is forwarded to every analytics event the user can fire
 * from this surface so PostHog can split engagement by where they
 * saw it (modal vs. page).
 */
"use client";

import Image, { type StaticImageData } from "next/image";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";
import checklistGif from "../../../public/images/walkthrough/walkthrough/01-checklist-suggest-form.gif";
import suggestionLogGif from "../../../public/images/walkthrough/walkthrough/02-adding-suggestion.gif";
import cellExplanationGif from "../../../public/images/walkthrough/walkthrough/03-cell-explanation.gif";
import manualHypothesisGif from "../../../public/images/walkthrough/walkthrough/04-manual-hypothesis.gif";
import suggestedHypothesesGif from "../../../public/images/walkthrough/walkthrough/05-suggested-hypotheses.gif";
import gameSetupGif from "../../../public/images/walkthrough/walkthrough/06-game-setup.gif";
import createPackGif from "../../../public/images/walkthrough/walkthrough/07-create-card-pack.gif";
import sharePackGif from "../../../public/images/walkthrough/walkthrough/08-share-card-pack.gif";
import savePackGif from "../../../public/images/walkthrough/walkthrough/09-save-card-pack.gif";
import desktopPng from "../../../public/images/walkthrough/walkthrough/10-desktop.png";
import teachMeSetupPng from "../../../public/images/walkthrough/11-teach-me-setup.png";
import teachMeCheckButtonPng from "../../../public/images/walkthrough/12-teach-me-check-button.png";
import teachMeCheckBannerPng from "../../../public/images/walkthrough/13-teach-me-check-banner.png";
import { YouTubeEmbed } from "./YouTubeEmbed";

const VIDEO_ID = "ijkDbdlpY6c";

// Phone-shaped gifs (01–09) are 500×766 and feel out of place when
// stretched to the full content column on desktop. Cap them around a
// phone width and center the frame so the parchment sits around them;
// on mobile the column is narrower than 400px so the wrapper hits the
// column width first and the gif fills naturally.
const PHONE_FRAME_MAX_WIDTH = "max-w-[400px]";

const IMAGE_SIZES_PHONE = "(max-width: 400px) 92vw, 400px";
const IMAGE_SIZES_FULL = "(max-width: 800px) 92vw, 640px";

// Frame-width discriminators. Pulled to module scope so the
// i18next/no-literal-string lint rule reads them as identifiers
// rather than user copy.
const FRAME_PHONE = "phone" as const;
const FRAME_FULL = "full" as const;

type FrameWidth = typeof FRAME_PHONE | typeof FRAME_FULL;

function WalkthroughSubsection({
    image,
    alt,
    title,
    body,
    frameWidth,
    priority = false,
}: {
    readonly image: StaticImageData;
    readonly alt: string;
    readonly title: string;
    readonly body: string;
    readonly frameWidth: FrameWidth;
    readonly priority?: boolean;
}) {
    const frameClass =
        frameWidth === FRAME_PHONE
            ? `mx-auto w-full ${PHONE_FRAME_MAX_WIDTH}`
            : "w-full";
    const sizes =
        frameWidth === FRAME_PHONE ? IMAGE_SIZES_PHONE : IMAGE_SIZES_FULL;
    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
                <h3 className="m-0 font-display text-[1.125rem] leading-tight text-accent">
                    {title}
                </h3>
                <p className="m-0 text-[0.9375rem] leading-relaxed">{body}</p>
            </div>
            <div
                className={`${frameClass} overflow-hidden rounded-[var(--radius)] border border-border/30 bg-panel shadow-sm`}
            >
                {/*
                  * Shave 2px off every edge of the asset to hide any
                  * hairline artifact at the source-image boundary. The
                  * image is sized 4px wider than its container and pulled
                  * back with a negative margin; the wrapper's
                  * `overflow-hidden` clips the result.
                  */}
                <Image
                    src={image}
                    alt={alt}
                    sizes={sizes}
                    className="-m-[2px] block h-auto w-[calc(100%+4px)] max-w-none"
                    {...(priority ? { priority: true } : {})}
                />
            </div>
        </section>
    );
}

function MajorSection({
    heading,
    intro,
    children,
}: {
    readonly heading: string;
    readonly intro?: string;
    readonly children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <h2 className="m-0 font-display text-[1.375rem] leading-tight">
                    {heading}
                </h2>
                {intro !== undefined && (
                    <p className="m-0 text-[1rem] leading-relaxed">{intro}</p>
                )}
            </div>
            <div className="flex flex-col [&>*+*]:mt-10 [&>*+*]:border-t [&>*+*]:border-accent/30 [&>*+*]:pt-10">
                {children}
            </div>
        </div>
    );
}

function Walkthrough() {
    const t = useTranslations("about.walkthrough");
    return (
        <div className="mt-4 flex flex-col [&>*+*]:mt-10 [&>*+*]:border-t [&>*+*]:border-accent/30 [&>*+*]:pt-10">
            <h2 className="m-0 font-display text-[1.5rem] leading-tight text-accent">
                {t("heading")}
            </h2>

            <MajorSection heading={t("smartDeductions.heading")}>
                <WalkthroughSubsection
                    image={checklistGif}
                    alt={t("smartDeductions.checklist.imageAlt")}
                    title={t("smartDeductions.checklist.title")}
                    body={t("smartDeductions.checklist.body")}
                    frameWidth={FRAME_PHONE}
                    priority
                />
                <WalkthroughSubsection
                    image={suggestionLogGif}
                    alt={t("smartDeductions.suggestionLog.imageAlt")}
                    title={t("smartDeductions.suggestionLog.title")}
                    body={t("smartDeductions.suggestionLog.body")}
                    frameWidth={FRAME_PHONE}
                />
                <WalkthroughSubsection
                    image={cellExplanationGif}
                    alt={t("smartDeductions.cellExplanation.imageAlt")}
                    title={t("smartDeductions.cellExplanation.title")}
                    body={t("smartDeductions.cellExplanation.body")}
                    frameWidth={FRAME_PHONE}
                />
            </MajorSection>

            <MajorSection heading={t("hypotheses.heading")}>
                <WalkthroughSubsection
                    image={manualHypothesisGif}
                    alt={t("hypotheses.manual.imageAlt")}
                    title={t("hypotheses.manual.title")}
                    body={t("hypotheses.manual.body")}
                    frameWidth={FRAME_PHONE}
                />
                <WalkthroughSubsection
                    image={suggestedHypothesesGif}
                    alt={t("hypotheses.suggested.imageAlt")}
                    title={t("hypotheses.suggested.title")}
                    body={t("hypotheses.suggested.body")}
                    frameWidth={FRAME_PHONE}
                />
            </MajorSection>

            <MajorSection heading={t("invite.heading")}>
                <WalkthroughSubsection
                    image={gameSetupGif}
                    alt={t("invite.setup.imageAlt")}
                    title={t("invite.setup.title")}
                    body={t("invite.setup.body")}
                    frameWidth={FRAME_PHONE}
                />
            </MajorSection>

            <MajorSection heading={t("cardPacks.heading")}>
                <WalkthroughSubsection
                    image={createPackGif}
                    alt={t("cardPacks.create.imageAlt")}
                    title={t("cardPacks.create.title")}
                    body={t("cardPacks.create.body")}
                    frameWidth={FRAME_PHONE}
                />
                <WalkthroughSubsection
                    image={sharePackGif}
                    alt={t("cardPacks.share.imageAlt")}
                    title={t("cardPacks.share.title")}
                    body={t("cardPacks.share.body")}
                    frameWidth={FRAME_PHONE}
                />
                <WalkthroughSubsection
                    image={savePackGif}
                    alt={t("cardPacks.save.imageAlt")}
                    title={t("cardPacks.save.title")}
                    body={t("cardPacks.save.body")}
                    frameWidth={FRAME_PHONE}
                />
            </MajorSection>

            <MajorSection heading={t("platforms.heading")}>
                <WalkthroughSubsection
                    image={desktopPng}
                    alt={t("platforms.desktopMobile.imageAlt")}
                    title={t("platforms.desktopMobile.title")}
                    body={t("platforms.desktopMobile.body")}
                    frameWidth={FRAME_FULL}
                />
            </MajorSection>

            <MajorSection
                heading={t("teachMe.heading")}
                intro={t("teachMe.intro")}
            >
                <WalkthroughSubsection
                    image={teachMeSetupPng}
                    alt={t("teachMe.turnOn.imageAlt")}
                    title={t("teachMe.turnOn.title")}
                    body={t("teachMe.turnOn.body")}
                    frameWidth={FRAME_FULL}
                />
                <WalkthroughSubsection
                    image={teachMeCheckButtonPng}
                    alt={t("teachMe.markCell.imageAlt")}
                    title={t("teachMe.markCell.title")}
                    body={t("teachMe.markCell.body")}
                    frameWidth={FRAME_FULL}
                />
                <WalkthroughSubsection
                    image={teachMeCheckBannerPng}
                    alt={t("teachMe.checkResult.imageAlt")}
                    title={t("teachMe.checkResult.title")}
                    body={t("teachMe.checkResult.body")}
                    frameWidth={FRAME_FULL}
                />
            </MajorSection>
        </div>
    );
}

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
            <h2 className="m-0 font-display text-[1.375rem] leading-tight">
                {t("title")}
            </h2>
            <p className="m-0 text-[1rem] leading-relaxed">
                {t("motivation")}
            </p>
            <p className="m-0 text-[1rem] leading-relaxed">
                {t("videoCallout")}
            </p>
            <Walkthrough />
        </div>
    );
}
