"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shareOpenFailed } from "../../analytics/events";
import { routes } from "../../routes";
import { hasPersistedGameData } from "./useApplyShareSnapshot";
import { hashShareId } from "./shareAnalytics";

const SHARE_OPEN_FAILED_REASON = "not_found_or_expired" as const;
const SETUP_VIEW_QUERY = "?view=setup" as const;

export function ShareMissingPage({
    shareId,
}: {
    readonly shareId: string;
}) {
    const t = useTranslations("share");
    const router = useRouter();
    const [hasCurrentGame, setHasCurrentGame] = useState(false);

    useEffect(() => {
        setHasCurrentGame(hasPersistedGameData());
    }, []);

    useEffect(() => {
        shareOpenFailed({
            shareIdHash: hashShareId(shareId),
            reason: SHARE_OPEN_FAILED_REASON,
        });
    }, [shareId]);

    const target = hasCurrentGame
        ? routes.play
        : `${routes.play}${SETUP_VIEW_QUERY}`;
    const actionLabel = hasCurrentGame
        ? t("missingActionContinue")
        : t("missingActionStart");

    return (
        <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
            <h1 className="m-0 font-display text-[1.75rem] text-accent">
                {t("importTitle")}
            </h1>
            <Dialog.Root open>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                    <Dialog.Content
                        className={
                            "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] flex w-[min(92vw,480px)] flex-col " +
                            "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                            "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                        }
                    >
                        <div className="px-5 pt-5">
                            <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                                {t("missingTitle")}
                            </Dialog.Title>
                            <Dialog.Description className="pt-3 text-[1rem] leading-relaxed text-muted">
                                {t("missingBody")}
                            </Dialog.Description>
                        </div>
                        <div className="mt-4 flex items-center justify-end border-t border-border bg-panel px-5 pt-4 pb-5">
                            <button
                                type="button"
                                onClick={() => router.push(target)}
                                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover"
                                data-share-missing-cta
                            >
                                {actionLabel}
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </main>
    );
}
