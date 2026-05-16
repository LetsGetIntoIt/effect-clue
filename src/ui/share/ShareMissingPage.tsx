"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { shareOpenFailed } from "../../analytics/events";
import { routes } from "../../routes";
import { Modal } from "../components/Modal";
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
    const [open, setOpen] = useState(true);

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

    const onAction = (): void => {
        setOpen(false);
        router.push(target);
    };

    return (
        <main className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-8">
            <h1 className="m-0 text-[1.5rem] uppercase tracking-[0.05em] text-accent">
                {t("importTitle")}
            </h1>
            <Modal
                open={open}
                title={t("missingTitle")}
                onOpenChange={(next) => {
                    if (!next) onAction();
                }}
                header={
                    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                        <Dialog.Title className="m-0 font-display text-[1.25rem] uppercase tracking-[0.05em] text-accent">
                            {t("missingTitle")}
                        </Dialog.Title>
                    </div>
                }
                content={
                    <Dialog.Description className="m-0 px-5 pt-3 pb-3 text-[1rem] leading-normal text-muted">
                        {t("missingBody")}
                    </Dialog.Description>
                }
                footer={
                    <div className="flex items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
                        <button
                            type="button"
                            onClick={onAction}
                            className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover"
                            data-share-missing-cta
                        >
                            {actionLabel}
                        </button>
                    </div>
                }
            />
        </main>
    );
}
