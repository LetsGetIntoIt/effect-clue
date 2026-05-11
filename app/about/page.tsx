"use client";

import { useTranslations } from "next-intl";
import { AboutContent } from "../../src/ui/components/AboutContent";

export default function AboutPage() {
    const t = useTranslations("about");
    return (
        <main className="mx-auto flex max-w-2xl flex-col gap-5 px-5 py-8">
            <h1 className="m-0 font-display text-[1.75rem] text-accent">
                {t("pageHeading")}
            </h1>
            <AboutContent context="page" />
        </main>
    );
}
