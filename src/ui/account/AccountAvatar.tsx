"use client";

import { UserIcon } from "../components/Icons";
import type { useSession } from "../hooks/useSession";

type SessionUser = NonNullable<ReturnType<typeof useSession>["data"]>["user"];

const initialsFor = (user: SessionUser): string => {
    const source = user.name ?? user.email;
    const trimmed = source.trim();
    if (trimmed.length === 0) return "?";
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    return trimmed[0]!.toUpperCase();
};

export function AccountAvatar({
    user,
    sizeClassName,
}: {
    readonly user: SessionUser | null | undefined;
    readonly sizeClassName: string;
}) {
    if (user && !user.isAnonymous && user.image) {
        return (
            <img
                src={user.image}
                alt=""
                className={`${sizeClassName} rounded-full object-cover`}
            />
        );
    }
    if (user && !user.isAnonymous) {
        return (
            <span
                aria-hidden="true"
                className={`${sizeClassName} inline-flex items-center justify-center rounded-full bg-accent text-[1rem] font-semibold text-white`}
            >
                {initialsFor(user)}
            </span>
        );
    }
    return (
        <span
            aria-hidden="true"
            className={`${sizeClassName} inline-flex items-center justify-center rounded-full border border-border bg-white text-muted`}
        >
            <UserIcon size={16} />
        </span>
    );
}
