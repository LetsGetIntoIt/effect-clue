/**
 * Account modal — the sign-in / profile / sign-out surface.
 *
 * Anonymous (signed-out) state shows a Google sign-in CTA + the
 * benefits ("Sync custom card packs across devices", "Save shared
 * games"). Signed-in state shows the user's name + email + avatar
 * + a "Sign out" button. M8 will append a "My card packs" section
 * for managing server-stored packs.
 *
 * The dev-only sign-in form below the Google CTA is conditionally
 * rendered behind `process.env.NODE_ENV === "development"` —
 * defense-in-depth layer 4. The condition collapses to `false`
 * in production builds, so the entire `<DevSignInForm />` subtree
 * (and this file's import of it) tree-shakes out.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { sessionQueryKey, useSession } from "../hooks/useSession";
import { XIcon } from "../components/Icons";
import { DevSignInForm } from "./DevSignInForm";

const isDev = process.env.NODE_ENV === "development";

// Wire-format constants — exempt from i18next/no-literal-string.
const SIGN_OUT_URL = "/api/auth/sign-out";
const METHOD_POST = "POST";
const CRED_INCLUDE: RequestCredentials = "include";

export function AccountModal({
    open,
    onClose,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const t = useTranslations("account");
    const tCommon = useTranslations("common");
    const queryClient = useQueryClient();
    const session = useSession();

    const onGoogleSignIn = (): void => {
        if (typeof window === "undefined") return;
        // Redirect via better-auth's social-sign-in endpoint. We
        // round-trip rather than calling a JS API so the cookie
        // lands the same way for OAuth + dev-credentials paths.
        const url = `/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(window.location.pathname)}`;
        window.location.href = url;
    };

    const onSignOut = async (): Promise<void> => {
        await fetch(SIGN_OUT_URL, {
            method: METHOD_POST,
            credentials: CRED_INCLUDE,
        });
        await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        onClose();
    };

    const onDevSignedIn = async (): Promise<void> => {
        await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
        onClose();
    };

    const user = session.data?.user;
    const isAnon = !user || user.isAnonymous;

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-50 flex w-[min(92vw,440px)] flex-col " +
                        "-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                >
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
                        <Dialog.Title className="m-0 font-display text-[20px] text-accent">
                            {isAnon ? t("titleSignedOut") : t("titleSignedIn")}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={tCommon("close")}
                            className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="px-5 pt-3 text-[14px] leading-relaxed">
                        {isAnon ? t("descriptionSignedOut") : t("descriptionSignedIn")}
                    </Dialog.Description>
                    <div className="px-5 pb-5">
                        {isAnon ? (
                            <div className="mt-4 flex flex-col gap-2">
                                <ul className="m-0 list-disc pl-5 text-[14px]">
                                    <li>{t("benefitSyncPacks")}</li>
                                    <li>{t("benefitSharedGames")}</li>
                                </ul>
                                <button
                                    type="button"
                                    onClick={onGoogleSignIn}
                                    className="mt-4 cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent px-4 py-2 text-[14px] font-semibold text-white hover:bg-accent-hover"
                                >
                                    {t("signInWithGoogle")}
                                </button>
                                {isDev ? (
                                    <DevSignInForm onSignedIn={onDevSignedIn} />
                                ) : null}
                            </div>
                        ) : (
                            <div className="mt-4 flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    {user?.image !== null && user?.image !== undefined ? (
                                        <img
                                            src={user.image}
                                            alt=""
                                            className="h-12 w-12 rounded-full"
                                        />
                                    ) : null}
                                    <div className="flex flex-col">
                                        <div className="text-[15px] font-semibold">
                                            {user?.name ?? user?.email}
                                        </div>
                                        <div className="text-[12px] text-muted">
                                            {user?.email}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void onSignOut()}
                                    className="mt-2 cursor-pointer rounded-[var(--radius)] border border-border bg-white px-4 py-2 text-[13px] hover:bg-hover"
                                >
                                    {t("signOut")}
                                </button>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
