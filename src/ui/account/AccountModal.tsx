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
import { DateTime } from "effect";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    type SignInFromContext,
    signInFailed,
    signInStarted,
} from "../../analytics/events";
import {
    getMyCardPacks,
    type PersistedCardPack,
} from "../../server/actions/packs";
import {
    myCardPacksQueryKey,
    useCustomCardPacks,
} from "../../data/customCardPacks";
import { useIsSyncingCardPacks } from "../../data/cardPacksInFlight";
import { flushPendingChanges } from "../../data/cardPacksSync";
import { decodeServerPack } from "../../data/serverPackCodec";
import type { CardSet } from "../../logic/CardSet";
import type { CustomCardSet } from "../../logic/CustomCardSets";
import { useSession } from "../hooks/useSession";
import {
    CardStackIcon,
    PencilIcon,
    RefreshIcon,
    TrashIcon,
    XIcon,
} from "../components/Icons";
import { ShareIcon } from "../components/ShareIcon";
import { useCardPackActions } from "../components/cardPackActions";
import { AccountAvatar } from "./AccountAvatar";
import { authClient } from "./authClient";
import { DevSignInForm } from "./DevSignInForm";

const isDev = process.env.NODE_ENV === "development";

const PROVIDER_GOOGLE = "google" as const;
const SIGN_IN_FROM_MENU: SignInFromContext = "menu";

/**
 * A card pack as rendered in the modal. Carries the live `CardSet`
 * so the per-row Share / Edit / Delete actions don't have to lazily
 * decode `cardSetData` on click. `clientGeneratedId` is the
 * cross-device-stable identity (equals the local id; matches a server
 * row's `client_generated_id` column). `source` tracks which side of
 * the merge the entry came from so dedupe logic outside this module
 * can reason about it if needed.
 */
interface DisplayPack {
    readonly id: string;
    readonly clientGeneratedId: string;
    readonly label: string;
    readonly cardSet: CardSet;
    readonly source: "server" | "local";
    readonly unsyncedSince: DateTime.Utc | undefined;
}

export const mergeCardPacks = (
    localPacks: ReadonlyArray<CustomCardSet>,
    serverPacks: ReadonlyArray<PersistedCardPack>,
): ReadonlyArray<DisplayPack> => {
    // The continuous reconcile in `CardPacksSync` swaps local ids
    // for server ids once a pack has been pulled, so the local
    // `id` may equal EITHER a server `id` OR a server
    // `clientGeneratedId`. Track both to catch every pair-match.
    const serverIdentities = new Set<string>();
    for (const pack of serverPacks) {
        serverIdentities.add(pack.id);
        serverIdentities.add(pack.clientGeneratedId);
    }
    const localById = new Map<string, CustomCardSet>();
    for (const pack of localPacks) {
        localById.set(pack.id, pack);
    }
    const decodedServer: ReadonlyArray<DisplayPack> = serverPacks.flatMap(
        (pack) => {
            const decoded = decodeServerPack(pack);
            if (decoded === null) return [];
            const local =
                localById.get(pack.id) ??
                localById.get(pack.clientGeneratedId);
            return [
                {
                    id: pack.id,
                    clientGeneratedId: pack.clientGeneratedId,
                    label: pack.label,
                    cardSet: decoded.cardSet,
                    source: "server" as const,
                    unsyncedSince: local?.unsyncedSince,
                },
            ];
        },
    );
    const localOnly: ReadonlyArray<DisplayPack> = localPacks
        .filter((pack) => !serverIdentities.has(pack.id))
        .map((pack) => ({
            id: pack.id,
            clientGeneratedId: pack.id,
            label: pack.label,
            cardSet: pack.cardSet,
            source: "local" as const,
            unsyncedSince: pack.unsyncedSince,
        }));
    return [...decodedServer, ...localOnly];
};

