/**
 * Modal that opens when [`requestSignOut`] detects unsynced card-pack
 * changes (offline or server error). Lists each affected pack under
 * `Created`, `Modified`, or `Deleted`, with inline tags on
 * `Modified` rows describing whether the label, the cards, or both
 * changed. Three actions:
 *
 *   - **Stay logged in** (cancel — default focused, safe option).
 *   - **Try again** (only when `reason === "serverError"`) — re-runs
 *     the flush and either closes the modal on success or refreshes
 *     the list with whatever's still pending.
 *   - **Sign out anyway** (destructive) — clears account-tied
 *     localStorage and signs out. The just-discarded changes are
 *     lost.
 *
 * Pushed onto the shared `ModalStack` via the standard three slots
 * (`LogoutWarningHeader`, `LogoutWarningBody`, `LogoutWarningFooter`).
 * Alert-style: `dismissOnOutsideClick: false` + `dismissOnEscape:
 * false` so a stray click can't drop the user into a half-warned
 * state. The header carries no X close — dismissal goes through the
 * explicit footer buttons.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";
import type {
    FlushReason,
    UnsyncedSummary,
} from "../../data/cardPacksSync";

interface SectionProps {
    readonly heading: string;
    readonly children: ReactNode;
}

const Section = ({ heading, children }: SectionProps) => (
    <section className="mt-4">
        <h3 className="m-0 text-[1.125rem] font-semibold text-accent">
            {heading}
        </h3>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-[1rem]">
            {children}
        </ul>
    </section>
);

const Tag = ({ children }: { readonly children: ReactNode }) => (
    <span className="ml-2 inline-block rounded-[var(--radius-pill,999px)] border border-border px-2 py-px text-[1rem] font-semibold text-muted">
        {children}
    </span>
);

export const LOGOUT_WARNING_MODAL_ID = "logout-warning" as const;
export const LOGOUT_WARNING_MAX_WIDTH = "min(92vw,460px)" as const;

export function LogoutWarningHeader() {
    const t = useTranslations("account.logoutWarning");
    return (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                {t("title")}
            </Dialog.Title>
        </div>
    );
}

export function LogoutWarningBody({
    summary,
    reason,
}: {
    readonly summary: UnsyncedSummary | null;
    readonly reason: FlushReason | null;
}) {
    const t = useTranslations("account.logoutWarning");
    const created = summary?.created ?? [];
    const modified = summary?.modified ?? [];
    const deleted = summary?.deleted ?? [];

    return (
        <div className="px-5 pt-3 pb-3">
            <p className="m-0 text-[1rem] leading-snug text-[#2a1f12]">
                {reason === "offline"
                    ? t("ledeOffline")
                    : t("ledeServerError")}
            </p>
            {created.length > 0 ? (
                <Section
                    heading={t("createdHeading", {
                        count: created.length,
                    })}
                >
                    {created.map((p) => (
                        <li
                            key={p.id}
                            className="truncate rounded bg-row-alt px-2 py-1"
                        >
                            {p.label}
                        </li>
                    ))}
                </Section>
            ) : null}
            {modified.length > 0 ? (
                <Section
                    heading={t("modifiedHeading", {
                        count: modified.length,
                    })}
                >
                    {modified.map((p) => (
                        <li
                            key={p.id}
                            className="truncate rounded bg-row-alt px-2 py-1"
                        >
                            {p.label}
                            {p.labelChanged ? (
                                <Tag>{t("tagRenamed")}</Tag>
                            ) : null}
                            {p.cardsChanged ? (
                                <Tag>{t("tagCardsChanged")}</Tag>
                            ) : null}
                        </li>
                    ))}
                </Section>
            ) : null}
            {deleted.length > 0 ? (
                <Section
                    heading={t("deletedHeading", {
                        count: deleted.length,
                    })}
                >
                    {deleted.map((p) => (
                        <li
                            key={p.id}
                            className="truncate rounded bg-row-alt px-2 py-1"
                        >
                            {p.label}
                        </li>
                    ))}
                </Section>
            ) : null}
        </div>
    );
}

export function LogoutWarningFooter({
    reason,
    retrying,
    onStay,
    onRetry,
    onSignOutAnyway,
}: {
    readonly reason: FlushReason | null;
    readonly retrying: boolean;
    readonly onStay: () => void;
    readonly onRetry: () => void;
    readonly onSignOutAnyway: () => void;
}) {
    const t = useTranslations("account.logoutWarning");
    return (
        <div className="flex flex-wrap items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
            <button
                type="button"
                onClick={onStay}
                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover"
            >
                {t("stayLoggedIn")}
            </button>
            {reason === "serverError" ? (
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={retrying}
                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-panel font-semibold text-[#2a1f12] hover:bg-hover disabled:opacity-60"
                >
                    {retrying ? t("tryingAgain") : t("tryAgain")}
                </button>
            ) : null}
            <button
                type="button"
                onClick={onSignOutAnyway}
                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover"
            >
                {t("signOutAnyway")}
            </button>
        </div>
    );
}