export function AccountModal({
    open,
    onClose,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const t = useTranslations("account");
    const tCommon = useTranslations("common");
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const session = useSession();
    const user = session.data?.user;
    const isAnon = !user || user.isAnonymous;
    const localCardPacks = useCustomCardPacks();
    const myCardPacks = useQuery({
        queryKey: myCardPacksQueryKey(user?.id),
        queryFn: getMyCardPacks,
        enabled: open && !isAnon,
    });
    const packs = mergeCardPacks(
        localCardPacks.data ?? [],
        myCardPacks.data ?? [],
    );
    const { sharePack, renamePack, deletePack } = useCardPackActions();
    const queryClient = useQueryClient();
    const isInFlight = useIsSyncingCardPacks();
    const isSyncing = isInFlight || myCardPacks.isFetching;

    const handleSyncNow = async (): Promise<void> => {
        await flushPendingChanges();
        await queryClient.invalidateQueries({
            queryKey: myCardPacksQueryKey(user?.id),
        });
    };

    const callbackURL = (): string => {
        const qs = searchParams.toString();
        return qs.length > 0 ? `${pathname}?${qs}` : pathname;
    };

    const onGoogleSignIn = async (): Promise<void> => {
        signInStarted({ provider: PROVIDER_GOOGLE, from: SIGN_IN_FROM_MENU });
        const result = await authClient.signIn.social({
            provider: PROVIDER_GOOGLE,
            callbackURL: callbackURL(),
        });
        if (result.error !== null) {
            signInFailed({
                provider: PROVIDER_GOOGLE,
                reason: result.error.code ?? String(result.error.status),
            });
        }
    };

    const onDevSignedIn = async (): Promise<void> => {
        await session.refetch();
        onClose();
    };

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                <Dialog.Content
                    className={
                        "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] flex w-[min(92vw,440px)] flex-col " +
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
                                    onClick={() => void onGoogleSignIn()}
                                    className="tap-target text-tap mt-4 cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover"
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
                                    <AccountAvatar
                                        user={user}
                                        sizeClassName="h-12 w-12"
                                    />
                                    <div className="flex flex-col">
                                        <div className="text-[15px] font-semibold">
                                            {user?.name ?? user?.email}
                                        </div>
                                        <div className="text-[12px] text-muted">
                                            {user?.email}
                                        </div>
                                    </div>
                                </div>
                                <section className="rounded-[var(--radius)] border border-border bg-white px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <h3 className="m-0 text-[13px] font-semibold text-accent">
                                            {t("myCardPacksTitle")}
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => void handleSyncNow()}
                                            disabled={isSyncing}
                                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border border-border bg-white px-2 py-1 text-[12px] text-muted transition-colors duration-200 ease-out hover:bg-hover hover:text-accent disabled:cursor-not-allowed"
                                        >
                                            <RefreshIcon
                                                size={12}
                                                className={
                                                    isSyncing
                                                        ? "animate-spin"
                                                        : ""
                                                }
                                            />
                                            <span>
                                                {t(
                                                    isSyncing
                                                        ? "syncing"
                                                        : "syncNow",
                                                )}
                                            </span>
                                        </button>
                                    </div>
                                    {myCardPacks.isPending && packs.length === 0 ? (
                                        <div className="mt-2 text-[12px] text-muted">
                                            {t("myCardPacksLoading")}
                                        </div>
                                    ) : myCardPacks.isError && packs.length === 0 ? (
                                        <div className="mt-2 text-[12px] text-danger">
                                            {t("myCardPacksError")}
                                        </div>
                                    ) : packs.length === 0 ? (
                                        <div className="mt-2 text-[12px] text-muted">
                                            {t("myCardPacksEmpty")}
                                        </div>
                                    ) : (
                                        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[13px]">
                                            {packs.map((pack) => {
                                                const hasPending =
                                                    pack.unsyncedSince !==
                                                    undefined;
                                                return (
                                                <li
                                                    key={pack.id}
                                                    className="flex items-stretch overflow-hidden rounded border border-border bg-row-alt"
                                                >
                                                    <span
                                                        className="flex items-center self-stretch border-r border-border px-2.5 text-muted"
                                                        title={t(
                                                            hasPending
                                                                ? "packPendingTitle"
                                                                : "packSyncedTitle",
                                                        )}
                                                        aria-label={t(
                                                            hasPending
                                                                ? "packPendingAria"
                                                                : "packSyncedAria",
                                                            { label: pack.label },
                                                        )}
                                                    >
                                                        {hasPending ? (
                                                            <RefreshIcon
                                                                size={14}
                                                                className={
                                                                    isSyncing
                                                                        ? "animate-spin"
                                                                        : ""
                                                                }
                                                            />
                                                        ) : (
                                                            <CardStackIcon
                                                                size={14}
                                                            />
                                                        )}
                                                    </span>
                                                    <span className="flex-1 truncate self-center px-3 py-2">
                                                        {pack.label}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            sharePack(pack)
                                                        }
                                                        className="inline-flex cursor-pointer items-center border-l border-border px-2.5 py-1.5 text-muted transition-colors duration-200 ease-out hover:bg-hover hover:text-accent"
                                                        title={t("sharePackTitle", { label: pack.label })}
                                                        aria-label={t("sharePackAria", { label: pack.label })}
                                                    >
                                                        <ShareIcon size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void renamePack(pack)
                                                        }
                                                        className="inline-flex cursor-pointer items-center border-l border-border px-2.5 py-1.5 text-muted transition-colors duration-200 ease-out hover:bg-hover hover:text-accent"
                                                        title={t("renamePackTitle", { label: pack.label })}
                                                        aria-label={t("renamePackAria", { label: pack.label })}
                                                    >
                                                        <PencilIcon size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void deletePack(pack)
                                                        }
                                                        className="inline-flex cursor-pointer items-center border-l border-border px-2.5 py-1.5 text-muted transition-colors duration-200 ease-out hover:bg-hover hover:text-danger"
                                                        title={t("deletePackTitle", { label: pack.label })}
                                                        aria-label={t("deletePackAria", { label: pack.label })}
                                                    >
                                                        <TrashIcon size={14} />
                                                    </button>
                                                </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </section>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
